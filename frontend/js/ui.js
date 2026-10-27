// Tiny safe-templating + reusable UI components.
// html`` escapes every interpolated value unless it was produced by html`` or raw().

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __raw: String(s) });
const render = (v) => (v == null || v === false ? "" : Array.isArray(v) ? v.map(render).join("") : typeof v === "object" && "__raw" in v ? v.__raw : esc(v));
export const html = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? render(vals[i]) : ""), ""));
export const mount = (el, tpl) => { el.innerHTML = render(tpl); };

/* ---------- formatting ---------- */
export const pct = (x, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
export const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
export const localDateKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const confLevel = (c) => (c >= 0.6 ? "high" : c >= 0.4 ? "med" : "low");
export const confText = (c) => ({ high: "Higher confidence", med: "Moderate confidence", low: "Lower confidence" })[confLevel(c)];

/* ---------- components ---------- */
export const demoTag = (on) => (on ? html`<span class="tag demo">DEMO DATA</span>` : "");

export const crest = (team, big = false) =>
  html`<span class="crest ${big ? "lg" : ""}" style="--c:${team.color || "#22e07a"}" aria-hidden="true">${(team.short || team.name.slice(0, 3)).toUpperCase()}</span>`;

export const updatedAt = (iso, source) =>
  html`<span class="updated">${source === "demo" ? "Demo snapshot" : "Last updated"}: <time datetime="${iso}">${fmtDateTime(iso)}</time></span>`;

export const formChips = (games) =>
  html`<div class="form" role="img" aria-label="Recent form: ${games.map((g) => g.res).join(" ")}">${games.map((g) => html`<span class="f ${g.res}" title="${g.venue === "H" ? "vs" : "@"} ${g.opp} ${g.gf}-${g.ga}">${g.res}</span>`)}</div>`;

export const meter = (conf) =>
  html`<div class="meter ${confLevel(conf)}"><div class="lbl"><span>${confText(conf)}</span><span>${pct(conf)} confidence estimate</span></div><div class="track"><div class="fill" style="width:${Math.round(conf * 100)}%"></div></div></div>`;

export const evidenceBlocks = (p) => html`
  <p class="reason">${p.reasoning}</p>
  ${meter(p.confidence)}
  <details><summary>Supporting statistics (${p.evidence.length})</summary><ul>${p.evidence.map((e) => html`<li>${e}</li>`)}</ul></details>
  <details class="warn"><summary>Important uncertainties (${p.uncertainties.length})</summary><ul>${p.uncertainties.map((e) => html`<li>${e}</li>`)}</ul></details>
  <p class="disclaimer">Estimate based on the data above. Not a guarantee.</p>`;

export const stateCard = (title, body) => html`<div class="card state"><h3>${title}</h3><p>${body}</p></div>`;
export const skeletons = (n = 4) => html`${Array.from({ length: n }, () => html`<div class="skeleton"></div>`)}`;
