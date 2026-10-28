import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { status } from "../config.js";
import * as football from "../services/footballProvider.js";
import { predict } from "../services/statModel.js";
import { accuracyOf } from "../services/store.js";

/**
 * Free, serverless pipeline for GitHub Actions + GitHub Pages.
 *
 *   fixtures (today + next 5 days, UTC) -> (only matches within 36h of kickoff) context + player data -> statistical prediction -> locked JSON file
 *   finished matches -> results attached -> accuracy recomputed -> index written
 *
 * Output goes to <repo>/data (or STATIC_DATA_DIR). The workflow commits it, so git history is the audit trail.
 * Integrity: a match file that already holds a prediction is NEVER recomputed or overwritten; results are
 * attached to it afterwards without touching the prediction.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.STATIC_DATA_DIR || path.join(here, "..", "..", "data");
const DAYS_AHEAD = Number(process.env.FOOTBALL_DAYS_AHEAD ?? 5); // fixtures listed this many days ahead
const PREDICT_WINDOW_MS = Number(process.env.PREDICT_WINDOW_HOURS ?? 36) * 3_600_000; // predictions are made/locked this long before kickoff
const KEEP_DAYS_BACK = 3; // how many past days stay listed on the site (files are never deleted)
const KEEP_DAYS_FWD = Math.max(6, DAYS_AHEAD + 1);
const MIN_LEAD_MS = 5 * 60_000; // only predict matches that start at least 5 minutes from now
const SETTLE_AFTER_MS = 150 * 60_000; // results are fetched 2.5h after kickoff
const SETTLE_WINDOW_MS = 5 * 86_400_000; // give up on unfinished matches after 5 days (postponed etc.)

const file = (...p) => path.join(OUT, ...p);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1) + "\n"); };
const dayKey = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

export async function run(now = new Date()) {
  if (!status().footballApiConfigured) {
    console.error("Football data API is not configured (FOOTBALL_API_PROVIDER / FOOTBALL_API_KEY / FOOTBALL_API_BASE_URL). Nothing generated.");
    return { skipped: true };
  }
  const summary = { fixtures: 0, locked: 0, skipped: 0, failed: 0, settled: 0 };

  // 1) fixtures + predictions
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const date = dayKey(addDays(now, i));
    const fixtures = await football.getFixtures({ date }); // a failure here aborts the run before anything is written for this day
    writeJson(file("fixtures", `${date}.json`), fixtures);
    summary.fixtures += fixtures.length;

    for (const fx of fixtures) {
      const mfile = file("matches", `${fx.id}.json`);
      const existing = readJson(mfile);
      if (existing?.prediction) { summary.skipped++; continue; } // locked: never touched
      const lead = new Date(fx.kickoffUtc) - now;
      // Too late, or too early: predicting days ahead would lock numbers that go stale before kickoff.
      if (fx.status !== "scheduled" || lead < MIN_LEAD_MS || lead > PREDICT_WINDOW_MS) { summary.skipped++; continue; }
      try {
        const snapshotAt = new Date().toISOString();
        const [ctx, players] = await Promise.all([football.getMatchContext(fx.id), football.getPlayerIntel(fx.id)]);
        const context = { ...ctx, fixture: fx }; // the fixture list is the single source of truth for names/kickoff
        const prediction = predict({ context, players });
        if (!prediction) { console.warn(`Fixture ${fx.id} (${fx.home.name} v ${fx.away.name}): not enough season data for a prediction yet.`); }
        if (new Date(fx.kickoffUtc) <= new Date()) { summary.skipped++; continue; } // kickoff passed while we were fetching
        writeJson(mfile, {
          fixtureId: fx.id, kickoffUtc: fx.kickoffUtc, context, players, prediction, dataSnapshotAt: snapshotAt,
          lockedAt: prediction ? new Date().toISOString() : null, result: null,
        });
        if (prediction) summary.locked++; else summary.skipped++;
      } catch (e) {
        summary.failed++;
        console.error(`Fixture ${fx.id} skipped:`, e.message);
      }
    }
  }

  // 2) settle finished matches
  const all = listMatches();
  const due = all.filter((m) => m.prediction && !m.result && now - new Date(m.kickoffUtc) > SETTLE_AFTER_MS && now - new Date(m.kickoffUtc) < SETTLE_WINDOW_MS);
  if (due.length) {
    try {
      const results = await football.getResults(due.map((m) => m.fixtureId));
      for (const r of results) {
        const m = readJson(file("matches", `${r.fixtureId}.json`));
        if (!m || m.result) continue;
        m.result = { home: r.home, away: r.away, scorers: r.scorers ?? null, recordedAt: new Date().toISOString() };
        writeJson(file("matches", `${r.fixtureId}.json`), m);
        summary.settled++;
      }
    } catch (e) { console.error("Result sync failed (will retry next run):", e.message); }
  }

  // 3) daily lists, accuracy, index
  const matches = listMatches();
  const byDate = new Map();
  for (const m of matches) {
    const d = m.kickoffUtc.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    if (m.prediction) byDate.get(d).push({ fixture: m.context.fixture, prediction: m.prediction, lockedAt: m.lockedAt });
  }
  for (const [d, rows] of byDate) writeJson(file("daily", `${d}.json`), rows);

  const settled = matches.filter((m) => m.prediction && m.result);
  const acc = accuracyOf(settled);
  acc.tracked = settled
    .sort((a, b) => b.kickoffUtc.localeCompare(a.kickoffUtc)).slice(0, 100)
    .map((m) => ({
      match: `${m.context.fixture.home.name} v ${m.context.fixture.away.name}`,
      lockedAt: m.lockedAt, pick: m.prediction.outcome.pick, score: m.prediction.correctScore.top.score,
      actual: { home: m.result.home, away: m.result.away },
      scorers: Array.isArray(m.result.scorers) ? m.prediction.goalscorers.map((g) => ({ name: g.name, hit: m.result.scorers.includes(g.playerId) })) : [],
    }));
  writeJson(file("accuracy.json"), acc);

  const lo = dayKey(addDays(now, -KEEP_DAYS_BACK)), hi = dayKey(addDays(now, KEEP_DAYS_FWD));
  const dates = fs.existsSync(file("fixtures")) ? fs.readdirSync(file("fixtures")).map((n) => n.replace(".json", "")).filter((d) => d >= lo && d <= hi).sort() : [];
  writeJson(file("index.json"), { updatedAt: new Date().toISOString(), dates, method: "statistical-model", source: "football-data.org" });

  console.log("Done:", summary);
  return summary;
}

function listMatches() {
  const dir = file("matches");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => readJson(path.join(dir, n))).filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
