# Tasks: LinkedIn Job Alerts Phase 2 — Implement Pipeline

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350 (config ~25, services ~210, pipeline ~115) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with 4–5 focused commits |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Config + service utilities | PR 1 commit 1 | Manual: `Services.normalizeUrl('https://a.com/b?c=1/')` → `"https://a.com/b"` | N/A (no API calls) | src/config.js + src/services.js utility functions |
| 2 | API clients (JSearch, Gemini, Notion, Telegram) | PR 1 commit 2 | Manual: mock `Services.fetch` to return canned responses | N/A (mocked) | src/services.js client functions only |
| 3 | Pipeline steps + wiring | PR 1 commit 3 | Manual: `runPipeline()` against real APIs (Phase 3) | N/A (requires live keys) | src/pipeline.js step functions |

---

## Phase 1: Config Additions

- [x] 1.1 Add endpoint constants to `src/config.js`: JSEARCH_ENDPOINT, JSEARCH_HOST, GEMINI_ENDPOINT, NOTION_ENDPOINT, TELEGRAM_ENDPOINT (~6 lines)
- [x] 1.2 Add OWNER_PROFILE text constant and ERROR_MESSAGES map to `src/config.js` (~12 lines)

## Phase 2: Service Utilities (no API calls)

- [x] 2.1 Add `fetchWithRetry(url, options, maxRetries, backoffMs)` to `src/services.js` IIFE — retry loop classifying HTTP 503/429/timeout as retryable, 4xx as fatal, exponential backoff via `delay = backoffMs × attempt` (~30 lines)
- [x] 2.2 Add `parseJSONWithFenceStrip(text)` to `src/services.js` — strip leading/trailing ` ```json\n...\n``` ` fences, trim whitespace, call `JSON.parse()`, throw on invalid (~12 lines)
- [x] 2.3 Add `normalizeUrl(url)` to `src/services.js` — return null + log if null/empty, strip query string via `split('?')[0]`, strip trailing slash (~10 lines)

## Phase 3: API Clients

- [x] 3.1 Add `fetchFromJSearch(keyword, location)` to `src/services.js` — build GET to JSEARCH_ENDPOINT with RapidAPI headers, call fetchWithRetry, return `response.data` array. Wrap in try/catch, log `[STEP 2] ERROR` on failure, return `[]` (~25 lines)
- [x] 3.2 Add `scoreSingleJob(job)` to `src/services.js` — POST to Gemini generateContent with forced JSON schema, parse response with parseJSONWithFenceStrip, clamp score to 0–100, retry up to GEMINI_MAX_RETRIES with exponential backoff on 503 (~45 lines)
- [x] 3.3 Add `notionQueryDatabase(databaseId)` to `src/services.js` — POST to Notion query endpoint, paginate via has_more/next_cursor, extract normalized Link.url from each page, return URL array (~35 lines)
- [x] 3.4 Add `notionCreatePage(databaseId, job)` to `src/services.js` — POST to Notion pages endpoint, build 9-property map (Nombre, Empresa, Link, Score, Fuente, Descripción truncated to DESCRIPTION_MAX_CHARS, Fecha publicación omitted if null, Estado="Nuevo", Keyword), return page object (~40 lines)
- [x] 3.5 Add `telegramSendMessage(chatId, text)` to `src/services.js` — early return if token/chatId missing (log warning), POST to Telegram sendMessage with parse_mode Markdown, return response (~15 lines)
- [x] 3.6 Export all new functions in the Services IIFE return object (~8 lines)

## Phase 4: Pipeline Step Implementations

- [x] 4.1 Replace `fetchJobsFromJSearch()` stub in `src/pipeline.js` — loop CONFIG.KEYWORDS, call Services.fetchFromJSearch per keyword, tag each job with keyword, concat results, catch per-keyword errors (non-fatal), log step boundary (~18 lines)
- [x] 4.2 Replace `dedupAgainstNotion(jobs)` stub in `src/pipeline.js` — batch dedup via normalizeUrl + seen set, then Notion history dedup via Services.notionQueryDatabase (try/catch, fallback to batch-only on failure), return filtered array (~28 lines)
- [x] 4.3 Replace `scoreWithGemini(jobs)` stub in `src/pipeline.js` — loop jobs, call Services.scoreSingleJob, set score=0 on error (non-fatal), return scored array (~15 lines)
- [x] 4.4 Replace `sendNotifications(matches)` stub in `src/pipeline.js` — loop matches, call Services.notionCreatePage then Services.telegramSendMessage, catch per-job errors (non-fatal), log sent count (~22 lines)

---

## Total Estimated Changed Lines

| File | Lines Added/Modified | Notes |
|------|---------------------|-------|
| `src/config.js` | ~25 | Endpoints, OWNER_PROFILE, ERROR_MESSAGES |
| `src/services.js` | ~210 | 8 new functions + exports |
| `src/pipeline.js` | ~115 | 4 stubs replaced with full implementations |
| **Total** | **~350** | |

## Risk Assessment

| Task | Risk | Mitigation |
|------|------|------------|
| 2.1 fetchWithRetry | Medium — error classification is subtle (503 vs 4xx vs network) | Test with mocked fetch responses per HTTP class |
| 3.2 scoreSingleJob | Medium — forced JSON schema + fence stripping + retry | Hardcoded test case: malformed Gemini response must not crash |
| 3.4 notionCreatePage | Low — property mapping is mechanical | Verify all 9 properties match spec; truncation at boundary |
| 4.2 dedupAgainstNotion | Low — logic is straightforward | Verify batch dedup + Notion fallback path |
