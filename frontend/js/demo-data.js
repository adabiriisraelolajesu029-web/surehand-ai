// ---------------------------------------------------------------------------
// DEMO DATA — every club, player, fixture, statistic and prediction in this file
// is FICTIONAL and generated locally so the interface can be previewed.
// None of it represents real football. It is only used when no backend/football
// API is connected, and the UI labels it "DEMO DATA" everywhere.
// Prediction numbers below come from a simple Poisson model on invented ratings —
// they are NOT output from Claude or any real analysis.
// ---------------------------------------------------------------------------

export const DEMO_SNAPSHOT_AT = "2026-10-27T06:00:00Z"; // static: demo data never "updates"

const LEAGUES = {
  npl: { id: "npl", name: "Northland Premier League", country: "Northland" },
  cvl: { id: "cvl", name: "Costa Verde Liga", country: "Costa Verde" },
  uc: { id: "uc", name: "Union Cup", country: "Continental" },
};

// att = goal-scoring multiplier, conc = goals-conceded multiplier (lower is a tighter defence)
const TEAMS = {
  rdm: { id: "rdm", name: "Redmoor Rovers", short: "RDM", color: "#e5484d", att: 1.25, conc: 0.85 },
  ash: { id: "ash", name: "Ashford United", short: "ASH", color: "#5fb4ff", att: 1.1, conc: 0.95 },
  kgp: { id: "kgp", name: "Kingsport City", short: "KGP", color: "#7cd4ff", att: 1.4, conc: 0.8 },
  hal: { id: "hal", name: "Halden Athletic", short: "HAL", color: "#f2b84b", att: 0.9, conc: 1.15 },
  wex: { id: "wex", name: "Wexcombe Town", short: "WEX", color: "#b39dff", att: 0.85, conc: 1.2 },
  brw: { id: "brw", name: "Brightwater FC", short: "BRW", color: "#4fd1c5", att: 1.0, conc: 1.0 },
  mar: { id: "mar", name: "Atlético Marisol", short: "MAR", color: "#ff8a5b", att: 1.2, conc: 0.9 },
  alc: { id: "alc", name: "Deportivo Alcira", short: "ALC", color: "#9be564", att: 0.95, conc: 1.05 },
  san: { id: "san", name: "Real Sancho", short: "SAN", color: "#e8e8f0", att: 1.3, conc: 0.85 },
  vis: { id: "vis", name: "CD Vistamar", short: "VIS", color: "#ff7eb6", att: 0.8, conc: 1.25 },
};

const FIXTURE_DEFS = [
  { id: "demo-1", league: "npl", home: "rdm", away: "ash", day: 0, h: 12, m: 30 },
  { id: "demo-2", league: "npl", home: "kgp", away: "hal", day: 0, h: 15, m: 0 },
  { id: "demo-3", league: "npl", home: "wex", away: "brw", day: 0, h: 17, m: 30 },
  { id: "demo-4", league: "cvl", home: "mar", away: "alc", day: 0, h: 18, m: 0 },
  { id: "demo-5", league: "cvl", home: "san", away: "vis", day: 0, h: 20, m: 0 },
  { id: "demo-6", league: "uc", home: "ash", away: "mar", day: 1, h: 19, m: 45 },
  { id: "demo-7", league: "uc", home: "hal", away: "alc", day: 1, h: 20, m: 0 },
];

/* ---------- deterministic randomness ---------- */
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const poissonSample = (lam, rnd) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const poissonPmf = (k, lam) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return (Math.exp(-lam) * lam ** k) / f; };
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

const BASE = 1.3;
const lambdas = (h, a) => ({ home: BASE * h.att * a.conc * 1.08, away: BASE * a.att * h.conc * 0.94 });

