# Delta for Job Fetching

## ADDED Requirements

### Requirement: JSearch Filter Parameters

The system SHALL append `job_requirements=under_3_years_experience,no_experience` and `employment_types=FULLTIME` to every JSearch `/search-v2` request URL.

The system SHALL apply these parameters server-side so that JSearch returns only entry-level and full-time results before any client-side filtering.

#### Scenario: Filter params included in request

- GIVEN CONFIG.KEYWORDS contains 3 keywords
- WHEN `fetchJobsFromJSearch()` constructs the request URL
- THEN each URL includes `job_requirements=under_3_years_experience,no_experience`
- AND each URL includes `employment_types=FULLTIME`

#### Scenario: Filter params reduce result count

- GIVEN a keyword that previously returned 40 results without filters
- WHEN the same keyword is queried with filter params
- THEN the result count is reduced (e.g., 15-25 results)

#### Scenario: JSearch ignores unsupported params gracefully

- GIVEN a JSearch request includes `job_requirements` and `employment_types`
- WHEN the API ignores or rejects these params (returns 200 with unfiltered data)
- THEN the pipeline continues with whatever results are returned
- AND a warning is logged that filter params may not be effective

#### Scenario: JSearch returns error on filter params

- GIVEN a JSearch request fails with HTTP 4xx when filter params are included
- WHEN the error is caught
- THEN the error is logged with keyword and status code
- AND the pipeline continues with results from other keywords
