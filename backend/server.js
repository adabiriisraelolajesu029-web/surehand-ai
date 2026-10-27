import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config, status } from "./config.js";
import { NotConnectedError } from "./services/errors.js";
import * as football from "./services/footballProvider.js";
import { generatePrediction } from "./services/claudePredictor.js";
import * as store from "./services/store.js";
import { runDailyAnalysis } from "./jobs/dailyAnalysis.js";

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60 }));

// Serve the frontend from the same origin so `npm start` gives you the whole app.
// (In production you can host /frontend on any static host and point apiBase at this API.)
const frontendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");
app.use(express.static(frontendDir));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const stamp = (data) => ({ data, meta: { source: "live", fetchedAt: new Date().toISOString() } });

function requireAdmin(req, res, next) {
  if (!config.adminToken) return res.status(503).json({ error: "ADMIN_TOKEN is not configured on the server." });
  if (req.get("authorization") !== `Bearer ${config.adminToken}`) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Which services are connected. The frontend uses this to decide between live and DEMO mode.
app.get("/api/health", (_req, res) => res.json({ ok: true, services: status(), time: new Date().toISOString() }));

// 1. Fixture retrieval
app.get("/api/fixtures", wrap(async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  res.json(stamp(await football.getFixtures({ date, league: req.query.league, country: req.query.country })));
}));

// 2. Match analysis (stats, form, H2H, player intelligence). No AI involved.
app.get("/api/matches/:id/analysis", wrap(async (req, res) => {
  const [context, players] = await Promise.all([football.getMatchContext(req.params.id), football.getPlayerIntel(req.params.id)]);
  res.json(stamp({ context, players }));
}));

// 3. Prediction generation (Claude). Returns the prediction; locking is a separate, explicit step.
app.post("/api/matches/:id/predict", requireAdmin, wrap(async (req, res) => {
  const [context, players] = await Promise.all([football.getMatchContext(req.params.id), football.getPlayerIntel(req.params.id)]);
  const prediction = await generatePrediction({ context, players });
  res.json(stamp(prediction));
}));

// 4. Result tracking
app.post("/api/predictions/lock", requireAdmin, wrap(async (req, res) => {
  const { fixtureId, kickoffUtc, prediction, dataSnapshotAt } = req.body || {};
  if (!fixtureId || !kickoffUtc || !prediction) return res.status(400).json({ error: "fixtureId, kickoffUtc and prediction are required" });
  res.status(201).json(store.lockPrediction({ fixtureId, kickoffUtc, prediction, dataSnapshotAt }));
}));

app.post("/api/results/sync", requireAdmin, wrap(async (_req, res) => {
  const pending = store.listLatest().filter((p) => !p.result && new Date(p.kickoffUtc) < new Date());
  const results = await football.getResults(pending.map((p) => p.fixtureId));
  let attached = 0;
  for (const r of results) if (store.attachResult(r.fixtureId, r)) attached++;
  res.json({ attached, checkedAt: new Date().toISOString() });
}));

// Scheduler hook: a platform cron (e.g. Render) POSTs here each morning. The run takes minutes
// (one Claude call per match), so it is started in the background and answered with 202.
let dailyRun = null;
app.post("/api/jobs/daily-analysis", requireAdmin, (req, res) => {
  if (dailyRun) return res.status(409).json({ error: "A daily analysis run is already in progress.", startedAt: dailyRun });
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const mode = req.query.mode === "lineups" ? "lineups" : "morning";
  dailyRun = new Date().toISOString();
  runDailyAnalysis(date, mode)
    .then((r) => console.log("Daily analysis finished:", date, r))
    .catch((e) => console.error("Daily analysis failed:", e))
    .finally(() => { dailyRun = null; });
  res.status(202).json({ started: true, date, mode, startedAt: dailyRun });
});

app.get("/api/predictions/daily", wrap(async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const rows = store.listLatest().filter((p) => p.kickoffUtc.startsWith(date));
  const strength = (p) => Math.max(p.prediction.outcome.confidence, p.prediction.correctScore.confidence);
  res.json(stamp(rows.sort((a, b) => strength(b) - strength(a))));
}));

app.get("/api/predictions/:fixtureId", wrap(async (req, res) => {
  const rec = store.getPrediction(req.params.fixtureId);
  if (!rec) return res.status(404).json({ error: "No locked prediction exists for this fixture." });
  res.json(stamp(rec));
}));

app.get("/api/accuracy", (_req, res) => res.json(stamp(store.computeAccuracy())));

app.use((err, _req, res, _next) => {
  if (err instanceof NotConnectedError) return res.status(501).json({ error: err.message, service: err.service, notConnected: true });
  const code = err.status || 500;
  if (code === 500) console.error(err);
  res.status(code).json({ error: code === 500 ? "Internal server error" : err.message });
});

app.listen(config.port, () => console.log(`SureHand AI API on :${config.port}`, status()));
