const CONFIG = {
  // Imbuo Parent API
  DEFAULT_BACKEND_URL: 'http://localhost:8001',
  ENDPOINT_PATH: '/api/v1/restrictions',

  // Netflix DOM selectors
  SELECTORS: {
    SEARCH_INPUT: 'input[name="pin-search"]',
    SEARCH_RESULTS_CONTAINER: 'div.search-results',
    SEARCH_RESULT_ITEM: 'a.search-result',
    PROTECTED_VIDEOS_CONTAINER: 'div.protected-videos',
    PROTECTED_VIDEO_ITEM: 'div.protected-video',
    REMOVE_BUTTON: 'button[data-titleid][aria-label="Remove"]',
    SAVE_BUTTON: 'button[data-uia="btn-account-pin-submit"]',
    CANCEL_BUTTON: 'button[data-uia="btn-account-pin-cancel"]',
    CLEAR_INPUT_BUTTON: 'span.icon-close',
  },

  // Timing
  AUTOCOMPLETE_POLL_INTERVAL_MS: 200,
  AUTOCOMPLETE_TIMEOUT_MS: 5000,
  DELAY_BETWEEN_TITLES_MIN_MS: 500,
  DELAY_BETWEEN_TITLES_MAX_MS: 1000,

  // Matching
  MATCH_THRESHOLD: 0.85,

  // Brand (sent as X-Brand header so backend checks correct entitlement)
  BRAND: 'mnsa-safe',

  // Auth endpoints (backend API)
  AUTH_ME_PATH: '/api/v1/me',
  BILLING_CHECKOUT_URL_PATH: '/api/v1/billing/checkout-url',

  // Frontend app (opened in browser tab for login/register)
  DEFAULT_FRONTEND_URL: 'http://localhost:5173?brand=mnsa-safe',
  LOGIN_WEB_PATH: '/login',
  REGISTER_WEB_PATH: '/register',
};
