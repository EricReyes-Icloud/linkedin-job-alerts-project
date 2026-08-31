/**
 * LinkedIn Job Alerts — Local Test Runner
 *
 * Simulates Apps Script globals so the pipeline (src/pipeline.js, src/services.js,
 * src/config.js) can run in Node.js against real APIs.
 *
 * Usage: node test-runner.js
 *
 * NOTE: Files are loaded via eval() to replicate Apps Script's flat global scope.
 * This gives poorer stack traces than require(), but matches the target runtime
 * where every file shares a single global scope and there is no module system.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// 1. Load .env (with quote stripping)
// ---------------------------------------------------------------------------
function loadEnv() {
  var envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found. Create it with your API keys.');
    process.exit(1);
  }
  var content = fs.readFileSync(envPath, 'utf8');
  var lines = content.split('\n').filter(function(l) { return l.trim() && !l.startsWith('#'); });
  lines.forEach(function(line) {
    var eqIndex = line.indexOf('=');
    if (eqIndex === -1) return;
    var key = line.substring(0, eqIndex).trim();
    var value = line.substring(eqIndex + 1).trim();
    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnv();

// ---------------------------------------------------------------------------
// 2. Mock Apps Script globals
// ---------------------------------------------------------------------------

// --- PropertiesService (wraps process.env) ---
var PropertiesService = {
  getScriptProperties: function() {
    return {
      getProperty: function(key) {
        return process.env[key] || null;
      },
      setProperty: function(key, value) {
        process.env[key] = value;
      }
    };
  }
};

// --- Utilities (real synchronous sleep via sleep(1)) ---
var Utilities = {
  sleep: function(ms) {
    try {
      execSync('sleep ' + (ms / 1000), { stdio: 'ignore' });
    } catch (e) {
      // Fallback to busy-wait if sleep command fails
      var end = Date.now() + ms;
      while (Date.now() < end) {}
    }
  },
  formatDate: function(date, tz, format) {
    return date.toISOString().split('T')[0];
  }
};

// --- Session ---
var Session = {
  getScriptTimeZone: function() {
    return 'America/Bogota';
  }
};

// --- Logger ---
var Logger = {
  log: function(msg) {
    console.log(msg);
  }
};

// --- UrlFetchApp (SYNCHRONOUS via curl) ---
// Apps Script's UrlFetchApp.fetch is blocking. We use curl via execSync
// to get the same synchronous behavior: the call blocks until the HTTP
// response arrives, and returns an object with .getContentText() and
// .getResponseCode() just like the real platform.
var UrlFetchApp = {
  fetch: function(url, options) {
    options = options || {};
    var method = (options.method || 'GET').toUpperCase();
    var headers = options.headers || {};

    // Merge options.contentType into headers (Apps Script convention)
    if (options.contentType && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = options.contentType;
    }

    // Build curl command as a single string for execSync.
    // Include a real network read timeout (-m/--max-time) so a hanging server
    // aborts at the HTTP layer instead of blocking until execSync kills the
    // process (120000ms). Configurable via CURL_MAX_TIME, default 30s.
    var curlMaxTime = process.env.CURL_MAX_TIME || 30;
    var cmd = 'curl -s -S -L -m ' + curlMaxTime + ' -w "\\n%{http_code}" -X ' + method;

    // Add headers
    var headerKeys = Object.keys(headers);
    for (var i = 0; i < headerKeys.length; i++) {
      var key = headerKeys[i];
      var value = String(headers[key]);
      // Escape single quotes for shell safety
      var safeKey = key.replace(/'/g, "'\\''");
      var safeVal = value.replace(/'/g, "'\\''");
      cmd += " -H '" + safeKey + ': ' + safeVal + "'";
    }

    // Write POST/PUT/PATCH body to a temp file to avoid shell escaping issues
    var tmpFile = null;
    if (options.payload) {
      tmpFile = path.join(os.tmpdir(), 'curl_body_' + process.pid + '_' + Date.now() + '.json');
      fs.writeFileSync(tmpFile, options.payload);
      cmd += ' -d @' + tmpFile;
    }

    cmd += " '" + url + "'";

    try {
      var result = execSync(cmd, { encoding: 'utf8', timeout: 120000 });
      // curl -w appends "\n<http_code>" at the end of the output
      var lines = result.split('\n');
      var httpCode = parseInt(lines.pop(), 10);
      var body = lines.join('\n');

      if (httpCode >= 400) {
        throw new Error('HTTP ' + httpCode + ': ' + body.substring(0, 500));
      }

      return {
        getContentText: function() { return body; },
        getResponseCode: function() { return httpCode; }
      };
    } finally {
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore cleanup errors */ }
      }
    }
  }
};

// ---------------------------------------------------------------------------
// 3. Load project files via eval (see file header comment for rationale)
// ---------------------------------------------------------------------------
eval(fs.readFileSync(path.join(__dirname, 'src', 'config.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'src', 'services.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'src', 'pipeline.js'), 'utf8'));

// ---------------------------------------------------------------------------
// 4. Override isExecutionDay for testing
//    The pipeline exits on odd days (parity gate). Today may be odd, so we
//    force it to always return true. Comment this block out to test the
//    parity gate itself.
// ---------------------------------------------------------------------------
var _originalIsExecutionDay = isExecutionDay;
isExecutionDay = function() {
  console.log('[TEST] Parity gate bypassed — forcing execution');
  return true;
};

// ---------------------------------------------------------------------------
// 5. Run the pipeline
// ---------------------------------------------------------------------------
console.log('=== LinkedIn Job Alerts — Local Test ===');
console.log('Date:', new Date().toISOString());
console.log('Day of year:', Services.getDayOfYear(new Date()));
console.log('');

runPipeline();
