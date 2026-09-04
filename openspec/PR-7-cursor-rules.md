# PR: Add Cursor project rules for the v2 codebase

## Description

The repo encodes strong implicit conventions — Google Apps Script ES5/global-scope runtime, $0 free-tier quota discipline, the retired n8n workflow, manual deployment, and a strict commit/PR style — but nothing surfaces them to an AI-assisted editor. A fresh editor session can therefore suggest solutions the project explicitly rejects: reintroducing n8n, HTML scraping, `clasp` automation, Node-only APIs in `src/`, hardcoded secrets, or AI attribution in commits. On a pipeline that runs on scarce free-tier quota (JSearch ~200 requests/month, Gemini free tier), such mistakes are costly, not cosmetic.

This change adds three Cursor rules (`.mdc` format, with `description`/`globs`/`alwaysApply` frontmatter) that codify the project's real context, the coding standards for `src/**/*.js`, and the git/delivery conventions. With `alwaysApply: true` on all three, an editor session in this repo starts with the same context the human maintainer has.

## Changes Made

- `.cursor/rules/project-context.mdc` — NEW (59 lines): project-wide rule (`globs: "*"`, `alwaysApply: true`) describing what v2 is and is not — the real architecture (Apps Script → JSearch/RapidAPI → Gemini → Notion → Telegram), sources of truth (`src/config.js`, `src/pipeline.js`, `src/services.js`, `src/main.js`), the parity gate cadence, the retired n8n workflow and no-scraping stance, the $0 philosophy, and the manual Apps Script deploy (no `clasp`).
- `.cursor/rules/src-appsscript-standards.mdc` — NEW (52 lines): rule scoped to `globs: "src/**/*.js"` — ES5-compatible, flat global scope (no `require`/`import`/`export`), secrets only via Script Properties or gitignored `.env`, centralized `CONFIG` in `src/config.js`, non-fatal error handling, quota discipline (`BATCH_SIZE = 15`, `GEMINI_MAX_RETRIES = 3` with 2s/4s/6s backoff), tolerant Gemini response parsing, and cheap local verification via `node --check` before any real run.
- `.cursor/rules/git-and-delivery.mdc` — NEW (37 lines): project-wide rule (`globs: "*"`) — Conventional Commits in English with no `Co-Authored-By`, secrets never staged or committed, `.atl/` kept out of commits, PR content drafted with `skills/pr-creator/SKILL.md` and saved to `openspec/PR-{next-number}-{slug}.md`, user pushes/opens PRs themselves, and manual production deployment.

## Impact

- **Editor context**: Cursor sessions now load always-on rules that state the project's real architecture and its explicit non-negotiables (no n8n, no scraping, no self-hosting, $0, manual deploy), reducing the risk of confidently wrong suggestions.
- **Code-authoring guardrails**: `src/` edits get standards enforcement at generation time — ES5/global scope, no secrets in code, centralized `CONFIG`, quoted retry/batching behavior, tolerant AI parsing — instead of relying on review to catch violations.
- **Delivery consistency**: Commits and PRs follow the documented conventions (English, conventional commits, no AI attribution, PRs via `skills/pr-creator/SKILL.md`), including for future editor-generated changes.
- **No runtime behavior change**: docs/configuration only; `src/` was not touched in this change.
- **Caveat**: the rules are declarative guidance — their enforcement depends on the editor agent honoring them; they are not linting or CI gates.

## Notes

- Excluded from this PR: `.atl/skill-registry.md` and `.atl/.skill-registry.cache.json` — pre-existing skill-registry artifacts, not part of this change.
- `.cursor/` is a new directory created solely by these three files.
- Verify: open the repo in Cursor and confirm the three rules appear and apply (all `alwaysApply: true`); spot-check that a `src/` editing session surfaces the Apps Script constraints.
- This PR follows the workflow defined in `.cursor/rules/git-and-delivery.mdc` — the first PR produced under the conventions the change itself introduces.