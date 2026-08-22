## Exploration: LinkedIn Job Alerts System — Full System Understanding

### Current State

The system is a daily n8n workflow that automates job searching on LinkedIn. Every morning at 8am (America/Argentina/Buenos_Aires), it:

1. **Searches LinkedIn** using multiple keywords in parallel via an unofficial guest API endpoint (`jobs-guest/jobs/api`)
2. **Deduplicates** results both within a batch and against existing Notion database records
3. **Fetches full job descriptions** for new listings (rate-limited)
4. **Scores each job** against the user's CV using Google Gemini (`gemini-3.5-flash-lite`), returning a 0-100 score, justification, and a tailored CV
5. **Stores results in Notion** with structured fields (title, company, URL, external ID, score, justification, adapted CV, detection date)
6. **Sends Telegram alerts** when the score exceeds a configurable threshold (default: 85)

The system handles real production challenges: LinkedIn IP bans from aggressive scraping, Gemini 503 overload errors mid-run, n8n `$itemIndex` bugs with batch-size-1 loops, and HTTP Request nodes overwriting input JSON.

---

### 1. Node Structure — Complete Inventory (26 nodes)

| # | ID (short) | Name | Type | Position | Purpose |
|---|-----------|------|------|----------|---------|
| 1 | `1a9358ce` | Schedule Trigger | `n8n-nodes-base.scheduleTrigger` v1.2 | [144, 432] | Fires daily at 8:00 AM |
| 2 | `8f58db9d` | job titles | `n8n-nodes-base.code` v2 | [288, -304] | Defines 3 search keywords |
| 3 | `447a4feb` | Loop Over Items | `n8n-nodes-base.splitInBatches` v3 | [480, -320] | Iterates keywords one by one |
| 4 | `a837e844` | HTTP Request | `n8n-nodes-base.httpRequest` v4.2 | [624, 0] | LinkedIn guest search API |
| 5 | `59f0054a` | HTML | `n8n-nodes-base.html` v1.2 | [832, 0] | Extracts titles, companies, URLs from search HTML |
| 6 | `edc8eb3d` | Wait | `n8n-nodes-base.wait` v1.1 | [672, 256] | Rate-limit pause between LinkedIn requests |
| 7 | `a4ecb8bd` | Code | `n8n-nodes-base.code` v2 | [784, -336] | Flattens batch results into unified list |
| 8 | `b7e63bd1` | Code1 | `n8n-nodes-base.code` v2 | [1168, -160] | Deduplicates by URL (strips query params) |
| 9 | `2cd51f3f` | Get many database pages | `n8n-nodes-base.notion` v2.2 | [1296, 80] | Fetches ALL existing jobs from Notion DB |
| 10 | `568efb4b` | ExistingIds | `n8n-nodes-base.code` v2 | [1456, 208] | Extracts `id_externo` array from Notion results |
| 11 | `1d81c92e` | Merge | `n8n-nodes-base.merge` v3.2 | [1584, -160] | Joins scraped jobs with existing IDs |
| 12 | `e0d69a51` | Code2 | `n8n-nodes-base.code` v2 | [1776, -160] | Marks each job: `existe = true/false` |
| 13 | `04cd6e3c` | If | `n8n-nodes-base.if` v2.2 | [1952, -160] | Passes only `existe === false` (new jobs) |
| 14 | `82c6ed79` | Loop Detalle Ofertas | `n8n-nodes-base.splitInBatches` v3 | [2256, -400] | Iterates new jobs for detail fetch |
| 15 | `08c27c24` | Guardar original | `n8n-nodes-base.code` v2 | [2512, -320] | Saves original data before HTTP overwrite |
| 16 | `eb1bdd22` | HTTP Request — detalle de la oferta | `n8n-nodes-base.httpRequest` v4.2 | [2720, -320] | Fetches full LinkedIn job page |
| 17 | `1efdf645` | HTML — extraer descripción | `n8n-nodes-base.html` v1.2 | [2944, -320] | Extracts `.show-more-less-html__markup` |
| 18 | `468d394d` | Code — combinar descripción | `n8n-nodes-base.code` v2 | [3136, -320] | Merges description with original data |
| 19 | `7d3f28b2` | Wait1 | `n8n-nodes-base.wait` v1.1 | [2528, -128] | Rate-limit pause between detail fetches |
| 20 | `10be4af4` | Mi Perfil | `n8n-nodes-base.set` v3.4 | [2640, 224] | User CV text (placeholder) |
| 21 | `acfe5c72` | Merge1 | `n8n-nodes-base.merge` v3.2 | [3632, -352] | Joins job details with Mi Perfil |
| 22 | `67e0f45e` | Loop Gemini | `n8n-nodes-base.splitInBatches` v3 | [3984, -352] | Iterates jobs for Gemini scoring |
| 23 | `5828aa50` | Guardar antes de Gemini | `n8n-nodes-base.code` v2 | [4192, -256] | Saves original before Gemini response |
| 24 | `e37bc8b2` | GEMINI | `n8n-nodes-base.httpRequest` v4.2 | [4576, -336] | Calls Gemini API for scoring |
| 25 | `dc10fdf9` | Wait Retry | `n8n-nodes-base.wait` v1.1 | [4752, -240] | 10-second wait before retry |
| 26 | `18f95049` | Code3 | `n8n-nodes-base.code` v2 | [4944, -240] | Retry counter (max 3 attempts) |
| 27 | `a9e36719` | parser | `n8n-nodes-base.code` v2 | [5184, -336] | Parses Gemini JSON response |
| 28 | `0a5cef9f` | Wait2 | `n8n-nodes-base.wait` v1.1 | [5248, -64] | Pause after parse |
| 29 | `63c0eb19` | If1 | `n8n-nodes-base.if` v2.2 | [4608, -512] | Score >= 85 threshold check |
| 30 | `9bb4bc6a` | Create a database page | `n8n-nodes-base.notion` v2.2 | [4848, -528] | Writes job to Notion |
| 31 | `7108a50c` | Send a text message | `n8n-nodes-base.telegram` v1.2 | [5088, -528] | Sends Telegram alert |

