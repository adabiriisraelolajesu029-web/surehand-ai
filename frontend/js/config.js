// Public, non-secret frontend configuration.
// NEVER put API keys here — the browser only talks to the SureHand backend.
window.SUREHAND_CONFIG = {
  // Same-origin by default (backend serves this folder). If you host the frontend
  // elsewhere, set this to e.g. "https://api.yourdomain.com/api" and add the origin to CORS_ORIGINS.
  apiBase: "/api",
};
