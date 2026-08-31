- [x] 1.1 Replace `CONFIG.KEYWORDS` (lines 11–16) with 3 phrases: `['javascript developer junior', 'react developer junior', 'node developer junior']`.
- [x] 1.2 Add `CONFIG.SENIORITY_EXCLUDE = /\b(senior|lead|manager|staff|principal|director|vp|head\s+of)\b|\bjava\b(?!script)/i`.
- [x] 1.3 Add `CONFIG.TECH_STACK_KEYWORDS = ['javascript', 'typescript', 'react', 'node', 'express', 'firebase']`.
- [x] 1.4 Add comment block `// --- Pre-filter (Step 3.5) ---` explaining conservative stance.

## Phase 2: Core Implementation

- [x] 2.1 In `src/services.js` `fetchFromJSearch` (line 97), append `&job_requirements=under_3_years_experience,no_experience&employment_types=FULLTIME` to URL. No signature change.
- [x] 2.2 In `src/services.js`, add `preFilterJobs(jobs)` per design: seniority-title regex exclusion, tech-stack `≥1` inclusion across `title+description`, push to `retained`/`excluded`, log excluded reasons.
- [x] 2.3 Guard `preFilterJobs`: if `CONFIG.SENIORITY_EXCLUDE` is not a RegExp, skip title exclusion (fall through to tech check); if `CONFIG.TECH_STACK_KEYWORDS` is not an array, retain all jobs (return input unchanged). No mutation of input.
- [x] 2.4 Export `preFilterJobs` in `src/services.js` public API `return {}` block (after `fetchFromJSearch`, ~line 393).

## Phase 3: Pipeline Integration (src/pipeline.js)

- [x] 3.1 Insert Step 3.5 call after Step 3 log (line 37) / early-exit check (lines 39–42): `var filteredJobs = Services.preFilterJobs(newJobs); Services.log('Step 3.5 — ' + filteredJobs.length + ' jobs after pre-filter');`.
- [x] 3.2 Add early exit: if `filteredJobs.length === 0`, log `'All jobs filtered out — pipeline finished'` and `return` (no Gemini call).
- [x] 3.3 Change Step 4 input from `newJobs` to `filteredJobs` (line 45).

## Phase 4: Manual Verification (Projects Script constraint — no unit runner)

- [ ] 4.1 Verify JSearch params: run `node test-runner.js`, confirm request URLs include verified `job_requirements=under_3_years_experience,no_experience` and `employment_types=FULLTIME` and result count dropped vs. prior run (spec ``job-fetching`` Scenarios 2–4).
- [ ] 4.2 Confirm the two accepted param values are honored by live JSearch (spec open questions: comma-separated requirements; `FULLTIME` enum). If params returned 4xx, confirm existing try/catch logs and pipeline continues (Scenario "JSearch returns error").
- [ ] 4.3 Confirm `Step 3.5 — N jobs after pre-filter` logged with exclusion reasons; count reduction matches spec ``pre-filter`` scenarios (8 of 18; seniority + Java-only + no-tech dismissals).
- [ ] 4.4 Confirm Gemini receives only filtered jobs (`Step 4 — scored N` where N = post-filter count, spec ``pipeline-core`` scenarios 1–3).

## Phase 5: Docs / Cleanup

- [ ] 5.1 Update any README / pipeline-step docs to list Step 3.5 `preFilterJobs` and the two new JSearch params (tests/docs travel with code).
- [ ] 5.2 Confirm no leftover references to removed/disused keywords and no debug code introduced.
