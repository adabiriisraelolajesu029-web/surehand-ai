// Data access layer. The browser only ever talks to the SureHand backend —
// football-API and Claude keys live on the server.
//
// Mode is decided once at startup:
//   live → backend reachable AND football API configured: every call goes to /api/*
//   demo → anything else: fictional DEMO DATA is shown and labelled as such
// In live mode errors are surfaced to the user; we never silently fall back to demo data.
import { DEMO_SNAPSHOT_AT, DEMO_TRACKED, getDemoDaily, getDemoFixtures, getDemoMatch } from "./demo-data.js";

const BASE = (window.SUREHAND_CONFIG && window.SUREHAND_CONFIG.apiBase) || "/api";

export const state = { mode: "demo", reason: "Checking backend…", health: null };
export const isDemo = () => state.mode === "demo";

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
    state.mode = "demo"; state.health = null; state.reason = "Backend not reachable.";
  }
  return state;
}

const demoMeta = { source: "demo", fetchedAt: DEMO_SNAPSHOT_AT };
const wrapLive = (b) => ({ data: b.data, source: "live", updatedAt: b.meta.fetchedAt });

export async function getFixtures({ date } = {}) {
  if (isDemo()) return { data: getDemoFixtures(), source: "demo", updatedAt: demoMeta.fetchedAt };
  return wrapLive(await http(`/fixtures?date=${encodeURIComponent(date || "")}`));
}

/** Returns the MatchDetail shape described in docs/DATA_CONTRACTS.md (prediction may be null in live mode). */
export async function getMatch(id) {
  if (isDemo()) {
    const m = getDemoMatch(id);
    if (!m) throw new Error("Demo match not found");
    return { data: m, source: "demo", updatedAt: demoMeta.fetchedAt };
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
  const r = wrapLive(await http(`/predictions/daily?date=${encodeURIComponent(date || "")}`));
  // Backend returns locked prediction records; the Daily page needs the fixture too.
  const fixtures = (await getFixtures({ date })).data;
  r.data = r.data.map((rec) => ({ fixture: fixtures.find((f) => f.id === rec.fixtureId), prediction: rec.prediction, lockedAt: rec.lockedAt })).filter((x) => x.fixture);
  return r;
}

export async function getAccuracy() {
  if (isDemo()) return { data: { tracked: DEMO_TRACKED }, source: "demo", updatedAt: demoMeta.fetchedAt };
  return wrapLive(await http("/accuracy"));
}
