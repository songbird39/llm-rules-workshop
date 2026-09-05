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
  const sh = {
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

function loadServer() {
  const sh = makeSheet();
  // 첫 호출에서는 시트가 없다 / the sheet does not exist on the first call, which is what
  // makes sheet_() create it and write the header. Handing back a ready-made sheet skips
  // that, every data row shifts up by one, and roster_ eats the first participant as if
  // it were the header — which is exactly the false alarm this harness first raised.
  let created = false;
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => (created ? sh : null),
        insertSheet: () => { created = true; return sh; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: "json", JAVASCRIPT: "js" },
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent: () => t }),
    },
    Date, JSON, String, Number, RegExp, Math, console,
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
  return { sh, post, get, getText, ctx: sandbox };
}


module.exports = { makeSheet, loadServer };
