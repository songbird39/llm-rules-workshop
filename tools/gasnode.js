/**
 * server/Code.gs, running in node against a simulated sheet.
 *
 * 두 테스트가 같은 서버를 쓴다 / both suites use this: tools/test_server.js drives it
 * directly, and the browser suite routes the page's own requests into it. A browser test
 * whose endpoint is a hand-written stub only ever proves the client reads back what the
 * client wrote — which is precisely the thing that was wrong when analysis records saved
 * and then would not load.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── 시트 흉내 / the thinnest sheet that Code.gs actually uses ────────────────
function makeSheet() {
  const rows = [];   // rows[0] is the header once appendRow puts it there
  // 읽은 칸 수 / cells touched by reads. The json column is the expensive one — 50,000
  // characters a row — and reading it whole is what made every request take nine seconds.
  const counters = { cells: 0, jsonCells: 0 };
  const sh = {
    __counters: counters,
    __resetCounters() { counters.cells = 0; counters.jsonCells = 0; },
    appendRow(v) {
      // 셀 상한 / a Sheets cell holds 50,000 characters. The whole board rides in one
      // cell, so this is a real ceiling for a transcript-heavy analysis record.
      v.forEach((cell) => {
        if (typeof cell === "string" && cell.length > 50000) throw new Error("cell over 50000 chars");
      });
      rows.push(v.slice());
    },
    getLastRow: () => rows.length,
    setFrozenRows() {},
    getRange(r, c, nr, nc) {
      // 읽은 칸을 센다 / count the cells a read actually touches, so a test can tell whether
      // the sheet is being read whole
      counters.cells += (nr || 1) * (nc || 1);
      if (c <= 10 && c + (nc || 1) - 1 >= 10) counters.jsonCells += (nr || 1);
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < (nr || 1); i++) {
            const row = rows[r - 1 + i] || [];
            const line = [];
            for (let j = 0; j < (nc || 1); j++) line.push(row[c - 1 + j] === undefined ? "" : row[c - 1 + j]);
            out.push(line);
          }
          return out;
        },
        getValue() {
          const row = rows[r - 1] || [];
          return row[c - 1] === undefined ? "" : row[c - 1];
        },
      };
    },
    deleteRow(r) { rows.splice(r - 1, 1); },
    _rows: rows,
  };
  return sh;
}

// 호출할 때마다 1초씩 흐르는 시계 / a clock that advances a second per reading, so rows
// written one after another carry distinct timestamps the way real ones do
function TickingDate() {
  let now = Date.UTC(2026, 8, 1, 9, 0, 0);
  const D = function (...args) {
    if (!(this instanceof D)) return new D(...args).toString();
    if (args.length === 0) { now += 1000; return new Date(now); }
    return new Date(...args);
  };
  D.prototype = Date.prototype;
  D.now = () => { now += 1000; return now; };
  D.UTC = Date.UTC;
  D.parse = Date.parse;
  return D;
}

function loadServer() {
  // 시트가 둘이다 / two sheets now: responses, and codes for the global codebook
  const sheets = {};
  const sheetFor = (name) => (sheets[name] || (sheets[name] = makeSheet()));
  const sh = makeSheet();
  // 첫 호출에서는 시트가 없다 / the sheet does not exist on the first call, which is what
  // makes sheet_() create it and write the header. Handing back a ready-made sheet skips
  // that, every data row shifts up by one, and roster_ eats the first participant as if
  // it were the header — which is exactly the false alarm this harness first raised.
  let created = false;
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => {
          if (name === "codes") return sheets.codes || null;
          return created ? sh : null;
        },
        insertSheet: (name) => {
          if (name === "codes") return sheetFor("codes");
          created = true;
          return sh;
        },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: "json", JAVASCRIPT: "js" },
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent: () => t }),
    },
    // 시계가 멈춰 있으면 안 된다 / the clock must MOVE. Every appendRow stamps new Date(),
    // and with a frozen clock every row lands in the same millisecond — which makes the
    // version thinner discard rows it would never discard in life, and quietly turns tests
    // about history into tests about nothing.
    Date: TickingDate(), JSON, String, Number, RegExp, Math, console,
  };
  sandbox.ContentService.createTextOutput = (t) => {
    const o = { _t: t };
    o.setMimeType = () => o;
    o.getContent = () => t;
    return o;
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../server/Code.gs"), "utf8"), sandbox);
  const post = (body) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  // callback 이 있으면 JSONP 텍스트가 돌아온다 / with a callback the server answers JSONP, not
  // JSON, so parsing it throws. getText hands back exactly what the browser would receive;
  // get is the convenience for calling from node, and drops the callback first.
  const getText = (params) => sandbox.doGet({ parameter: params }).getContent();
  const get = (params) => {
    const p2 = {};
    Object.keys(params || {}).forEach((k) => { if (k !== "callback") p2[k] = params[k]; });
    return JSON.parse(getText(p2));
  };
  return { sh, sheets, post, get, getText, ctx: sandbox, counters: sh.__counters,
    reset: () => { sh.__resetCounters(); Object.keys(sheets).forEach((k) => sheets[k].__resetCounters()); } };
}


module.exports = { makeSheet, loadServer };
