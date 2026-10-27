import { config } from "../../config.js";

/**
 * API-Football (api-sports.io, v3) adapter.
 * Maps raw responses into the normalized shapes in docs/DATA_CONTRACTS.md.
 * Anything the provider does not report is omitted or null, never guessed.
 *
 * NOTE: written against the public v3 docs but NOT yet run against the live API
 * (the build sandbox cannot reach it). Run a few real fixtures and compare by eye.
 */

// ---- tiny TTL cache: protects the daily request quota from repeat page views ----
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  return val;
}
const MIN = 60_000, HOUR = 60 * MIN;

async function call(path, params = {}) {
  const url = new URL(path, config.football.baseUrl);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { "x-apisports-key": config.football.key }, signal: ctl.signal });
    if (!res.ok) throw new Error(`API-Football request failed (${res.status})`);
    const body = await res.json();
    // API-Football reports quota/plan/param problems with HTTP 200 and an `errors` field.
    const errs = Array.isArray(body.errors) ? body.errors : Object.values(body.errors || {});
    if (errs.length) throw new Error(`API-Football: ${errs.join("; ")}`);
    return body.response || [];
  } finally { clearTimeout(t); }
}

const seasonFor = (iso) => { const d = new Date(iso); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };
const short = (name) => name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).join("").slice(0, 3).toUpperCase() || "???";
const STATUS = { NS: "scheduled", TBD: "scheduled", PST: "postponed", CANC: "cancelled", FT: "finished", AET: "finished", PEN: "finished" };
const statusOf = (s) => STATUS[s] || (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(s) ? "live" : "scheduled");

function toFixture(r) {
  return {
    id: String(r.fixture.id),
    kickoffUtc: new Date(r.fixture.date).toISOString(),
    status: statusOf(r.fixture.status?.short),
    league: { id: String(r.league.id), name: r.league.name, country: r.league.country },
    home: { id: String(r.teams.home.id), name: r.teams.home.name, short: short(r.teams.home.name) },
    away: { id: String(r.teams.away.id), name: r.teams.away.name, short: short(r.teams.away.name) },
    _season: r.league.season,
  };
}
const publicFixture = ({ _season, ...f }) => f;

async function fixtureById(id) {
  return cached(`fx:${id}`, 10 * MIN, async () => {
    const [r] = await call("/fixtures", { id });
    if (!r) { const e = new Error(`Fixture ${id} not found`); e.status = 404; throw e; }
    return toFixture(r);
  });
}

// ---------------------------------------------------------------- public API
export async function getFixtures({ date, league, country }) {
  // config.football.leagues is [] when FOOTBALL_LEAGUE_IDS=all (no league filter).
  const wanted = league ? [String(league)] : config.football.leagues;
  // One request per day (not per league) keeps quota use at 1 call.
  const rows = await cached(`fxdate:${date}`, 15 * MIN, () => call("/fixtures", { date, timezone: "UTC" }));
  return rows
    .filter((r) => !wanted.length || wanted.includes(String(r.league.id)))
    .filter((r) => !country || r.league.country.toLowerCase() === String(country).toLowerCase())
    .map(toFixture).map(publicFixture)
    .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
}

export async function getMatchContext(fixtureId) {
  const fx = await fixtureById(fixtureId);
  const season = fx._season ?? seasonFor(fx.kickoffUtc);
  return cached(`ctx:${fixtureId}`, 30 * MIN, async () => {
    const [formH, formA, statsH, statsA, h2h] = await Promise.all([
      recentForm(fx.home.id), recentForm(fx.away.id),
      teamSplits(fx.league.id, season, fx.home.id), teamSplits(fx.league.id, season, fx.away.id),
      call("/fixtures/headtohead", { h2h: `${fx.home.id}-${fx.away.id}`, last: 5 }),
    ]);
    return {
      fixture: publicFixture(fx),
      form: { home: formH, away: formA },
      stats: { home: statsH, away: statsA, sample: `${season}/${String(season + 1).slice(2)} league season to date` },
      h2h: h2h.filter((g) => g.goals.home !== null).map((g) => ({
        date: g.fixture.date.slice(0, 10),
        homeId: String(g.teams.home.id), awayId: String(g.teams.away.id),
        home: g.teams.home.name, away: g.teams.away.name,
        hg: g.goals.home, ag: g.goals.away,
      })),
    };
  });
}

