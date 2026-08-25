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
    maxRetries = maxRetries || 2;
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
  function fetchFromJSearch(keyword, location) {
    try {
      var endpoint = CONFIG.JSEARCH_ENDPOINT;
      var host = CONFIG.JSEARCH_HOST;
      var apiKey = getProperty('RAPIDAPI_KEY');
      var url = endpoint + '?query=' + encodeURIComponent(keyword) + '&page=1&num_pages=1&date_posted=week&country=co&work_from_home=true';
      var options = {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': host
        }
      };
      var response = fetchWithRetry(url, options);
      var rawText = response.getContentText();
      var data = JSON.parse(rawText);
      var jobs = [];
      if (data && data.data && data.data.jobs) {
        jobs = data.data.jobs;
      }
      return jobs;
    } catch (e) {
      log('[STEP 2] ERROR: JSearch fetch — keyword="' + keyword + '": ' + e.message);
      return [];
    }
  }

  function scoreSingleJob(job) {
    var geminiApiKey = getProperty('GEMINI_API_KEY');
    var model = CONFIG.GEMINI_MODEL;
    var endpoint = CONFIG.GEMINI_ENDPOINT + model + ':generateContent?key=' + geminiApiKey;
    var jobText = 'Title: ' + job.job_title + '\nCompany: ' + (job.company_name || 'Unknown') + '\nDescription: ' + (job.job_description || 'No description');
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
        var parsed = parseJSONWithFenceStrip(responseText);
        var score = parsed.score;
        if (typeof score !== 'number') {
          score = 0;
        }
        score = Math.max(0, Math.min(100, Math.round(score)));
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
        '\n   Description: ' + (j.job_description || 'No description') + '\n\n';
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

    for (attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        var response = fetchWithRetry(endpoint, options, 0);
        var responseText = response.getContentText();
        var parsed = parseJSONWithFenceStrip(responseText);

        // parsed may be the array directly, or wrapped in {scores: [...]}
        var scoresArray = Array.isArray(parsed) ? parsed : (parsed.scores || parsed.results || []);

        // Build a lookup by job_index
        var scoreMap = {};
        for (var k = 0; k < scoresArray.length; k++) {
          var entry = scoresArray[k];
          if (typeof entry.job_index === 'number' && typeof entry.score === 'number') {
            scoreMap[entry.job_index] = Math.max(0, Math.min(100, Math.round(entry.score)));
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
    scoreSingleJob: scoreSingleJob,
    scoreJobsBatch: scoreJobsBatch,
    notionQueryDatabase: notionQueryDatabase,
    notionCreatePage: notionCreatePage,
    telegramSendMessage: telegramSendMessage
  };
})();
