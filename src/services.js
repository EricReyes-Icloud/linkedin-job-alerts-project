/**
 * LinkedIn Job Alerts — Services (thin wrappers)
 *
 * Every Apps Script platform service goes through here so the core pipeline
 * logic stays testable outside of Apps Script. When running on the platform,
 * these call the real APIs; when testing locally, you can mock this object.
 *
 * Usage in pipeline:
 *   var data = Services.fetch(url, options);
 *   var key  = Services.getProperty('RAPIDAPI_KEY');
 */

var Services = (function () {
  'use strict';

  // --- HTTP ---
  function fetch(url, options) {
    return UrlFetchApp.fetch(url, options);
  }

  // --- Properties (secret store) ---
  function getProperty(key) {
    return PropertiesService.getScriptProperties().getProperty(key);
  }

  function setProperty(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, value);
  }

  // --- Logging ---
  function log(message) {
    Logger.log(message);
  }

  // --- Utilities ---
  function sleep(ms) {
    Utilities.sleep(ms);
  }

  function formatDate(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  function getDayOfYear(date) {
    var start = new Date(date.getFullYear(), 0, 0);
    var diff = date - start;
    var oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  // --- Advanced utilities ---
  function fetchWithRetry(url, options, maxRetries, backoffMs) {
    // Sentinel: an explicit 0 means ZERO retries (the caller owns retrying).
    // Only when maxRetries is omitted do we default to 2 internal retries.
    if (maxRetries === undefined) {
      maxRetries = 2;
    }
    backoffMs = backoffMs || 1000;
    var attempt;
    for (attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        var response = fetch(url, options);
        return response;
      } catch (e) {
        var statusCode = e.message ? parseInt(e.message.match(/\d+/)) : 0;
        var isRetryable = (statusCode === 503 || statusCode === 429 || e.message.indexOf('timeout') !== -1);
        if (!isRetryable || attempt > maxRetries) {
          throw e;
        }
        var delay = backoffMs * attempt;
        sleep(delay);
      }
    }
    throw new Error('fetchWithRetry: max retries exceeded');
  }

  function parseJSONWithFenceStrip(text) {
    if (!text) {
      throw new Error('parseJSONWithFenceStrip: empty text');
    }
    var stripped = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    return JSON.parse(stripped);
  }

  /**
   * Coerce a Gemini score value (number or numeric string) to an integer
   * clamped to 0-100. Returns null when the value is not a finite number.
   *
   * @param {*} value - Number or numeric string (e.g. 85 or "85").
   * @return {?number} - Integer in [0, 100], or null when unparseable.
   */
  function toScoreNumber(value) {
    var num = Number(value);
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    if (typeof num !== 'number' || !isFinite(num)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  /**
   * Coerce a Gemini job_index value (number or numeric string) to a
   * non-negative integer. Returns null when it does not parse to a finite
   * integer.
   *
   * @param {*} value - Number or numeric string (e.g. 0 or "0").
   * @return {?number} - Non-negative integer, or null when unparseable.
   */
  function toJobIndex(value) {
    var num = Number(value);
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    if (typeof num !== 'number' || !isFinite(num)) {
      return null;
    }
    var intVal = Math.round(num);
    if (intVal < 0) {
      return null;
    }
    return intVal;
  }

  /**
   * Extract the model's text output from a Gemini :generateContent response.
   *
   * Gemini always wraps the result in:
   *   { candidates: [{ content: { parts: [{ text: "..." }] } }] }
   *
   * This function parses the raw response string, extracts the text from
   * candidates[0].content.parts[0].text (concatenating all parts), and
   * returns it.  If the shape doesn't match the envelope — or if parsing
   * fails — the original raw text is returned unchanged so that any
   * direct-JSON path still works.
   *
   * @param {string} rawText  - The raw HTTP response body from Gemini.
   * @return {string}         - The model's generated text, or rawText as-is.
   */
  function extractGeminiText(rawText) {
    try {
      var parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          parsed.candidates && Array.isArray(parsed.candidates) &&
          parsed.candidates.length > 0) {
        var candidate = parsed.candidates[0];
        var parts = candidate && candidate.content && candidate.content.parts;
        if (parts && Array.isArray(parts) && parts.length > 0) {
          var texts = [];
          for (var i = 0; i < parts.length; i++) {
            if (parts[i] && typeof parts[i].text === 'string') {
              texts.push(parts[i].text);
            }
          }
          if (texts.length > 0) {
            return texts.join('');
          }
        }
      }
      // Shape didn't match the envelope — fall through
      return rawText;
    } catch (e) {
      // Not valid JSON — return as-is
      return rawText;
    }
  }

  function normalizeUrl(url) {
    if (!url) {
      log('normalizeUrl: null or empty URL');
      return null;
    }
    var withoutQuery = url.split('?')[0];
    var normalized = withoutQuery.replace(/\/$/, '');
    return normalized;
  }

  // --- API Clients ---

  /**
   * Build a JSearch /search-v2 query string for a keyword.
   *
   * @param {string} keyword  - The search keyword(s).
   * @param {boolean} strict  - true  → all restrictive filters (FULLTIME,
   *                            under-3-years, no-experience, week).
   *                            false → relaxed (drop employment_types and
   *                            job_requirements, widen date_posted to month).
   *                            country=co and work_from_home=true are always
   *                            kept (core user requirements).
   * @returns {string} Full query string (without the leading '?').
   */
  function buildJSearchQuery(keyword, strict) {
    var base = 'query=' + encodeURIComponent(keyword) +
      '&page=1&num_pages=1' +
      '&country=co&work_from_home=true';

    if (strict) {
      return base +
        '&date_posted=week' +
        '&job_requirements=under_3_years_experience,no_experience' +
        '&employment_types=FULLTIME';
    }

    // Relaxed: drop job_requirements and employment_types,
    // widen date_posted from week → month.
    return base + '&date_posted=month';
  }

  /**
   * Parse the raw JSearch response and extract the jobs array.
   * Logs explicit warnings for API errors or malformed responses.
   *
   * @param {string} rawText - The raw HTTP response body.
   * @returns {Array} Array of job objects (may be empty).
   */
  function parseJSearchResponse(rawText) {
    var data = JSON.parse(rawText);

    if (data && data.status && data.status !== 'OK') {
      log('[STEP 2] JSearch API status=' + data.status +
        (data.error ? ' error=' + data.error : ''));
    }

    var jobs = [];
    if (data && data.data && data.data.jobs) {
      jobs = data.data.jobs;
    }
    return jobs;
  }

  function fetchFromJSearch(keyword, location) {
    try {
      var endpoint = CONFIG.JSEARCH_ENDPOINT;
      var host = CONFIG.JSEARCH_HOST;
      var apiKey = getProperty('RAPIDAPI_KEY');
      var options = {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': host
        }
      };

      var useStrictFirst = CONFIG.JSEARCH_STRICT_FIRST !== false;

      // --- Pass 1: strict filters (or relaxed if strict is disabled) ---
      var strictQuery = buildJSearchQuery(keyword, true);
      var url = endpoint + '?' + strictQuery;
      var response = fetchWithRetry(url, options);
      var jobs = parseJSearchResponse(response.getContentText());

      if (jobs.length > 0 || !useStrictFirst) {
        log('[STEP 2] keyword="' + keyword + '" strict returned ' + jobs.length + ' jobs');
        return jobs;
      }

      // --- Pass 2: relaxed fallback (strict yielded 0 and toggle is on) ---
      log('[STEP 2] keyword="' + keyword + '" strict returned 0 jobs, trying relaxed filters');
      var relaxedQuery = buildJSearchQuery(keyword, false);
      var relaxedUrl = endpoint + '?' + relaxedQuery;
      response = fetchWithRetry(relaxedUrl, options);
      jobs = parseJSearchResponse(response.getContentText());

      log('[STEP 2] keyword="' + keyword + '" relaxed returned ' + jobs.length + ' jobs');
      return jobs;

    } catch (e) {
      log('[STEP 2] ERROR: JSearch fetch — keyword="' + keyword + '": ' + e.message);
      return [];
    }
  }

  function preFilterJobs(jobs) {
    // Guard: if config missing, return input unchanged
    if (!(CONFIG.SENIORITY_EXCLUDE instanceof RegExp)) {
      Services.log('Step 3.5 — SENIORITY_EXCLUDE not a RegExp, skipping title exclusion');
    }
    if (!Array.isArray(CONFIG.TECH_STACK_KEYWORDS)) {
      Services.log('Step 3.5 — TECH_STACK_KEYWORDS not an array, retaining all jobs');
      return jobs;
    }

    var excluded = [];
    var retained = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var title = (job.job_title || '').toLowerCase();
      var desc = (job.job_description || '').toLowerCase();
      var text = title + ' ' + desc;
      // 1. Seniority exclusion (only if regex is valid)
      if (CONFIG.SENIORITY_EXCLUDE instanceof RegExp && CONFIG.SENIORITY_EXCLUDE.test(title)) {
        excluded.push({ job: job, reason: 'seniority' });
        continue;
      }
      // 2. Tech-stack inclusion (require >=1 match)
      var hasTech = CONFIG.TECH_STACK_KEYWORDS.some(function(kw) {
        return text.indexOf(kw.toLowerCase()) !== -1;
      });
      if (!hasTech) {
        excluded.push({ job: job, reason: 'no_tech_match' });
        continue;
      }
      retained.push(job);
    }
    if (excluded.length > 0) {
      Services.log('Step 3.5 — excluded ' + excluded.length + ' jobs: ' +
        excluded.map(function(e) { return '"' + e.job.job_title + '" (' + e.reason + ')'; }).join(', '));
    }
    return retained;
  }

  /**
   * Extract a short scoring-oriented summary of a job description.
   * Preserves signal Gemini needs (tech keywords, seniority, work mode,
   * role type, location) while keeping the payload small.
   * Does NOT mutate job.job_description — the original stays intact.
   */
  function summarizeDescriptionForScoring(job) {
    var description = job.job_description;
    if (!description) {
      return 'No description';
    }

    var scoringKeywords = [
      'javascript', 'typescript', 'react', 'node', 'express', 'firebase', 'mysql',
      'html', 'css', 'python', 'php', 'vue', 'angular', 'next', 'docker', 'aws',
      'git', 'sql', 'nosql', 'mongodb', 'graphql',
      'junior', 'mid-level', 'entry', 'experience', 'years',
      'remote', 'work from home', 'hybrid', 'onsite', 'on-site', 'wfh',
      'full stack', 'fullstack', 'full-stack', 'backend', 'front-end', 'frontend',
      'colombia', 'latam', 'latin america'
    ];

    // Split into chunks: newlines first, then sentences within long chunks
    var rawChunks = description.split('\n');
    var sentences = [];
    var i, p;
    for (i = 0; i < rawChunks.length; i++) {
      var chunk = rawChunks[i].trim();
      if (!chunk) { continue; }
      if (chunk.length > 150) {
        var parts = chunk.split('. ');
        for (p = 0; p < parts.length; p++) {
          if (parts[p].trim()) {
            sentences.push(parts[p].trim());
          }
        }
      } else {
        sentences.push(chunk);
      }
    }

    var matched = [];
    var j, k;
    for (j = 0; j < sentences.length; j++) {
      var lower = sentences[j].toLowerCase();
      for (k = 0; k < scoringKeywords.length; k++) {
        if (lower.indexOf(scoringKeywords[k]) !== -1) {
          matched.push(sentences[j]);
          break;
        }
      }
    }

    if (matched.length > 0) {
      var result = matched.join(' ');
      if (result.length > 600) {
        return result.substring(0, 600);
      }
      return result;
    }

    // Fallback: bounded prefix when no keyword matches
    return description.substring(0, 600);
  }

  function scoreSingleJob(job) {
    var geminiApiKey = getProperty('GEMINI_API_KEY');
    var model = CONFIG.GEMINI_MODEL;
    var endpoint = CONFIG.GEMINI_ENDPOINT + model + ':generateContent?key=' + geminiApiKey;
    var jobText = 'Title: ' + job.job_title + '\nCompany: ' + (job.company_name || 'Unknown') + '\nDescription: ' + summarizeDescriptionForScoring(job);
    var prompt = jobText + '\n\nOwner Profile: ' + CONFIG.OWNER_PROFILE +
      '\n\nScoring criteria (score 0-100, higher = better match):' +
      '\n- Junior level match (0-3 years experience required)' +
      '\n- Remote/work-from-home availability' +
      '\n- Tech stack alignment: React, JavaScript, Node.js, Express, Firebase, MySQL' +
      '\n- Colombia/LATAM relevance' +
      '\n- Full stack role (not backend-only or frontend-only)' +
      '\n\nScore this job match 0-100 based on relevance to the owner profile.';
    var requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { score: { type: 'INTEGER' } },
          required: ['score']
        }
      }
    };
    var options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody)
    };
    var maxRetries = CONFIG.GEMINI_MAX_RETRIES;
    var backoffMs = CONFIG.GEMINI_RETRY_DELAY_MS;
    var attempt;
    for (attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        var response = fetchWithRetry(endpoint, options, 0);
        var responseText = response.getContentText();
        var extracted = extractGeminiText(responseText);
        var parsed = parseJSONWithFenceStrip(extracted);
        var coercedScore = toScoreNumber(parsed.score);
        var score = (coercedScore === null) ? 0 : coercedScore;
        job.score = score;
        log('Scored job "' + job.job_title + '": ' + score);
        return job;
      } catch (e) {
        if (attempt < maxRetries) {
          var delay = backoffMs * attempt;
          sleep(delay);
        } else {
          log('[STEP 4] ERROR: Gemini scoring — job="' + job.job_title + '": ' + e.message);
          job.score = 0;
          return job;
        }
      }
    }
  }

  function scoreJobsBatch(jobs) {
    if (!jobs || jobs.length === 0) {
      return jobs || [];
    }

    var geminiApiKey = getProperty('GEMINI_API_KEY');
    var model = CONFIG.GEMINI_MODEL;
    var endpoint = CONFIG.GEMINI_ENDPOINT + model + ':generateContent?key=' + geminiApiKey;

    // Build numbered job list for the prompt
    var jobLines = '';
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      jobLines += (i + 1) + '. Title: ' + (j.job_title || 'Unknown') +
        '\n   Company: ' + (j.company_name || 'Unknown') +
        '\n   Description: ' + summarizeDescriptionForScoring(j) + '\n\n';
    }

    var prompt = 'Owner Profile: ' + CONFIG.OWNER_PROFILE +
      '\n\nScoring criteria (score 0-100, higher = better match):' +
      '\n- Junior level match (0-3 years experience required)' +
      '\n- Remote/work-from-home availability' +
      '\n- Tech stack alignment: React, JavaScript, Node.js, Express, Firebase, MySQL' +
      '\n- Colombia/LATAM relevance' +
      '\n- Full stack role (not backend-only or frontend-only)' +
      '\n\nYou must score EVERY job in the list. Do not skip any.' +
      '\n\nJobs to score:\n' + jobLines +
      '\nReturn a JSON array with exactly ' + jobs.length + ' objects, one per job, using job_index matching the 0-based position above.' +
      '\nFormat: [{"job_index": 0, "score": N}, {"job_index": 1, "score": N}, ...]';

    var requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              job_index: { type: 'INTEGER' },
              score: { type: 'INTEGER' }
            },
            required: ['job_index', 'score']
          }
        }
      }
    };

    var options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody)
    };

    var maxRetries = CONFIG.GEMINI_MAX_RETRIES;
    var backoffMs = CONFIG.GEMINI_RETRY_DELAY_MS;
    var attempt;
    var rawLogged = false;

    for (attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        var response = fetchWithRetry(endpoint, options, 0);
        var responseText = response.getContentText();
        if (!rawLogged) {
          log('[STEP 4] Gemini raw response (truncated): ' + responseText.substring(0, 300));
          rawLogged = true;
        }
        var extracted = extractGeminiText(responseText);
        var parsed = parseJSONWithFenceStrip(extracted);

        // parsed may be the array directly, or wrapped in {scores: [...]}
        var scoresArray = Array.isArray(parsed) ? parsed : (parsed.scores || parsed.results || []);

        // Build a lookup by job_index
        var scoreMap = {};
        for (var k = 0; k < scoresArray.length; k++) {
          var entry = scoresArray[k];
          var entryIndex = (entry && typeof entry === 'object') ? toJobIndex(entry.job_index) : null;
          var entryScore = (entry && typeof entry === 'object') ? toScoreNumber(entry.score) : null;
          if (entryIndex !== null && entryScore !== null) {
            scoreMap[entryIndex] = entryScore;
          } else {
            log('Score entry skipped (bad index/score): ' + JSON.stringify(entry));
          }
        }

        // Attach scores to job objects (fallback to 0 if missing)
        for (var m = 0; m < jobs.length; m++) {
          var score = scoreMap[m];
          if (typeof score !== 'number') {
            score = 0;
          }
          jobs[m].score = score;
          log('Batch scored job "' + (jobs[m].job_title || 'Unknown') + '": ' + score);
        }

        return jobs;

      } catch (e) {
        if (attempt < maxRetries) {
          var delay = backoffMs * attempt;
          sleep(delay);
        } else {
          log('[STEP 4] ERROR: Gemini batch scoring (batch size=' + jobs.length + '): ' + e.message);
          // Set all scores to 0 as fallback
          for (var n = 0; n < jobs.length; n++) {
            jobs[n].score = 0;
          }
          return jobs;
        }
      }
    }
  }

  function notionQueryDatabase(databaseId) {
    var notionToken = getProperty('NOTION_TOKEN');
    var notionVersion = CONFIG.NOTION_API_VERSION;
    var endpoint = CONFIG.NOTION_ENDPOINT + 'databases/' + databaseId + '/query';
    var options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + notionToken,
        'Notion-Version': notionVersion,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({})
    };
    var allUrls = [];
    var hasMore = true;
    var startCursor = undefined;
    while (hasMore) {
      var body = {};
      if (startCursor) {
        body.start_cursor = startCursor;
      }
      options.payload = JSON.stringify(body);
      var response = fetchWithRetry(endpoint, options);
      var data = JSON.parse(response.getContentText());
      var pages = data.results || [];
      for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        if (page.properties && page.properties.Link && page.properties.Link.url) {
          var normalized = normalizeUrl(page.properties.Link.url);
          if (normalized) {
            allUrls.push(normalized);
          }
        }
      }
      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }
    return allUrls;
  }

  function notionCreatePage(databaseId, job) {
    var notionToken = getProperty('NOTION_TOKEN');
    var notionVersion = CONFIG.NOTION_API_VERSION;
    var endpoint = CONFIG.NOTION_ENDPOINT + 'pages';
    var truncatedDesc = job.job_description ? job.job_description.substring(0, CONFIG.DESCRIPTION_MAX_CHARS) : '';
    var properties = {
      'Nombre': { title: [{ text: { content: job.job_title } }] },
      'Empresa': { rich_text: [{ text: { content: job.company_name || '' } }] },
      'Link': { url: job.job_apply_link },
      'Score': { number: job.score },
      'Fuente': { select: { name: job.publisher || 'Unknown' } },
      'Descripción': { rich_text: [{ text: { content: truncatedDesc } }] },
      'Estado': { select: { name: 'Nueva' } },
      'Keyword': { rich_text: [{ text: { content: job.keyword } }] }
    };
    if (job.job_posting_datetime) {
      properties['Fecha publicación'] = { date: { start: job.job_posting_datetime } };
    }
    var requestBody = {
      parent: { database_id: databaseId },
      properties: properties
    };
    var options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + notionToken,
        'Notion-Version': notionVersion,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(requestBody)
    };
    var response = fetch(endpoint, options);
    return JSON.parse(response.getContentText());
  }

  function telegramSendMessage(chatId, text) {
    if (!chatId || !text) {
      log('TELEGRAM_MISSING_CREDENTIALS: chat_id or text missing');
      return null;
    }
    var botToken = getProperty('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      log('TELEGRAM_MISSING_CREDENTIALS: bot token not configured');
      return null;
    }
    var endpoint = CONFIG.TELEGRAM_ENDPOINT + botToken + '/sendMessage';
    var requestBody = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    };
    var options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody)
    };
    var response = fetch(endpoint, options);
    return JSON.parse(response.getContentText());
  }

  // --- Public API ---
  return {
    fetch: fetch,
    getProperty: getProperty,
    setProperty: setProperty,
    log: log,
    sleep: sleep,
    formatDate: formatDate,
    getDayOfYear: getDayOfYear,
    fetchWithRetry: fetchWithRetry,
    parseJSONWithFenceStrip: parseJSONWithFenceStrip,
    normalizeUrl: normalizeUrl,
    fetchFromJSearch: fetchFromJSearch,
    preFilterJobs: preFilterJobs,
    scoreSingleJob: scoreSingleJob,
    scoreJobsBatch: scoreJobsBatch,
    notionQueryDatabase: notionQueryDatabase,
    notionCreatePage: notionCreatePage,
    telegramSendMessage: telegramSendMessage
  };
})();
