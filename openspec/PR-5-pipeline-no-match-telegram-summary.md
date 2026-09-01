# PR: Notify Telegram when no jobs match the threshold

## Description

When the pipeline runs and scores jobs via Gemini but none of them meet `SCORE_THRESHOLD`, the pipeline previously exited silently — it only logged the result. This created a blind spot: the system ran, but the user had no visibility into whether it worked or what the market looked like today.

This change adds a Telegram notification at the zero-match exit path so the user receives a summary showing how many offers were scored and what each one received, even when no match qualifies for a full alert. This keeps the user informed without adding noise — only zero-match runs trigger the summary, never zero-fetch or zero-scored scenarios.

## Changes Made

- `src/pipeline.js` — Modified the early-exit branch when `matches.length === 0` in `runPipeline()`: calls `sendNoMatchSummary(scoredJobs)` before returning, replacing the silent `Services.log` call.
- `src/pipeline.js` — Added new function `sendNoMatchSummary(scoredJobs)` that builds a concise Telegram message with the count of scored offers and per-job score lines, then sends it via `Services.telegramSendMessage`.

## Impact

- **User visibility**: The user now receives a Telegram message whenever the pipeline scores jobs but finds no matches above the threshold. Previously this scenario produced no notification.
- **No false positives**: The notification only fires when at least one job was scored. Cases where zero jobs were fetched, all were duplicates, or all were removed by the pre-filter remain silent as before.
- **Backward compatibility**: The change is additive — it adds a Telegram message on an existing exit path without altering the pipeline's control flow or scoring logic.
- **Error resilience**: The Telegram send is wrapped in a try/catch; a failed send is logged and does not prevent the pipeline from completing.

## Notes

- The Telegram message format uses the system's existing emoji and copy ("Sin matches hoy"), not PR decoration.
- `job.job_title` is the preferred field with fallback to `job.title` (JSearch's actual field name), consistent with how `formatTelegramMessage` already accesses title.
- To verify: run the pipeline with `SCORE_THRESHOLD` set higher than any scored job's score and confirm a Telegram message arrives with the expected summary.
