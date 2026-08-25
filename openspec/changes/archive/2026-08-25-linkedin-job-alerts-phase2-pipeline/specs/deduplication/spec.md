# Deduplication Specification

## Purpose

Normalize job URLs and remove duplicates both within a single fetch batch and against the historical Notion database, ensuring only genuinely new jobs proceed to scoring.

## Requirements

### Requirement: Normalize URLs for Comparison

The system MUST normalize job URLs before comparison by stripping query strings and trailing slashes.

**Input**: raw URL string (e.g., `"https://linkedin.com/jobs/view/123?ref=foo&utm_bar=1"`)
**Output**: normalized URL (e.g., `"https://linkedin.com/jobs/view/123"`)

#### Scenario: URL with query parameters

- GIVEN a URL `"https://linkedin.com/jobs/view/123?ref=foo&trk=abc"`
- WHEN `normalizeUrl()` is called
- THEN the result is `"https://linkedin.com/jobs/view/123"`

#### Scenario: URL with trailing slash

- GIVEN a URL `"https://linkedin.com/jobs/view/123/"`
- WHEN `normalizeUrl()` is called
- THEN the result is `"https://linkedin.com/jobs/view/123"`

#### Scenario: Null or empty URL

- GIVEN a job with `job_apply_link` of `null` or `""`
- WHEN `normalizeUrl()` is called
- THEN the result is `null`
- AND a warning is logged

### Requirement: Deduplicate Within Batch

The system MUST remove duplicate jobs within the current fetch batch based on normalized URL.

#### Scenario: Two jobs share same URL from different keywords

- GIVEN keyword "backend developer" and "backend engineer" return the same job posting
- WHEN batch dedup runs
- THEN only one copy survives
- AND the surviving copy retains the keyword from whichever keyword fetched it first

#### Scenario: Three jobs from JSearch triplication

- GIVEN JSearch returns the same posting 3 times (LinkedIn, Indeed, Glassdoor) with slightly different URLs
- WHEN URLs are normalized
- THEN batch dedup reduces to 1 job
- AND the count is logged

### Requirement: Deduplicate Against Notion History

The system MUST query the Notion database for all existing `Link` property values and drop any job whose normalized URL already exists.

**Notion query**: Fetch all pages from `CONFIG.NOTION_DB_ID`, extract the `Link.url` field from each.

#### Scenario: Job already exists in Notion

- GIVEN a job with normalized URL `"https://linkedin.com/jobs/view/456"`
- AND Notion database already contains a page with Link = `"https://linkedin.com/jobs/view/456"`
- WHEN dedup runs
- THEN the job is excluded from the new-jobs list

#### Scenario: Notion query returns empty (fresh database)

- GIVEN the Notion database has no pages
- WHEN dedup runs
- THEN all batch-deduped jobs pass through

#### Scenario: Notion API call fails

- GIVEN the Notion database query fails with an API error
- WHEN the error is caught
- THEN the error is logged
- AND dedup proceeds with batch-only dedup (not against history)
- AND pipeline continues (non-fatal)

## Acceptance Criteria

- [ ] `normalizeUrl()` strips query strings and trailing slashes
- [ ] Batch dedup reduces triplicated JSearch results to 1
- [ ] Notion history query fetches all existing Link URLs
- [ ] Jobs already in Notion are excluded
- [ ] Notion API failure is non-fatal; pipeline continues
- [ ] Step boundary logged with post-dedup count
