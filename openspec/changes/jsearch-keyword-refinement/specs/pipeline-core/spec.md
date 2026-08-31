# Delta for Pipeline Core

## MODIFIED Requirements

### Requirement: Pipeline Step Signatures

Each step function MUST accept its input as an argument, return its output, and MUST NOT rely on module-level mutable state.

| Step | Function | Input | Output |
|------|----------|-------|--------|
| 2 | `fetchJobsFromJSearch()` | none (reads CONFIG) | `Array<Object>` raw jobs |
| 3 | `dedupAgainstNotion(jobs)` | Array of raw jobs | Array of new jobs |
| 3.5 | `preFilterJobs(jobs)` | Array of new jobs | Array of filtered jobs |
| 4 | `scoreWithGemini(jobs)` | Array of filtered jobs | Array of scored jobs |
| 5 | `filterByScore(jobs)` | Array of scored jobs | Array of matches |
| 6 | `sendNotifications(matches)` | Array of matches | void (side effects only) |

(Previously: 6-step pipeline without pre-filter; step 4 input was "Array of new jobs")

#### Scenario: Step functions are pure where possible

- GIVEN `filterByScore` receives `[{score: 90}, {score: 80}]`
- WHEN called
- THEN it returns `[{score: 90}]`
- AND neither input array is mutated

### Requirement: Pre-Filter Integration

The pipeline SHALL execute `preFilterJobs()` as Step 3.5, between dedup (Step 3) and Gemini scoring (Step 4). The pre-filter SHALL use deterministic title regex and tech-stack keyword matching (see `pre-filter` spec).

The pipeline SHALL pass the pre-filter output directly to `scoreWithGemini()` as input.

#### Scenario: Pre-filter removes irrelevant jobs before scoring

- GIVEN 18 jobs after dedup, 10 are irrelevant (senior titles or missing tech keywords)
- WHEN the pipeline executes Step 3.5
- THEN 8 jobs flow to Step 4 (Gemini scoring)
- AND Gemini processes 8 jobs instead of 18

#### Scenario: Pre-filter passes all jobs when all are relevant

- GIVEN 18 jobs after dedup, all match inclusion criteria
- WHEN the pipeline executes Step 3.5
- THEN all 18 jobs flow to Step 4
- AND no jobs are dropped

#### Scenario: Pre-filter output is zero

- GIVEN 18 jobs after dedup, all are excluded by pre-filter
- WHEN `preFilterJobs()` returns `[]`
- THEN the pipeline exits early (Step 4 is not executed)
- AND `"All jobs filtered out — pipeline finished"` is logged

### Requirement: Structured Step Logging

The pipeline MUST log a summary at each step boundary with the count of items flowing to the next step.

(Previously: Logging covered Steps 2-6 only; now includes Step 3.5)

#### Scenario: Full pipeline logging

- GIVEN a run fetches 25 jobs, dedup reduces to 18, pre-filter reduces to 8, scoring produces 8, 5 match threshold
- WHEN the pipeline executes
- THEN logs include:
  - `"Step 2 — fetched 25 raw jobs"`
  - `"Step 3 — 18 new jobs after dedup"`
  - `"Step 3.5 — 8 jobs after pre-filter"`
  - `"Step 4 — scored 8 jobs"`
  - `"Step 5 — 5 matches above threshold"`
  - `"=== Pipeline complete — 5 notifications sent ==="`
