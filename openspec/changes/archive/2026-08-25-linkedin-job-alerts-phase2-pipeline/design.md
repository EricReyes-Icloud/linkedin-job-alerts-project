# Design: LinkedIn Job Alerts Phase 2 — Implement Pipeline

## Technical Approach

Implement the 6-step pipeline end-to-end by extending the Phase 1 IIFE scaffold. `services.js` gains 8 new functions (retry, parse, normalize, API clients). `pipeline.js` replaces 4 stubs with full implementations. `config.js` adds profile text and endpoint constants. The IIFE pattern stays — Apps Script needs `var` globals, no ES modules.

## Architecture Decisions

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Module pattern | IIFE vs ES modules vs classes | IIFE (existing) | Apps Script constraint; no `import/export`; vars must be global |
| Error strategy | Fail-fast vs degrade-gracefully | Degrade (non-fatal) | Legacy lesson: partial results > total failure; every external call in try/catch |
| Retry approach | Fixed delay vs exponential backoff | Exponential (linear multiplier) | Spec mandates `delay = base × attempt`; handles Gemini 503 overload |
| Gemini parsing | Accept as-is vs fence-strip | Fence-strip first | Gemini wraps JSON in ``` even with forced schema — defensive strip before parse |
| Dedup scope | Batch-only vs batch + Notion history | Both (double safety) | JSearch triplicates across boards; Notion prevents re-alerting old offers |
| Description truncation | In pipeline step vs in Notion client | In Notion client | Single responsibility — client enforces its own limits |

## Data Flow

```
runPipeline()
  │
  ▼
Step 1: isExecutionDay() ──odd──▶ EXIT
  │ even
  ▼
Step 2: fetchJobsFromJSearch()
  │  Input: none (reads CONFIG.KEYWORDS, CONFIG.LOCATION)
  │  Output: Array<RawJob { title, company_name, job_description,
  │           job_apply_link, job_posting_datetime, publisher, keyword }>
  ▼
Step 3: dedupAgainstNotion(rawJobs)
  │  Input: Array<RawJob>
  │  Calls: normalizeUrl() per job, notionQueryDatabase() once
  │  Output: Array<RawJob> (subset — new only)
  ▼
Step 4: scoreWithGemini(newJobs)
  │  Input: Array<RawJob>
  │  Calls: parseJSONWithFenceStrip(), scoreWithGemini() per job
  │  Output: Array<ScoredJob { ...RawJob, score: number }>
  ▼
Step 5: filterByScore(scoredJobs)  [already implemented]
  │  Input: Array<ScoredJob>
  │  Output: Array<ScoredJob> where score >= 85
  ▼
Step 6: sendNotifications(matches)
  │  Input: Array<ScoredJob>
  │  Calls: notionCreatePage() + telegramSendMessage() per match
  │  Output: void (side effects)
```

## services.js Extensions

| Function | Signature | Behavior |
|----------|-----------|----------|
| `fetchWithRetry` | `(url, options, maxRetries?, backoffMs?)` | Wraps `Services.fetch()` in retry loop. Classifies errors: HTTP 503/429/timeout → retry; 4xx → throw immediately; network error → retry. Exponential backoff: `delay = backoffMs × attempt`. Default `maxRetries=2`, `backoffMs=1000`. Returns response. Throws after exhaustion. |
| `parseJSONWithFenceStrip` | `(text)` | Strips leading/trailing markdown fences (` ```json\n...\n``` `) and leading/trailing whitespace. Calls `JSON.parse()`. Returns parsed object. Throws on invalid JSON after strip. |
| `normalizeUrl` | `(url)` | Returns `null` + logs warning if url is null/empty. Strips query string (`url.split('?')[0]`), then trailing slash. Returns normalized string. |
| `fetchFromJSearch` | `(keywords, location)` | Iterates keywords, builds GET to `https://jsearch.p.rapidapi.com/search`. Headers: `X-RapidAPI-Key`, `X-RapidAPI-Host`. Params: `query=keyword location`, `page=1`, `date_posted=week`. Uses `fetchWithRetry()`. Returns flattened array. Each job tagged with originating keyword. Catches per-keyword errors (non-fatal). |
| `scoreWithGemini` | `(job)` | POST to Gemini `generateContent` endpoint. Body: `contents` with user turn containing job title + company + description + owner profile. `generationConfig`: `responseMimeType: "application/json"`, `responseSchema: { type: "object", properties: { score: { type: "integer" } }, required: ["score"] }`. Parses response with `parseJSONWithFenceStrip()`. Clamps score to 0–100. Retries up to 3× with backoff on 503. Returns job with `.score` attached. |
| `notionQueryDatabase` | `(databaseId, filter?)` | POST to `https://api.notion.com/v1/databases/{id}/query`. Headers: `Authorization: Bearer {token}`, `Notion-Version: {version}`. Pagination: loop with `has_more` + `next_cursor`. Extracts `Link.url` from each page. Returns array of normalized URL strings. |
| `notionCreatePage` | `(databaseId, properties)` | POST to `https://api.notion.com/v1/pages`. Headers: same as query. Body: `{ parent: { database_id }, properties }`. Truncates `rich_text` fields > 2000 chars. Omits `date` properties when value is null. Returns page object. |
| `telegramSendMessage` | `(chatId, text)` | POST to `https://api.telegram.org/bot{token}/sendMessage`. Body: `{ chat_id, text, parse_mode: "Markdown" }`. Returns early (no API call) if token/chatId missing. Logs warning. |

