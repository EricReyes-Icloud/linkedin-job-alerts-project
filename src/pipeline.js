/**
 * LinkedIn Job Alerts — Pipeline
 *
 * Six logical steps executed sequentially on every trigger fire.
 * On odd days the pipeline exits immediately (zero API calls spent).
 *
 * Step mapping:
 *   1. Parity gate
 *   2. Fetch jobs from JSearch via RapidAPI
 *   3. Normalize links + dedup against Notion history
 *   4. Score each new offer with Gemini
 *   5. Filter: keep score >= SCORE_THRESHOLD
 *   6. Create Notion page + send Telegram notification
 */

function runPipeline() {
  'use strict';
  Services.log('=== Pipeline start ===');

  // --- Step 1: Parity gate ---
  if (!isExecutionDay()) {
    Services.log('Odd day — exiting early (zero API calls)');
    return;
  }

  // --- Step 2: Fetch jobs from JSearch ---
  var rawJobs = fetchJobsFromJSearch();
  Services.log('Step 2 — fetched ' + rawJobs.length + ' raw jobs');

  if (rawJobs.length === 0) {
    Services.log('No jobs fetched — pipeline finished');
    return;
  }

  // --- Step 3: Normalize + dedup ---
  var newJobs = dedupAgainstNotion(rawJobs);
  Services.log('Step 3 — ' + newJobs.length + ' new jobs after dedup');

  if (newJobs.length === 0) {
    Services.log('All jobs already in Notion — pipeline finished');
    return;
  }

  // --- Step 3.5: Pre-filter (new) ---
  var filteredJobs = Services.preFilterJobs(newJobs);
  Services.log('Step 3.5 — ' + filteredJobs.length + ' jobs after pre-filter');
  if (filteredJobs.length === 0) {
    Services.log('All jobs filtered out — pipeline finished');
    return;
  }

  // --- Step 4: Score with Gemini ---
  var scoredJobs = scoreWithGemini(filteredJobs);
  Services.log('Step 4 — scored ' + scoredJobs.length + ' jobs');

  // --- Step 5: Filter by threshold ---
  var matches = filterByScore(scoredJobs);
  Services.log('Step 5 — ' + matches.length + ' matches above threshold');

  if (matches.length === 0) {
    Services.log('No matches — pipeline finished');
    return;
  }

  // --- Step 6: Store + notify ---
  sendNotifications(matches);
  Services.log('=== Pipeline complete — ' + matches.length + ' notifications sent ===');
}

// ---------------------------------------------------------------------------
// Step helpers — stubs to be implemented in Phase 2
// ---------------------------------------------------------------------------

function isExecutionDay() {
  var today = new Date();
  var dayOfYear = Services.getDayOfYear(today);
  return dayOfYear % 2 === 0;
}

function fetchJobsFromJSearch() {
  var allJobs = [];
  for (var i = 0; i < CONFIG.KEYWORDS.length; i++) {
    var keyword = CONFIG.KEYWORDS[i];
    try {
      var results = Services.fetchFromJSearch(keyword, CONFIG.LOCATION);
      // Tag each result with originating keyword
      results.forEach(function(job) { job.keyword = keyword; });
      allJobs = allJobs.concat(results);
    } catch (e) {
      Services.log('[STEP 2] ERROR: JSearch fetch — keyword="' + keyword + '": ' + e.message);
      // Continue with other keywords (non-fatal)
    }
  }
  return allJobs;
}

function dedupAgainstNotion(jobs) {
  // 1. Batch dedup: normalize URLs, keep first occurrence
  var seen = {};
  var batchDeduped = [];
  jobs.forEach(function(job) {
    var normalized = Services.normalizeUrl(job.job_apply_link);
    if (normalized && !seen[normalized]) {
      seen[normalized] = true;
      batchDeduped.push(job);
    }
  });

  // 2. Notion history dedup (non-fatal on API failure)
  var existingUrls = [];
  try {
    existingUrls = Services.notionQueryDatabase(Services.getProperty('NOTION_DB_ID'));
  } catch (e) {
    Services.log('[STEP 3] ERROR: Notion query failed — proceeding with batch-only dedup: ' + e.message);
  }

  var existingSet = {};
  existingUrls.forEach(function(url) { existingSet[url] = true; });

  return batchDeduped.filter(function(job) {
    var normalized = Services.normalizeUrl(job.job_apply_link);
    return !existingSet[normalized];
  });
}

function scoreWithGemini(jobs) {
  var BATCH_SIZE = 15;
  var allScored = [];

  for (var i = 0; i < jobs.length; i += BATCH_SIZE) {
    var batch = jobs.slice(i, i + BATCH_SIZE);
    try {
      Services.scoreJobsBatch(batch);
    } catch (e) {
      Services.log('[STEP 4] ERROR: Gemini batch scoring — batch #' + Math.floor(i / BATCH_SIZE) + ': ' + e.message);
      // Fallback: score each job in this batch individually
      batch.forEach(function(job) {
        try {
          Services.scoreSingleJob(job);
        } catch (e2) {
          Services.log('[STEP 4] ERROR: Gemini fallback scoring — job="' + (job.job_title || 'Unknown') + '": ' + e2.message);
          job.score = 0;
        }
      });
    }
    allScored = allScored.concat(batch);
  }

  return allScored;
}

function filterByScore(jobs) {
  return jobs.filter(function (job) {
    return job.score >= CONFIG.SCORE_THRESHOLD;
  });
}

function sendNotifications(matches) {
  var sent = 0;
  matches.forEach(function(job) {
    try {
      Services.notionCreatePage(Services.getProperty('NOTION_DB_ID'), job);
      Services.telegramSendMessage(
        Services.getProperty('TELEGRAM_CHAT_ID'),
        formatTelegramMessage(job)
      );
      sent++;
    } catch (e) {
      Services.log('[STEP 6] ERROR: Notification — job="' + job.title + '": ' + e.message);
    }
  });
  return sent;
}

function formatTelegramMessage(job) {
  return '🎯 Nueva oferta con match (' + job.score + '/100)\n\n' +
    job.title + ' en ' + (job.company_name || 'Unknown') + '\n\n' +
    job.job_apply_link;
}
