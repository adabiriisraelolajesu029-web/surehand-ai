import { getMatch } from "../api.js";
import { crest, demoTag, evidenceBlocks, fmtDateTime, formChips, html, mount, pct, skeletons, stateCard, updatedAt, esc } from "../ui.js";

const STATUS = { available: ["green", "Available"], doubt: ["amber", "Doubtful"], injured: ["red", "Injured"], suspended: ["red", "Suspended"] };

export async function match(root, id) {
  mount(root, skeletons(4));
  const res = await getMatch(id);
  const m = res.data, demo = res.source === "demo";
  const { fixture: f, prediction: p } = m;

  mount(root, html`
    <div class="crumbs"><a href="#/">← All matches</a></div>
    <div class="card hero">
      <div class="side">${crest(f.home, true)}<b>${f.home.name}</b><span class="muted small">Home</span></div>
      <div class="mid"><span class="tag">${f.league.name}</span><span class="vs">vs</span><span class="small muted">${fmtDateTime(f.kickoffUtc)}</span>${demoTag(demo)}</div>
      <div class="side away">${crest(f.away, true)}<b>${f.away.name}</b><span class="muted small">Away</span></div>
    </div>
    <div class="row spread" style="margin-top:10px">${updatedAt(res.updatedAt, res.source)}${m.lockedAt ? html`<span class="tag green">Locked ${fmtDateTime(m.lockedAt)}</span>` : html`<span class="tag">Not locked</span>`}</div>

    <section class="block"><h2>Predictions</h2>${p ? predictions(m) : stateCard("No prediction yet", "No prediction has been generated and locked for this match. Analysis below is still available.")}</section>
    ${m.form ? html`<section class="block"><h2>Recent form</h2>${form(m)}</section>` : ""}
    ${m.stats ? html`<section class="block"><h2>Goals &amp; home/away performance</h2>${stats(m)}</section>` : ""}
    ${m.h2h ? html`<section class="block"><h2>Head to head</h2>${h2h(m)}</section>` : ""}
    <section class="block"><h2>Player intelligence</h2>${players(m)}</section>
  `);
}

function predictions(m) {
  const p = m.prediction, f = m.fixture, o = p.outcome;
  const pickLabel = o.pick === "H" ? f.home.name : o.pick === "A" ? f.away.name : "Draw";
  return html`<div class="grid cols-3">
    <article class="card pred">
      <h3>Match outcome <span class="tag">1X2</span></h3>
      <div class="pick">${pickLabel}<small>${pct(Math.max(o.homeWin, o.draw, o.awayWin))} estimated</small></div>
      <div class="probbar" role="img" aria-label="Home ${pct(o.homeWin)}, draw ${pct(o.draw)}, away ${pct(o.awayWin)}">
        <i class="h" style="width:${o.homeWin * 100}%"></i><i class="d" style="width:${o.draw * 100}%"></i><i class="a" style="width:${o.awayWin * 100}%"></i></div>
      <div class="legend"><span>Home <b>${pct(o.homeWin)}</b></span><span>Draw <b>${pct(o.draw)}</b></span><span>Away <b>${pct(o.awayWin)}</b></span></div>
      ${evidenceBlocks(o)}
    </article>

    <article class="card pred">
      <h3>Anytime goalscorer <span class="tag">Top ${Math.min(3, p.goalscorers.length)}</span></h3>
      ${p.goalscorers.length === 0 ? html`<p class="muted">No eligible players with reliable data.</p>` : p.goalscorers.slice(0, 3).map((g) => html`
        <div class="scorer"><div><b>${g.name}</b> <span class="muted small">${g.team}</span></div><div class="p">${pct(g.probability)}</div><div class="sub">${confidenceWord(g.confidence)} · ${g.reasoning}</div></div>`)}
      ${p.goalscorers.slice(0, 3).map((g) => html`<details><summary>${g.name}: evidence &amp; uncertainties</summary><ul>${g.evidence.map((e) => html`<li>${e}</li>`)}</ul><ul class="muted">${g.uncertainties.map((e) => html`<li>⚠ ${e}</li>`)}</ul></details>`)}
      <p class="disclaimer">Probabilities are estimates for a player to score at least once. Lineups are unconfirmed unless stated.</p>
    </article>

    <article class="card pred">
      <h3>Correct score <span class="tag">Low-probability by nature</span></h3>
      <div class="pick">${p.correctScore.top.score.replace("-", " – ")}<small>${pct(p.correctScore.top.probability, 1)} estimated</small></div>
      <div class="scores">${[p.correctScore.top, ...p.correctScore.alternatives].map((s, i) => html`<span class="score ${i === 0 ? "top" : ""}">${s.score.replace("-", "–")}<small>${pct(s.probability, 1)}</small></span>`)}</div>
      <div style="margin-top:6px"></div>
      ${evidenceBlocks(p.correctScore)}
    </article>
  </div>`;
}
const confidenceWord = (c) => (c >= 0.6 ? "Higher confidence" : c >= 0.4 ? "Moderate confidence" : "Lower confidence") + ` (${pct(c)})`;

