# Exploration: README Rewrite for LinkedIn Job Alerts v2

## Current State

The `README.md` documents the **legacy n8n system** which has been fully retired. The actual deployed system is v2: a Google Apps Script pipeline running on free tiers, rebuilt in Phase 2 of the ROADMAP (completed 2026-08-25). The README carries a stale "repo en rebuild" banner, an n8n-centric architecture diagram, n8n-specific setup steps, and "lessons learned" about n8n internals that no longer apply. The sole accurate statement in the top description is the general "busca ofertas → scorea con Gemini → guarda en Notion → notifica por Telegram" flow.

## Real System (v2) — Facts Extracted from Source

### Runtime & Stack
- **Google Apps Script** (plain JS, IIFE pattern), free Gmail account, schedule-triggered.
- **JSearch via RapidAPI** (`/search-v2`, host `jsearch.p.rapidapi.com`) — aggregates LinkedIn/Indeed/Glassdoor/ZipRecruiter. No HTML scraping, no unofficial endpoints.
- **Google Gemini** for scoring only (`GEMINI_MODEL = 'gemini-3.6-flash'`, free-tier flash).
- **Notion API** for storage; **Telegram Bot API** for alerts.
- **$0 total cost** — all free tiers.

### Pipeline Steps (src/pipeline.js)
1. **Parity gate** — computes day-of-year `% 2`; odd days exit immediately with **zero API calls** (every-other-day cadence).
2. **Fetch jobs** — loops `CONFIG.KEYWORDS` (3 keywords), calls `Services.fetchFromJSearch` per keyword; JSearch strict query first, **relaxed fallback** when strict yields 0 jobs (`JSEARCH_STRICT_FIRST: true`).
3. **Normalize + dedup** — normalize URLs (`split('?')[0]`, strip trailing `/`), dedup within batch AND against Notion history (fetches existing `Link.url` values); Notion query failure is **non-fatal** (proceeds with batch-only dedup).
3.5. **Pre-filter** — `preFilterJobs`: exclude titles matching `SENIORITY_EXCLUDE` regex (`senior|lead|manager|staff|principal|director|vp|head of`, and bare `java`); require ≥1 `TECH_STACK_KEYWORDS` match in title+description.
4. **Score with Gemini** — `scoreWithGemini` batches jobs in `BATCH_SIZE = 15`, calls `scoreJobsBatch` (JSON array with `job_index`+`score`, `responseSchema` forced), fallback `scoreSingleJob` per job on batch failure. Retries up to `GEMINI_MAX_RETRIES=3` with backoff. Score coerced to int in [0,100], missing/unparseable → 0.
5. **Filter by threshold** — keep `score >= CONFIG.SCORE_THRESHOLD` (75).
6. **Store + notify** — for each match: `notionCreatePage` + `telegramSendMessage`. If **no matches**, sends a `sendNoMatchSummary` Telegram message listing all scored offers and their scores.

### Configuration (src/config.js)
- `KEYWORDS`: `'javascript developer junior'`, `'react developer junior'`, `'node developer junior'` (juniors/senior-excluded focus — changed from legacy backend keywords)
- `SCORE_THRESHOLD: 75` (legacy was 85)
- `SENIORITY_EXCLUDE` regex + `TECH_STACK_KEYWORDS` (pre-filter)
- `LOCATION: 'Colombia'`, `REMOTE_ONLY: true`
- `OWNER_PROFILE`: Junior Full Stack (React, JS, Node, Express, Firebase, MySQL), remote-only, Bogota/LATAM, full-stack not backend/frontend-only
- `DESCRIPTION_MAX_CHARS: 1999` (Notion rich_text limit ≈2000)
- Endpoints: JSEARCH, GEMINI (`.../v1beta/models/`), NOTION, TELEGRAM

