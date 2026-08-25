# Job Fetching Specification

## Purpose

Fetch structured job data from JSearch via RapidAPI for each configured keyword, flatten multi-page results, and return a unified array of raw job objects.

## Requirements

### Requirement: Fetch Jobs From JSearch

The system MUST perform an HTTP GET to the RapidAPI JSearch endpoint for each keyword in `CONFIG.KEYWORDS`.

**Input contract**:
- `keywords`: array of strings from `CONFIG.KEYWORDS`
- `location`: string from `CONFIG_LOCATION`
- Each request includes headers: `X-RapidAPI-Key`, `X-RapidAPI-Host: jsearch.p.rapidapi.com`
- Query params: `query` = `"{keyword} {location}"`, `page` = `1`, `date_posted` = `"week"`

**Output contract**:
- Array of job objects, each containing at minimum: `{ title, company_name, job_description, job_apply_link, job_posting_datetime, publisher }`
- Empty array `[]` if no results across all keywords

#### Scenario: Happy path — multiple keywords return results

- GIVEN CONFIG.KEYWORDS contains 3 keywords
- WHEN `fetchJobsFromJSearch()` is called
- THEN the system issues 3 GET requests to JSearch
- AND each response's `data` array is flattened into a single results array
- AND the total count is logged: `"Step 2 — fetched N raw jobs"`

#### Scenario: Single keyword returns empty results

- GIVEN one keyword returns `data: []` from JSearch
- WHEN results are flattened
- THEN empty results for that keyword are silently skipped
- AND other keywords' results are still included

#### Scenario: JSearch returns HTTP error (4xx/5xx)

- GIVEN a JSearch request fails with HTTP 4xx or 5xx
- WHEN the error is caught
- THEN the error is logged with keyword and status code
- AND the pipeline continues with results from other keywords
- AND the failed keyword contributes 0 results

#### Scenario: JSearch response missing expected fields

- GIVEN a JSearch result object lacks `job_description` or `job_apply_link`
- WHEN the result is processed
- THEN the result is included with missing fields as `null`
- AND a warning is logged

### Requirement: Use fetchWithRetry for HTTP calls

The system MUST use `Services.fetchWithRetry()` (not raw `Services.fetch()`) for all JSearch requests.

#### Scenario: Transient network failure retries successfully

- GIVEN a JSearch request fails on first attempt with a network error
- WHEN `fetchWithRetry` is invoked with maxRetries=2
- THEN the request is retried up to 2 additional times
- AND total attempts are logged

#### Scenario: All retries exhausted

- GIVEN a JSearch request fails on all retry attempts
- WHEN retries are exhausted
- THEN the error is logged and the function returns results from other keywords
- AND the pipeline does not crash

## Acceptance Criteria

- [ ] 3 GET requests issued per run, one per keyword
- [ ] Results flattened into single array
- [ ] Empty/error responses for one keyword do not block others
- [ ] All HTTP calls go through `fetchWithRetry`
- [ ] Step boundary logged with raw job count
