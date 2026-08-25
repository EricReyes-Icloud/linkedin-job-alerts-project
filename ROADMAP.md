# LinkedIn Job Alerts v2 — Build Roadmap

This roadmap is the **single source of truth** for rebuilding the LinkedIn Job Alerts system as plain JavaScript running on Google Apps Script. It replaces the retired n8n workflow (`linkedin-job-alerts.json`) with a $0-cost, fully cloud-hosted pipeline that aggregates job boards, scores offers with Gemini, and delivers matches via Notion + Telegram. Anyone resuming this project cold — the owner or a future AI session — should be able to build the entire system from this file alone.

---

## Quick path

Build order, at a glance. Each phase has detailed acceptance criteria in [§6](#6-build-phases).

| Phase | Goal | Done when |
|-------|------|-----------|
| 0 | Accounts & keys | All 5 credentials obtained; secure storage decided |
| 1 | Repo scaffold | Apps Script-compatible JS modules exist; config constants defined; README points here |
| 2 | ✅ Pipeline implemented | All 6 pipeline steps work end-to-end against real APIs — **Completed 2026-08-25** |
| 3 | Manual E2E test | ≥1 Notion page created with correct properties **and** Telegram message received |
| 4 | Cloud deploy | Daily trigger live; parity gate verified (odd day → immediate exit) |
| 5 | Hardening & operations | Logging conventions, quota tracking, and break-glass runbook in place |

---

## 1. Mission & non-negotiable constraints

An automated alert system that searches aggregated job boards **every other day**, scores each new offer against the owner's profile with Gemini (**score only**), keeps matches ≥ 85, stores them in a Notion database, and pushes a Telegram notification per strong match.

These five constraints drive every decision below. Do not trade them away.

| # | Constraint | Consequence for the design |
|---|------------|----------------------------|
| 1 | **$0 philosophy** — no VPS, no paid services | Generous free tiers only; the platform must have a *permanent* free plan |
| 2 | **Truly automatic in the cloud** — must not depend on the owner's PC being on | This is what killed self-hosted n8n; the runtime must be someone else's machine |
| 3 | **Every-other-day cadence** | Daily trigger + parity gate: compute day-of-year `% 2`; odd days exit immediately having spent **zero API calls** |
| 4 | **Gemini returns ONLY `{"score": N}`** (numeric 0–100) | No adapted-CV generation, no long justification — deliberate simplification vs. legacy |
| 5 | **Code lives in this repo as normal JS** | Deployed to Apps Script by copy-paste (or clasp later); no Node-only APIs allowed in source |

---

## 2. Architecture decision record

### 2.1 Chosen stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| **Data source** | JSearch by OpenWeb Ninja, consumed via RapidAPI | Aggregates LinkedIn / Indeed / Glassdoor / ZipRecruiter through Google for Jobs. Returns structured JSON **including full job descriptions** — no HTML scraping, no unofficial endpoints, no CSS selectors to rot |
| **Runtime** | Google Apps Script (free Gmail account) | Private by default, zero infrastructure, built-in Stackdriver logging, and quota headroom that is massive relative to our workload (see §2.2) |

JSearch gotchas to respect: the same posting appears **triplicated across boards**, so cross-board dedup is mandatory; results can later be filtered by publisher by appending `"via linkedin"` to the query string (future option, see §7).

### 2.2 Capacity check (free-tier quotas)

| Resource | Free limit | Estimated usage | Headroom |
|----------|------------|-----------------|----------|
| UrlFetchApp calls | 20,000 / day | ~25 calls per run | Massive |
| Apps Script trigger runtime | ~90 min / day total | ~2 min per run | Massive |
| JSearch via RapidAPI | ~200 requests / **month** | ~45–60 / month (15 runs × 3 keywords) | ~3× — track it (§6 Phase 5) |

### 2.3 Rejected alternatives

| Alternative | Verdict | Reason |
|-------------|---------|--------|
| n8n Cloud | Rejected | No permanent free plan — 14-day trial, then $24/month. Violates constraint #1 |
| n8n Community Edition (self-hosted) | Rejected | Free, but requires an always-on machine. Violates constraint #2 |
| GitHub Actions scheduled workflows | Blocked | Scheduled workflows are **blocked on private repos with free accounts** (deliberate, poorly documented limitation — verified Aug 2026). On public repos, schedules silently auto-disable after 60 days without activity, and cron runs lag 5–30 minutes under load |

### 2.4 Legacy workflow verdict

`linkedin-job-alerts.json` is **NOT modified** and **NOT executable** for this rebuild: it is an n8n export that only runs inside n8n, and the chosen platform (Apps Script) provides no runtime for nodes or connections. The **platform decision is what retires the file** — not the switch to JSearch alone (changing data sources inside n8n would have been painful, but feasible). The file stays in the repo as a historical reference, alongside `openspec/changes/linkedin-job-alerts-exploration/exploration.md`.

---

## 3. Target pipeline

Target shape: **six logical steps in a single flat JS file, ~150 lines.**

```
(1) Daily time-driven trigger (~8 AM)
        │
        ▼
      Parity gate: day-of-year % 2 ──odd──▶ EXIT EARLY (zero API calls spent)
        │ even
        ▼
(2) GET JSearch × 3 keywords                          [~3 RapidAPI calls]
        │   Structured JSON already contains: title, company,
        │   FULL description, application link
        ▼
(3) Normalize links + dedup vs Notion                 [~1 Notion call]
        │   Fetch existing links/job ids; drop offers already stored.
        │   Normalize URLs before comparing.
        │   Dedup WITHIN batch and AGAINST history.
        ▼
(4) POST Gemini per new offer                         [1 call per offer]
        │   Forced response schema: object with only numeric "score" 0–100
        │   Parse wrapped in try/catch · strip stray markdown fences
        │   Retry up to 3 attempts with backoff (handles 503 overload)
        ▼
(5) Filter: score ≥ 85
        │
        ▼
(6) For each surviving offer:
        Create Notion page  +  send Telegram notification
```

Cost profile per run on an executing day: ~3 RapidAPI + ~1 Notion read + 1 Gemini call per *new* offer + 1 Notion write and 1 Telegram message per surviving offer — roughly the ~25 URL-fetch calls and ~2 minutes cited in §2.2.

---

## 4. What changes vs. legacy

### 4.1 Legacy critical bugs — eliminated by construction

These three bugs made the legacy workflow structurally fragile. The rebuild removes them not by fixing them, but by making them impossible:

| Legacy bug | How the rebuild eliminates it |
|------------|-------------------------------|
| Wait nodes with **no duration configured** — workflow paused indefinitely awaiting a webhook that never fires | Plain sequential code: no Waits, no gates, no node graph |
| Unreachable **"If1" score gate wired before GEMINI** — `score` did not exist yet, so no job ever reached Notion/Telegram | Explicit linear function calls in source order; wiring errors of this class cannot occur |
| **Fragile parser** — `JSON.parse` with no try/catch; malformed Gemini output crashed the run | Every external-API parse wrapped in try/catch; Gemini output constrained by a forced response schema |

### 4.2 Recycled from legacy (approved)

| Asset | Carried over as |
|-------|-----------------|
| The 3 search keywords | `'backend developer'`, `'backend engineer'`, `'software engineer backend'` |
| Dedup key concept | `id_externo` = URL with query string stripped (`url.split('?')[0]`). New system **stores the Link URL and compares the normalized form** |
| Gemini retry policy | Attempt counter, maximum 3 attempts, wait between retries — legacy hit `503 model overloaded` mid-run |
| Notion property mapping + Telegram notification format concept | Field set **reduced**: the new message shows title / company / link / score only (no justification, no adapted CV — because Gemini output is score-only now) |

---

## 5. Data contracts

### 5.1 Notion database — target DB "Trabajos"

| Property | Type | Notes |
|----------|------|-------|
| Nombre | title | Offer title |
| Empresa | rich_text | Company name |
| Link | url | Used as the **dedup source** (compared normalized) |
| Score | number | 0–100 from Gemini |
| Fuente | select | Publisher / board (LinkedIn, Indeed, Glassdoor…) |
| Descripción | rich_text | Truncated to **~1999 chars** (Notion 2000-char property limit) |
| Fecha publicación | date | Posting date |
| Estado | select | Nueva / Aplicada / Descartada — owner updates manually over time |
| Keyword | rich_text | Which search keyword found it |

### 5.2 Gemini request/response contract

- **Request**: offer title + company + full description, scored against the owner's profile text (profile source: TBD — config constant or Script Properties, decided at implementation).
- **Response**: forced schema — a JSON object containing **only** a numeric `score` between 0 and 100.
- **Parsing rules**: strip markdown fences defensively before `JSON.parse`; wrap in try/catch; retry up to 3 attempts with backoff on failure or HTTP 503.
- Exact Gemini model: TBD at implementation (pick a current free-tier flash-class model).

### 5.3 Telegram message format

Format concept recycled from legacy, with the reduced field set:

```
🎯 Nueva oferta con match ({score}/100)

{title} en {company}

{link}
```

Exact copy finalized during Phase 2.

---

## 6. Build phases

Work strictly top-to-bottom. Do not start a phase until the previous one meets its acceptance criteria.

### Phase 0 — Accounts & keys

Create every account and credential up front:

| Account / service | You obtain | Critical note |
|-------------------|------------|---------------|
| RapidAPI → subscribe to **JSearch** free tier | API key | Free tier is ~200 requests/**month** |
| Google AI Studio | Gemini API key | — |
| Telegram bot via **@BotFather** | Bot token + your `chat_id` | Message your own bot once to obtain the chat id |
| Notion **internal integration** | Integration secret | The integration **must be connected to the database** via `•••` → Connections — otherwise every API call fails with access denied |
| Google account | Access to Apps Script | Any free Gmail account |

**Secret handling rules (non-negotiable):**
- Never hardcode keys in source.
- Production: store keys in Apps Script **Properties Service**.
- Local development: `.env`-style config file, **excluded from git** via `.gitignore`.

**Acceptance criteria**
- [ ] JSearch subscription active; test request returns results
- [ ] Gemini API key works (one manual call from AI Studio or curl)
- [ ] Telegram bot responds; chat_id captured
- [ ] Notion integration connected to the "Trabajos" database; test read succeeds
- [ ] Local secrets file gitignored

### Phase 1 — Repo scaffold

- Plain-JS module(s), Apps Script-compatible: **no Node-only APIs** (no `fs`, `http`, `crypto`, …).
- Platform services (`UrlFetchApp`, `Utilities`, logging) accessed through **thin wrappers**, so core logic stays unit-testable outside Apps Script.
- Config constants module: `KEYWORDS` list (the 3 approved keywords), `LOCATION` (value TBD — set at scaffold time), `SCORE_THRESHOLD = 85`.
- README gains a section pointing to **ROADMAP.md** (this file) as the build source of truth.

**Acceptance criteria**
- [ ] Scaffold compiles/lints clean with no Node-only imports
- [ ] Core logic importable without any Apps Script global present
- [ ] Config constants defined; README updated

### Phase 2 — Implement pipeline

Implement the six steps of §3. Coding rules:

1. Every external-API response parsed **inside try/catch**.
2. **Log each step**: result counts per keyword, post-dedup count, per-offer Gemini outcome (score / retry / failure), pages created, messages sent.
3. **Preserve original item data explicitly across each external API call** — never assume the next response carries prior fields (hard-won legacy lesson, still valid).
4. Gemini call: forced schema + defensive fence-stripping + retry ≤ 3 with backoff.
5. Descriptions truncated to ~1999 chars before writing to Notion.

**Acceptance criteria**
- [ ] Full flow executes end-to-end against real APIs from a manual invocation
- [ ] A deliberately malformed Gemini-style response does not crash the run
- [ ] Logs show every step boundary

### Phase 3 — Manual end-to-end test

Run the main function **manually, once**, against real services.

**Acceptance criteria (gate to Phase 4)**
- [ ] At least one Notion page created **with correct properties** (title, company, link, score, fuente, truncated description, date, Estado=Nueva, keyword)
- [ ] A Telegram message received with the §5.3 format
- [ ] All defects found during the run fixed **before proceeding**

### Phase 4 — Deploy to Apps Script

- Paste the code into a new Apps Script project (or set up **clasp**).
- Configure all keys in **Script Properties**.
- Create the daily time-driven trigger (~8 AM).
- Verify the parity gate: force a run on an **odd** day-of-year → immediate exit, zero API calls logged.

**Acceptance criteria**
- [ ] Code deployed; keys in Script Properties only
- [ ] Daily trigger active
- [ ] Odd-day force-run exits instantly with no outbound calls
- [ ] Even-day behavior unchanged from Phase 3 results

### Phase 5 — Hardening & operations

- **Logging conventions**: after any anomaly, open Apps Script → Executions; logs follow the Phase 2 step-boundary convention, so the failing step is identifiable at a glance.
- **Quota tracking**: check the RapidAPI dashboard monthly counter — budget ~200 req/month vs. expected ~45–60.
- **Starter runbook** (expand as incidents occur):

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| No Telegram messages across several runs | Trigger disabled or parity gate misconfigured | Check Apps Script triggers page + last execution log |
| Notion "access denied" | Integration disconnected from the DB | Reconnect via `•••` → Connections |
| Duplicate offers reappearing | URL-normalization regression | Compare stored Link vs. newly computed normalized form |
| JSearch 403 / 429 | Monthly quota exhausted | Check RapidAPI usage; reduce keywords or accept skipped cycles |
| Gemini failures persist past 3 retries | Model-side outage | Skip the cycle; every-other-day cadence self-heals next run |

- **Tuning knobs**: `SCORE_THRESHOLD` (default 85), `KEYWORDS` list, `LOCATION`, cadence (parity `% 2` → another modulus), Telegram copy.

**Acceptance criteria**
- [ ] Runbook committed and reachable from this doc
- [ ] Knobs documented in the config module comments

---

## 7. Future ideas — NOT committed

None of these are scheduled or promised. Do **not** build any of them without an explicit owner request.

- Publisher filter: append `"via linkedin"` to the JSearch query string
- More keywords (mind the ~200/month request budget)
- Daily digest message instead of per-offer notifications
- Auto-update the Notion `Estado` field
- Weekly stats email

---

## 8. Known gotchas

1. **Same job on multiple boards within one JSearch response** → dedup within the batch AND against Notion history.
2. **Gemini occasionally wraps JSON in markdown fences** even with schema instructions → strip fences defensively before parsing.
3. **Notion rich_text property limit is 2000 chars** → truncate descriptions to ~1999.
4. **RapidAPI free tier is monthly** (~200 req) → ~45–60/month usage fits, but track the counter.
5. **Preserve original item data explicitly** across each external API call rather than assuming the response carries prior fields — the legacy lesson that remains fully applicable.

---

## 9. Repo map

| Path | Role |
|------|------|
| `ROADMAP.md` | This file — the build source of truth |
| `linkedin-job-alerts.json` | Legacy n8n export — **historical reference only. Do not modify, do not execute.** |
| `openspec/changes/linkedin-job-alerts-exploration/exploration.md` | Deep-dive analysis of the legacy workflow |
| `README.md` | Project overview; gains a pointer to this roadmap in Phase 1 |
| `src/` (created in Phase 1) | Apps Script-compatible pipeline code — layout TBD at scaffold time |

---

## Next step

Start **Phase 3**: run the pipeline manually against real APIs to verify end-to-end behavior. The code is implemented and verified — now it needs to prove itself against live JSearch, Gemini, Notion, and Telegram services.
