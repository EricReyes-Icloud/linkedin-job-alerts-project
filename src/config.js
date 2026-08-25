/**
 * LinkedIn Job Alerts — Configuration
 *
 * All secrets (API keys, tokens, IDs) live in Apps Script Properties Service.
 * This file only holds non-sensitive constants.
 *
 * To set secrets in Apps Script:
 *   File → Project Properties → Script Properties → Add new property
 *
 * To set secrets locally for testing:
 *   Create a .env file (excluded from git) and load it in your test harness.
 */

var CONFIG = {
  // --- Search ---
  KEYWORDS: [
    'full stack developer junior',
    'full-stack developer junior',
    'javascript developer junior',
    'node developer junior',
    'react developer junior',
    'AI developer junior'
  ],
  LOCATION: 'Colombia',
  REMOTE_ONLY: true,

  // --- Scoring ---
  SCORE_THRESHOLD: 75,
  GEMINI_MODEL: 'gemini-3.7-flash',  // free-tier flash model — update as needed

  // --- Notion ---
  // NOTION_DB_ID  → set in Script Properties
  NOTION_API_VERSION: '2022-06-28',

  // --- Telegram ---
  // TELEGRAM_BOT_TOKEN  → set in Script Properties
  // TELEGRAM_CHAT_ID    → set in Script Properties

  // --- API keys ---
  // RAPIDAPI_KEY   → set in Script Properties
  // GEMINI_API_KEY → set in Script Properties

  // --- Pipeline ---
  GEMINI_MAX_RETRIES: 3,
  GEMINI_RETRY_DELAY_MS: 2000,
  DESCRIPTION_MAX_CHARS: 1999,  // Notion rich_text limit ≈ 2000

  // --- Endpoints ---
  JSEARCH_ENDPOINT: 'https://jsearch.p.rapidapi.com/search-v2',
  JSEARCH_HOST: 'jsearch.p.rapidapi.com',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',
  NOTION_ENDPOINT: 'https://api.notion.com/v1/',
  TELEGRAM_ENDPOINT: 'https://api.telegram.org/bot',

  // --- Profile (for Gemini scoring) ---
  OWNER_PROFILE: 'Junior Full Stack Developer. ' +
    'Experience: React, JavaScript, Node.js, Express, Product Architecture, Firebase, MySQL, OpenCode, Spec-Driven Development, Professional AI Integration. ' +
    'Required: Remote work only (Work from home). ' +
    'Timezone: America/Bogota (Colombia, LATAM). ' +
    'Location: Colombia / LATAM. ' +
    'Must be a full stack role — not backend-only or frontend-only.',

  // --- Error messages ---
  ERROR_MESSAGES: {
    MISSING_CONFIG: 'Required configuration missing',
    NOTION_QUERY_FAILED: 'Notion database query failed',
    GEMINI_PARSE_FAILED: 'Gemini response could not be parsed',
    TELEGRAM_MISSING_CREDENTIALS: 'Telegram credentials not configured'
  }
};
