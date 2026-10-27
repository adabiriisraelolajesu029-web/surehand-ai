import Anthropic from "@anthropic-ai/sdk";
import { config, status } from "../config.js";
import { NotConnectedError } from "./errors.js";

const SYSTEM_PROMPT = `You are the analysis engine of SureHand AI, a football analytics product.
You receive structured, sourced data for ONE match. Produce evidence-based predictions.
Rules:
- Use ONLY the data supplied. Never invent statistics, injuries, lineups or results.
- If data is missing or stale, say so in "uncertainties" and lower confidence.
- Probabilities are estimates, never guarantees. Never use words like "guaranteed", "sure" or "lock".
- Probabilities for outcome must sum to 1 (+/-0.01). Confidence is a number from 0 to 1.
- Respond with a single JSON object matching the requested schema and nothing else.`;

export const PREDICTION_SCHEMA_HINT = {
  outcome: { homeWin: "number", draw: "number", awayWin: "number", pick: "H|D|A", confidence: "number", reasoning: "string", evidence: ["string"], uncertainties: ["string"] },
  goalscorers: [{ playerId: "string", name: "string", team: "string", probability: "number", confidence: "number", reasoning: "string", evidence: ["string"], uncertainties: ["string"] }],
  correctScore: { top: { score: "H-A", probability: "number" }, alternatives: [{ score: "H-A", probability: "number" }], confidence: "number", reasoning: "string", evidence: ["string"], uncertainties: ["string"] },
};

/** Validate model output before it is stored or shown. Throws on anything malformed. */
export function validatePrediction(p) {
  const o = p?.outcome;
  if (!o) throw new Error("Missing outcome");
  const sum = o.homeWin + o.draw + o.awayWin;
  if (![o.homeWin, o.draw, o.awayWin].every((x) => typeof x === "number" && x >= 0 && x <= 1) || Math.abs(sum - 1) > 0.02) {
    throw new Error("Outcome probabilities invalid");
  }
  for (const section of [o, p.correctScore, ...(p.goalscorers || [])]) {
    if (!section || typeof section.confidence !== "number" || section.confidence < 0 || section.confidence > 1) throw new Error("Invalid confidence");
    if (!Array.isArray(section.uncertainties)) throw new Error("Uncertainties required");
  }
  return p;
}

/**
 * Generate predictions for one match from provider data.
 * Requires ANTHROPIC_API_KEY + ANTHROPIC_MODEL. Not tested against the live API yet.
 */
export async function generatePrediction(matchData) {
  if (!status().claudeConfigured) {
    throw new NotConnectedError("Anthropic Claude API", "Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in backend/.env.");
  }
  const client = new Anthropic({ apiKey: config.anthropic.key });
  const msg = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Match data (JSON):\n${JSON.stringify(matchData)}\n\nReturn JSON with this shape:\n${JSON.stringify(PREDICTION_SCHEMA_HINT)}`,
      },
    ],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("Model did not return valid JSON");
  }
  return validatePrediction(parsed);
}
