import { config, status } from "../config.js";
import { NotConnectedError } from "./errors.js";
import * as apiFootball from "./providers/apiFootball.js";
import * as footballData from "./providers/footballData.js";

/**
 * Football data provider facade. The rest of the app depends only on these four
 * functions and the shapes in docs/DATA_CONTRACTS.md.
 *
 * Supported providers (FOOTBALL_API_PROVIDER): "football-data" (free tier friendly), "api-football" (needs a paid plan for the current season).
 * To add another, create services/providers/<name>.js exporting the same four functions
 * and register it below. Nothing here ever returns invented data: an unsupported or
 * unconfigured provider throws NotConnectedError.
 */
const PROVIDERS = { "api-football": apiFootball, "football-data": footballData };

function provider() {
  if (!status().footballApiConfigured) {
    throw new NotConnectedError(
      "Football statistics API",
      "Set FOOTBALL_API_PROVIDER, FOOTBALL_API_KEY and FOOTBALL_API_BASE_URL in backend/.env."
    );
  }
  const p = PROVIDERS[config.football.provider];
  if (!p) {
    throw new NotConnectedError(
      "Football statistics API",
      `Provider "${config.football.provider}" is not supported. Supported: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }
  return p;
}

/** @returns {Promise<Fixture[]>} fixtures for an ISO date (YYYY-MM-DD) in the tracked leagues */
export const getFixtures = (args) => provider().getFixtures(args);

/** @returns {Promise<MatchContext>} form, season splits, H2H */
export const getMatchContext = (fixtureId) => provider().getMatchContext(fixtureId);

/** @returns {Promise<PlayerIntel>} injuries, suspensions, scoring records, lineups (when published) */
export const getPlayerIntel = (fixtureId) => provider().getPlayerIntel(fixtureId);

/** @returns {Promise<FinalResult[]>} final scores and goalscorers for finished fixtures */
export const getResults = (fixtureIds) => provider().getResults(fixtureIds);