/* ---------- synthetic history ---------- */
function recentGames(team, seedKey) {
  const rnd = seeded(seedKey + team.id);
  const pool = Object.values(TEAMS).filter((t) => t.id !== team.id);
  const games = [];
  for (let i = 0; i < 10; i++) {
    const opp = pool[Math.floor(rnd() * pool.length)];
    const venue = i % 2 === 0 ? "H" : "A";
    const gf = poissonSample(BASE * team.att * opp.conc * (venue === "H" ? 1.08 : 0.94), rnd);
    const ga = poissonSample(BASE * opp.att * team.conc * (venue === "H" ? 0.94 : 1.08), rnd);
    games.push({ opp: opp.name, venue, gf, ga, res: gf > ga ? "W" : gf < ga ? "L" : "D" });
  }
  return games;
}
const record = (gs) => ({
  p: gs.length, w: gs.filter((g) => g.res === "W").length, d: gs.filter((g) => g.res === "D").length, l: gs.filter((g) => g.res === "L").length,
  gf: gs.reduce((s, g) => s + g.gf, 0), ga: gs.reduce((s, g) => s + g.ga, 0),
});

const SURNAMES = ["Okafor", "Marlow", "Voss", "Ibarra", "Lindqvist", "Dacosta", "Reyes", "Tanaka", "Brandt", "Mensah", "Duarte", "Kovacs", "Hale", "Quint", "Ferro", "Nakamura", "Salgado", "Whitlock", "Adeyemi", "Moreau", "Castell", "Rourke"];
const INITIALS = "ABCDEFGHJKLMNPRSTW";
function squad(team) {
  const rnd = seeded("squad" + team.id);
  const used = new Set();
  const positions = ["ST", "ST", "AM", "W", "CM"];
  return positions.map((pos, i) => {
    let name;
    do { name = `${INITIALS[Math.floor(rnd() * INITIALS.length)]}. ${SURNAMES[Math.floor(rnd() * SURNAMES.length)]}`; } while (used.has(name));
    used.add(name);
    const apps = 8 + Math.floor(rnd() * 3);
    const goals = Math.max(0, Math.round((pos === "ST" ? 6 : pos === "CM" ? 1.5 : 3.5) * team.att * (0.5 + rnd())));
    const r = rnd();
    const status = r < 0.12 ? "injured" : r < 0.22 ? "doubt" : r < 0.27 ? "suspended" : "available";
    const note = status === "injured" ? "Injury (demo): return date not known" : status === "doubt" ? "Fitness doubt (demo): late test expected" : status === "suspended" ? "Suspended (demo): serving ban" : "";
    return { id: `${team.id}-p${i + 1}`, name, team: team.name, pos, apps, goals, minutes: 55 + Math.floor(rnd() * 36), shotsPer90: round(1 + rnd() * (pos === "ST" ? 2.6 : 1.6), 1), status, note, lineup: status === "available" ? (rnd() < 0.8 ? "likely" : "rotation risk") : "unlikely" };
  });
}