### Secrets (Apps Script Script Properties / Script Properties Service)
- `RAPIDAPI_KEY`, `GEMINI_API_KEY`, `NOTION_TOKEN`, `NOTION_DB_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Set via File → Project Properties → Script Properties. Never hardcoded in source; `.env` for local testing (gitignored).
- Note: config.js comments mention `setProperty` also exists (used for state if needed).

### Notion Database Schema (from services.js `notionCreatePage`)
- `Nombre` (title), `Empresa` (rich_text), `Link` (url — dedup source), `Score` (number), `Fuente` (select), `Descripción` (rich_text, truncated), `Estado` (select, defaults `'Nueva'`), `Keyword` (rich_text), `Fecha publicación` (date, optional)

### Telegram Message Format
- Match: `🎯 Nueva oferta con match ({score}/100)\n\n{title} en {company}\n\n{link}` (uses `.title`/`.job_title` depending on field)
- No-match summary: `🔍 Sin matches hoy ({n} ofertas scoreadas...)` listing each scored offer + score

### Deploy (manual, per ROADMAP Phase 4)
- Paste modules into new Apps Script project (or clasp).
- Configure all keys in Script Properties.
- Create daily time-driven trigger (~8 AM).
- Parity gate verified (odd day → immediate exit).

## Brecha (Gap): README vs Reality

### Obsoleto / Incorrecto (must remove or rewrite)
1. **"Este repo está en rebuild"** banner + statement that ROADMAP is "la fuente única de verdad" — rebuild is DONE (Phase 2 completed 2026-08-25); README should be the primary user-facing doc again.
2. **Entire "Por qué existe esto" n8n anecdote** — recounts building n8n automations; no longer the platform.
3. **"Qué hace" steps** — mention "deduplica" (fine) but the flow implies LinkedIn scraping + full description fetch + CV adaptado generation — none of those exist in v2. Gemini now returns **score only**, no justification, no adapted CV. Search source is **JSearch/RapidAPI**, not LinkedIn.
4. **Full n8n architecture diagram** (Schedule → HTTP → Loop → HTML → Gemini → Notion → Telegram) — completely replaced by 6-step Apps Script pipeline.
5. **"Lecciones aprendidas" section** — all n8n-specific ($itemIndex, HTTP Request node overwriting JSON, Merge chooseBranch, Wait-node rate limiting). Irrelevant to v2.
6. **Setup section** — requirements say "una instancia de n8n"; steps reference importing `linkedin-job-alerts.json`, editing n8n nodes (`If1`, `GEMINI` node, `Mi Perfil`, `job titles`, `HTTP Request`), configuring n8n credentials. None apply to Apps Script.
7. **Stack section** — lists n8n + LinkedIn guest API; should be Apps Script + JSearch/RapidAPI + Gemini + Notion + Telegram.
8. **"Variables de entorno"** — n8n-specific ($env), replaced by Apps Script Script Properties.
9. **Disclaimer** — talks about unofficial LinkedIn endpoint being fragile; v2 uses JSearch (stability concern shifts to RapidAPI monthly quota).
10. **Threshold default 85** in setup — reality is `SCORE_THRESHOLD = 75`.

### Falta (missing entirely)
1. The real v2 architecture and 6-step pipeline (with parity gate = every-other-day).
2. Pre-filter logic (seniority exclusion + tech-stack requirement).
3. Batching (batch of 15) + strict→relaxed JSearch fallback.
4. No-match Telegram summary behavior.
5. Real config constants (keywords, threshold=75, model, location, remote-only, profile).
6. Script Properties secrets list + deployment steps for Apps Script.
7. Notion DB schema as implemented.
8. Cost model ($0) and RapidAPI monthly quota (~200 req/month) tracking.
9. Runbook/hardening (from ROADMAP Phase 5).

### Correcto (keep / adapt)
- General "busca ofertas, scorea con Gemini, guarda en Notion, notifica por Telegram" and "system that aggregates job boards".
- Notion + Gemini + Telegram integration concept (now via JSearch instead of LinkedIn).
- MIT license.

## Affected Areas
- `README.md` — the artifact to rewrite (full replacement).
- `ROADMAP.md` — source of context for phases/history; README should reference it, not be superseded by it.
- `src/config.js`, `src/pipeline.js`, `src/services.js`, `src/main.js` — ground truth for the rewritten content; any drift must be captured accurately.
- `openspec/changes/readme-rewrite/exploration.md` — this artifact.

## Approaches

1. **Full rewrite from source-of-truth specs** — Rebuild README top-to-bottom from `src/` + ROADMAP's target design, dropping all n8n content.
   - Pros: Accurate, clean, single coherent document; directly serves manual deployer.
   - Cons: Loses "why this project exists" human story unless intentionally kept/reworded for v2; more work.
   - Effort: Medium

2. **Section-level surgical update** — Keep README skeleton, replace out-of-date sections (arquitectura, setup, stack, lecciones) while preserving narrative intros.
   - Pros: Preserves the personal "por qué" framing the author liked.
   - Cons: Risk of leftover n8n references; mixing legacy voice with v2 reality reduces coherence; harder to keep accurate in one pass.
   - Effort: Low/Medium

3. **README as concise overview + point to ROADMAP/openspec** — Trim README to a short overview, architecture summary, and links to deeper docs.
   - Pros: Lightweight; less drift.
   - Cons: ROADMAP is a build doc (not user-facing), so it doesn't fully replace a proper README for a manual deployer; loses setup details unless linked elsewhere.
   - Effort: Low

### Recommendation
**Approach 1 (full rewrite)** — a coherent, accurate v2 README. It can inherit the warm personal intro (retargeting the "por qué" from n8n-scraping to the v2 $0 cloud pipeline) and must include the real configuration values, Script Properties guide, deploy steps, pipeline flow, Notion schema, and an updated Stack + operational notes (RapidAPI quota, no-match summary, every-other-day cadence). Preserve "Por qué existe esto" as a brief personal story, but rewrite it around v2's motivation (leaving work, free-tier automation) rather than n8n internals. Reference ROADMAP.md as the historical/build source of truth while making README the primary user-facing doc.

## Risks
- **Stale config drift**: The rewrite must mirror `src/config.js` exactly (threshold 75, gemini-3.6-flash, Colombia keywords, etc.) to avoid creating new inaccuracies; verify final copy against source before publishing.
- **JSearch reliance**: v2 depends on RapidAPI free tier (~200 req/month, ~45-60 expected). README should flag this operational constraint so the user isn't surprised by monthly quota exhaustion.
- **Personal/quirk loss**: A full rewrite may drop the author's distinctive voice ("Usalo, adaptalo, rómpelo y arreglalo"). The license/disclaimer tone should be preserved intentionally.
- **Model name**: `GEMINI_MODEL` is documented as "update as needed"; README should note the model is a config constant, not hardcode a claim that may go stale.

## Ready for Proposal
Yes — this is a documentation-only change, fully understood. The orchestrator should tell the user: the README is ~100% legacy-n8n and must be rewritten from `src/` + ROADMAP; recommend the full-rewrite approach preserving a reworded personal intro and ending with the real v2 setup/deploy facts. Next phase: **propose**.
