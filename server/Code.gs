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

// 배포된 버전을 스스로 밝힌다 / the deployment says which version it is, in every reply.
// 배포를 미루면 조용히 어긋난다: 새 클라이언트는 여러 줄로 나눠 저장하는데 옛 서버는 그걸
// 다시 붙이지 못해, 저장은 되는데 열리지 않는 상태가 된다.
// A deferred redeploy fails SILENTLY and confusingly: the new client writes a record
// across several rows and an old deployment cannot reassemble them, so analysis saves
// appear to work and then will not load. The client compares this against what it needs
// and says so plainly instead of leaving you to guess.
var VERSION = '2026-09-05';

var SHEET_NAME = 'responses';
// 관리자 해석(sensemaking) 레코드는 'sm:' 접두어가 붙은 별도 키로 저장한다.
// Admin sensemaking records live under a separate key, 'sm:' + participant. They are
// never a participant's own record: roster_ skips them and latestState_ refuses to
// return one for a bare participant id, so a participant can never load an admin's
// experiment as their board.
var SENSE_PREFIX = 'sm:';
// 참여자 항목을 숨기거나 설명을 붙인 관리자 메모는 'mt:' 키로 따로 쌓인다.
// Per-participant admin metadata — the hidden flag and the description that says who
// the code belongs to — lives under 'mt:' + participant, newest row wins. It is a
// normal appended row, so nothing is ever rewritten or destroyed: hiding is reversible
// by construction, which is the whole point of not having a delete any more.
var META_PREFIX = 'mt:';
// 전사 본문은 'tx:' 키로 따로 산다 / transcript bodies live under 'tx:' + participant, apart
// from the board they belong to. The board record is rewritten constantly; a transcript is
// pasted once, so keeping them in separate records keeps the frequent write small.
var TX_PREFIX = 'tx:';
// 긴 전사 때문에 한 칸에 담기지 않는다 / a whole analysis board no longer fits in one cell
// once real transcripts are pasted into it — a Sheets cell holds 50,000 characters. A
// record too big for one row is therefore written as several rows that share a stamp,
// each carrying one slice of the same JSON, and reassembled on the way out. A group is
// only used once every slice of it is present, so a half-written record can never be
// served: the previous complete one is returned instead.
var HEADERS = ['receivedAt', 'participant', 'kind', 'queuedAt', 'step', 'selectedRules', 'combinations', 'annotations', 'arrows', 'json'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    // 데모는 기록하지 않는다 / demo sessions are rehearsals, not data. The client already
    // refuses to send them; this is the backstop for a stale cached build that still does.
    if (isDemo_(body.participant || (body.payload && body.payload.participant))) {
      return json_({ ok: true, skipped: 'demo' });
    }
    // 삭제 기능은 없앴다 / there is no delete any more. A stale cached client may still
    // post one; answer it without touching the sheet rather than letting it through.
    if (body.action === 'delete') {
      return json_({ ok: false, error: 'delete is disabled; hide the participant instead' });
    }
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
  } else if (p.versions) {
    out = { ok: true, participant: p.versions, versions: versions_(p.versions, Number(p.every) || 120000) };
  } else if (p.row) {
    out = { ok: true, row: Number(p.row), state: stateAtRow_(Number(p.row)) };
  } else if (p.participant) {
    out = { ok: true, participant: p.participant, state: latestState_(p.participant) };
  } else {
    out = { ok: true, rows: Math.max(0, sheet_().getLastRow() - 1) };
  }
  out.version = VERSION;
  if (p.callback) {
    return ContentService
      .createTextOutput(p.callback + '(' + JSON.stringify(out) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(out);
}

/** demo, demo0, DEMO-2 … — anything starting with "demo", case-insensitive. */
function isDemo_(pid) {
  return /^demo/i.test(String(pid || ''));
}

/** One row per participant seen in the sheet, newest activity first.
 *  Feeds the admin view-mode roster. Read-only: touches nothing.
 */
function roster_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 3).getValues(); // receivedAt, participant, kind
  var map = {}, order = [], metaRow = {};
  for (var i = 0; i < vals.length; i++) {
    var pid = String(vals[i][1] || '').trim();
    if (!pid) continue;
    // 숨김·설명은 마지막 mt: 행만 유효하다 / only the LAST mt: row counts, so the loop
    // just remembers where it was and the json is read once, after the scan
    if (pid.indexOf(META_PREFIX) === 0) { metaRow[pid.slice(META_PREFIX.length)] = i + 2; continue; }
    if (pid.indexOf(TX_PREFIX) === 0) continue;   // 전사 기록도 참여자가 아니다 / not a participant
    // 관리자 해석용 레코드는 참여자 목록에 넣지 않는다 / admin sensemaking records are
    // stored under a "sm:" key and are not participants
    if (pid.indexOf(SENSE_PREFIX) === 0) continue;
    if (isDemo_(pid)) continue;   // 데모는 참여자가 아니다 / a demo is not a participant
    if (!map[pid]) { map[pid] = { participant: pid, rows: 0, submits: 0, firstAt: null, lastAt: null }; order.push(pid); }
    var rec = map[pid];
    rec.rows++;
    if (String(vals[i][2]) === 'submit') rec.submits++;
    var ts = vals[i][0];
    if (ts && (!rec.lastAt || ts > rec.lastAt)) rec.lastAt = ts;
    // 첫 행이 곧 세션이 열린 시각 / the first row a participant ever wrote is when their
    // session started — the sheet is append-only, so nothing earlier can appear later
    if (ts && (!rec.firstAt || ts < rec.firstAt)) rec.firstAt = ts;
  }
  var out = order.map(function (pid) {
    var r = map[pid];
    var m = metaRow[pid] ? readMeta_(sh, metaRow[pid]) : {};
    return {
      participant: r.participant,
      rows: r.rows,
      submits: r.submits,
      firstAt: r.firstAt ? new Date(r.firstAt).toISOString() : null,
      lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      // 숨김은 목록에서만 빠진다 / hidden only drops it out of the default list; every
      // row it ever wrote is still on the sheet and the client can bring it back
      hidden: !!m.hidden,
      desc: String(m.desc || '')
    };
  });
  // 세션이 열린 순서대로 / in the order the sessions happened, oldest first: the roster
  // is a record of fieldwork, and fieldwork has an order. Sorting by last activity made
  // the list reshuffle itself every time a record was opened.
  out.sort(function (a, b) { return String(a.firstAt || '').localeCompare(String(b.firstAt || '')); });
  return out;
}

