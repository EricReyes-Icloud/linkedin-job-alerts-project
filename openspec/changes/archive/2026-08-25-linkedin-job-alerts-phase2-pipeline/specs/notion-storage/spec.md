# Notion Storage Specification

## Purpose

Create a Notion database page for each job that passes the score threshold, mapping job fields to the "Trabajos" database schema.

## Requirements

### Requirement: Create Notion Page for Match

The system MUST create a new page in `CONFIG.NOTION_DB_ID` for each job with `score >= CONFIG.SCORE_THRESHOLD`.

**Properties mapping**:

| Notion Property | Type | Source |
|----------------|------|--------|
| Nombre | title | `job.title` |
| Empresa | rich_text | `job.company_name` |
| Link | url | `job.job_apply_link` |
| Score | number | `job.score` |
| Fuente | select | `job.publisher` |
| Descripción | rich_text | `job.job_description` truncated to `CONFIG.DESCRIPTION_MAX_CHARS` |
| Fecha publicación | date | `job.job_posting_datetime` |
| Estado | select | `"Nuevo"` (hardcoded) |
| Keyword | rich_text | `job.keyword` |

#### Scenario: Happy page creation

- GIVEN a job with score 90, title "Backend Dev", company "Acme", link "https://...", keyword "backend developer"
- WHEN `notionCreatePage()` is called
- THEN a POST is made to Notion API with all 9 properties
- AND the response contains a page `id`
- AND a Telegram notification is queued for this job

#### Scenario: Description exceeds 1999 characters

- GIVEN a job description is 3500 characters long
- WHEN the properties are constructed
- THEN `job_description` is truncated to `CONFIG.DESCRIPTION_MAX_CHARS` (1999) characters
- AND the truncation is applied before the API call

#### Scenario: Job posting datetime is null

- GIVEN a job where `job_posting_datetime` is null or empty
- WHEN properties are constructed
- THEN `Fecha publicación` is omitted from the request (not sent as null)

#### Scenario: Notion API returns error

- GIVEN the Notion API returns HTTP 4xx or 5xx
- WHEN the error is caught
- THEN the error is logged with the job title
- AND the pipeline continues (non-fatal)
- AND the Telegram notification for this job is skipped

### Requirement: Dedup Before Write (Double Safety)

Even though Step 3 deduplicates, the system MUST re-check if the normalized URL already exists in Notion before creating a page, as a safety net.

#### Scenario: Duplicate detected at write time

- GIVEN a job with normalized URL `"https://linkedin.com/jobs/view/789"`
- AND a page with that Link already exists in Notion
- WHEN `sendNotifications()` processes this job
- THEN the page creation is skipped
- AND a log entry records the skip

## Acceptance Criteria

- [ ] Page created with all 9 properties correctly mapped
- [ ] Description truncated to 1999 chars before write
- [ ] Missing optional fields (e.g., date) are omitted, not sent as null
- [ ] Notion API errors are non-fatal
- [ ] Re-dedup check prevents duplicate pages
- [ ] Each page creation is logged with job title