## pipeline.js Implementation

### fetchJobsFromJSearch()

```js
function fetchJobsFromJSearch() {
  var allJobs = [];
  for (var i = 0; i < CONFIG.KEYWORDS.length; i++) {
    var keyword = CONFIG.KEYWORDS[i];
    try {
      var results = Services.fetchFromJSearch(keyword, CONFIG.LOCATION);
      // Tag each result with originating keyword
      results.forEach(function(job) { job.keyword = keyword; });
      allJobs = allJobs.concat(results);
    } catch (e) {
      Services.log('[STEP 2] ERROR: JSearch fetch — keyword="' + keyword + '": ' + e.message);
      // Continue with other keywords (non-fatal)
    }
  }
  return allJobs;
}
```

### dedupAgainstNotion(jobs)

```js
function dedupAgainstNotion(jobs) {
  // 1. Batch dedup: normalize URLs, keep first occurrence
  var seen = {};
  var batchDeduped = [];
  jobs.forEach(function(job) {
    var normalized = Services.normalizeUrl(job.job_apply_link);
    if (normalized && !seen[normalized]) {
      seen[normalized] = true;
      batchDeduped.push(job);
    }
  });

  // 2. Notion history dedup (non-fatal on API failure)
  var existingUrls = [];
  try {
    existingUrls = Services.notionQueryDatabase(CONFIG.NOTION_DB_ID);
  } catch (e) {
    Services.log('[STEP 3] ERROR: Notion query failed — proceeding with batch-only dedup: ' + e.message);
  }

  var existingSet = {};
  existingUrls.forEach(function(url) { existingSet[url] = true; });

  return batchDeduped.filter(function(job) {
    var normalized = Services.normalizeUrl(job.job_apply_link);
    return !existingSet[normalized];
  });
}
```

### scoreWithGemini(jobs)

```js
function scoreWithGemini(jobs) {
  var scored = [];
  jobs.forEach(function(job) {
    try {
      var result = Services.scoreSingleJob(job);
      job.score = result.score;
    } catch (e) {
      Services.log('[STEP 4] ERROR: Gemini scoring — job="' + job.title + '": ' + e.message);
      job.score = 0; // Non-fatal default
    }
    scored.push(job);
  });
  return scored;
}
```

### sendNotifications(matches)

```js
function sendNotifications(matches) {
  var sent = 0;
  matches.forEach(function(job) {
    try {
      Services.notionCreatePage(CONFIG.NOTION_DB_ID, job);
      Services.telegramSendMessage(
        Services.getProperty('TELEGRAM_CHAT_ID'),
        formatTelegramMessage(job)
      );
      sent++;
    } catch (e) {
      Services.log('[STEP 6] ERROR: Notification — job="' + job.title + '": ' + e.message);
    }
  });
  return sent;
}
```

## config.js Additions