/** The {hidden, desc} stored in one 'mt:' row, or {} if it is unreadable. */
function readMeta_(sh, row) {
  try {
    var body = JSON.parse(sh.getRange(row, 10).getValue());
    var st = (body && body.payload && body.payload.state) || {};
    return { hidden: !!st.hidden, desc: st.desc };
  } catch (err) {
    return {};
  }
}

/** Version index for one participant, newest first.
 *  Autosaves fire every 2.5s of activity, so a session can be hundreds of rows. Keep
 *  one per `everyMs` window plus EVERY submit, which is the deliberate finish and must
 *  never be thinned away. Returns only metadata; fetch a state with ?row=.
 */
function versions_(pid, everyMs) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 3).getValues(); // receivedAt, participant, kind
  var out = [], lastKept = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][1] || '').trim() !== String(pid)) continue;
    var kind = String(vals[i][2] || '');
    var t = vals[i][0] ? new Date(vals[i][0]).getTime() : 0;
    if (kind !== 'submit' && lastKept && (t - lastKept) < everyMs) continue;
    lastKept = t;
    out.push({ row: i + 2, at: vals[i][0] ? new Date(vals[i][0]).toISOString() : null, kind: kind });
  }
  out.reverse();
  return out;
}

/** The board state stored in one specific row, or null. Read-only. */
function stateAtRow_(row) {
  var sh = sheet_();
  if (!row || row < 2 || row > sh.getLastRow()) return null;
  try {
    var body = JSON.parse(sh.getRange(row, 10).getValue());
    var st = body && body.payload && body.payload.state;
    return (st && st.cards) ? st : null;
  } catch (err) {
    return null;
  }
}

/** Newest saved board state for a participant, or null.
 *  Handles both shapes: a whole state in one row, and a state sliced across several rows
 *  that share a stamp. Scans newest-first and returns the first COMPLETE record found, so
 *  a save that was cut off halfway leaves the previous one standing rather than replacing
 *  it with something unreadable.
 */
function latestState_(pid) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var pidCol = sh.getRange(2, 2, last - 1, 1).getValues();   // participant
  var jsonCol = sh.getRange(2, 10, last - 1, 1).getValues(); // json
  var kindCol = sh.getRange(2, 3, last - 1, 1).getValues();   // kind

  // 조각들을 스탬프별로 모은다 / gather the slices by stamp in one pass, so a group whose
  // rows are interleaved with other participants' autosaves still comes back whole
  var groups = {};
  for (var g = 0; g < pidCol.length; g++) {
    if (String(pidCol[g][0]) !== String(pid)) continue;
    try {
      var b = JSON.parse(jsonCol[g][0]);
      if (!b || !b.parts) continue;
      var key = String(b.stamp);
      if (!groups[key]) groups[key] = { parts: b.parts, slices: {}, at: g };
      groups[key].slices[b.part] = (b.payload && b.payload.chunk) || '';
      groups[key].at = g;
    } catch (err2) {}
  }

  for (var i = pidCol.length - 1; i >= 0; i--) {             // newest first
    if (String(pidCol[i][0]) !== String(pid)) continue;
    // 이중 안전장치 / belt and braces: even if a sensemaking row were somehow written
    // under a bare participant id, never hand it back as that participant's board.
    if (String(kindCol[i][0]) === 'sensemaking' && String(pid).indexOf(SENSE_PREFIX) !== 0) continue;
    if (String(kindCol[i][0]) === 'meta') continue;   // 메타 행은 보드가 아니다 / not a board
    // 전사 기록은 보드가 아니다 / a transcript record is not a board either, and must never
    // come back as one for a bare participant id
    if (String(kindCol[i][0]) === 'transcript' && String(pid).indexOf(TX_PREFIX) !== 0) continue;
    try {
      var body = JSON.parse(jsonCol[i][0]);
      if (body && body.parts) {
        var grp = groups[String(body.stamp)];
        if (!grp) continue;
        var joined = '', whole = true;
        for (var k = 0; k < grp.parts; k++) {
          if (grp.slices[k] === undefined) { whole = false; break; }
          joined += grp.slices[k];
        }
        if (!whole) continue;                      // 조각이 빈다 / an incomplete save, skip it
        var st2 = JSON.parse(joined);
        if (st2 && (st2.cards || st2.texts)) return st2;
        continue;
      }
      var st = body && body.payload && body.payload.state;
      if (st && (st.cards || st.texts)) return st;
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
