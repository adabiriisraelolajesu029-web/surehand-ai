# Data contracts

The frontend and `backend/services/footballProvider.js` agree on these normalized shapes. A real provider adapter must map its raw responses into them. Anything the provider cannot supply should be **omitted or null**, never guessed: the UI shows "unavailable" and the prediction prompt lowers confidence.

## Fixture (`GET /api/fixtures` → `data: Fixture[]`)
```json
{ "id": "string", "kickoffUtc": "2026-10-27T15:00:00Z", "status": "scheduled",
  "league": { "id": "string", "name": "string", "country": "string" },
  "home": { "id": "string", "name": "string", "short": "ABC", "color": "#22e07a" },
  "away": { "id": "string", "name": "string", "short": "XYZ" } }
```

## MatchContext (`GET /api/matches/:id/analysis` → `data.context`)
```json
{ "fixture": { "...Fixture" },
  "form":  { "home": [Game x5], "away": [Game x5] },
  "stats": { "home": Splits, "away": Splits, "sample": "Last 10 matches" },
  "h2h":   [ { "date": "2025-03-01", "homeId": "", "awayId": "", "home": "", "away": "", "hg": 2, "ag": 1 } ] }
```
`Game = { opp, venue: "H"|"A", gf, ga, res: "W"|"D"|"L" }`
`Splits = { overall, home, away }`, each `{ p, w, d, l, gf, ga }`

## Players (`data.players`)
```json
{ "home": [Player], "away": [Player] }
```
`Player = { id, name, team, pos, apps, goals, minutes, shotsPer90, status: "available"|"doubt"|"injured"|"suspended", note, lineup: "likely"|"rotation risk"|"unlikely" }`
Only include lineup/injury fields the provider actually reports.

## Prediction (`POST /api/matches/:id/predict`, stored by `/api/predictions/lock`)
```json
{ "outcome": { "homeWin": 0.45, "draw": 0.27, "awayWin": 0.28, "pick": "H", "confidence": 0.5,
               "reasoning": "", "evidence": [""], "uncertainties": [""] },
  "goalscorers": [ { "playerId": "", "name": "", "team": "", "probability": 0.31, "confidence": 0.4,
                     "reasoning": "", "evidence": [""], "uncertainties": [""] } ],
  "correctScore": { "top": { "score": "2-1", "probability": 0.11 }, "alternatives": [ { "score": "1-1", "probability": 0.1 } ],
                    "confidence": 0.2, "reasoning": "", "evidence": [""], "uncertainties": [""] } }
```
`claudePredictor.validatePrediction` rejects output that doesn't follow this shape (probabilities must sum to ~1, confidences in 0–1, uncertainties required).

## Locked record (`GET /api/predictions/:fixtureId`)
`{ fixtureId, kickoffUtc, prediction, dataSnapshotAt, lockedAt, result: null | { home, away, scorers: [playerId], recordedAt } }`

## Response envelope
`{ "data": ..., "meta": { "source": "live", "fetchedAt": "ISO timestamp" } }`
Not-connected services return HTTP 501 with `{ "error": "...", "notConnected": true }`.