```js
// --- Endpoints ---
JSEARCH_ENDPOINT: 'https://jsearch.p.rapidapi.com/search',
JSEARCH_HOST: 'jsearch.p.rapidapi.com',
GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',
NOTION_ENDPOINT: 'https://api.notion.com/v1/',
TELEGRAM_ENDPOINT: 'https://api.telegram.org/bot',

// --- Profile (for Gemini scoring) ---
OWNER_PROFILE: 'Senior backend developer with 8+ years experience. ' +
  'Expertise: Python, Node.js, Go, PostgreSQL, Redis, Docker, K8s. ' +
  'Preferred: remote, full-time, senior/staff level, product companies. ' +
  'Location: Argentina (open to LATAM timezone).',

// --- Error messages ---
ERROR_MESSAGES: {
  MISSING_CONFIG: 'Required configuration missing',
  NOTION_QUERY_FAILED: 'Notion database query failed',
  GEMINI_PARSE_FAILED: 'Gemini response could not be parsed',
  TELEGRAM_MISSING_CREDENTIALS: 'Telegram credentials not configured'
}
```

## Data Structures

### Job object shape (flowing through pipeline)

```js
{
  title: "Backend Developer",
  company_name: "Acme Corp",
  job_description: "We are looking for...",   // may be null
  job_apply_link: "https://linkedin.com/jobs/view/123?ref=abc",
  job_posting_datetime: "2026-08-20",          // may be null
  publisher: "LinkedIn",
  keyword: "backend developer",                // added in Step 2
  score: 92                                    // added in Step 4
}
```

### Notion property mapping

```js
{
  "Nombre":          { title: [{ text: { content: job.title } }] },
  "Empresa":         { rich_text: [{ text: { content: job.company_name || '' } }] },
  "Link":            { url: job.job_apply_link },
  "Score":           { number: job.score },
  "Fuente":          { select: { name: job.publisher || 'Unknown' } },
  "Descripción":     { rich_text: [{ text: { content: truncatedDesc } }] },
  "Fecha publicación": { date: { start: job.job_posting_datetime } },  // omitted if null
  "Estado":          { select: { name: 'Nueva' } },
  "Keyword":         { rich_text: [{ text: { content: job.keyword } }] }
}
```

### Telegram message template

```
🎯 Nueva oferta con match ({score}/100)

{title} en {company_name}

{job_apply_link}
```

## Error Classification

| Category | Examples | Behavior |
|----------|----------|----------|
| **Fatal** | CONFIG undefined, Script Properties unavailable | Log + return immediately from `runPipeline()` |
| **Non-fatal** | Single JSearch keyword fails, single Gemini 503, single Notion page fails, single Telegram send fails | Log with `[STEP N] ERROR` format; continue pipeline with degraded results |
| **Degradation** | All Gemini calls fail (all jobs get score=0) | `filterByScore()` naturally filters everything out; pipeline exits gracefully |
| **Degradation** | Notion dedup query fails | Falls back to batch-only dedup; may re-alert some old jobs |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Phase 2 replaces stubs in existing files. Phase 1 had zero side effects (stubs return `[]`). Rollback is `git revert` to Phase 1 commit.

## Testing Considerations

| Strategy | Approach |
|----------|----------|
| Mock Apps Script globals | Define `var UrlFetchApp = { fetch: function() {} }` etc. before loading `services.js` in Node |
| Mock Services object | Override `Services.fetch`, `Services.getProperty` in test setup; core logic stays isolated |
| Test without live APIs | Inject mock responses for JSearch/Gemini/Notion/Telegram; verify pipeline flow |
| Error injection | Return HTTP 503 responses, malformed JSON, empty arrays; verify graceful degradation |
| Dedup edge cases | Triplicated URLs with query params, null links, empty Notion DB |
| Score boundary | Scores at 84, 85, 86; out-of-range scores (−5, 150); null descriptions |
| Truncation | Descriptions at 1999, 2000, 3500 chars |

## Open Questions

- [ ] Gemini model version: `gemini-2.0-flash` assumed per config; verify free-tier availability at implementation time
- [ ] Owner profile text: hardcoded in config vs. Script Properties (proposal says TBD; config constant is simpler for now)
- [ ] Notion "Fuente" select options: what valid values exist in the database? Need to verify DB schema before mapping `publisher` to select names

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/services.js` | Modify | Add 8 functions: fetchWithRetry, parseJSONWithFenceStrip, normalizeUrl, fetchFromJSearch, scoreSingleJob, notionQueryDatabase, notionCreatePage, telegramSendMessage |
| `src/pipeline.js` | Modify | Replace stubs for fetchJobsFromJSearch, dedupAgainstNotion, scoreWithGemini, sendNotifications |
| `src/config.js` | Modify | Add endpoints, OWNER_PROFILE, ERROR_MESSAGES constants |
