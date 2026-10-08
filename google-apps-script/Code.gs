// Google Apps Script for the stock chart experiment.
//
// HOW TO USE: open your Google Sheet > Extensions > Apps Script, delete
// everything in Code.gs there, paste this whole file in, then deploy it
// as a web app (see README.md, "Step 1").
//
// The website sends JSON like this (several tabs at once):
//   { "batchId": "abc123",
//     "sheets": { "Actions": [ { "column": "value", ... } ], "Summary": [ ... ] } }
// or the older form (one tab):
//   { "sheet": "Test", "batchId": "abc123", "rows": [ { "column": "value", ... } ] }
// Each object in a row list becomes one row in the tab with that name.
// Tabs and column headers are created automatically from the keys.
// "batchId" stops the same data being saved twice if the website retries.

// Leave this empty if you opened Apps Script from the sheet (Extensions >
// Apps Script). If you made the script at script.google.com instead, paste
// the sheet's ID here: the long part of the sheet's address between /d/ and /edit.
var SHEET_ID = '';

function doPost(e) {
  // Only one request writes at a time, so rows from two iPads never mix.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, error: 'The sheet is busy. Try again.' });
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();

    // Turn both formats into one { tabName: rows } map.
    var sheets = {};
    if (data.sheets && typeof data.sheets === 'object') {
      sheets = data.sheets;
    } else {
      sheets[String(data.sheet || 'Data')] = data.rows;
    }

    // Skip batches that were already saved (a retry after a slow reply).
    // Batch IDs are kept in column A of the "_batches" tab.
    var batchId = data.batchId ? String(data.batchId) : '';
    var batchLog = null;
    if (batchId) {
      batchLog = ss.getSheetByName('_batches') || ss.insertSheet('_batches');
      var seen = batchLog.getRange('A:A').createTextFinder(batchId).matchEntireCell(true).findNext();
      if (seen) return json({ ok: true, added: 0, duplicate: true });
    }

    // First prepare every tab, then write. If something is wrong with the
    // data, the error happens before anything is written.
    var names = Object.keys(sheets);
    var jobs = names.map(function (name) {
      var rows = Array.isArray(sheets[name]) ? sheets[name] : [];
      return prepare(ss, name, rows);
    });
    var added = 0;
    jobs.forEach(function (job) {
      write(job);
      added += job.values.length;
    });

    // Record the batch once, after all of its tabs are written.
    if (batchLog) batchLog.appendRow([clean(batchId), new Date(), clean(names.join(', ')), added]);
    return json({ ok: true, added: added });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Works out the header row and the cell values for one tab.
function prepare(ss, name, rows) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  // Read the existing header row, then add any new column names.
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (key) {
      if (headers.indexOf(key) === -1) headers.push(key);
    });
  });
  var values = rows.map(function (row) {
    return headers.map(function (h) { return clean(row[h]); });
  });
  return { sheet: sheet, headers: headers, values: values };
}

// Writes the header row and appends the new rows below the existing ones.
// Column names go through clean() too, so a name like "=IMAGE(...)" is
// stored as text and never runs as a formula.
function write(job) {
  if (job.headers.length > 0) job.sheet.getRange(1, 1, 1, job.headers.length).setValues([job.headers.map(clean)]);
  if (job.values.length > 0) {
    job.sheet.getRange(job.sheet.getLastRow() + 1, 1, job.values.length, job.headers.length).setValues(job.values);
  }
}

// Open the web app URL in a browser to check that it is running.
function doGet() {
  return json({ ok: true, message: 'Apps Script is running' });
}

// Makes one value safe to put in a cell.
function clean(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') value = JSON.stringify(value); // lists or objects: store as text
  // Text is stored exactly as text: the ' in front stops Sheets from running
  // it as a formula (=, +, -, @) or changing it ("007" -> 7, "1/2" -> a date).
  // The ' itself is not saved in the cell. Numbers stay numbers.
  if (typeof value === 'string' && value !== '') return "'" + value;
  return value;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
