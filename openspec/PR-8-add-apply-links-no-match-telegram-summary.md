# PR-8: Add application links to Telegram no-match summary

## Description

When no job offers score above the `SCORE_THRESHOLD`, the pipeline sends a Telegram message listing all scored offers so the user can see what was evaluated. The previous version only showed job titles and scores, which left the user without a way to manually review offers that might be relevant despite being scored below threshold.

This change adds the `job_apply_link` to each offer entry in the no-match summary message, giving the user a clickable link to open every listed offer on LinkedIn.

## Changes Made

**Bug fixes / Improvements**

- `src/pipeline.js`
  - `sendNoMatchSummary()` now extracts `job_apply_link` from each scored job and appends it on a new line below the title/score.
  - Line separator between entries changed from `\n` to `\n\n` so each offer (title + link) is visually distinct.

## Impact

- The Telegram no-match summary now includes a clickable application link for every scored offer, enabling manual review of below-threshold results.
- No behavioral change when `job_apply_link` is absent or empty -- the line simply renders blank.
- No impact on scoring logic, job fetching, or the happy-path match notifications.

## Notes

- Verify by triggering the pipeline on a day where no offers exceed the threshold and confirming the Telegram message contains clickable links.
- The `job_apply_link` field is already populated by the job-fetching layer (`src/pipeline.js` job normalization); this change only surfaces it in the summary.
