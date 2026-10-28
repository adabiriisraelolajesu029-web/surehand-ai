import { state, isDemo, isStatic } from "../api.js";
import { html, mount } from "../ui.js";

const dot = (on) => html`<span class="status-dot ${on ? "on" : "off"}"></span>`;

function staticPage(root) {
  const idx = state.index || {};
  mount(root, html`
    <div class="page-head"><div><h1>How SureHand AI works</h1><p>What powers these predictions, and what it can and cannot see.</p></div>
      <span class="tag green">LIVE DATA</span></div>
    <div class="card"><table><tbody>
      <tr><td style="width:28px">${dot(true)}</td><td><b>Data source</b></td><td class="muted">football-data.org: fixtures, results, league tables and top scorers for the Premier League, La Liga, Serie A, Bundesliga and Ligue 1. Last published: ${idx.updatedAt ? new Date(idx.updatedAt).toLocaleString() : "unknown"}.</td></tr>
      <tr><td>${dot(true)}</td><td><b>Prediction engine</b></td><td class="muted">A statistical model (Poisson goal model), not AI. It turns each team's season scoring and conceding rates into expected goals, then into win/draw/loss chances, likely scorelines and each top scorer's chance to score.</td></tr>
      <tr><td>${dot(false)}</td><td><b>Injuries, suspensions, lineups</b></td><td class="muted">Not available from the free data source. The model cannot know who is missing, so scorer picks carry lower confidence.</td></tr>
    </tbody></table></div>
    <section class="block"><h2>Data integrity rules</h2><div class="card"><ul class="small muted" style="margin:0;padding-left:18px;display:grid;gap:6px">
      <li>Every number comes from the data source or is calculated from it. Nothing is invented; missing data is shown as unavailable or lowers confidence.</li>
      <li>Predictions are saved before kickoff and never changed. The project's public history shows when each one was saved.</li>
      <li>Updates run on a schedule a few times a day, so lineups and late news are not reflected.</li>
      <li>Predictions are estimates, never guarantees.</li>
    </ul></div></section>`);
}

export function data(root) {
  if (isStatic()) return staticPage(root);
  const s = state.health?.services;
  const rows = [
    ["Backend API", !!state.health, state.health ? "Reachable" : "Not reachable — run the backend (see README)"],
    ["Football statistics API", !!s?.footballApiConfigured, s?.footballApiConfigured ? "Credentials configured (integration still needs testing)" : "Not connected — fixtures, stats and player data are DEMO DATA"],
    ["Anthropic Claude API", !!s?.claudeConfigured, s?.claudeConfigured ? "Credentials configured (integration still needs testing)" : "Not connected — no AI predictions are being generated"],
  ];
  const endpoints = [
    ["GET", "/api/fixtures?date=&league=&country=", "Fixture retrieval"],
    ["GET", "/api/matches/:id/analysis", "Form, goals, splits, H2H, injuries, lineups"],
    ["POST", "/api/matches/:id/predict", "Generate prediction with Claude (admin)"],
    ["POST", "/api/predictions/lock", "Store prediction before kickoff (admin)"],
    ["POST", "/api/results/sync", "Fetch final results and settle predictions (admin)"],
    ["GET", "/api/predictions/daily", "Ranked locked predictions for a day"],
    ["GET", "/api/accuracy", "Accuracy per category"],
  ];
  mount(root, html`
    <div class="page-head"><div><h1>Data &amp; integration status</h1><p>What is connected, what is not, and which mode the app is running in.</p></div>
      <span class="tag ${isDemo() ? "demo" : "green"}">${isDemo() ? "DEMO DATA MODE" : "LIVE MODE"}</span></div>

    <div class="card"><table><tbody>${rows.map(([n, on, t]) => html`<tr><td style="width:28px">${dot(on)}</td><td><b>${n}</b></td><td class="muted">${t}</td></tr>`)}</tbody></table>
      <p class="small muted" style="margin-top:10px">Mode reason: ${state.reason}</p></div>

    <section class="block"><h2>Backend endpoints</h2><div class="card"><div class="table-scroll"><table>
      <tbody>${endpoints.map(([m, p, d]) => html`<tr><td><span class="tag">${m}</span></td><td><code>${p}</code></td><td class="muted">${d}</td></tr>`)}</tbody></table></div></div></section>

    <section class="block"><h2>Data integrity rules</h2><div class="card"><ul class="small muted" style="margin:0;padding-left:18px;display:grid;gap:6px">
      <li>Fixtures, statistics, injuries and predictions are never invented. Without a connected source the app shows clearly labelled DEMO DATA with fictional clubs.</li>
      <li>API keys live only in the backend <code>.env</code>; the browser never sees them.</li>
      <li>Every page shows when its data was last updated.</li>
      <li>Missing data lowers confidence or is shown as unavailable — it is never filled in.</li>
      <li>Predictions are always described as estimates, never guarantees.</li>
    </ul></div></section>`);
}
