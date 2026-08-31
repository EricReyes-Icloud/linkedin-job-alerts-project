# Proposal: JSearch Keyword Refinement

## Intent

The pipeline fetches 60-120 jobs per run via broad keyword matching, but JSearch's tokenizer produces many false positives (e.g., "Java Developer" matches "javascript developer junior"). This wastes Gemini free-tier quota (15 RPM), limits pipeline frequency, and still leaks irrelevant jobs past scoring. We need server-side filtering, tighter keywords, and a cheap deterministic pre-filter to improve result relevance before Gemini spends tokens on it.

## Scope

### In Scope
- Add JSearch native filter params (`job_requirements`, `employment_types`) to `fetchFromJSearch` URL
- Reduce KEYWORDS to 3 high-signal phrases for junior JS profile
- Add `preFilterJobs()` step between dedup and scoring: seniority exclusion + tech-stack inclusion
- Update affected specs: `job-fetching`, `pipeline-core`

### Out of Scope
- Moving keywords to Properties Service or external config
- Modifying Gemini scoring logic or prompts
- Aggressive filtering (only exclude clear senior/lead/manager titles)
- Numeric Gemini call-reduction target as primary success measure
- New dependencies or services
- Pipeline error handling changes

## Business Rules

1. **Profile**: Junior/Jr in JavaScript (frontend JS/TS + frameworks)
2. **Pre-filter stance**: CONSERVATIVE — only drop clearly-irrelevant roles; avoid false negatives
3. **Keyword storage**: stays in `src/config.js`, documented with rationale comments
4. **Success metric**: result RELEVANCE (quality of profile match), not call-count reduction
5. **$0 philosophy**: no paid services, free tiers only

## Capabilities

### New Capabilities

- `pre-filter`: Deterministic pipeline step that filters jobs by seniority signals and tech-stack keywords before Gemini scoring

### Modified Capabilities

- `job-fetching`: Add `job_requirements=under_3_years_experience,no_experience` and `employment_types=FULLTIME` to JSearch request params
- `pipeline-core`: Insert pre-filter step between Step 3 (dedup) and Step 4 (scoring); update step signatures and logging

## Approach

Layered defense — each layer filters independently:
1. **Server-side** (JSearch params): experience level + employment type at source
2. **Keyword precision**: 3 targeted phrases replace 6 broad ones
3. **Deterministic pre-filter**: `preFilterJobs()` — title regex seniority exclusion + tech-stack inclusion (≥1 match from JS/TS/React/Node/Express/Firebase)
4. **Gemini**: remains final semantic arbiter for nuanced matching

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/config.js` | Modified | KEYWORDS array (6→3 phrases), new filter constants |
| `src/services.js:97` | Modified | `fetchFromJSearch` adds filter params to URL |
| `src/pipeline.js:87-118` | Modified | New `preFilterJobs()` call between dedup and scoring |
| `openspec/specs/job-fetching/spec.md` | Modified | New requirement for filter params |
| `openspec/specs/pipeline-core/spec.md` | Modified | New pre-filter step in pipeline flow |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| False negatives from pre-filter (valid junior roles with atypical titles) | Medium | Conservative regex: only exclude explicit senior/lead/manager; require ≥1 tech keyword |
| JSearch `job_requirements` filter over-excludes | Low | Monitor result counts; relax to `under_3_years_experience` only if too few |
| Cross-language false positives ("Java" in "JavaScript") | Medium | Pre-filter exclusion regex for `\bjava\b(?!script)` |
| Keyword list needs future updates | Low | Document rationale in config.js comments; design for easy modification |

## Rollback Plan

1. **Pre-filter**: Comment out `preFilterJobs()` call in `pipeline.js` — pipeline reverts to dedup→scoring flow
2. **Keywords**: Revert `CONFIG.KEYWORDS` to original 6-phrase array
3. **JSearch params**: Remove `job_requirements` and `employment_types` from URL in `services.js`
4. All changes are config/code-only; no data migrations, no API key changes, no schema changes

## Dependencies

- JSearch `/search-v2` must accept `job_requirements` and `employment_types` params on free tier (verified in exploration)

## Success Criteria

- [ ] Jobs reaching Gemini scoring have demonstrably higher junior-JS relevance (manual spot-check)
- [ ] JSearch results per run drop from 60-120 to 20-40
- [ ] Pre-filter drops ≥50% of irrelevant jobs before Gemini scoring
- [ ] No valid junior roles lost (false negative check on first 3 runs)
- [ ] Pipeline completes within free-tier quota constraints
