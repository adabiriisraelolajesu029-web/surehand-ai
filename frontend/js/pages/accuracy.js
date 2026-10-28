import { getAccuracy } from "../api.js";
import { demoTag, fmtDateTime, html, mount, pct, stateCard, updatedAt, skeletons } from "../ui.js";

const rate = (n, hit) => (n ? hit / n : null);
const kpi = (title, sub, n, hit) => html`
  <div class="card kpi"><div class="muted small">${title}</div>
    <div class="big ${n ? "" : "na"}">${n ? pct(hit / n) : "—"}</div>
    <div class="small muted">${n ? `${hit} of ${n} ${sub}${n < 30 ? " · too few to judge yet" : ""}` : "No settled predictions yet"}</div></div>`;

const mark = (ok) => html`<span class="${ok ? "ok" : "bad"}" aria-label="${ok ? "correct" : "incorrect"}">${ok ? "✓" : "✗"}</span>`;
const pickText = (p) => ({ H: "Home win", D: "Draw", A: "Away win" })[p] || p;

export async function accuracy(root) {
  mount(root, skeletons(3));
  const res = await getAccuracy();
  const demo = res.source === "demo";

  let k, rows = [];
  if (demo) {
    rows = res.data.tracked.map((t) => {
      const a = t.actual, actualPick = a.home > a.away ? "H" : a.home < a.away ? "A" : "D";
      return { ...t, outcomeOk: t.pick === actualPick, scoreOk: t.score === `${a.home}-${a.away}`, actualPick };
    });
    const sc = rows.flatMap((r) => r.scorers);
    k = { outcome: { n: rows.length, hit: rows.filter((r) => r.outcomeOk).length }, score: { n: rows.length, hit: rows.filter((r) => r.scoreOk).length }, scorer: { n: sc.length, hit: sc.filter((s) => s.hit).length } };
  } else {
    const d = res.data;
    k = { outcome: { n: d.outcome.n, hit: d.outcome.hit }, score: { n: d.correctScore.n, hit: d.correctScore.hit }, scorer: { n: d.goalscorer.n, hit: d.goalscorer.hit } };
    rows = (d.tracked || []).map((t) => { const a = t.actual, actualPick = a.home > a.away ? "H" : a.home < a.away ? "A" : "D"; return { ...t, outcomeOk: t.pick === actualPick, scoreOk: t.score === `${a.home}-${a.away}`, actualPick }; });
  }

  mount(root, html`
    <div class="page-head">
      <div><h1>Accuracy tracker ${demoTag(demo)}</h1>
        <p>Every prediction is stored with a timestamp before kickoff and never edited. Results are attached afterwards and each category is scored separately.</p></div>
      ${updatedAt(res.updatedAt, res.source)}
    </div>
    ${demo ? html`<div class="card" style="border-color:rgba(242,184,75,.4)"><p class="small" style="color:var(--amber)"><strong>DEMO DATA.</strong> The rows below are fictional examples showing how tracking will look. They are not real predictions or real results, and these percentages say nothing about SureHand AI's real accuracy.</p></div>` : ""}

    <div class="grid cols-3" style="margin-top:14px">
      ${kpi("Match outcome accuracy", "outcomes correct", k.outcome.n, k.outcome.hit)}
      ${kpi("Exact correct-score accuracy", "exact scores correct", k.score.n, k.score.hit)}
      ${kpi("Goalscorer accuracy", "scorer picks scored", k.scorer.n, k.scorer.hit)}
    </div>

    <section class="block"><h2>Tracked predictions</h2>
      ${rows.length ? html`<div class="card"><div class="table-scroll"><table>
        <thead><tr><th>Match</th><th>Locked</th><th>Outcome</th><th>Score</th><th>Scorers</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td><b>${r.match}</b><div class="small muted">Final ${r.actual.home}–${r.actual.away}</div></td>
          <td class="small muted">${fmtDateTime(r.lockedAt)}</td>
          <td>${mark(r.outcomeOk)} ${pickText(r.pick)}<div class="small muted">Actual: ${pickText(r.actualPick)}</div></td>
          <td>${mark(r.scoreOk)} ${r.score.replace("-", "–")}</td>
          <td>${r.scorers.length ? r.scorers.map((s) => html`<div>${mark(s.hit)} ${s.name}</div>`) : html`<span class="small muted">not tracked</span>`}</td></tr>`)}</tbody></table></div></div>`
      : stateCard(k.outcome.n ? "Settled predictions" : "No settled predictions yet", k.outcome.n ? "Per-prediction history will appear here once the results endpoint returns individual records." : "Once matches with locked predictions finish and results are synced, accuracy will appear here.")}
    </section>

    <section class="block"><h2>How tracking works</h2><div class="card"><ol class="small muted" style="margin:0;padding-left:18px;display:grid;gap:6px">
      <li>A prediction is generated and <b>locked</b> before kickoff. It is never recalculated or edited afterwards.</li>
      <li>After full time, the final score (and scorers, when the data source provides them) is attached from the football data provider.</li>
      <li>Accuracy is computed separately for outcome, exact score and goalscorer picks from locked predictions only.</li>
    </ol></div></section>`);
}
