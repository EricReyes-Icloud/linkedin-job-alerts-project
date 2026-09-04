# PR: Rewrite README for the v2 pipeline and add interactive architecture diagram

## Description

The README still documented the legacy n8n-based workflow, including the "repo en rebuild" banner and lessons learned from the n8n implementation. After the v2 rebuild moved the pipeline to Google Apps Script (JSearch + Gemini + Notion + Telegram, $0), the README no longer reflected the real system: the architecture section described the old flow and the deploy instructions pointed at a stale setup.

This change fully rewrites `README.md` to document the v2 pipeline as it actually exists in `src/`: the $0 stack, the 6-step pipeline flow (parity gate, fetch, normalize/dedup, pre-filter, Gemini scoring, store + notify), the exact configuration constants from `src/config.js`, the Script Properties credentials, the Notion schema, a step-by-step deploy guide, and a free-tier quota analysis. It also adds an interactive architecture diagram generated with the archify skill.

## Changes Made

- `README.md` — Full rewrite (421 lines changed, +301/−126): project description, $0 tech stack table, architecture section with ASCII pipeline diagram and link to `docs/diagrams/architecture.html`, per-step flow table with API call counts and error behavior, `src/config.js` constants (search, pre-filter, scoring, pipeline), 6 Script Properties (`RAPIDAPI_KEY`, `GEMINI_API_KEY`, `NOTION_TOKEN`, `NOTION_DB_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), Notion database schema, step-by-step Apps Script deploy guide, free-tier quotas, MIT license.
- `docs/diagrams/architecture.html` — NEW (715 KB): self-contained interactive architecture diagram of the v2 pipeline with inline SVG, dark/light themes, and animations, generated with the archify skill.
- `docs/diagrams/architecture.visual-check.json` — NEW: archify visual-check receipt for the diagram (marks the automated browser check as skipped because Chrome/Chromium is unavailable in this environment).
- `openspec/changes/readme-rewrite/exploration.md` — NEW: SDD exploration planning artifact for the README rewrite.
- `openspec/changes/readme-rewrite/proposal.md` — NEW: SDD change proposal for the README rewrite.

## Impact

- **Documentation accuracy**: The README now describes the real v2 system; all legacy n8n content (setup steps, workflow import, LinkedIn guest API disclaimer, n8n lessons learned) was removed.
- **No runtime changes**: This is a docs-only change — `src/` was not modified.
- **New artifact**: `docs/diagrams/architecture.html` is fully self-contained (no external dependencies) and requires opening in a browser.
- **Caveat**: The automated visual check of the diagram was skipped (no Chrome/Chromium available), so the diagram received manual review only.

## Notes

- Excluded from this PR: `.atl/skill-registry.md` and `.atl/.skill-registry.cache.json` — pre-existing skill-registry artifacts, not part of this change.
- `docs/diagrams/architecture.visual-check.json` is an archify sidecar receipt; it can be excluded from the commit if the diagram artifact should ship alone.
- Verify: open `docs/diagrams/architecture.html` in a browser and cross-check the README deploy guide and constants against `src/config.js`.