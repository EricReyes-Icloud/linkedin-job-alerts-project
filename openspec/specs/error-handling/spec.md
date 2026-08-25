# Error Handling Specification

## Purpose

Define a consistent error handling strategy across all external API calls, ensuring the pipeline degrades gracefully rather than crashing on transient failures.

## Requirements

### Requirement: Try/Catch Around Every External Call

Every call to an external API (JSearch, Gemini, Notion, Telegram) MUST be wrapped in a `try/catch` block.

#### Scenario: API call succeeds

- GIVEN a JSearch request completes with HTTP 200
- WHEN the response is returned
- THEN it is processed normally

#### Scenario: API call throws

- GIVEN a `Services.fetchWithRetry()` call throws an exception
- WHEN the exception is caught
- THEN the error message and context (keyword, job title) are logged
- AND the step returns a degraded result (empty array, score=0, or skipped notification)
- AND `runPipeline()` continues to the next step

### Requirement: Non-Fatal Error Classification

The pipeline MUST treat all external API errors as non-fatal. A failure in any single step or sub-call MUST NOT prevent subsequent steps from executing with whatever data is available.

**Non-fatal errors** (pipeline continues):
- JSearch HTTP error for one keyword
- Gemini score failure for one job
- Notion page creation failure for one job
- Telegram message failure for one job
- Notion dedup query failure (falls back to batch-only dedup)

**Fatal errors** (pipeline exits):
- `CONFIG` is undefined or missing required keys (configuration error)
- Script Properties Service is unavailable (platform error)

#### Scenario: Partial failure across steps

- GIVEN Step 2 fetches 20 jobs (3 keywords × ~7 each), one keyword fails
- WHEN the pipeline continues
- THEN 13 jobs enter Step 3
- AND the pipeline completes normally with degraded results

### Requirement: Structured Logging Format

All error logs MUST include enough context to diagnose the failure without reading source code.

**Format**: `[STEP N] ERROR: {step_name} — {context}: {error_message}`

Examples:
- `[STEP 2] ERROR: JSearch fetch — keyword="backend developer": HTTP 403 Forbidden`
- `[STEP 4] ERROR: Gemini scoring — job="Senior Backend Dev" at Acme: JSON parse failed`
- `[STEP 6] ERROR: Telegram send — job="Backend Engineer": chat_id not configured`

#### Scenario: Error log is actionable

- GIVEN a Gemini scoring failure is logged
- WHEN the developer reads the Apps Script execution log
- THEN the log entry includes the step number, failing operation, job context, and error message
- AND no additional source code inspection is needed to identify the failure point

### Requirement: Retry Strategy for Transient Failures

The system MUST use exponential backoff for retryable errors (HTTP 503, network timeout).

**Backoff formula**: `delay = baseDelay × attemptNumber`
- `baseDelay`: `CONFIG.GEMINI_RETRY_DELAY_MS` (2000ms default)
- `maxRetries`: `CONFIG.GEMINI_MAX_RETRIES` (3 default)

#### Scenario: Exponential backoff on 503

- GIVEN Gemini returns HTTP 503 on attempt 1
- WHEN retry logic runs
- THEN attempt 2 waits 2000ms
- AND attempt 3 waits 4000ms
- AND attempt 4 waits 6000ms (if maxRetries allows)
- AND if all attempts fail, the job gets score=0

## Acceptance Criteria

- [ ] Every external API call has a try/catch wrapper
- [ ] Non-fatal errors produce degraded results, not crashes
- [ ] Fatal errors (config/platform) exit the pipeline immediately
- [ ] Error logs include step, operation, context, and message
- [ ] Exponential backoff applied to retryable failures
- [ ] No error in Step N prevents Step N+1 from executing with available data
