# Proposal: LinkedIn Job Alerts Phase 2 — Implement Pipeline

## Intent

Phase 1 scaffold exists (config, services, pipeline skeleton, main). The pipeline has 6 steps but only Step 1 (parity gate) is implemented. Steps 2–6 are stubs returning empty arrays. Phase 2 implements the full end-to-end pipeline: fetch jobs, dedup, score, filter, store, notify.

## Scope

### In Scope
- Implement `fetchJobsFromJSearch()` — loop 3 keywords, GET RapidAPI, flatten results
- Implement `dedupAgainstNotion()` — normalize URLs, fetch existing links from Notion, drop duplicates (within batch AND against history)
- Implement `scoreWithGemini()` — POST per offer, forced `{"score": N}` schema, fence-stripping, retry ≤3 with backoff
- Implement `sendNotifications()` — Notion page creation + Telegram message per match
- Add service utilities to `services.js`: `fetchWithRetry`, `parseJSONWithFenceStrip`, `normalizeUrl`, Notion/Gemini/Telegram client wrappers
- Truncate descriptions to ~1999 chars before Notion write
- Structured logging at every step boundary

### Out of Scope
- Apps Script deployment (Phase 4)
- Manual E2E test against live APIs (Phase 3)
- Hardening, runbook, quota tracking (Phase 5)
- README update (deferred to Phase 3 when architecture is proven)

## Capabilities

### New Capabilities
- `job-fetching`: JSearch/RapidAPI integration — fetch, parse, flatten structured job data
- `deduplication`: URL normalization + Notion history comparison
- `ai-scoring`: Gemini score-only integration with retry and fence-stripping
- `notion-storage`: Notion database page creation with property mapping
- `telegram-notifications`: Telegram Bot API message delivery

### Modified Capabilities
- `pipeline-core`: Step functions (Steps 2–6) change from stubs to full implementations

## Approach

Modify `services.js` first — add retry logic, JSON parser, URL normalizer, and thin API clients (Notion, Gemini, Telegram) all behind the existing IIFE pattern. Then implement each pipeline step in `pipeline.js` as standalone functions called from `runPipeline()`.

Key decisions:
- **IIFE pattern stays** — Apps Script needs `var` globals; no ES modules
- **Error strategy**: try/catch around every external call; log failures; continue pipeline (partial results > total failure)
- **Retry**: configurable via CONFIG constants; exponential backoff for Gemini 503s
- **Gemini prompt**: inject owner profile from config or Script Properties; forced response schema

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/services.js` | Modified | Add fetchWithRetry, parseJSONWithFenceStrip, normalizeUrl, API clients |
| `src/pipeline.js` | Modified | Implement Steps 2–6, replace stubs |
| `src/config.js` | Modified | Add profile text constant (or placeholder) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Gemini returns unparseable JSON despite forced schema | Medium | Fence-stripping + try/catch + retry; log raw response on failure |
| Notion 2000-char limit exceeded on descriptions | Low | Truncate to 1999 chars in config; defensive slice before write |
| JSearch triplicated results not fully deduped | Medium | Dedup within batch AND against Notion history; normalize URLs |
| Gemini free-tier rate limits hit mid-run | Low | Score one-by-one; skip on persistent failure; self-heals next run |

## Rollback Plan

Git revert to Phase 1 commit. Pipeline stubs return empty arrays — zero API calls, no side effects. No data loss risk.

## Dependencies

- Phase 0 credentials (RapidAPI key, Gemini key, Notion integration, Telegram bot)
- Notion database "Trabajos" with correct property schema
- Owner profile text for Gemini scoring prompt

## Success Criteria

- [ ] Full pipeline executes end-to-end against real APIs from manual invocation
- [ ] Deliberately malformed Gemini response does not crash the run
- [ ] Logs show every step boundary with result counts
- [ ] At least one Notion page created with correct properties
- [ ] Telegram notification received with correct format