/* ---------- predictions (Poisson on demo ratings) ---------- */
function buildPrediction(h, a, hp, ap, hForm, aForm, h2h) {
  const lam = lambdas(h, a);
  const grid = []; let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
    const p = poissonPmf(i, lam.home) * poissonPmf(j, lam.away);
    grid.push({ score: `${i}-${j}`, probability: p });
    if (i > j) pH += p; else if (i < j) pA += p; else pD += p;
  }
  const tot = pH + pD + pA; pH /= tot; pD /= tot; pA /= tot;
  const pick = pH >= pD && pH >= pA ? "H" : pA >= pD ? "A" : "D";
  const pmax = Math.max(pH, pD, pA);
  const missing = [...hp, ...ap].filter((p) => p.status !== "available").length;
  const hf = record(hForm.slice(0, 5)), af = record(aForm.slice(0, 5));
  const h2hHome = h2h.filter((m) => m.hg > m.ag && m.homeId === h.id || m.ag > m.hg && m.awayId === h.id).length;
  const pickName = pick === "H" ? h.name : pick === "A" ? a.name : "Draw";
  const outcomeConf = Math.min(0.78, Math.max(0.25, 0.3 + (pmax - 0.34) * 1.1 - missing * 0.03));
  const top = [...grid].sort((x, y) => y.probability - x.probability);

  const scorers = [];
  for (const [team, players, l] of [[h, hp, lam.home], [a, ap, lam.away]]) {
    const eligible = players.filter((p) => p.status === "available" || p.status === "doubt");
    const totalGoals = players.reduce((s, p) => s + Math.max(p.goals, 0.5), 0);
    for (const p of eligible) {
      const share = Math.max(p.goals, 0.5) / totalGoals;
      const avail = p.status === "doubt" ? 0.6 : p.lineup === "rotation risk" ? 0.8 : 0.95;
      const prob = 1 - Math.exp(-l * share * 1.15 * (p.minutes / 90) * avail);
      scorers.push({
        playerId: p.id, name: p.name, team: team.name, probability: prob,
        confidence: Math.min(0.55, Math.max(0.2, 0.28 + p.apps / 60 - (p.status === "doubt" ? 0.1 : 0) - (p.lineup === "rotation risk" ? 0.05 : 0))),
        reasoning: `${p.name} (${p.pos}) has ${p.goals} goals in ${p.apps} appearances (demo figures) and takes a ${Math.round(share * 100)}% share of ${team.name}'s modelled scoring.`,
        evidence: [`${p.goals} goals in last ${p.apps} apps; ${p.shotsPer90} shots per 90 (demo)`, `${team.name} expected goals: ${round(l)} (demo model)`, `Avg. minutes ${p.minutes}; lineup status: ${p.lineup}`],
        uncertainties: ["Starting lineup unconfirmed — a bench role would sharply reduce this probability.", ...(p.status === "doubt" ? ["Listed as a fitness doubt."] : []), "Single-match scoring is high-variance even for regular scorers.", "DEMO DATA: invented player and statistics."],
      });
    }
  }
  scorers.sort((x, y) => y.probability - x.probability);

  return {
    outcome: {
      homeWin: pH, draw: pD, awayWin: pA, pick, confidence: outcomeConf,
      reasoning: `The demo model leans ${pick === "D" ? "towards a draw" : `to ${pickName}`}, driven by expected goals of ${round(lam.home)} vs ${round(lam.away)}. The margin is ${pmax > 0.5 ? "clear but far from certain" : "narrow"}, so confidence is ${confLevel(outcomeConf)}.`,
      evidence: [
        `Expected goals (demo model): ${h.name} ${round(lam.home)}, ${a.name} ${round(lam.away)}`,
        `${h.name} last 5: ${hf.w}W ${hf.d}D ${hf.l}L, scored ${hf.gf}, conceded ${hf.ga}`,
        `${a.name} last 5: ${af.w}W ${af.d}D ${af.l}L, scored ${af.gf}, conceded ${af.ga}`,
        `Head to head (last ${h2h.length}): ${h.name} won ${h2hHome}`,
      ],
      uncertainties: ["DEMO DATA: invented ratings, not real team strength.", "Only the last 5–10 matches used — small sample.", `${missing} relevant player(s) flagged as unavailable or doubtful.`, "Does not model referee, weather, travel, motivation or in-game events."],
    },
    goalscorers: scorers.slice(0, 5),
    correctScore: {
      top: top[0], alternatives: top.slice(1, 5),
      confidence: Math.min(0.3, Math.max(0.1, top[0].probability * 1.8)),
      reasoning: `${top[0].score} is the single most likely scoreline in the demo model, but even the best exact score is a low-probability event (${(top[0].probability * 100).toFixed(1)}%).`,
      evidence: [`Poisson scoreline grid from expected goals ${round(lam.home)} / ${round(lam.away)} (demo)`, `Top alternatives: ${top.slice(1, 4).map((s) => s.score).join(", ")}`],
      uncertainties: ["Exact scores are inherently rare: the top pick usually has under a 15% chance.", "Poisson ignores game-state effects such as red cards or late goals.", "DEMO DATA: model inputs are invented."],
    },
  };
}
const confLevel = (c) => (c >= 0.6 ? "higher" : c >= 0.4 ? "moderate" : "lower");

/* ---------- public API ---------- */
function kickoff(def) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + def.day);
  d.setUTCHours(def.h, def.m, 0, 0);
  return d.toISOString();
}
const fixtureOf = (def) => ({
  id: def.id, kickoffUtc: kickoff(def), league: LEAGUES[def.league], status: "scheduled",
  home: pickTeam(TEAMS[def.home]), away: pickTeam(TEAMS[def.away]),
});
const pickTeam = ({ id, name, short, color }) => ({ id, name, short, color });

export function getDemoFixtures() { return FIXTURE_DEFS.map(fixtureOf); }
export function getDemoLeagues() { return Object.values(LEAGUES); }

