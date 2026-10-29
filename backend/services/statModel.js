/**
 * Statistical prediction model (no AI, no paid API).
 *
 * Inputs are the normalized MatchContext + PlayerIntel from the football provider.
 * Method: a Poisson goal model.
 *   1. Each team's scoring and conceding rates come from this season's home/away league record,
 *      shrunk toward a prior built from the team's overall strength so that small samples don't dominate.
 *   2. Expected goals for each side = attack rate x opponent's conceding rate / league average.
 *   3. A score matrix (0-8 goals each) gives win/draw/loss probabilities and the likeliest scorelines.
 *   4. A player's chance to score = 1 - exp(-expected team goals x his share of the team's league goals).
 *
 * It returns null when the data needed is missing; it never fills gaps with guesses.
 * Output matches the Prediction shape in docs/DATA_CONTRACTS.md, plus method: "statistical-model".
 */

const MAX_GOALS = 8;
const SHRINK_K = 4; // weight of the prior, in "games"

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function poissonRow(lambda) {
  const row = [Math.exp(-lambda)];
  for (let k = 1; k <= MAX_GOALS; k++) row.push((row[k - 1] * lambda) / k);
  return row;
}

/** Joint score probabilities, renormalised after truncating at MAX_GOALS. */
export function scoreMatrix(lh, la) {
  const ph = poissonRow(lh), pa = poissonRow(la);
  let total = 0;
  const m = ph.map((a) => pa.map((b) => { const p = a * b; total += p; return p; }));
  return m.map((r) => r.map((p) => p / total));
}

const valid = (r) => r && Number.isFinite(r.p) && r.p > 0 && Number.isFinite(r.gf) && Number.isFinite(r.ga);

