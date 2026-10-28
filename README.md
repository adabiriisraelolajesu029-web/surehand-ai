# SureHand AI

Football analytics dashboard: match outcome, anytime goalscorer and correct-score predictions, each with reasoning, a confidence estimate, supporting statistics and stated uncertainties. Predictions are never presented as guaranteed.

## Current status (initial stage)

| Part | State |
|---|---|
| Interface (dashboard, match analysis, daily predictions, accuracy tracker, data status) | Built, responsive |
| Demo mode | Built. Fictional clubs and players, labelled **DEMO DATA** everywhere |
| Backend API structure and endpoints | Built |
| Prediction locking + accuracy calculation | Built (JSON-file store; swap for a database in production) |
| Football statistics API integration | **football-data.org adapter written** (`services/providers/footballData.js`, free tier, top 5 leagues) plus an API-Football adapter for paid plans. Both tested against mocked responses only; never run against the live APIs. Needs your `FOOTBALL_API_KEY` |
| Claude prediction generation | **Written but untested.** Needs `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`; never run against the live API |
| Scheduled daily analysis | Script in place (`jobs/dailyAnalysis.js`); refuses to run until both services are connected |

No live fixtures, player statistics, injuries or AI predictions are produced until the services above are connected and tested. The Poisson numbers in demo mode come from invented ratings and are not real analysis.

## Free hosting on GitHub (no server, no cost)

This is the default way to run SureHand AI when you have no budget. Everything runs on GitHub's free tools for a public repository:

- **`.github/workflows/predictions.yml`** runs three times a day. It fetches fixtures and league stats from football-data.org (free token), calculates predictions with the statistical model (`backend/services/statModel.js`, a Poisson goal model, **not AI**), attaches final results, and commits the JSON files in `data/`.
- **GitHub Pages** publishes `frontend/` plus `data/` as the website. The page reads the JSON files, so no backend is needed.
- Predictions are written once, before kickoff, and never recalculated. Git history shows when each was saved.

One-time setup:
1. Repository **Settings → Secrets and variables → Actions → New repository secret**: name `FOOTBALL_API_KEY`, value = your football-data.org token.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions** tab → "Update predictions and publish site" → **Run workflow**. The first run takes several minutes (the free API allows 10 requests/minute). Your site appears at `https://<username>.github.io/<repo>/`.

Limits: no injuries/lineups (free data source), scheduled runs can start 10-30 minutes late, and GitHub may pause scheduled workflows after ~60 days without repository activity (re-enable them in the Actions tab).

The Express backend, Claude-written predictions and `render.yaml` below are an optional paid upgrade path.

## Run it

```bash
cd backend
npm install
cp .env.example .env     # optional for demo mode
npm start                # http://localhost:8787 — serves the API and the frontend
```

You can also open `frontend/` with any static server (e.g. `npx serve frontend`); with no backend it runs in demo mode. If the frontend is hosted separately, set `apiBase` in `frontend/js/config.js` and add the origin to `CORS_ORIGINS`.

## Architecture

```
frontend/            static ES-module SPA (no build step), talks only to /api
  js/api.js          live vs demo mode, single data-access layer
  js/demo-data.js    fictional DEMO DATA
  js/pages/*         dashboard, match, daily, accuracy, data status
  js/ui.js           escaped templating + reusable components
backend/
  server.js          Express API, rate limiting, CORS, admin-token guard
  services/footballProvider.js   adapter to implement for a stats API
  services/claudePredictor.js    Claude prompt + strict output validation
  services/store.js              locking, results, accuracy
  jobs/dailyAnalysis.js          fixtures → context → predict → lock
docs/DATA_CONTRACTS.md           shapes the provider adapter must return
```

Secrets stay in `backend/.env`. Endpoints that spend money or write data (`/predict`, `/predictions/lock`, `/results/sync`) require `Authorization: Bearer $ADMIN_TOKEN`.

## Deploy on Render

`render.yaml` defines the web service (API + frontend, with a persistent disk for the prediction store) and two cron jobs: a 07:00 WAT daily analysis (`POST /api/jobs/daily-analysis`) and a 00:30 WAT results sync. Push the project to GitHub, create a Blueprint in Render, then set `FOOTBALL_API_KEY` and `ANTHROPIC_API_KEY`, and copy the generated `ADMIN_TOKEN` and your site URL into both cron jobs. A persistent disk requires a paid Render instance; on a free one the store resets on every deploy.

**Data source limits (football-data.org free tier):** top 5 leagues for the current season, 10 requests/minute (the adapter queues calls to stay under it; a full day takes several minutes, which is fine for the scheduled job). It does **not** provide injuries, suspensions, lineups, minutes or shots, so anytime-goalscorer picks are based on each team's league top scorers only and carry lower confidence, and the match page says availability is unknown. Final scorers may not be available either; in that case goalscorer accuracy is simply not tracked (never counted as misses). For fuller player data, switch `FOOTBALL_API_PROVIDER` to `api-football` on a paid plan; the optional lineup-aware second run (`?mode=lineups`) only works with that provider.

## Connecting real data (next steps)

1. Register for a free football-data.org token and set `FOOTBALL_API_KEY` in `.env` (defaults already point at the top 5 leagues: PL, PD, SA, BL1, FL1).
2. Run `/api/fixtures` and `/api/matches/:id/analysis` for a real fixture and compare the output with the football-data.org website or another trusted source, including missing injury/lineup data.
3. Set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; run `/predict` on a few matches and review the output manually before trusting it.
4. Schedule `npm run analyze:daily` (cron / platform scheduler) ahead of kickoffs, plus a post-match job calling `POST /api/results/sync`.
5. Replace the JSON store with a real database before relying on the accuracy history.

## Known limitations

- Frontend was not browser-tested in this build environment; load it and report any layout bugs.
- The Express server was not booted here (the build sandbox could not reach the npm registry). Syntax checks pass and the store/locking and demo-data logic were run directly; run `npm install && npm start` and check `/api/health` first.
- Live-mode page mapping depends on the contracts being followed exactly.
- Daily page in live mode lists only matches with locked predictions.
