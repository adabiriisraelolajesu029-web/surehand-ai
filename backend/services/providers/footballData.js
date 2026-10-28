import { config } from "../../config.js";

/**
 * football-data.org (v4) adapter, built for the FREE tier.
 *
 * Free tier gives: fixtures, results, the overall league table and top scorers for
 * the top competitions in the current season, at 10 requests/minute.
 * It does NOT give injuries, suspensions, lineups, minutes or shot data. Those fields are simply
 * omitted (never guessed) and the UI / prompt treat availability as unknown.
 *
 * NOTE: written against the public v4 docs but NOT yet run against the live API
 * (the build sandbox cannot reach it). Check real responses before trusting it.
 */

// Accept API-Football numeric ids (the earlier default) or football-data codes.
const ID_TO_CODE = { 39: "PL", 140: "PD", 135: "SA", 78: "BL1", 61: "FL1" };
const DEFAULT_CODES = ["PL", "PD", "SA", "BL1", "FL1"];
const codes = () => {
  const c = config.football.leagues.map((x) => ID_TO_CODE[x] || String(x).toUpperCase());
  return c.length ? c : DEFAULT_CODES; // "all" is not possible on the free tier
};

// ---- TTL cache ----
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  return val;
}
const MIN = 60_000, HOUR = 60 * MIN;

// ---- rate limiter: free tier allows 10 calls/minute, so calls are serialized ~6.2s apart ----
const GAP_MS = Number(process.env.FOOTBALL_API_MIN_GAP_MS ?? 6200);
let chain = Promise.resolve(), lastAt = 0;
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function call(path, params = {}, { optional = false } = {}) {
  const url = new URL(config.football.baseUrl.replace(/\/?$/, "/") + path.replace(/^\//, ""));
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await throttled(async () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      try { return await fetch(url, { headers: { "X-Auth-Token": config.football.key }, signal: ctl.signal }); }
      finally { clearTimeout(t); }
    });
    if (res.status === 429 && attempt === 0) { // rate limited: wait as told, retry once
      const wait = Number(res.headers.get("retry-after")) || 30;
      await new Promise((r) => setTimeout(r, Math.min(wait, 65) * 1000));
      continue;
    }
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    if (optional && [400, 403, 404].includes(res.status)) return null; // resource not in this plan
    throw new Error(`football-data.org ${res.status}: ${body.message || res.statusText}`);
  }
  throw new Error("football-data.org: rate limit exceeded, try again shortly");
}

const STATUS = { SCHEDULED: "scheduled", TIMED: "scheduled", POSTPONED: "postponed", SUSPENDED: "postponed", CANCELLED: "cancelled", FINISHED: "finished", AWARDED: "finished", IN_PLAY: "live", PAUSED: "live" };

function toFixture(m) {
  const team = (t) => ({ id: String(t.id), name: t.name, short: t.tla || t.shortName?.slice(0, 3).toUpperCase() || t.name.slice(0, 3).toUpperCase() });
  return {
    id: String(m.id),
    kickoffUtc: new Date(m.utcDate).toISOString(),
    status: STATUS[m.status] || "scheduled",
    league: { id: m.competition.code, name: m.competition.name, country: m.area?.name || "" },
    home: team(m.homeTeam),
    away: team(m.awayTeam),
  };
}

// ---------------------------------------------------------------- public API
export async function getFixtures({ date, league, country }) {
  const wanted = league ? [ID_TO_CODE[league] || String(league).toUpperCase()] : codes();
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  // dateTo is widened by a day then filtered, so the result is right whether the API treats it as inclusive or not.
  const body = await cached(`fx:${date}:${wanted}`, 15 * MIN, () =>
    call("matches", { dateFrom: date, dateTo: next, competitions: wanted.join(",") }));
  return (body.matches || [])
    .filter((m) => m.utcDate.startsWith(date))
    .filter((m) => !country || (m.area?.name || "").toLowerCase() === String(country).toLowerCase())
    .map(toFixture)
    .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
}

async function rawMatch(id) {
  return cached(`m:${id}`, 10 * MIN, async () => {
    const m = await call(`matches/${id}`);
    if (!m || !m.homeTeam) { const e = new Error(`Fixture ${id} not found`); e.status = 404; throw e; }
    return m;
  });
}

const finishedMatches = (code) => cached(`fin:${code}`, HOUR, async () => (await call(`competitions/${code}/matches`, { status: "FINISHED" })).matches || []);

/**
 * Home/away records per team and league scoring averages, built from the season's finished matches.
 * (The free tier's standings only include the overall table, not separate home/away tables.)
 */
