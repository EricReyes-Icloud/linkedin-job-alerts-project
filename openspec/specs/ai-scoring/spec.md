# AI Scoring Specification

## Purpose

Score each new job offer against the owner's profile using Gemini, producing a numeric score (0–100) for downstream filtering.

## Requirements

### Requirement: Score Job With Gemini

The system MUST send one Gemini API request per job, containing the job title, company, and full description, and receive a JSON response `{"score": N}` where N is 0–100.

**Request contract**:
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{CONFIG.GEMINI_MODEL}:generateContent?key={API_KEY}`
- Method: POST
- Body: `contents` with a single user turn containing the job text + owner profile, plus `generationConfig.responseMimeType: "application/json"` and a `responseSchema` forcing `{"score": integer}`

**Response contract**:
- Parsed JSON: `{ "score": <number 0–100> }`
- Score attached to job object as `job.score`

#### Scenario: Happy path — valid score returned

- GIVEN a job with title "Backend Developer", company "Acme", and a description
- WHEN `scoreWithGemini()` is called
- THEN a POST is made to Gemini API
- AND the response JSON contains `"score"` key
- AND `job.score` is set to the numeric value
- AND the score and job title are logged

#### Scenario: Gemini returns HTTP 503 (overloaded)

- GIVEN Gemini returns HTTP 503 on first attempt
- WHEN the error is caught
- THEN the system waits `CONFIG.GEMINI_RETRY_DELAY_MS` × attempt_number (exponential backoff)
- AND retries up to `CONFIG.GEMINI_MAX_RETRIES` times
- AND if all retries fail, `job.score` is set to `0`
- AND a warning is logged

#### Scenario: Gemini returns malformed JSON

- GIVEN Gemini returns text that is not valid JSON (e.g., wrapped in markdown fences, extra text)
- WHEN `parseJSONWithFenceStrip()` is called
- THEN markdown fences are stripped (` ```json\n...\n``` ` → raw JSON)
- AND `JSON.parse` is attempted on the cleaned text
- AND if parsing still fails, `job.score` is set to `0`
- AND the raw response is logged for debugging

#### Scenario: Gemini returns score outside 0–100 range

- GIVEN Gemini returns `{"score": 150}` or `{"score": -5}`
- WHEN the response is validated
- THEN the score is clamped to the nearest valid bound (0 or 100)
- AND a warning is logged

### Requirement: Preserve Job Data Across Scoring

The system MUST preserve all original job fields (title, company, description, URL, etc.) when attaching the score. No fields from the original job object are lost during the Gemini call.

#### Scenario: Job object retains all fields after scoring

- GIVEN a job object with fields `{ title, company_name, job_description, job_apply_link, job_posting_datetime, publisher, keyword }`
- WHEN `scoreWithGemini()` processes it
- THEN the returned object contains all original fields PLUS `score`
- AND no original field is overwritten or lost

## Acceptance Criteria

- [ ] One Gemini API call per job
- [ ] Forced JSON response schema prevents free-text responses
- [ ] Markdown fence stripping handles Gemini's occasional wrapping
- [ ] Retry with backoff on 503, max `CONFIG.GEMINI_MAX_RETRIES` attempts
- [ ] Malformed/missing score defaults to 0 (non-fatal)
- [ ] All original job fields preserved after scoring
- [ ] Step boundary logged with scored job count
