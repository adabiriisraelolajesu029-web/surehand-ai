import "dotenv/config";

const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  corsOrigins: (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  football: {
    provider: env.FOOTBALL_API_PROVIDER || "",
    key: env.FOOTBALL_API_KEY || "",
    baseUrl: env.FOOTBALL_API_BASE_URL || "",
    // API-Football league ids to cover. Default = Europe's top 5 (EPL 39, La Liga 140, Serie A 135, Bundesliga 78, Ligue 1 61).
    // Set FOOTBALL_LEAGUE_IDS to a different comma-separated list, or "all" for every league the API returns.
    leagues: (env.FOOTBALL_LEAGUE_IDS || "39,140,135,78,61").trim().toLowerCase() === "all"
      ? []
      : (env.FOOTBALL_LEAGUE_IDS || "39,140,135,78,61").split(",").map((s) => s.trim()).filter(Boolean),
  },
  anthropic: {
    key: env.ANTHROPIC_API_KEY || "",
    model: env.ANTHROPIC_MODEL || "",
  },
  adminToken: env.ADMIN_TOKEN || "",
};

export const status = () => ({
  footballApiConfigured: Boolean(config.football.provider && config.football.key && config.football.baseUrl),
  claudeConfigured: Boolean(config.anthropic.key && config.anthropic.model),
});
