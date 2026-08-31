## Exploration: JSearch Keyword Refinement

### Current State

The pipeline fetches jobs from JSearch via RapidAPI using 6 broad keywords defined in `src/config.js:16-23`:

```javascript
KEYWORDS: [
  'full stack developer junior',
  'full-stack developer junior',
  'javascript developer junior',
  'node developer junior',
  'react developer junior',
  'AI developer junior'
]
```

Each keyword triggers a separate GET request to `https://jsearch.p.rapidapi.com/search-v2` with these parameters (from `src/services.js:97`):

```
query={keyword}&page=1&num_pages=1&date_posted=week&country=co&work_from_home=true
```

**The matching-quality gap**: JSearch uses keyword-based (not semantic) matching. "javascript developer junior" matches "Java Developer" because the tokenizer treats "java" and "javascript" as overlapping tokens. "AI developer junior" matches "Senior AI Researcher" because "junior" appears in unrelated contexts. The current approach relies entirely on Gemini scoring (Step 4) to filter these false positives, but:

1. **Wastes Gemini quota**: 6 keywords × ~10-20 results each = 60-120 jobs per run. Batched at 15 jobs/call → 4-8 Gemini calls per run. At 15 RPM free tier, this limits pipeline frequency.
2. **Still leaks irrelevant jobs**: Gemini scoring isn't perfect; some false positives score ≥75 and reach Telegram.
3. **No server-side filtering**: Available JSearch filters (`job_requirements`, `employment_types`) are unused.

### Affected Areas

- `src/config.js` — KEYWORDS array, potential new filter constants
- `src/services.js:92-117` — `fetchFromJSearch()` builds the JSearch URL
- `src/services.js:119-279` — `scoreSingleJob()` / `scoreJobsBatch()` (Gemini calls)
- `src/pipeline.js:72-87` — `fetchJobsFromJSearch()` loops keywords
- `src/pipeline.js:118-142` — `scoreWithGemini()` batching logic
- `openspec/specs/job-fetching/spec.md` — fetch contract
- `openspec/specs/ai-scoring/spec.md` — scoring contract

### Approaches

#### 1. Refine Keyword Sets (More Specific + Exclusion Terms)
Replace broad keywords with precise, quoted phrases and negative terms:
- `"full stack developer" junior` (quoted phrase)
- `"react developer" AND (junior OR entry)`  
- `"javascript developer" -java -senior -lead -principal`
- `"node.js developer" -senior -architect`

| Pros | Cons | Effort |
|------|------|--------|
| Zero code changes beyond config; uses JSearch's native boolean operators | JSearch boolean support varies; exclusion terms may not work reliably on free tier; maintenance burden as keywords grow | Low |

#### 2. Pre-Filter Before Gemini (Deterministic Cheap Filters)
Add a new pipeline step between dedup (Step 3) and scoring (Step 4) that drops obviously-irrelevant jobs using only job metadata (title, description snippets):
- Title regex: exclude `senior|lead|principal|architect|manager|director|staff|head|chief`
- Seniority gate: require `junior|entry|0-2|0-3|graduate|intern` in title/description
- Tech stack inclusion: require at least one of `react|javascript|node|express|firebase|mysql|full.stack|fullstack`
- Tech stack exclusion: reject if `java|python|go|rust|c\+\+|php|ruby` dominates (no JS/TS mention)
- Location gate: require `remote|colombia|latam|bogota|mexico|argentina|chile|peru|ecuador`

| Pros | Cons | Effort |
|------|------|--------|
| Drops 50-80% irrelevant jobs before Gemini → massive quota savings; deterministic, fast, free; keeps Gemini for nuanced matching | False negative risk if regex too aggressive; maintenance of exclusion/inclusion lists; adds pipeline complexity | Medium |

#### 3. Use JSearch Native Filters (Server-Side)
Add `job_requirements=under_3_years_experience,no_experience` and `employment_types=FULLTIME` to the JSearch request (`src/services.js:97`):

```
&job_requirements=under_3_years_experience,no_experience&employment_types=FULLTIME
```

| Pros | Cons | Effort |
|------|------|--------|
| Filters at source — fewer results fetched, less data transfer; free tier supports these params per JSearch docs; zero false negatives from our regex | JSearch's "under_3_years_experience" classification may not align perfectly with "junior"; can't filter tech stack; country=co + work_from_home already used | Low |

#### 4. Combined: JSearch Filters + Light Pre-Filter + Refined Keywords (Recommended)
Layer all three: tighter JSearch query params + 2-3 refined keywords + minimal pre-filter (seniority + tech-stack only).

| Pros | Cons | Effort |
|------|------|--------|
| Defense in depth: server filters → keyword precision → cheap pre-filter → Gemini only for genuine candidates; maximal quota savings; minimal false negatives | Slightly more config surface; need to tune keyword list once | Medium |

### Recommendation

**Approach 4 (Combined)** with this scope:

1. **Immediate (config only)**: Add `job_requirements=under_3_years_experience,no_experience` and `employment_types=FULLTIME` to `fetchFromJSearch` URL.
2. **Immediate (config only)**: Reduce KEYWORDS to 3 high-signal phrases:
   - `"full stack developer" junior`
   - `"react developer" (junior OR entry)`
   - `"node.js developer" junior`
3. **New pipeline step**: `preFilterJobs(jobs)` between dedup and scoring — title regex for seniority exclusion + tech-stack inclusion (JS/TS/React/Node/Firebase/MySQL). Target: drop 60-70% before Gemini.
4. **Keep Gemini batch scoring** for semantic nuance (full-stack vs backend-only, remote verification, Colombia relevance).

**Estimated impact**:
- JSearch results per run: 60-120 → 20-40 (server filters + better keywords)
- Gemini calls per run: 4-8 → 2-3 (pre-filter drops ~60%)
- Free-tier headroom: 15 RPM → pipeline can run more frequently or handle more keywords

### Risks

1. **False negatives**: Over-aggressive pre-filter drops valid junior full-stack roles with atypical titles (e.g., "Software Engineer I", "Developer - Entry Level"). Mitigation: keep pre-filter conservative (only exclude clear senior titles, require ≥1 tech keyword).
2. **Keyword maintenance**: As user's profile evolves, keyword list needs updates. Mitigation: document keyword strategy in config.js comments; consider future per-user profile mapping.
3. **JSearch free-tier limits**: `num_pages=1` already minimal; `job_requirements` filter may reduce result diversity. Mitigation: monitor result counts; if too few, relax to `under_3_years_experience` only.
4. **Cross-language false positives**: "Java" in "JavaScript" persists. Mitigation: pre-filter exclusion regex for `\bjava\b(?!script)` in title/description.
5. **Gemini scoring drift**: If pre-filter changes input distribution, Gemini prompts may need recalibration. Mitigation: log score distributions pre/post change.

### Ready for Proposal

**Yes**. The exploration identifies a clear, bounded scope: modify `fetchFromJSearch` params, refine `CONFIG.KEYWORDS`, add a `preFilterJobs` step in `pipeline.js` between dedup and scoring. No architectural changes, no new dependencies, respects $0 philosophy. Orchestrator should proceed to `sdd-propose` with this scope.