function form(m) {
  const { home, away } = m.fixture;
  return html`<div class="grid cols-2">${[[home, m.form.home], [away, m.form.away]].map(([t, g]) => html`
    <div class="card"><div class="row spread"><div class="team">${crest(t)}<span class="name">${t.name}</span></div>${formChips(g)}</div>
      <div class="table-scroll"><table><thead><tr><th>Opponent</th><th>Venue</th><th class="num">Score</th></tr></thead>
      <tbody>${g.map((x) => html`<tr><td>${x.opp}</td><td>${x.venue === "H" ? "Home" : "Away"}</td><td class="num">${x.gf}–${x.ga}</td></tr>`)}</tbody></table></div></div>`)}</div>`;
}

const rec = (r) => `${r.w}-${r.d}-${r.l}`;
function stats(m) {
  const { home, away } = m.fixture, s = m.stats;
  const rows = [
    ["Goals scored (per game)", (x) => (x.overall.gf / x.overall.p).toFixed(2)],
    ["Goals conceded (per game)", (x) => (x.overall.ga / x.overall.p).toFixed(2)],
    ["Home record (W-D-L)", (x) => `${rec(x.home)}  · ${x.home.gf}:${x.home.ga}`],
    ["Away record (W-D-L)", (x) => `${rec(x.away)}  · ${x.away.gf}:${x.away.ga}`],
    ["Overall record (W-D-L)", (x) => rec(x.overall)],
  ];
  return html`<div class="card"><div class="cmp">
    <div class="l">${home.name}</div><div class="lbl">&nbsp;</div><div class="r">${away.name}</div>
    ${rows.map(([label, fn]) => html`<div class="l">${fn(s.home)}</div><div class="lbl">${label}</div><div class="r">${fn(s.away)}</div>`)}
  </div><p class="disclaimer">${s.sample}. Small samples can mislead — treat splits as context, not proof.</p></div>`;
}

function h2h(m) {
  const { home, away } = m.fixture;
  const hw = m.h2h.filter((x) => (x.hg > x.ag && x.homeId === home.id) || (x.ag > x.hg && x.awayId === home.id)).length;
  const aw = m.h2h.filter((x) => (x.hg > x.ag && x.homeId === away.id) || (x.ag > x.hg && x.awayId === away.id)).length;
  const dr = m.h2h.length - hw - aw, n = m.h2h.length || 1;
  return html`<div class="card">
    <div class="legend"><span>${home.name} <b>${hw}</b></span><span>Draws <b>${dr}</b></span><span>${away.name} <b>${aw}</b></span></div>
    <div class="h2h-bar"><i style="width:${(hw / n) * 100}%;background:var(--green)"></i><i style="width:${(dr / n) * 100}%;background:#6f8a7c"></i><i style="width:${(aw / n) * 100}%;background:var(--blue)"></i></div>
    <div class="table-scroll"><table><thead><tr><th>Date</th><th>Home</th><th class="num">Score</th><th>Away</th></tr></thead>
    <tbody>${m.h2h.map((x) => html`<tr><td>${x.date}</td><td>${x.home}</td><td class="num"><b>${x.hg}–${x.ag}</b></td><td>${x.away}</td></tr>`)}</tbody></table></div></div>`;
}

function players(m) {
  if (!m.players || (!m.players.home?.length && !m.players.away?.length))
    return stateCard("Player data unavailable", "No reliable injury, suspension or lineup data for this match. SureHand AI does not guess these.");
  const { home, away } = m.fixture;
  return html`<div class="grid cols-2">${[[home, m.players.home], [away, m.players.away]].map(([t, ps]) => html`
    <div class="card"><div class="team" style="margin-bottom:8px">${crest(t)}<span class="name">${t.name}</span></div>
      <div class="table-scroll"><table><thead><tr><th>Player</th><th>Status</th><th class="num">G/Apps</th><th class="num">Avg min</th><th>Expected start</th></tr></thead>
      <tbody>${ps.map((p) => { const [c, label] = p.status ? (STATUS[p.status] || ["", p.status]) : ["", "Not reported"]; return html`<tr>
        <td><b>${p.name}</b> <span class="muted small">${p.pos}</span>${p.note ? html`<div class="small muted">${p.note}</div>` : ""}</td>
        <td><span class="tag ${c}">${label}</span></td><td class="num">${p.goals}/${p.apps}</td><td class="num">${p.minutes != null ? `${p.minutes}'` : "—"}</td><td>${p.lineup || "—"}</td></tr>`; })}</tbody></table></div>
      <p class="disclaimer">${ps.some((p) => p.status) ? "Expected lineups are estimates until official team sheets are published." : "Injury, suspension and lineup data is not provided by the current data source, so availability is unknown. Showing the league's top scorers only."}</p></div>`)}</div>`;
}
