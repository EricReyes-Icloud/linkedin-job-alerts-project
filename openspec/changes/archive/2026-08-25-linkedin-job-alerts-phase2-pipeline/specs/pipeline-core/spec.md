# Pipeline Core Specification

## Purpose

Orchestrate the six-step pipeline from fetch to notify, replacing stubs with full implementations while preserving the existing control flow and early-exit logic.

## Requirements

### Requirement: Pipeline Step Signatures

Each step function MUST accept its input as an argument, return its output, and MUST NOT rely on module-level mutable state.

| Step | Function | Input | Output |
|------|----------|-------|--------|
| 2 | `fetchJobsFromJSearch()` | none (reads CONFIG) | `Array<Object>` raw jobs |
| 3 | `dedupAgainstNotion(jobs)` | Array of raw jobs | Array of new jobs |
| 4 | `scoreWithGemini(jobs)` | Array of new jobs | Array of scored jobs |
| 5 | `filterByScore(jobs)` | Array of scored jobs | Array of matches |
| 6 | `sendNotifications(matches)` | Array of matches | void (side effects only) |

#### Scenario: Step functions are pure where possible

- GIVEN `filterByScore` receives `[{score: 90}, {score: 80}]`
- WHEN called
- THEN it returns `[{score: 90}]`
- AND neither input array is mutated

### Requirement: Pipeline Continues on Non-Fatal Errors

The pipeline MUST continue to the next step even if the current step produces partial or zero results due to errors.

#### Scenario: Step 2 fetch fails for all keywords

- GIVEN all 3 JSearch requests fail
- WHEN `fetchJobsFromJSearch()` returns `[]`
- THEN `runPipeline()` logs the count and returns early
- AND no further steps execute (no API calls wasted)

#### Scenario: Step 4 scoring fails for some jobs

- GIVEN 10 jobs enter Step 4, but Gemini fails for 3 of them
- WHEN `scoreWithGemini()` returns 7 jobs (3 with score=0)
- THEN `filterByScore()` processes all 7
- AND jobs with score=0 are filtered out naturally by the threshold

### Requirement: Structured Step Logging

The pipeline MUST log a summary at each step boundary with the count of items flowing to the next step.

#### Scenario: Full pipeline logging

- GIVEN a run fetches 25 jobs, dedup reduces to 18, scoring produces 18, 5 match threshold
- WHEN the pipeline executes
- THEN logs include:
  - `"Step 2 — fetched 25 raw jobs"`
  - `"Step 3 — 18 new jobs after dedup"`
  - `"Step 4 — scored 18 jobs"`
  - `"Step 5 — 5 matches above threshold"`
  - `"=== Pipeline complete — 5 notifications sent ==="`

### Requirement: Early Exit on Empty Intermediate Results

The pipeline MUST exit early (return) when any step produces zero results, to avoid wasting API calls on subsequent steps.

#### Scenario: Zero new jobs after dedup

- GIVEN 10 raw jobs are fetched, but all are already in Notion
- WHEN `dedupAgainstNotion()` returns `[]`
- THEN Steps 4–6 are not executed
- AND `"All jobs already in Notion — pipeline finished"` is logged

## Acceptance Criteria

- [ ] All step functions accept input and return output (no hidden state)
- [ ] Non-fatal errors produce partial results, not crashes
- [ ] Step boundary logged with item counts
- [ ] Early exit on zero intermediate results
- [ ] `filterByScore` is already implemented and unchanged
- [ ] `isExecutionDay()` is already implemented and unchanged
