# PR-3: Gemini Model Fix + Batch Scoring

## Description

The LinkedIn Job Alerts pipeline was deployed after Phase 2 but produced zero matches on every run. Root cause: the configured model `gemini-3.6-flash` does not exist in Google AI Studio — every Gemini scoring call silently failed or returned a 404-style error, resulting in all jobs receiving a score of 0. No job ever passed the threshold.

Additionally, the scoring implementation called Gemini once per job (~30 individual API calls per pipeline run), which triggered HTTP 429 rate-limiting errors and made the pipeline unreliable even after the model fix.

This PR fixes the model ID, introduces batch scoring (15 jobs per API call), adds a local test harness, and syncs the spec/scaffolding files from the Phase 2 archive.

## Changes Made

### Bug fixes

- `src/config.js` — Changed `GEMINI_MODEL` from `'gemini-3.6-flash'` to `'gemini-3.7-flash'` (the actual free-tier flash model in Google AI Studio). Changed `SCORE_THRESHOLD` from 75 to 75 (was temporarily 70, restored to match ROADMAP target of 75).

### Features

- `src/services.js` — Added `scoreJobsBatch(jobs)` function (lines 177–279) that sends up to 15 jobs in a single Gemini API call using JSON mode with `responseSchema`. Parses the response into a `job_index → score` map and attaches scores to job objects. Includes retry with exponential backoff and fallback to score=0 on failure.
- `src/services.js` — Exported `scoreJobsBatch` in the public API object.

### Pipeline updates

- `src/pipeline.js` — Rewrote `scoreWithGemini(jobs)` (lines 118–142) to split jobs into batches of 15, call `scoreJobsBatch()` per batch, and fall back to `scoreSingleJob()` individually if the batch call fails. Eliminates the 429 rate-limiting path entirely for typical runs.

### Dev tooling

- `test-runner.js` — New local test harness that loads `.env`, bootstraps Apps Script globals, and runs the full pipeline against real APIs in Node.js.

### Configuration

- `.gitignore` — Excludes `node_modules/`, `.env`, and `*.log`.

### Specs and scaffolding

- `openspec/specs/` — 7 domain spec files synced from the Phase 2 archive (`search`, `scoring`, `dedup`, `notion`, `telegram`, `pipeline`, `config`).
- `README.md` — Updated with current project status and usage instructions.
- `ROADMAP.md` — Updated to reflect Phase 2 completion and bugfix session.

## Impact

- **Pipeline now produces matches**: After the model fix and batch scoring, the pipeline successfully scores jobs and surfaces relevant junior full-stack remote positions in Colombia/LATAM.
- **Rate limiting eliminated**: Batching 15 jobs per Gemini call reduces ~30 API calls to ~2 per pipeline run, staying well within the free-tier rate limit.
- **Reliability improved**: Fallback logic (batch → individual scoring → score=0) ensures partial failures don't crash the entire pipeline.
- **Local development enabled**: `test-runner.js` allows running the full pipeline locally without deploying to Apps Script.
- **Backward compatible**: No breaking changes. The public API adds `scoreJobsBatch` alongside the existing `scoreSingleJob`.

## Notes

- **How to test**: Run `node test-runner.js` with a valid `.env` containing `RAPIDAPI_KEY` and `GEMINI_API_KEY`. Pipeline should complete without 429 errors and produce scored jobs above threshold.
- **Known follow-up**: JSearch keyword refinement (broader search terms to increase candidate pool) is saved in Engram under topic `linkedin-job-alerts/keyword-optimization` for a future session.
- **Dependencies**: Requires `RAPIDAPI_KEY` and `GEMINI_API_KEY` set in `.env` for local testing, or in Apps Script Script Properties for deployment.
