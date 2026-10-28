import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimal JSON-file store so the structure works out of the box.
 * Swap for Postgres/SQLite/Supabase in production — keep the same function names.
 *
 * Integrity rules enforced here:
 *  - A prediction is locked with a timestamp BEFORE kickoff and can never be edited or replaced.
 *  - Results are attached separately and never alter the locked prediction.
 */
// DATA_DIR lets a host point the store at a persistent disk (e.g. Render disk at /var/data).
const dir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const file = path.join(dir, "predictions.json");

function load() {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { predictions: [] }; }
}
function save(db) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

export function listPredictions() { return load().predictions; }
const RANK = { morning: 0, lineups: 1 };
/** One record per fixture: the latest stage locked before kickoff (lineups beats morning). */
function latest(rows) {
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.fixtureId);
    if (!cur || (RANK[r.stage] ?? 0) > (RANK[cur.stage] ?? 0)) best.set(r.fixtureId, r);
  }
  return [...best.values()];
}
export function listLatest() { return latest(load().predictions); }
export function getPrediction(fixtureId, stage) {
  const rows = load().predictions.filter((p) => p.fixtureId === fixtureId && (!stage || (p.stage ?? "morning") === stage));
  return latest(rows)[0] || null;
}

export function lockPrediction({ fixtureId, kickoffUtc, prediction, dataSnapshotAt, stage = "morning" }) {
  const db = load();
  if (!(stage in RANK)) { const e = new Error(`Unknown stage "${stage}"`); e.status = 400; throw e; }
  if (db.predictions.some((p) => p.fixtureId === fixtureId && (p.stage ?? "morning") === stage)) {
    const e = new Error(`A ${stage} prediction is already locked for this fixture`); e.status = 409; throw e;
  }
  const now = new Date();
  if (now >= new Date(kickoffUtc)) {
    const e = new Error("Kickoff has passed; predictions can only be locked before kickoff"); e.status = 422; throw e;
  }
  const record = { fixtureId, kickoffUtc, stage, prediction, dataSnapshotAt, lockedAt: now.toISOString(), result: null };
  db.predictions.push(record);
  save(db);
  return record;
}

export function attachResult(fixtureId, result) {
  const db = load();
  const recs = db.predictions.filter((p) => p.fixtureId === fixtureId);
  if (!recs.length) return null;
  const recordedAt = new Date().toISOString();
  let changed = false;
  for (const rec of recs) if (!rec.result) { rec.result = { ...result, recordedAt }; changed = true; }
  if (changed) save(db);
  return latest(recs)[0];
}

/** Accuracy is computed from locked predictions with results, per category. */
export function computeAccuracy() {
  return accuracyOf(listLatest()); // latest locked stage per fixture; earlier stages are kept but not double-counted
}

/** Pure: accuracy from any list of { prediction, result } records (also used by the static site generator). */
export function accuracyOf(records) {
  const done = records.filter((p) => p.result);
  const out = { settled: done.length, outcome: { n: 0, hit: 0 }, correctScore: { n: 0, hit: 0 }, goalscorer: { n: 0, hit: 0 } };
  for (const p of done) {
    const { home, away } = p.result;
    const scorers = Array.isArray(p.result.scorers) ? p.result.scorers : null; // null = data source did not report scorers
    const actual = home > away ? "H" : home < away ? "A" : "D";
    out.outcome.n++; if (p.prediction.outcome.pick === actual) out.outcome.hit++;
    out.correctScore.n++; if (p.prediction.correctScore.top.score === `${home}-${away}`) out.correctScore.hit++;
    if (scorers) for (const g of p.prediction.goalscorers || []) { out.goalscorer.n++; if (scorers.includes(g.playerId)) out.goalscorer.hit++; }
  }
  const pct = (c) => (c.n ? c.hit / c.n : null);
  return { ...out, outcome: { ...out.outcome, rate: pct(out.outcome) }, correctScore: { ...out.correctScore, rate: pct(out.correctScore) }, goalscorer: { ...out.goalscorer, rate: pct(out.goalscorer) }, updatedAt: new Date().toISOString() };
}
