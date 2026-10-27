import { config, status } from "../config.js";
import * as football from "../services/footballProvider.js";
import { generatePrediction } from "../services/claudePredictor.js";
import * as store from "../services/store.js";

/**
 * Daily pipeline: fetch fixtures -> gather context -> generate predictions -> lock before kickoff.
 *
 * Run it from any scheduler:
 *   - cron:            0 7 * * *  cd /app/backend && npm run analyze:daily
 *   - GitHub Actions / Render cron / Railway cron / Cloud Scheduler hitting this script
 * Pair it with a second job that calls POST /api/results/sync after matches finish.
 *
 * It refuses to run until both services are connected, so it can never produce placeholder predictions.
 */
/**
 * mode "morning": predict every not-yet-started match of the day (lineups usually unknown; the prompt lowers confidence).
 * mode "lineups": run every ~20 min; for matches kicking off in 15-100 min, once official lineups are published,
 *                 lock a second, lineup-aware prediction. The morning record is kept; the later stage is the one shown and scored.
 */
export async function runDailyAnalysis(date = new Date().toISOString().slice(0, 10), mode = "morning") {
  const s = status();
  if (!s.footballApiConfigured || !s.claudeConfigured) {
    console.error("Daily analysis skipped: football API and/or Claude API not connected.", s);
    return { skipped: true };
  }
  const fixtures = await football.getFixtures({ date });
  let locked = 0;
  for (const fx of fixtures) {
    if (fx.status !== "scheduled" || new Date(fx.kickoffUtc) <= new Date()) continue; // only predict matches that haven't started
    const minsToKickoff = (new Date(fx.kickoffUtc) - Date.now()) / 60_000;
    if (mode === "lineups") {
      if (minsToKickoff < 15 || minsToKickoff > 100 || store.getPrediction(fx.id, "lineups")) continue;
    } else if (store.getPrediction(fx.id)) continue;
    try {
      const snapshotAt = new Date().toISOString();
      const [context, players] = await Promise.all([football.getMatchContext(fx.id), football.getPlayerIntel(fx.id)]);
      if (mode === "lineups" && ![...(players.home || []), ...(players.away || [])].some((p) => p.lineup)) continue; // not published yet; retry next run
      const prediction = await generatePrediction({ context, players });
      store.lockPrediction({ fixtureId: fx.id, kickoffUtc: fx.kickoffUtc, prediction, dataSnapshotAt: snapshotAt, stage: mode === "lineups" ? "lineups" : "morning" });
      locked++;
    } catch (e) {
      console.error(`Fixture ${fx.id} skipped:`, e.message);
    }
  }
  return { fixtures: fixtures.length, locked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyAnalysis(undefined, process.argv.includes("--lineups") ? "lineups" : "morning").then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
}