**Note**: Wait nodes (#6, #19, #28) have NO `amount` parameter configured — they default to webhook-resume mode (indefinite pause unless an external webhook triggers them). This is a **critical bug** for rate limiting.

---

### 2. Real Prompts

#### Gemini Scoring Prompt (exact text from node `e37bc8b2`):

```
Analizá esta oferta laboral y mi perfil. Respondé SOLO con un objeto JSON válido,
sin texto adicional ni markdown, con esta forma exacta:
{"score": number, "justificacion": string, "cv_adaptado": string}.

OFERTA:
Título: {$json.titulo}
Empresa: {$json.empresa}
Descripción: {$json.descripcion}

MI PERFIL:
{$('Mi Perfil').first().json.miperfil}

INSTRUCCIONES IMPORTANTES:
- El campo "score" debe ser un número entre 0 y 100 que represente qué tan bien
  matchea mi perfil con esta oferta.
- El campo "justificacion" debe ser un párrafo breve (máximo 400 caracteres)
  explicando por qué es o no un buen match.
- El campo "cv_adaptado" debe ser un resumen de mi perfil adaptado específicamente
  a esta oferta, priorizando la experiencia y skills más relevantes para el puesto.
  IMPORTANTE: el campo cv_adaptado debe tener un máximo estricto de 1800 caracteres.
  Sé conciso, priorizá lo más relevante y no repitas información innecesaria.
```

**Expected JSON response schema** (implicit, not enforced):
```json
{
  "score": <number 0-100>,
  "justificacion": "<string, max 400 chars>",
  "cv_adaptado": "<string, max 1800 chars>"
}
```

**No system prompt** — the prompt is sent as a single `user` role message in the `contents[0].parts[0].text` field. No `systemInstruction` is configured.

**Score threshold**: `>= 85` (hardcoded in If1 node, `rightValue: 85`, operator: `number/gte`).

---

### 3. Scoring and CV Logic

#### How Gemini response is parsed (node `a9e36719` — `parser`):

```javascript
const raw = $input.item.json.candidates[0].content.parts[0].text;
const clean = raw.replace(/```json|```/g, '').trim();
const parsed = JSON.parse(clean);

const original = $('Guardar antes de Gemini').first().json._original;

return {
  json: {
    ...original,
    ...parsed,
    cv_adaptado: (parsed.cv_adaptado || '').slice(0, 1990)
  }
};
```

**Key behaviors:**
- Extracts `candidates[0].content.parts[0].text` from Gemini's standard response format
- Strips markdown code fences (`\`\`\`json` and `\`\`\``)
- Parses as JSON — **no try/catch**, so malformed Gemini responses crash the node
- Merges parsed fields (`score`, `justificacion`, `cv_adaptado`) with original job data
- Truncates `cv_adaptado` to **1990 characters** (hard limit for Notion rich_text)
- Uses `alwaysOutputData: true` so the node always produces output

#### Score evaluation (node `63c0eb19` — `If1`):

```json
{
  "conditions": [{
    "leftValue": "={{ $json.score }}",
    "rightValue": 85,
    "operator": { "type": "number", "operation": "gte" }
  }]
}
```

**If score >= 85**: Creates Notion page → sends Telegram alert.
**If score < 85**: The item is silently dropped (no "false" branch connected).

#### What happens to low-score jobs:
Nothing. They are NOT stored in Notion. They are NOT logged. They simply don't pass the If1 gate. There is no "archive low-score jobs" path.

---

### 4. Retry / Rate Limiting

#### Gemini retry loop (503 handling):

| Component | Configuration |
|-----------|--------------|
| Trigger | `onError: "continueErrorOutput"` on GEMINI node |
| Wait | Wait Retry: **10 seconds** (amount: 10) |
| Counter | Code3: `_intentos` field, incremented each retry |
| Max retries | **3 attempts** (`intentos >= 3` → returns null) |
| Retry path | Wait Retry → Code3 → back to Loop Gemini |

**Flow**: GEMINI error → Wait Retry (10s) → Code3 (increment counter) → Loop Gemini (retry same item)

**Problem**: When retries are exhausted (`intentos >= 3`), Code3 returns `null`. In n8n, returning null from a Code node produces no output items — the item is silently dropped. There is no error notification, no logging, no fallback.

#### LinkedIn rate limiting:

| Component | Configuration |
|-----------|--------------|
| Wait (search loop) | **No amount configured** — defaults to webhook-resume (indefinite) |
| Wait1 (detail loop) | **No amount configured** — defaults to webhook-resume (indefinite) |
| Batch size | Default (splitInBatches v3 default = 1 item per batch) |

**Problem**: The Wait nodes between LinkedIn requests have NO duration set. In n8n, a Wait node with no `amount` defaults to waiting for an external webhook call. This means:
- The workflow would PAUSE after each LinkedIn request and never resume automatically
- The "rate limiting" described in the README doesn't actually work as configured
- The workflow would need manual webhook triggers to continue, which defeats automation

---

### 5. Connections and Integrations

#### LinkedIn (Guest API):

| Parameter | Value |
|-----------|-------|
| Endpoint | `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` |
| Method | GET (default) |
| Query params | `keywords`, `location` (=YOUR_LOCATION), `start`=0, `f_TPR`=r86400 (past 24h) |
| Auth | None (guest/public API) |
| Headers | None configured |
| Cookie | None configured |

**Detail fetch**: GET `={{ $json.url }}` (direct job page URL)
**Detail extraction**: CSS selector `.show-more-less-html__markup`
**Search extraction**: CSS selectors `.base-search-card__title`, `.base-search-card__subtitle`, `a.base-card__full-link[href]`

#### Notion:

| Parameter | Value |
|-----------|-------|
| Database ID | `YOUR_NOTION_DATABASE_ID` (placeholder) |
| Database name | "Trabajos" (cached display name) |
| Read | `getAll` (returnAll: true) — fetches ALL pages |
| Write | `create` with properties below |
| Credentials | `YOUR_NOTION_CREDENTIAL_ID` |

**Notion schema** (properties written on create):
| Property | Type | Source |
|----------|------|--------|
| Title (auto) | title | `$json.titulo` |
| Empresa | rich_text | `$json.empresa` |
| URL | url | `$json.url` |
| id_externo | rich_text | `$json.id_externo` |
| Score | number | `$json.score` |
| Justificación | rich_text | `$json.justificacion` |
| CV Adaptado | rich_text | `$json.cv_adaptado` |

**Read path**: Reads `property_id_externo` from all pages to build dedup list.

#### Telegram:

| Parameter | Value |
|-----------|-------|
| Chat ID | `YOUR_TELEGRAM_CHAT_ID` (placeholder) |
| Credentials | `YOUR_TELEGRAM_CREDENTIAL_ID` |
| Message format | See below |

**Telegram message template**:
```
🎯 Nueva oferta con match ({{ $json.property_score }}/100)

{{ $json.property_titulo }} en {{ $json.property_empresa }}

{{ $json.property_justificaci_n }}

{{ $json.property_url }}
```

**Note**: The property references use `property_` prefix with underscored names (`property_justificaci_n` — note the `n` without accent). This is n8n's internal property name transformation.

#### Google AI Studio (Gemini):

| Parameter | Value |
|-----------|-------|
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent` |
| API key | `YOUR_GEMINI_API_KEY` (query parameter `?key=`) |
| Model | `gemini-3.5-flash-lite` |
| Method | POST |
| Content-Type | application/json |
| Auth | API key in URL |

---

### 6. Configuration and Credentials

#### All placeholders requiring replacement:

| Placeholder | Location | What to provide |
|------------|----------|----------------|
| `YOUR_LOCATION` | HTTP Request node (search) | LinkedIn location string (e.g., "Argentina", "Buenos Aires") |
| `YOUR_NOTION_DATABASE_ID` | Notion nodes (read + write) | Notion database UUID |
| `YOUR_NOTION_CREDENTIAL_ID` | Notion nodes (read + write) | n8n Notion credential ID |
| `YOUR_GEMINI_API_KEY` | GEMINI node | Google AI Studio API key |
| `YOUR_TELEGRAM_CHAT_ID` | Telegram node | Telegram chat/group ID |
| `YOUR_TELEGRAM_CREDENTIAL_ID` | Telegram node | n8n Telegram credential ID |
| `REEMPLAZAR con tu propio CV...` | Mi Perfil node | Full CV/profile text |

#### Environment variables:
**None referenced.** All credentials are hardcoded as n8n credential references or inline values. The workflow does NOT use n8n's `$env` variable system.

#### Workflow settings:
```json
{
  "executionOrder": "v1",
  "timezone": "America/Argentina/Buenos_Aires",
  "active": false
}
```

---

### 7. External Data

#### Mi Perfil / CV (node `10be4af4`):

The "Mi Perfil" node is a `Set` node with a single field:
- **Field name**: `miperfil`
- **Current value**: `"REEMPLAZAR con tu propio CV / perfil en texto plano. Este campo se inyecta en el prompt que se le manda al LLM para scorear cada oferta y generar un CV adaptado. Recomendado: nombre, ubicación, resumen profesional, experiencia laboral con logros medibles, stack técnico, educación e idiomas."`

**No real CV is embedded in the JSON.** The user must replace this placeholder with their actual profile text.

#### Search keywords (node `8f58db9d`):

```javascript
const keywords = [
  'backend developer',
  'backend engineer',
  'software engineer backend'
];
```

Three keywords, all backend-focused. The workflow maps each to a separate LinkedIn search.

---

### 8. What's Missing or Broken

#### Critical bugs:

1. **Wait nodes have no duration** — Wait, Wait1, and Wait2 have no `amount` parameter. They default to webhook-resume mode (indefinite pause). The workflow would freeze after the first LinkedIn request unless manually triggered via webhook. This completely breaks rate limiting.

2. **If1 score check is unreachable** — If1 (score >= 85) is connected to Loop Gemini's output, but at that point the data hasn't been through GEMINI yet. The `score` field doesn't exist until the `parser` node runs. So `{{ $json.score }}` evaluates to `undefined`, the condition always fails, and **no jobs ever reach Notion or Telegram**.

3. **No error handling in parser** — The parser does `JSON.parse(clean)` without try/catch. If Gemini returns malformed JSON (common with LLMs), the node crashes. Combined with the retry loop, this could cause infinite retries for the same item.

4. **Silent retry exhaustion** — When Code3 reaches 3 retries, it returns `null`. The item silently disappears. No error notification, no logging, no fallback path.

#### Design issues:

5. **No LinkedIn auth** — The guest API has no cookies, no headers, no session handling. LinkedIn actively blocks unauthenticated scraping. The workflow relies entirely on the endpoint remaining open.

6. **No CSS selector resilience** — LinkedIn's HTML structure can change without notice. The CSS selectors (`.base-search-card__title`, `.show-more-less-html__markup`, etc.) will break silently if LinkedIn updates their frontend.

7. **`start=0` is hardcoded** — The search always fetches page 0. If more than ~25 jobs match, older results are never seen.

8. **Low-score jobs are lost** — Jobs scoring below 85 are not stored anywhere. There's no history of rejected jobs, making it impossible to tune the threshold or review false negatives.

9. **Notion `getAll` with no pagination handling** — The workflow fetches ALL Notion pages (`returnAll: true`). For databases with hundreds of jobs, this could hit Notion API rate limits.

10. **Telegram message uses `property_` prefix** — The message template references `$json.property_score`, `$json.property_titulo`, etc. This works because n8n flattens Notion page properties with this prefix, but it's fragile if the Notion schema changes.

11. **No dedup across runs** — The dedup logic compares against Notion's current state, but if the workflow runs twice before Notion is updated, duplicates could be created.

12. **$itemIndex not used** — As noted in the README lessons, the batch loops don't use `$itemIndex`. The Code nodes use `pairedItem: index` instead, which is the correct pattern for n8n's item association.

---

### Affected Areas

- `linkedin-job-alerts.json` — The n8n workflow definition (the entire source of truth)
- `README.md` — Documentation of the system, setup steps, and lessons learned
- `openspec/changes/linkedin-job-alerts-exploration/exploration.md` — This artifact

### Approaches

Since this is an exploration of an existing system (not a proposed change), the "approaches" represent potential improvement directions:

1. **Fix Wait nodes** — Add explicit durations (e.g., 5-10 seconds for LinkedIn, 2-3 seconds for Gemini)
   - Pros: Enables actual rate limiting, makes the workflow functional
   - Cons: Need to test optimal timing for each API
   - Effort: Low

2. **Restructure Gemini flow** — Move If1 AFTER parser so the score check happens post-Gemini
   - Pros: Actually gates Notion/Telegram on score threshold
   - Cons: Changes workflow topology
   - Effort: Medium

3. **Add error handling** — Wrap parser in try/catch, add error notifications
   - Pros: Prevents silent failures, enables monitoring
   - Cons: More complex workflow
   - Effort: Medium

4. **Add LinkedIn auth** — Implement cookie/session management for the guest API
   - Pros: More reliable scraping, fewer IP blocks
   - Cons: Cookies expire, need refresh mechanism
   - Effort: High

### Recommendation

The workflow has a fundamental structural issue: the score gate (If1) is unreachable because it runs before Gemini processes the job. This must be fixed first. Additionally, the Wait nodes need explicit durations to enable actual rate limiting. Without these two fixes, the workflow either freezes or never produces output.

### Risks

- LinkedIn guest API may change or require authentication at any time
- Gemini API costs scale linearly with job count (no caching of scores)
- No monitoring or alerting for workflow failures
- Wait nodes without duration break the automation entirely
- Parser crash on malformed Gemini JSON causes silent retry loops
- No persistence of low-score jobs makes threshold tuning impossible

### Ready for Proposal

Yes — the system is fully understood from the JSON analysis. The next step should be creating a proposal that addresses the critical bugs (Wait nodes, If1 placement) and the design improvements (error handling, persistence of low-score jobs).

---

## Key Learnings

1. The n8n Wait node defaults to webhook-resume mode when no duration is configured, which silently breaks rate limiting.
2. The If1 score gate is positioned before the GEMINI node in the connection graph, making it unreachable for actual scoring decisions.
3. The parser node performs JSON.parse without try/catch, so malformed Gemini responses crash the node and trigger retry loops.
4. The workflow stores zero context about jobs scoring below threshold, making it impossible to tune the 85-point cutoff.
5. The Gemini prompt requests JSON output but provides no schema enforcement, relying entirely on the LLM's compliance.