const cache = new Map();
export function getDemoMatch(id) {
  if (cache.has(id)) return cache.get(id);
  const def = FIXTURE_DEFS.find((f) => f.id === id);
  if (!def) return null;
  const h = TEAMS[def.home], a = TEAMS[def.away];
  const hAll = recentGames(h, id), aAll = recentGames(a, id);
  const rnd = seeded("h2h" + id);
  const h2h = Array.from({ length: 5 }, (_, i) => {
    const homeIsH = i % 2 === 0;
    const hh = homeIsH ? h : a, aa = homeIsH ? a : h;
    return { date: `${2026 - Math.floor((i + 1) / 2)}-${String(((i * 5 + 2) % 12) + 1).padStart(2, "0")}-1${i}`, homeId: hh.id, awayId: aa.id, home: hh.name, away: aa.name, hg: poissonSample(lambdas(hh, aa).home, rnd), ag: poissonSample(lambdas(hh, aa).away, rnd) };
  });
  const hp = squad(h), ap = squad(a);
  const detail = {
    fixture: fixtureOf(def),
    form: { home: hAll.slice(0, 5), away: aAll.slice(0, 5) },
    stats: {
      home: { overall: record(hAll), home: record(hAll.filter((g) => g.venue === "H")), away: record(hAll.filter((g) => g.venue === "A")) },
      away: { overall: record(aAll), home: record(aAll.filter((g) => g.venue === "H")), away: record(aAll.filter((g) => g.venue === "A")) },
      sample: "Last 10 matches (demo)",
    },
    h2h,
    players: { home: hp, away: ap },
    prediction: buildPrediction(h, a, hp, ap, hAll, aAll, h2h),
  };
  cache.set(id, detail);
  return detail;
}

export function getDemoDaily() { return FIXTURE_DEFS.map((d) => getDemoMatch(d.id)); }

// Illustrative tracker rows (fictional matches). Real rows come from locked predictions + results.
export const DEMO_TRACKED = [
  { id: "t1", match: "Redmoor Rovers v Brightwater FC", kickoffUtc: "2026-10-18T14:00:00Z", lockedAt: "2026-10-18T06:00:00Z", pick: "H", score: "2-1", scorers: [{ name: "K. Voss", hit: true }, { name: "T. Hale", hit: false }], actual: { home: 2, away: 0, scored: ["K. Voss", "A. Moreau"] } },
  { id: "t2", match: "Kingsport City v Wexcombe Town", kickoffUtc: "2026-10-18T16:30:00Z", lockedAt: "2026-10-18T06:00:00Z", pick: "H", score: "3-0", scorers: [{ name: "R. Ferro", hit: true }, { name: "S. Okafor", hit: false }], actual: { home: 3, away: 1, scored: ["R. Ferro", "P. Quint", "R. Ferro"] } },
  { id: "t3", match: "Real Sancho v Deportivo Alcira", kickoffUtc: "2026-10-19T19:00:00Z", lockedAt: "2026-10-19T06:00:00Z", pick: "H", score: "2-0", scorers: [{ name: "L. Dacosta", hit: false }, { name: "J. Reyes", hit: false }], actual: { home: 1, away: 1, scored: ["M. Tanaka", "C. Duarte"] } },
  { id: "t4", match: "Halden Athletic v Ashford United", kickoffUtc: "2026-10-20T19:45:00Z", lockedAt: "2026-10-20T06:00:00Z", pick: "A", score: "1-2", scorers: [{ name: "E. Mensah", hit: true }], actual: { home: 0, away: 2, scored: ["E. Mensah", "N. Salgado"] } },
  { id: "t5", match: "CD Vistamar v Atlético Marisol", kickoffUtc: "2026-10-21T18:00:00Z", lockedAt: "2026-10-21T06:00:00Z", pick: "A", score: "0-2", scorers: [{ name: "F. Lindqvist", hit: true }, { name: "G. Brandt", hit: false }], actual: { home: 0, away: 2, scored: ["F. Lindqvist", "F. Lindqvist"] } },
  { id: "t6", match: "Brightwater FC v Ashford United", kickoffUtc: "2026-10-24T12:30:00Z", lockedAt: "2026-10-24T06:00:00Z", pick: "D", score: "1-1", scorers: [{ name: "H. Castell", hit: false }], actual: { home: 2, away: 1, scored: ["W. Rourke", "H. Quint", "B. Whitlock"] } },
];
