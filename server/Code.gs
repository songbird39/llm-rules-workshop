/**
 * LLM 학습 규칙 설계 워크샵 — 응답 수집 백엔드
 * Google Apps Script web app. Appends every autosave/submit to a sheet.
 *
 * SETUP
 *  1. Create a Google Sheet. Extensions ▸ Apps Script.
 *  2. Replace Code.gs with this file. Save.
 *  3. Deploy ▸ New deployment ▸ type "Web app"
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Copy the /exec URL and paste it into the workshop page
 *     (SYNC_URL in the source, or window.WORKSHOP_SYNC_URL in index.html,
 *      or open the page as  ...?sync=<url>  ).
 *  5. Any time you change this script you must Deploy ▸ Manage deployments ▸ Edit ▸ Version: New.
 */

var SHEET_NAME = 'responses';
var HEADERS = ['receivedAt', 'participant', 'kind', 'queuedAt', 'step', 'selectedRules', 'combinations', 'annotations', 'arrows', 'json'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var p = body.payload || {};
    sheet_().appendRow([
      new Date(),
      body.participant || p.participant || '',
      body.kind || '',
      body.queuedAt || '',
      p.step || '',
      summarize_(p.selectedRules, function (r) { return r.category + ': ' + r.title; }),
      summarize_(p.combinations, function (c) { return '#' + c.index + ' ' + (c.cards || []).map(function (x) { return x.type + '/' + x.title; }).join(' → '); }),
      summarize_(p.annotations, function (n) { return n.text; }),
      summarize_(p.arrows, function (a) { return (a.from && a.from.title) + ' → ' + (a.to && a.to.title); }),
      JSON.stringify(body)
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Health check + cross-device read + admin roster.
 *  ?participant=P01&callback=fn  → JSONP: fn({ok:true, state:{…}})
 *  ?list=1&callback=fn           → JSONP: fn({ok:true, participants:[…]})
 *  (no params)                    → {ok:true, rows:N}
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  if (p.list) {
    out = { ok: true, participants: roster_() };
  } else if (p.participant) {
    out = { ok: true, participant: p.participant, state: latestState_(p.participant) };
  } else {
    out = { ok: true, rows: Math.max(0, sheet_().getLastRow() - 1) };
  }
  if (p.callback) {
    return ContentService
      .createTextOutput(p.callback + '(' + JSON.stringify(out) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(out);
}

/** One row per participant seen in the sheet, newest activity first.
 *  Feeds the admin view-mode roster. Read-only: touches nothing.
 */
function roster_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 3).getValues(); // receivedAt, participant, kind
  var map = {}, order = [];
  for (var i = 0; i < vals.length; i++) {
    var pid = String(vals[i][1] || '').trim();
    if (!pid) continue;
    if (!map[pid]) { map[pid] = { participant: pid, rows: 0, submits: 0, lastAt: null }; order.push(pid); }
    var rec = map[pid];
    rec.rows++;
    if (String(vals[i][2]) === 'submit') rec.submits++;
    var ts = vals[i][0];
    if (ts && (!rec.lastAt || ts > rec.lastAt)) rec.lastAt = ts;
  }
  var out = order.map(function (pid) {
    var r = map[pid];
    return {
      participant: r.participant,
      rows: r.rows,
      submits: r.submits,
      lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null
    };
  });
  out.sort(function (a, b) { return String(b.lastAt || '').localeCompare(String(a.lastAt || '')); });
  return out;
}

/** Newest saved board state for a participant, or null. */
function latestState_(pid) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var pidCol = sh.getRange(2, 2, last - 1, 1).getValues();   // participant
  var jsonCol = sh.getRange(2, 10, last - 1, 1).getValues(); // json
  for (var i = pidCol.length - 1; i >= 0; i--) {             // newest first
    if (String(pidCol[i][0]) !== String(pid)) continue;
    try {
      var body = JSON.parse(jsonCol[i][0]);
      var st = body && body.payload && body.payload.state;
      if (st && st.cards) return st;
    } catch (err) {}
  }
  return null;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function summarize_(list, fn) {
  if (!list || !list.length) return '';
  return list.map(fn).join('\n');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