async function recentForm(teamId) {
  return cached(`form:${teamId}`, HOUR, async () => {
    const rows = await call("/fixtures", { team: teamId, last: 5, status: "FT-AET-PEN" });
    return rows.map((g) => {
      const isHome = String(g.teams.home.id) === String(teamId);
      const gf = isHome ? g.goals.home : g.goals.away, ga = isHome ? g.goals.away : g.goals.home;
      return { opp: isHome ? g.teams.away.name : g.teams.home.name, venue: isHome ? "H" : "A", gf, ga, res: gf > ga ? "W" : gf < ga ? "L" : "D" };
    });
  });
}

async function teamSplits(leagueId, season, teamId) {
  return cached(`splits:${leagueId}:${season}:${teamId}`, 6 * HOUR, async () => {
    const s = await call("/teams/statistics", { league: leagueId, season, team: teamId });
    const t = Array.isArray(s) ? s[0] : s;
    if (!t || !t.fixtures) return null;
    const pick = (k) => ({
      p: t.fixtures.played[k] ?? 0, w: t.fixtures.wins[k] ?? 0, d: t.fixtures.draws[k] ?? 0, l: t.fixtures.loses[k] ?? 0,
      gf: t.goals.for.total[k] ?? 0, ga: t.goals.against.total[k] ?? 0,
    });
    return { overall: pick("total"), home: pick("home"), away: pick("away") };
  });
}

export async function getPlayerIntel(fixtureId) {
  const fx = await fixtureById(fixtureId);
  const season = fx._season ?? seasonFor(fx.kickoffUtc);
  return cached(`players:${fixtureId}`, 20 * MIN, async () => {
    const [injuries, lineups] = await Promise.all([
      call("/injuries", { fixture: fixtureId }),
      call("/fixtures/lineups", { fixture: fixtureId }).catch(() => []), // usually only published ~1h before kickoff
    ]);
    const out = {};
    for (const side of ["home", "away"]) {
      const team = fx[side];
      const roster = await squadStats(team.id, fx.league.id, season);
      const lu = lineups.find((l) => String(l.team.id) === team.id);
      const starters = lu ? new Set(lu.startXI.map((x) => String(x.player.id))) : null;
      const unavailable = new Map(injuries.filter((i) => String(i.team.id) === team.id).map((i) => [String(i.player.id), i.player]));
      out[side] = roster.map((p) => {
        const inj = unavailable.get(p.id);
        const status = inj ? (/suspen/i.test(inj.reason || "") ? "suspended" : /question|doubt/i.test(inj.type || "") ? "doubt" : "injured") : "available";
        const rec = { ...p, team: team.name, status };
        if (inj?.reason) rec.note = inj.reason;
        if (starters) rec.lineup = status !== "available" ? "unlikely" : starters.has(p.id) ? "likely" : "unlikely";
        return rec;
      });
    }
    return out;
  });
}

/** Attackers/midfielders ranked by goal threat. Pulls up to 3 pages (60 players) per team. */
async function squadStats(teamId, leagueId, season) {
  return cached(`squad:${teamId}:${leagueId}:${season}`, 6 * HOUR, async () => {
    const rows = [];
    for (let page = 1; page <= 3; page++) {
      const res = await call("/players", { team: teamId, league: leagueId, season, page });
      rows.push(...res);
      if (res.length < 20) break;
    }
    return rows
      .map((r) => {
        const st = r.statistics?.[0] || {};
        const min = st.games?.minutes || 0;
        return {
          id: String(r.player.id), name: r.player.name, pos: (st.games?.position || "").replace("Attacker", "FW").replace("Midfielder", "MF").replace("Defender", "DF").replace("Goalkeeper", "GK"),
          apps: st.games?.appearences || 0, goals: st.goals?.total || 0, minutes: min,
          shotsPer90: min > 0 ? Math.round(((st.shots?.total || 0) / (min / 90)) * 100) / 100 : null,
        };
      })
      .filter((p) => p.pos !== "GK" && p.apps > 0)
      .sort((a, b) => b.goals - a.goals || (b.shotsPer90 ?? 0) - (a.shotsPer90 ?? 0))
      .slice(0, 10);
  });
}

export async function getResults(fixtureIds) {
  const out = [];
  for (let i = 0; i < fixtureIds.length; i += 20) {
    const rows = await call("/fixtures", { ids: fixtureIds.slice(i, i + 20).join("-") });
    for (const r of rows) {
      if (!["FT", "AET", "PEN"].includes(r.fixture.status?.short)) continue;
      const scorers = (r.events || [])
        .filter((e) => e.type === "Goal" && !/own goal|missed/i.test(e.detail || "") && e.player?.id)
        .map((e) => String(e.player.id));
      out.push({ fixtureId: String(r.fixture.id), home: r.goals.home, away: r.goals.away, scorers: [...new Set(scorers)] });
    }
  }
  return out;
}
