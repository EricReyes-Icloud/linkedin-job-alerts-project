# Pre-Filter Specification

## Purpose

Deterministic pipeline step that removes jobs before Gemini scoring using title-based seniority exclusion and tech-stack keyword inclusion. Conservative stance: only drop clearly-irrelevant roles to avoid false negatives on atypical junior titles.

## Requirements

### Requirement: Seniority Exclusion

The system SHALL exclude jobs whose title matches explicit seniority signals (Senior, Lead, Manager, Staff, Principal, Director, VP, Head of) using word-boundary regex matching.

The system SHALL NOT exclude jobs with ambiguous titles (e.g., "Software Engineer" without seniority modifier).

The system SHALL exclude jobs matching Java (but not JavaScript) using the pattern `\bjava\b(?!script)` to prevent cross-language false positives.

#### Scenario: Senior title excluded

- GIVEN a job with title "Senior JavaScript Developer"
- WHEN `preFilterJobs()` processes the job
- THEN the job is removed from the array
- AND the exclusion reason is logged

#### Scenario: Junior title passes

- GIVEN a job with title "Junior Frontend Developer"
- WHEN `preFilterJobs()` processes the job
- THEN the job is retained in the array

#### Scenario: Java (not JavaScript) excluded

- GIVEN a job with title "Java Backend Developer"
- WHEN `preFilterJobs()` processes the job
- THEN the job is removed from the array

### Requirement: Tech-Stack Inclusion

The system SHALL retain a job only if its title or description contains at least one keyword from the configured tech-stack list: JavaScript, TypeScript, React, Node, Express, Firebase.

#### Scenario: Job with tech keyword retained

- GIVEN a job with description mentioning "React and TypeScript"
- WHEN `preFilterJobs()` evaluates tech-stack inclusion
- THEN the job is retained

#### Scenario: Job without tech keyword removed

- GIVEN a job with title "General Software Engineer" and description mentioning only Python and Django
- WHEN `preFilterJobs()` evaluates tech-stack inclusion
- THEN the job is removed from the array

#### Scenario: Mixed content — title lacks keyword but description has it

- GIVEN a job with title "Frontend Developer" and description mentioning "JavaScript ES6"
- WHEN `preFilterJobs()` evaluates tech-stack inclusion
- THEN the job is retained (description match counts)

### Requirement: Pre-Filter Step Contract

The system SHALL execute `preFilterJobs()` as Step 3.5 in the pipeline, after dedup (Step 3) and before Gemini scoring (Step 4).

The system SHALL log the count of jobs entering and exiting the pre-filter step.

#### Scenario: Pre-filter reduces job count

- GIVEN 18 jobs enter the pre-filter step
- WHEN `preFilterJobs()` runs
- THEN 8 jobs are retained (10 excluded by seniority or missing tech keywords)
- AND `"Step 3.5 — 8 jobs after pre-filter"` is logged

#### Scenario: Pre-filter passes all jobs through

- GIVEN 18 jobs all match inclusion criteria
- WHEN `preFilterJobs()` runs
- THEN all 18 jobs are retained
- AND `"Step 3.5 — 18 jobs after pre-filter"` is logged
