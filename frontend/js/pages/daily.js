import { getDaily } from "../api.js";
import { crest, confLevel, confText, demoTag, fmtTime, html, mount, pct, skeletons, stateCard, updatedAt } from "../ui.js";

const filters = { category: "all", minConf: 0 };
const CATS = [["all", "All"], ["outcome", "Match outcome"], ["scorer", "Goalscorer"], ["score", "Correct score"]];
const LEVELS = [[0, "Any confidence"], [0.4, "Moderate or higher"], [0.6, "Higher only"]];

function entries(matches) {
  const out = [];
  for (const m of matches) {
    const { fixture: f, prediction: p } = m;
    if (!p) continue;
    const o = p.outcome, label = o.pick === "H" ? f.home.name : o.pick === "A" ? f.away.name : "Draw";
    out.push({ f, cat: "outcome", catLabel: "Match outcome", pick: label === "Draw" ? "Draw" : `${label} to win`, prob: Math.max(o.homeWin, o.draw, o.awayWin), conf: o.confidence, why: o.reasoning });
    const g = p.goalscorers[0];
    if (g) out.push({ f, cat: "scorer", catLabel: "Anytime goalscorer", pick: `${g.name} to score`, prob: g.probability, conf: g.confidence, why: g.reasoning });
    out.push({ f, cat: "score", catLabel: "Correct score", pick: p.correctScore.top.score.replace("-", " – "), prob: p.correctScore.top.probability, conf: p.correctScore.confidence, why: p.correctScore.reasoning });
  }
  return out;
}

export async function daily(root) {
  mount(root, html`<div class="page-head"><div><h1>Daily predictions</h1></div></div>${skeletons(5)}`);
  const res = await getDaily({});
  const demo = res.source === "demo";
  const rows = entries(res.data)
    .filter((e) => filters.category === "all" || e.cat === filters.category)
    .filter((e) => e.conf >= filters.minConf)
    .sort((a, b) => b.conf - a.conf || b.prob - a.prob);

  mount(root, html`
    <div class="page-head">
      <div><h1>Daily predictions ${demoTag(demo)}</h1>
        <p>Ranked by strength of available evidence (confidence estimate), not by how likely the pick is to be exciting. Higher rank does not mean certain.</p></div>
      ${updatedAt(res.updatedAt, res.source)}
    </div>
    <div class="filters" style="grid-template-columns:1fr auto">
      <div class="field"><label>Category</label><div class="chips" id="cats">${CATS.map(([k, l]) => html`<button type="button" class="chip ${filters.category === k ? "on" : ""}" data-k="${k}">${l}</button>`)}</div></div>
      <div class="field"><label for="conf">Minimum confidence</label><select id="conf">${LEVELS.map(([v, l]) => html`<option value="${v}" ${v === filters.minConf ? "selected" : ""}>${l}</option>`)}</select></div>
    </div>
    ${rows.length === 0 ? stateCard("Nothing to show", res.data.length === 0 ? "No analyzed matches with locked predictions for this day yet." : "No predictions match these filters.") : html`
      <div class="stack">${rows.map((e, i) => html`
        <a class="card match" style="grid-template-columns:36px 1fr auto" href="#/match/${encodeURIComponent(e.f.id)}">
          <div class="muted mono">#${i + 1}</div>
          <div style="min-width:0">
            <div class="row"><span class="tag">${e.catLabel}</span><span class="small muted">${fmtTime(e.f.kickoffUtc)} · ${e.f.league.name}</span></div>
            <div class="pick" style="font-size:1.1rem;margin:6px 0 2px">${e.pick}</div>
            <div class="row small muted"><span class="row" style="gap:6px">${crest(e.f.home)}${e.f.home.name}</span><span>v</span><span class="row" style="gap:6px">${crest(e.f.away)}${e.f.away.name}</span></div>
          </div>
          <div style="text-align:right"><div class="pick" style="font-size:1.15rem;color:var(--green)">${pct(e.prob, e.cat === "score" ? 1 : 0)}</div>
            <span class="tag ${confLevel(e.conf) === "high" ? "green" : confLevel(e.conf) === "med" ? "amber" : "red"}">${confText(e.conf)} · ${pct(e.conf)}</span></div>
        </a>`)}</div>
      <p class="disclaimer" style="margin-top:14px">Probabilities and confidence are estimates. Open a match to see statistics and uncertainties behind each pick.</p>`}
  `);

  root.querySelector("#cats").onclick = (ev) => { const k = ev.target.closest("[data-k]")?.dataset.k; if (k) { filters.category = k; daily(root); } };
  root.querySelector("#conf").onchange = (ev) => { filters.minConf = Number(ev.target.value); daily(root); };
}