export function predict({ context, players }) {
  const { fixture: f, stats, leagueAvg } = context || {};
  const H = stats?.home, A = stats?.away;
  if (!f || !valid(H?.overall) || !valid(A?.overall) || !valid(H?.home) || !valid(A?.away)) return null;
  if (!leagueAvg || !(leagueAvg.homeGoals > 0) || !(leagueAvg.awayGoals > 0)) return null;

  const avgH = leagueAvg.homeGoals, avgA = leagueAvg.awayGoals, avgAll = (avgH + avgA) / 2;
  // team overall strength relative to the league, used as the prior for venue-specific rates
  const rel = (t) => ({ att: t.overall.gf / t.overall.p / avgAll, def: t.overall.ga / t.overall.p / avgAll });
  const rH = rel(H), rA = rel(A);
  const shrink = (obs, n, prior) => (n * obs + SHRINK_K * prior) / (n + SHRINK_K);

  const homeAtt = shrink(H.home.gf / H.home.p, H.home.p, avgH * rH.att);   // home team's scoring at home
  const homeDef = shrink(H.home.ga / H.home.p, H.home.p, avgA * rH.def);   // home team's conceding at home
  const awayAtt = shrink(A.away.gf / A.away.p, A.away.p, avgA * rA.att);   // away team's scoring away
  const awayDef = shrink(A.away.ga / A.away.p, A.away.p, avgH * rA.def);   // away team's conceding away

  // Caps keep a small or lopsided sample from producing absurd certainty.
  const lh = clamp((homeAtt * awayDef) / avgH, 0.25, 3.0);
  const la = clamp((awayAtt * homeDef) / avgA, 0.25, 3.0);

  const M = scoreMatrix(lh, la);
  let homeWin = 0, draw = 0, awayWin = 0;
  const cells = [];
  for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) {
    const p = M[i][j];
    if (i > j) homeWin += p; else if (i === j) draw += p; else awayWin += p;
    cells.push({ score: `${i}-${j}`, probability: p });
  }
  cells.sort((a, b) => b.probability - a.probability);
  const top = cells[0], alternatives = cells.slice(1, 4);
  const pick = homeWin >= draw && homeWin >= awayWin ? "H" : awayWin >= draw ? "A" : "D";
  const maxP = Math.max(homeWin, draw, awayWin);

  // How much the sample supports the numbers: 0.1 (no games) .. 1 (10+ games each)
  const minGames = Math.min(H.overall.p, A.overall.p);
  const sw = clamp(minGames / 10, 0.1, 1);

  const homeName = f.home.name, awayName = f.away.name;
  const rec = (x) => `${x.w}W-${x.d}D-${x.l}L`;
  const formStr = (g) => (g?.length ? g.map((x) => x.res).join("") : "n/a");
  const sampleWarn = `Small sample: ${homeName} has ${H.home.p} home games and ${awayName} ${A.away.p} away games this season, so venue-specific rates are noisy (they are blended with overall strength).`;
  const commonUncertainty = [
    "Statistical model only: it ignores injuries, suspensions, lineups, tactics, motivation, fixture congestion and weather.",
    sampleWarn,
    ...(f.league?.id === "CL" ? ["Champions League: the model only sees this competition's matches (few games per team), not domestic form or club strength, so treat it as rough."] : []),
  ];

  const outcome = {
    homeWin: round(homeWin), draw: round(draw), awayWin: round(awayWin), pick,
    confidence: round(clamp(maxP * (0.6 + 0.4 * sw), 0.05, 0.8)),
    reasoning: `Poisson model: expected goals ${homeName} ${lh.toFixed(2)} vs ${awayName} ${la.toFixed(2)}, from each side's season scoring and conceding rates at this venue.`,
    evidence: [
      `${homeName} at home: ${rec(H.home)}, ${H.home.gf} scored and ${H.home.ga} conceded in ${H.home.p} games.`,
      `${awayName} away: ${rec(A.away)}, ${A.away.gf} scored and ${A.away.ga} conceded in ${A.away.p} games.`,
      `League averages this season: home teams ${avgH.toFixed(2)} goals per game, away teams ${avgA.toFixed(2)}.`,
      `Recent league form (newest first): ${homeName} ${formStr(context.form?.home)}, ${awayName} ${formStr(context.form?.away)} (shown for context, not used by the model).`,
    ],
    uncertainties: [...commonUncertainty, "Simple Poisson models tend to slightly underestimate draws."],
  };

  const correctScore = {
    top: { score: top.score, probability: round(top.probability) },
    alternatives: alternatives.map((c) => ({ score: c.score, probability: round(c.probability) })),
    confidence: round(clamp(top.probability * 2.5 * sw, 0.03, 0.3)),
    reasoning: `${top.score.replace("-", "–")} is the single likeliest scoreline in the model's score grid, but even the best exact score is a low-probability outcome.`,
    evidence: [
      `Expected goals ${lh.toFixed(2)} (${homeName}) and ${la.toFixed(2)} (${awayName}).`,
      `Top scorelines: ${[top, ...alternatives].map((c) => `${c.score} (${pct(c.probability, 1)})`).join(", ")}.`,
    ],
    uncertainties: [...commonUncertainty, "Exact scores depend heavily on chance; no model predicts them reliably."],
  };

  // ---- anytime goalscorer: share of the team's league goals x expected team goals
  const picks = [];
  for (const [side, lambda, team, tstats] of [["home", lh, f.home, H], ["away", la, f.away, A]]) {
    const teamGoals = tstats.overall.gf;
    if (!(teamGoals > 0)) continue;
    for (const pl of players?.[side] || []) {
      if (!(pl.goals > 0) || pl.status === "injured" || pl.status === "suspended") continue;
      const share = clamp(pl.goals / teamGoals, 0, 0.5);
      const prob = Math.min(0.7, 1 - Math.exp(-lambda * share)); // even elite scorers rarely exceed ~70%
      const known = Boolean(pl.status || pl.lineup);
      picks.push({
        playerId: String(pl.id), name: pl.name, team: team.name, probability: round(prob),
        confidence: round(clamp(Math.min(0.5, prob) * (0.5 + 0.5 * sw) * (known ? 1 : 0.8), 0.03, 0.45)),
        reasoning: `${pl.goals} of ${team.name}'s ${teamGoals} league goals this season (${pct(share)}), applied to the ${lambda.toFixed(2)} goals the model expects from them here.`,
        evidence: [
          `${pl.name}: ${pl.goals} league goals in ${pl.apps} appearances this season.`,
          `${team.name} have scored ${teamGoals} league goals in ${tstats.overall.p} games; the model expects ${lambda.toFixed(2)} in this match.`,
        ],
        uncertainties: [
          known ? "Lineup and availability data may be incomplete." : "Injury, suspension and lineup status are not available from the data source, so he may not play.",
          "Goal share includes penalties and ignores how well this particular opponent defends against individual players.",
          "Only the league's top scorers are considered; other players may score too.",
        ],
      });
    }
  }
  picks.sort((a, b) => b.probability - a.probability);

  return { method: "statistical-model", outcome, goalscorers: picks.slice(0, 3), correctScore };
}
