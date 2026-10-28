// Data access layer. The browser only ever talks to the SureHand backend —
// football-API and Claude keys live on the server.
//
// Mode is decided once at startup:
//   live → backend reachable AND football API configured: every call goes to /api/*
//   demo → anything else: fictional DEMO DATA is shown and labelled as such
// In live mode errors are surfaced to the user; we never silently fall back to demo data.
import { DEMO_SNAPSHOT_AT, DEMO_TRACKED, getDemoDaily, getDemoFixtures, getDemoMatch } from "./demo-data.js";

const BASE = (window.SUREHAND_CONFIG && window.SUREHAND_CONFIG.apiBase) || "/api";

// Modes: "live" (backend API), "static" (pre-generated JSON files under ./data, e.g. GitHub Pages), "demo" (fictional data).
export const state = { mode: "demo", reason: "Checking backend…", health: null, index: null };
export const isDemo = () => state.mode === "demo";
export const isStatic = () => state.mode === "static";

/** Fetch a pre-generated data file. null when it does not exist; throws on other failures. */
async function sjson(path) {
  const res = await fetch(`data/${path}`, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return res.json();
}

async function http(path, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout ?? 15000);
  try {
    const res = await fetch(BASE + path, { signal: ctl.signal, headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, notConnected: body.notConnected });
    return body;
  } finally { clearTimeout(t); }
}

export async function init() {
  try {
    const h = await http("/health", { timeout: 2500 });
    state.health = h;
    if (h.services.footballApiConfigured) { state.mode = "live"; state.reason = "Connected to backend"; }
    else { state.mode = "demo"; state.reason = "Backend reachable, but no football statistics API is connected yet."; }
  } catch {
    state.health = null;
    try { // no backend: look for pre-generated data files published with the site
      const idx = await sjson("index.json");
      if (idx) { state.mode = "static"; state.index = idx; state.reason = "Reading published data files."; return state; }
    } catch { /* fall through to demo */ }
    state.mode = "demo"; state.reason = "Backend not reachable and no published data found.";
  }
  return state;
}

const demoMeta = { source: "demo", fetchedAt: DEMO_SNAPSHOT_AT };
const wrapLive = (b) => ({ data: b.data, source: "live", updatedAt: b.meta.fetchedAt });

export async function getFixtures({ date } = {}) {
  if (isDemo()) return { data: getDemoFixtures(), source: "demo", updatedAt: demoMeta.fetchedAt };
  if (isStatic()) { // every published day; the page filters by the viewer's local date
    const idx = state.index || {};
    const days = await Promise.all((idx.dates || []).map((d) => sjson(`fixtures/${d}.json`)));
    return { data: days.flat().filter(Boolean), source: "static", updatedAt: idx.updatedAt };
  }
  return wrapLive(await http(`/fixtures?date=${encodeURIComponent(date || "")}`));
}

/** Returns the MatchDetail shape described in docs/DATA_CONTRACTS.md (prediction may be null in live mode). */
export async function getMatch(id) {
  if (isDemo()) {
    const m = getDemoMatch(id);
    if (!m) throw new Error("Demo match not found");
    return { data: m, source: "demo", updatedAt: demoMeta.fetchedAt };
  }
  if (isStatic()) {
    const m = await sjson(`matches/${encodeURIComponent(id)}.json`);
    if (!m) { // listed fixture whose prediction window has not opened yet
      const idx = state.index || {};
      for (const d of idx.dates || []) {
        const fx = ((await sjson(`fixtures/${d}.json`)) || []).find((f) => f.id === String(id));
        if (fx) return { data: { fixture: fx, prediction: null, lockedAt: null }, source: "static", updatedAt: idx.updatedAt };
      }
      throw new Error("No data has been published for this match.");
    }
    return { data: { ...m.context, players: m.players, prediction: m.prediction, lockedAt: m.lockedAt }, source: "static", updatedAt: m.dataSnapshotAt };
  }
  const analysis = wrapLive(await http(`/matches/${encodeURIComponent(id)}/analysis`, { timeout: 60000 }));
  let prediction = null, lockedAt = null;
  try {
    const p = await http(`/predictions/${encodeURIComponent(id)}`);
    prediction = p.data.prediction; lockedAt = p.data.lockedAt;
  } catch (e) { if (e.status !== 404) throw e; }
  const { context, players } = analysis.data;
  return { data: { ...context, players, prediction, lockedAt }, source: "live", updatedAt: analysis.updatedAt };
}

/** Flat list of MatchDetail objects that have predictions, for the Daily page. */
export async function getDaily({ date } = {}) {
  if (isDemo()) return { data: getDemoDaily(), source: "demo", updatedAt: demoMeta.fetchedAt };
  if (isStatic()) { // the viewer's local "today"; if nothing is published for it, the next day that has data
    const idx = state.index || {}, dates = idx.dates || [];
    const t = new Date(), today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const day = dates.includes(today) ? today : dates.find((d) => d > today) || dates[dates.length - 1];
    const rows = day ? (await sjson(`daily/${day}.json`)) || [] : [];
    return { data: rows.filter((r) => new Date(r.fixture.kickoffUtc) > Date.now() - 6 * 3600e3), source: "static", updatedAt: idx.updatedAt };
  }
  const r = wrapLive(await http(`/predictions/daily?date=${encodeURIComponent(date || "")}`));
  // Backend returns locked prediction records; the Daily page needs the fixture too.
  const fixtures = (await getFixtures({ date })).data;
  r.data = r.data.map((rec) => ({ fixture: fixtures.find((f) => f.id === rec.fixtureId), prediction: rec.prediction, lockedAt: rec.lockedAt })).filter((x) => x.fixture);
  return r;
}

export async function getAccuracy() {
  if (isDemo()) return { data: { tracked: DEMO_TRACKED }, source: "demo", updatedAt: demoMeta.fetchedAt };
  if (isStatic()) {
    const a = (await sjson("accuracy.json")) || { outcome: { n: 0, hit: 0 }, correctScore: { n: 0, hit: 0 }, goalscorer: { n: 0, hit: 0 }, tracked: [] };
    return { data: a, source: "static", updatedAt: a.updatedAt || (state.index || {}).updatedAt };
  }
  return wrapLive(await http("/accuracy"));
}
