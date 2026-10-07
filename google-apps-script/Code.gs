// Google Apps Script for the stock chart experiment.
//
// HOW TO USE: open your Google Sheet > Extensions > Apps Script, delete
// everything in Code.gs there, paste this whole file in, then deploy it
// as a web app (see README.md, "Stage 0", step 2).
//
// The website sends JSON like this:
//   { "sheet": "Test", "batchId": "abc123", "rows": [ { "column": "value", ... } ] }
// Each object in "rows" becomes one row in the tab named "sheet".
// Column headers are created automatically from the keys.
// "batchId" stops the same data being saved twice if the website retries.

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var rows = Array.isArray(data.rows) ? data.rows : [];
    var sheetName = String(data.sheet || 'Data');

    // Skip batches that were already saved (a retry after a slow reply).
    var batchLog = null;
    if (data.batchId) {
      batchLog = ss.getSheetByName('_batches') || ss.insertSheet('_batches');
      var seen = batchLog.createTextFinder(String(data.batchId)).matchEntireCell(true).findNext();
      if (seen) return json({ ok: true, added: 0, duplicate: true });
    }

    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // Read the existing header row, then add any new column names.
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    rows.forEach(function (row) {
      Object.keys(row).forEach(function (key) {
        if (headers.indexOf(key) === -1) headers.push(key);
      });
    });
    if (headers.length > 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    var values = rows.map(function (row) {
      return headers.map(function (h) { return clean(row[h]); });
    });
    if (values.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
    }

    if (batchLog) batchLog.appendRow([String(data.batchId), new Date(), sheetName, values.length]);
    return json({ ok: true, added: values.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Open the web app URL in a browser to check that it is running.
function doGet() {
  return json({ ok: true, message: 'Apps Script is running' });
}

// Text starting with = + - @ would be treated as a formula, so store it as plain text.
function clean(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
