/**
 * server/Code.gs, run for real against a simulated sheet.
 *
 *   node tools/test_server.js
 *
 * 브라우저 테스트만으로는 부족하다 / the browser suite stubs the endpoint, so it only ever
 * proves the CLIENT reads back what the CLIENT wrote. The question that stub cannot answer
 * is whether the sheet-backed server hands the record back at all — a scan that skips the
 * wrong row, or a kind guard that catches too much, would lose an analysis record silently
 * and look fine in every browser check. So: load Code.gs with the Apps Script globals
 * faked, POST exactly what the client posts, and GET it back the way the client asks.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${extra}`);
};

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
  const get = (params) => JSON.parse(sandbox.doGet({ parameter: params }).getContent());
  return { sh, post, get, ctx: sandbox };
}

// ── 클라이언트가 실제로 보내는 것 / exactly what the client posts ──────────────
const analysis = {
  savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
  cards: [
    { id: "s5", type: "act", title: "학습 계획", desc: "", sm: true, src: "p", of: "c1", x: 700, y: 400, w: 352 },
    { id: "s6", type: "when", title: "시작 전에", desc: "고친 설명", sm: true, src: "p", of: "c2", edited: true, x: 700, y: 520 },
    { id: "c9", type: "means", title: "새로 만든 카드", sm: true, src: "a", x: 900, y: 640 },
  ],
  notes: [
    { id: "n8", x: 700, y: 250, text: "전사 한 줄\n둘째 줄", kind: "tx", sm: true, src: "a", link: "s5", w: 281, h: 166, manual: true },
    { id: "n9", x: 1100, y: 250, text: "내 메모", kind: "memo", sm: true, src: "a", collapsed: false },
  ],
  arrows: [{ id: "s10", from: { k: "card", id: "s5" }, to: { k: "note", id: "n8" }, sm: true }],
  strokes: [{ id: "s11", ink: "oklch(0.76 0.130 70)", pts: [10, 10, 40, 30, 70, 20], sm: true }],
  seq: 12, panelW: 566,
};
const participantBoard = {
  savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
  cards: [{ id: "c1", type: "act", title: "학습 계획", x: 300, y: 400, w: 352 }],
  notes: [{ id: "n1", x: 300, y: 760, text: "참여자 메모" }], arrows: [], seq: 5, panelW: 566,
};

console.log("the server hands the analysis record back");
{
  const { post, get } = loadServer();
  // 참여자 자동저장이 먼저, 그 다음 해석 저장 / the participant's autosaves come first, and
  // the analysis record is written after them and interleaved with more of them
  post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: participantBoard } });
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: analysis } });
  post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: participantBoard } });
  post({ participant: "mt:P9", kind: "meta", payload: { participant: "mt:P9", state: { hidden: false, desc: "이지원" } } });

  const back = get({ participant: "sm:P9" });
  check(back.ok && !!back.state, "GET participant=sm:P9 returns a state at all");
  const st = back.state || {};
  check((st.cards || []).length === 3, "all three analysis cards come back", ` (${(st.cards || []).length})`);
  check((st.notes || []).length === 2, "both notes come back", ` (${(st.notes || []).length})`);
  check((st.arrows || []).length === 1, "the arrow comes back");
  check((st.strokes || []).length === 1, "and the ink comes back", ` (${(st.strokes || []).length})`);
  // 필드 하나하나 / the fields the analysis layer depends on, one at a time
  const card = (st.cards || []).find((c) => c.id === "s6");
  check(card && card.src === "p" && card.of === "c2", "provenance survives the round trip");
  check(card && card.edited === true, "so does the edited flag");
  const tx = (st.notes || []).find((n) => n.id === "n8");
  check(tx && tx.kind === "tx", "the note kind survives");
  check(tx && tx.link === "s5", "the link to its step survives");
  check(tx && tx.manual === true && tx.w === 281 && tx.h === 166, "and the hand-set size survives");
  check(JSON.stringify(st) === JSON.stringify(analysis), "in fact the record comes back byte for byte");

  // 참여자 보드는 오염되지 않는다 / and the participant's own board is untouched by all this
  const theirs = get({ participant: "P9" });
  check(theirs.state && theirs.state.pid === "P9", "the participant's board is still their own");
  check(!(theirs.state.cards || []).some((c) => c.sm), "with nothing of the analysis in it");
}

console.log("\nlater analysis saves win, and nothing else can impersonate one");
{
  const { post, get } = loadServer();
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: analysis } });
  const second = JSON.parse(JSON.stringify(analysis));
  second.notes[0].text = "고쳐 쓴 전사";
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: second } });
  const back = get({ participant: "sm:P9" });
  check(back.state.notes[0].text === "고쳐 쓴 전사", "the newest analysis save is the one returned",
    ` (${back.state.notes[0].text})`);

  // 메타 행은 보드가 아니다 / a meta row must never be mistaken for a board
  post({ participant: "mt:P9", kind: "meta", payload: { participant: "mt:P9", state: { hidden: true, desc: "x" } } });
  check(get({ participant: "sm:P9" }).state.notes[0].text === "고쳐 쓴 전사",
    "a later meta row does not displace it");
  // 그리고 해석 기록이 참여자 보드로 새어 나가지 않는다 / nor can it leak the other way
  check(get({ participant: "P9" }).state === null, "and a bare id never resolves to an analysis record");
}

console.log("\nthe roster still reads the meta rows correctly");
{
  const { post, get } = loadServer();
  post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: participantBoard } });
  post({ participant: "P7", kind: "autosave", payload: { participant: "P7", state: participantBoard } });
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: analysis } });
  post({ participant: "mt:P9", kind: "meta", payload: { participant: "mt:P9", state: { hidden: true, desc: "이지원 · 9/2" } } });
  const list = get({ list: "1" }).participants;
  check(list.length === 2, "the roster lists the participants and nothing else", ` (${list.map((r) => r.participant)})`);
  check(!list.some((r) => /^(sm|mt):/.test(r.participant)), "no sm: or mt: key appears as a participant");
  const p9 = list.find((r) => r.participant === "P9");
  check(p9 && p9.hidden === true, "the hidden flag is read back");
  check(p9 && p9.desc === "이지원 · 9/2", "and so is the description");
  check(list.every((r) => r.firstAt), "every row carries a created time to sort by");
  check(list[0].participant === "P7" || new Date(list[0].firstAt) <= new Date(list[1].firstAt),
    "and the list comes back oldest first");
}

console.log("\nthe cell ceiling is real, and worth knowing about");
{
  const { post } = loadServer();
  const big = JSON.parse(JSON.stringify(analysis));
  big.notes[0].text = "가".repeat(30000);
  const r1 = post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: big } });
  check(r1.ok === true, "30k characters of transcript still saves");
  const huge = JSON.parse(JSON.stringify(analysis));
  huge.notes[0].text = "가".repeat(60000);
  const r2 = post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: huge } });
  // 한 칸에 5만 자 / one cell holds 50,000 characters and the whole board rides in one.
  // The client posts no-cors and cannot read this failure, so it is silent: a long enough
  // transcript stops being saved and nothing says so.
  check(r2.ok === false, "but 60k does not — the sheet cell caps at 50,000 characters",
    ` (${r2.error || "saved anyway"})`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
process.exit(failures ? 1 : 0);
