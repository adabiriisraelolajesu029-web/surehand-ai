import { getFixtures, isDemo } from "../api.js";
import { crest, demoTag, fmtDay, fmtTime, html, localDateKey, mount, skeletons, stateCard, updatedAt } from "../ui.js";

const filters = { date: "", league: "all", country: "all", q: "" };

export async function dashboard(root) {
  mount(root, html`<div class="page-head"><div><h1>Upcoming matches</h1></div></div>${skeletons(5)}`);
  const res = await getFixtures({ date: filters.date });
  const all = res.data;
  const demo = res.source === "demo";

  if (!filters.date) filters.date = localDateKey(new Date().toISOString());
  const dates = [...new Set(all.map((f) => localDateKey(f.kickoffUtc)))].sort();
  const fromList = res.source !== "live"; // demo and static data come as a fixed set of days
  if (fromList && dates.length && !dates.includes(filters.date)) filters.date = dates.find((d) => d >= filters.date) || dates[dates.length - 1];
  const leagues = [...new Map(all.map((f) => [f.league.id, f.league])).values()];
  const countries = [...new Set(all.map((f) => f.league.country))].sort();

  const list = all
    .filter((f) => localDateKey(f.kickoffUtc) === filters.date)
    .filter((f) => filters.league === "all" || f.league.id === filters.league)
    .filter((f) => filters.country === "all" || f.league.country === filters.country)
    .filter((f) => !filters.q || `${f.home.name} ${f.away.name}`.toLowerCase().includes(filters.q.toLowerCase()))
    .sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));

  const byLeague = new Map();
  for (const f of list) { if (!byLeague.has(f.league.id)) byLeague.set(f.league.id, { league: f.league, items: [] }); byLeague.get(f.league.id).items.push(f); }

  mount(root, html`
    <div class="page-head">
      <div>
        <h1>Upcoming matches ${demoTag(demo)}</h1>
        <p>Select a match for form, head-to-head, player intelligence and predictions with their evidence.</p>
      </div>
      ${updatedAt(res.updatedAt, res.source)}
    </div>

    <form class="filters" id="filters" aria-label="Filter matches">
      <div class="field"><label for="f-date">Date</label>
        ${fromList
          ? html`<select id="f-date">${dates.map((d) => html`<option value="${d}" ${d === filters.date ? "selected" : ""}>${fmtDay(d + "T12:00:00")}</option>`)}</select>`
          : html`<input id="f-date" type="date" value="${filters.date}" />`}</div>
      <div class="field"><label for="f-league">League</label>
        <select id="f-league"><option value="all">All leagues</option>${leagues.map((l) => html`<option value="${l.id}" ${l.id === filters.league ? "selected" : ""}>${l.name}</option>`)}</select></div>
      <div class="field"><label for="f-country">Country</label>
        <select id="f-country"><option value="all">All countries</option>${countries.map((c) => html`<option ${c === filters.country ? "selected" : ""}>${c}</option>`)}</select></div>
      <div class="field search"><label for="f-q">Team</label><input id="f-q" type="search" placeholder="Search teams" value="${filters.q}" /></div>
      <button type="button" id="f-reset">Reset</button>
    </form>

    ${list.length === 0
      ? stateCard("No matches found", isDemo() ? "No demo fixtures match these filters." : "No fixtures returned for these filters. Try another date or league.")
      : [...byLeague.values()].map(({ league, items }) => html`
        <div class="league-head"><span>${league.name}</span><span class="tag">${league.country}</span></div>
        ${items.map((f) => html`
          <a class="match" href="#/match/${encodeURIComponent(f.id)}" aria-label="${f.home.name} versus ${f.away.name}, kickoff ${fmtTime(f.kickoffUtc)}">
            <div class="ko"><b>${fmtTime(f.kickoffUtc)}</b><span>${fmtDay(f.kickoffUtc)}</span></div>
            <div class="teams">
              <div class="team">${crest(f.home)}<span class="name">${f.home.name}</span></div>
              <div class="team">${crest(f.away)}<span class="name">${f.away.name}</span></div>
            </div>
            <div class="go" aria-hidden="true">›</div>
          </a>`)}`)}
  `);

  const rerender = () => dashboard(root);
  root.querySelector("#f-date").onchange = (e) => { filters.date = e.target.value; rerender(); };
  root.querySelector("#f-league").onchange = (e) => { filters.league = e.target.value; rerender(); };
  root.querySelector("#f-country").onchange = (e) => { filters.country = e.target.value; rerender(); };
  const q = root.querySelector("#f-q");
  q.oninput = (e) => { filters.q = e.target.value; clearTimeout(q._t); q._t = setTimeout(async () => { await rerender(); const n = root.querySelector("#f-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  root.querySelector("#f-reset").onclick = () => { Object.assign(filters, { date: "", league: "all", country: "all", q: "" }); rerender(); };
}
