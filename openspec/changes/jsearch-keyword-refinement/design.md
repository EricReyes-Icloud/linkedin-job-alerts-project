# Design: JSearch Keyword Refinement

## Technical Approach

Three-layer defense strategy: (1) JSearch native params filter server-side, (2) tighter keywords reduce noise at source, (3) `preFilterJobs()` deterministic pre-filter removes obvious non-matches before Gemini. Each layer operates independently — if one fails, the others compensate. The pre-filter slots in as Step 3.5 between dedup and scoring, matching the existing pipeline's synchronous IIFE flow.

## Architecture Decisions

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Pre-filter placement | After scoring vs. between dedup and scoring | Between dedup and scoring (Step 3.5) | Saves Gemini free-tier quota (15 RPM); deterministic filter before expensive LLM call |
| Tech-stack inclusion | Require all keywords vs. require ≥1 | Require ≥1 | Conservative stance — a React job mentioning Node is still relevant; requiring all would be too aggressive |
| Java/JS disambiguation | Separate regex step vs. combined exclusion regex | Combined `\bjava\b(?!script)` in seniority regex | Single regex pass; negative lookahead handles false positive without separate logic |
| Keyword count | 3 phrases vs. 5+ broad phrases | 3 high-signal phrases | Broad phrases waste JSearch quota on false positives; 3 targeted phrases reduce volume |
| Pre-filter config location | Separate config file vs. CONFIG constants | CONFIG constants in config.js | Matches existing pattern; no new files; easy to modify |
| JSearch params handling | Hardcode vs. dynamic builder | Append to existing URL string | Matches existing `fetchFromJSearch` pattern (string concat at services.js:97); no URL builder exists |

## Data Flow

```
runPipeline()
  │
  ▼
Step 1: isExecutionDay() ──odd──▶ EXIT
  │ even
  ▼
Step 2: fetchJobsFromJSearch()
  │  Reads: CONFIG.KEYWORDS (3 phrases), CONFIG.LOCATION
  │  Calls: Services.fetchFromJSearch(keyword, location) per keyword
  │  URL now includes: job_requirements, employment_types
  │  Output: Array<RawJob>
  ▼
Step 3: dedupAgainstNotion(rawJobs)
  │  Output: Array<RawJob> (new only)
  ▼
Step 3.5: preFilterJobs(newJobs)          ← NEW
  │  Input: Array<RawJob>
  │  Logic: title regex exclusion + tech-stack inclusion (≥1 match)
  │  Checks: job.job_title + (job.job_description || '')
  │  Output: Array<RawJob> (filtered subset)
  │  If empty array → pipeline exits early
  ▼
Step 4: scoreWithGemini(filteredJobs)
  │  Input: Array<RawJob> (now smaller)
  │  Output: Array<ScoredJob>
  ▼
Step 5: filterByScore(scoredJobs)
Step 6: sendNotifications(matches)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/config.js` | Modify | Replace KEYWORDS array (6→3 phrases); add `SENIORITY_EXCLUDE` regex pattern string; add `TECH_STACK_KEYWORDS` array |
| `src/services.js` | Modify | `fetchFromJSearch`: append `job_requirements` and `employment_types` to URL at line 97 |
| `src/services.js` | Modify | Add `preFilterJobs(jobs)` function in public API |
| `src/pipeline.js` | Modify | Insert Step 3.5 call between dedup (line 37) and scoring (line 45); add early exit if filtered array empty |

## Interfaces / Contracts

### `fetchFromJSearch(keyword, location)` — Modified

Current URL at services.js:97:
```js
var url = endpoint + '?query=' + encodeURIComponent(keyword) + '&page=1&num_pages=1&date_posted=week&country=co&work_from_home=true';
```

New URL (append two params):
```js
var url = endpoint + '?query=' + encodeURIComponent(keyword) + '&page=1&num_pages=1&date_posted=week&country=co&work_from_home=true&job_requirements=under_3_years_experience,no_experience&employment_types=FULLTIME';
```

No signature change. No call-site change. Existing `fetchWithRetry` + error handling unchanged.

### `preFilterJobs(jobs)` — New

