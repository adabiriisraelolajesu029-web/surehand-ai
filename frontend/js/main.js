import { init, isDemo, state } from "./api.js";
import { html, mount, stateCard, skeletons } from "./ui.js";
import { dashboard } from "./pages/dashboard.js";
import { match } from "./pages/match.js";
import { daily } from "./pages/daily.js";
import { accuracy } from "./pages/accuracy.js";
import { data } from "./pages/data.js";

const app = document.getElementById("app");
const bannerEl = document.getElementById("banner");

const routes = [
  [/^#?\/?$/, "dashboard", () => dashboard(app)],
  [/^#\/match\/(.+)$/, "dashboard", (m) => match(app, decodeURIComponent(m[1]))],
  [/^#\/daily$/, "daily", () => daily(app)],
  [/^#\/accuracy$/, "accuracy", () => accuracy(app)],
  [/^#\/data$/, "data", () => data(app)],
];

function banner() {
  mount(bannerEl, isDemo()
    ? html`<div class="banner" role="status"><div class="wrap"><strong>DEMO DATA</strong><span>Fictional clubs, players and numbers for previewing the interface. ${state.reason} <a href="#/data" style="text-decoration:underline">Integration status</a></span></div></div>`
    : html`<div class="banner live" role="status"><div class="wrap"><strong>LIVE</strong><span>Connected to the SureHand backend.</span></div></div>`);
}

let navToken = 0;
async function route() {
  const token = ++navToken;
  const hash = location.hash || "#/";
  const hit = routes.find(([re]) => re.test(hash));
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", hit && a.dataset.route === hit[1]));
  if (!hit) { mount(app, stateCard("Page not found", "That page doesn't exist.")); return; }
  try {
    await hit[2](hash.match(hit[0]));
    if (token === navToken) window.scrollTo({ top: 0 });
  } catch (e) {
    if (token !== navToken) return;
    console.error(e);
    mount(app, stateCard(e.notConnected ? "Service not connected" : "Couldn't load this page", e.message || "Unexpected error."));
  }
}

mount(app, skeletons(4));
await init();
banner();
window.addEventListener("hashchange", route);
route();