function buildRecords(fin) {
  const zero = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const add = (r, gf, ga) => { r.p++; r.gf += gf; r.ga += ga; if (gf > ga) r.w++; else if (gf < ga) r.l++; else r.d++; };
  const teams = new Map();
  const get = (id) => { if (!teams.has(id)) teams.set(id, { home: zero(), away: zero() }); return teams.get(id); };
  let homeGoals = 0, awayGoals = 0, n = 0;
  for (const g of fin) {
    const ft = g.score?.fullTime;
    if (ft?.home == null || ft?.away == null) continue;
    n++; homeGoals += ft.home; awayGoals += ft.away;
    add(get(String(g.homeTeam.id)).home, ft.home, ft.away);
    add(get(String(g.awayTeam.id)).away, ft.away, ft.home);
  }
  const splitsOf = (teamId) => {
    const t = teams.get(String(teamId));
    if (!t || t.home.p + t.away.p === 0) return null;
    const overall = { p: t.home.p + t.away.p, w: t.home.w + t.away.w, d: t.home.d + t.away.d, l: t.home.l + t.away.l, gf: t.home.gf + t.away.gf, ga: t.home.ga + t.away.ga };
    return { overall, home: t.home, away: t.away };
  };
  return { splitsOf, leagueAvg: n > 0 ? { homeGoals: homeGoals / n, awayGoals: awayGoals / n } : null };
}
const scorers = (code) => cached(`sc:${code}`, 6 * HOUR, async () => (await call(`competitions/${code}/scorers`, { limit: 60 })).scorers || []);

export async function getMatchContext(fixtureId) {
  const m = await rawMatch(fixtureId);
  const fx = toFixture(m), code = m.competition.code;
  return cached(`ctx:${fixtureId}`, 3 * HOUR, async () => {
    const [fin, h2h] = await Promise.all([
      finishedMatches(code),
      call(`matches/${fixtureId}/head2head`, { limit: 5 }, { optional: true }),
    ]);
    const { splitsOf, leagueAvg } = buildRecords(fin);
    const form = (teamId) => fin
      .filter((g) => String(g.homeTeam.id) === teamId || String(g.awayTeam.id) === teamId)
      .sort((a, b) => b.utcDate.localeCompare(a.utcDate)).slice(0, 5)
      .map((g) => {
        const isHome = String(g.homeTeam.id) === teamId;
        const gf = isHome ? g.score.fullTime.home : g.score.fullTime.away, ga = isHome ? g.score.fullTime.away : g.score.fullTime.home;
        return { opp: isHome ? g.awayTeam.name : g.homeTeam.name, venue: isHome ? "H" : "A", gf, ga, res: gf > ga ? "W" : gf < ga ? "L" : "D" };
      });
    const ctx = {
      fixture: fx,
      ...(leagueAvg ? { leagueAvg } : {}),
      form: { home: form(fx.home.id), away: form(fx.away.id) },
      stats: { home: splitsOf(fx.home.id), away: splitsOf(fx.away.id), sample: "League matches this season to date" },
    };
    // Head-to-head is omitted entirely if the plan does not provide it (the UI hides the block).
    if (h2h?.matches) {
      ctx.h2h = h2h.matches.filter((g) => g.score?.fullTime?.home != null).map((g) => ({
        date: g.utcDate.slice(0, 10), homeId: String(g.homeTeam.id), awayId: String(g.awayTeam.id),
        home: g.homeTeam.name, away: g.awayTeam.name, hg: g.score.fullTime.home, ag: g.score.fullTime.away,
      }));
    }
    return ctx;
  });
}

/** Free tier: league top scorers only. No injuries, suspensions, lineups, minutes or shots, so those fields are omitted. */
export async function getPlayerIntel(fixtureId) {
  const m = await rawMatch(fixtureId);
  const list = await scorers(m.competition.code);
  const side = (team) => list
    .filter((s) => String(s.team.id) === String(team.id))
    .map((s) => ({
      id: String(s.player.id), name: s.player.name, team: team.name, pos: s.player.section || s.player.position || "",
      apps: s.playedMatches ?? 0, goals: s.goals ?? 0, minutes: null, shotsPer90: null,
    }));
  return { home: side(m.homeTeam), away: side(m.awayTeam) };
}

export async function getResults(fixtureIds) {
  const out = [];
  for (const id of fixtureIds) {
    const m = await call(`matches/${id}`);
    if (m.status !== "FINISHED" && m.status !== "AWARDED") continue;
    const ft = m.score?.fullTime;
    if (ft?.home == null) continue;
    // Goal lists may not be included in the free plan. null = unknown, which the accuracy tracker skips (never counts as a miss).
    const scorers = Array.isArray(m.goals)
      ? [...new Set(m.goals.filter((g) => g.type !== "OWN" && g.scorer?.id).map((g) => String(g.scorer.id)))]
      : null;
    out.push({ fixtureId: String(m.id), home: ft.home, away: ft.away, scorers });
  }
  return out;
}