```js
function preFilterJobs(jobs) {
  var excluded = [];
  var retained = [];
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var title = (job.job_title || '').toLowerCase();
    var desc = (job.job_description || '').toLowerCase();
    var text = title + ' ' + desc;
    // 1. Seniority exclusion
    if (CONFIG.SENIORITY_EXCLUDE.test(title)) {
      excluded.push({ job: job, reason: 'seniority' });
      continue;
    }
    // 2. Tech-stack inclusion (require ≥1 match)
    var hasTech = CONFIG.TECH_STACK_KEYWORDS.some(function(kw) {
      return text.indexOf(kw.toLowerCase()) !== -1;
    });
    if (!hasTech) {
      excluded.push({ job: job, reason: 'no_tech_match' });
      continue;
    }
    retained.push(job);
  }
  if (excluded.length > 0) {
    Services.log('Step 3.5 — excluded ' + excluded.length + ' jobs: ' +
      excluded.map(function(e) { return '"' + e.job.job_title + '" (' + e.reason + ')'; }).join(', '));
  }
  return retained;
}
```

**Signature**: `preFilterJobs(jobs: Array<Object>) → Array<Object>`
**Mutation**: None — returns new array, input untouched.
**Failure mode**: If `CONFIG.SENIORITY_EXCLUDE` or `CONFIG.TECH_STACK_KEYWORDS` missing, `preFilterJobs` returns input array unchanged (defensive — no jobs lost to misconfiguration).

### `CONFIG` additions (config.js)

```js
// --- Pre-filter (Step 3.5) ---
// Conservative: only exclude explicit seniority titles + Java (not JavaScript)
SENIORITY_EXCLUDE: /\b(senior|lead|manager|staff|principal|director|vp|head\s+of)\b|\bjava\b(?!script)/i,

// Require ≥1 tech-stack keyword in title+description for relevance
TECH_STACK_KEYWORDS: ['javascript', 'typescript', 'react', 'node', 'express', 'firebase'],
```

### KEYWORDS (config.js) — Modified

```js
KEYWORDS: [
  'javascript developer junior',
  'react developer junior',
  'node developer junior'
],
```

Rationale: Drop 'full stack developer junior' / 'full-stack developer junior' (broad, low-signal), drop 'AI developer junior' (not profile-relevant). Three phrases target the core junior-JS identity.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| JSearch returns 4xx on filter params | Caught by existing `fetchWithRetry` + `fetchFromJSearch` try/catch (services.js:113). Logs error, returns `[]` for that keyword. Other keywords proceed. |
| JSearch ignores params (returns unfiltered data) | No error — pipeline continues with larger result set. Pre-filter (Step 3.5) catches what server-side missed. Log warning not added — requires result-count comparison which adds complexity without clear value. |
| `CONFIG.SENIORITY_EXCLUDE` undefined | `preFilterJobs` checks `typeof CONFIG.SENIORITY_EXCLUDE` before `.test()` — falls through to tech-stack check only. |
| `CONFIG.TECH_STACK_KEYWORDS` undefined | `.some()` on undefined throws — defensive guard: if array missing, skip inclusion check (retain all jobs). |
| All jobs excluded by pre-filter | `preFilterJobs` returns `[]`. Pipeline logs `'Step 3.5 — 0 jobs after pre-filter'` and exits (new early-exit check). No Gemini API call. |
| Regex engine performance | Single regex per title, `.some()` on 6 keywords per job — negligible for <100 jobs. No rate-limit concern. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. All changes are code/config modifications to existing files. No data schema changes. Rollback: revert three files (config.js, services.js, pipeline.js) to prior commit.

**Verification approach**: Deploy, run pipeline once, manually inspect: (1) fewer raw jobs from JSearch, (2) pre-filter log shows exclusions, (3) jobs reaching Gemini scoring have higher relevance on spot-check.

## Open Questions

- [ ] Verify `job_requirements` param accepts comma-separated values on JSearch free tier (spec assumes `under_3_years_experience,no_experience`)
- [ ] Confirm `employment_types=FULLTIME` is the correct JSearch enum value (may need `FULL_TIME`)
