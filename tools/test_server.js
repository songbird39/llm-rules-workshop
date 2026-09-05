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
const { loadServer } = require("./gasnode");

let failures = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${extra}`);
};

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

console.log("\na transcript far too big for one cell still round-trips");
{
  const { post, get, sh } = loadServer();
  // 실제 전사 분량 / an hour of interview: a quarter of a million characters, quotation
  // marks and newlines and all — five times what a single cell holds, and the escaping of
  // those quotes is exactly what makes a guessed slice size wrong
  const transcript = ("\"그래서 저는 챗지피티한테 먼저 물어보지 않고, 제 나름대로 " +
    "먼저 써 본 다음에 확인만 받으려고 했어요.\" 라고 말했다.\n").repeat(3700);
  const texts = { n8: transcript };
  const json = JSON.stringify({ texts: texts, cards: [] });
  // 클라이언트가 자르는 방식 그대로 / sliced the way the client slices it, measured not assumed
  const CELL_MAX = 50000;
  let size = 34000, slices = null;
  for (let a = 0; a < 8 && !slices; a++) {
    const n = Math.max(1, Math.ceil(json.length / size));
    const out = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      const body = {
        participant: "tx:P9", kind: "transcript", queuedAt: new Date().toISOString(),
        stamp: 1, part: i, parts: n,
        payload: { participant: "tx:P9", chunk: json.slice(i * size, (i + 1) * size) },
      };
      if (JSON.stringify(body).length > CELL_MAX) { ok = false; break; }
      out.push(body);
    }
    if (ok) slices = out; else size = Math.floor(size / 2);
  }
  check(slices !== null, "the client can slice it at all", ` (${slices && slices.length} rows)`);
  check(slices.every((b) => JSON.stringify(b).length <= CELL_MAX), "and every slice fits in a cell");
  let threw = null;
  try { slices.forEach((b) => post(b)); } catch (e) { threw = e.message; }
  check(threw === null, "the sheet accepts every one of them", threw ? ` (${threw})` : "");

  const back = get({ participant: "tx:P9" });
  check(back.state && back.state.texts, "the transcript record comes back");
  check(back.state.texts.n8 === transcript, "byte for byte, every character of it",
    ` (${(back.state.texts.n8 || "").length} of ${transcript.length})`);

  // 그리고 이것은 보드가 아니다 / and none of it can pass for a participant's board
  check(get({ participant: "P9" }).state === null, "a bare id never resolves to a transcript");
  check(get({ list: "1" }).participants.every((r) => !/^tx:/.test(r.participant)),
    "and tx: never appears in the roster");
  void sh;
}

console.log("\na half-written record never replaces a whole one");
{
  const { post, get } = loadServer();
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: analysis } });
  // 조각 하나가 빠진 채로 도착 / one slice never arrives — a closed laptop mid-save
  post({ participant: "sm:P9", kind: "sensemaking", stamp: 99, part: 0, parts: 3,
         payload: { participant: "sm:P9", chunk: '{"cards":[' } });
  post({ participant: "sm:P9", kind: "sensemaking", stamp: 99, part: 2, parts: 3,
         payload: { participant: "sm:P9", chunk: ']}' } });
  const back = get({ participant: "sm:P9" });
  check(back.state && back.state.cards.length === 3,
    "the last COMPLETE record is served, not the broken newer one",
    ` (${back.state && back.state.cards.length} cards)`);
}

console.log("\nthe analysis has a history, and checkpoints are never thinned away");
{
  const { post, get } = loadServer();
  const mk = (n, t) => ({ savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
    cards: Array.from({ length: n }, (_, i) => ({ id: "s" + i, type: "when", title: t, sm: true, src: "a", x: 100, y: 100 })),
    notes: [], arrows: [], strokes: [], seq: 9 });
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: mk(1, "a") } });
  post({ participant: "sm:P9", kind: "checkpoint", label: "1차 코딩 완료",
         payload: { participant: "sm:P9", state: mk(2, "b") } });
  // 그 뒤로 자동저장이 쏟아진다 / a flood of autosaves afterwards, all within the thinning window
  for (let i = 0; i < 6; i++) {
    post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: mk(3, "c") } });
  }
  const vs = get({ versions: "sm:P9", every: "120000" }).versions;
  const marks = vs.filter((v) => v.kind === "checkpoint");
  check(marks.length === 1, "the checkpoint survives a flood of autosaves around it", ` (${vs.length} versions)`);
  check(marks[0].label === "1차 코딩 완료", "with its name intact");
  const at = get({ row: String(marks[0].row) }).state;
  check(at && at.cards.length === 2, "and opening it gives that moment, not the newest one",
    ` (${at && at.cards.length})`);

  // 조각난 판본도 목록에 한 번만 / a sliced version appears ONCE and opens whole
  const big = mk(4, "d");
  const json = JSON.stringify(big), size = Math.ceil(json.length / 3);
  for (let i = 0; i < 3; i++) {
    post({ participant: "sm:P9", kind: "sensemaking", stamp: 77, part: i, parts: 3,
           payload: { participant: "sm:P9", chunk: json.slice(i * size, (i + 1) * size) } });
  }
  // 목록은 최신이 먼저 / newest first, so the slice group we just wrote heads the list.
  // Filtering by row number instead depended on the thinning window falling a particular
  // way, and these posts all land in the same millisecond.
  const vs2 = get({ versions: "sm:P9", every: "1" }).versions;
  check(vs2.length >= 1 && vs2[0].kind === "sensemaking", "a sliced save heads the list",
    ` (${vs2.length}, ${vs2[0] && vs2[0].kind})`);
  const opened = get({ row: String(vs2[0].row) }).state;
  check(opened && opened.cards.length === 4, "and opens reassembled", ` (${opened && opened.cards.length})`);

  // head / 누가 마지막으로 썼는지
  const h = get({ head: "sm:P9" }).head;
  check(h && String(h.stamp) === "77", "head reports the newest write", h ? ` (${h.stamp})` : "");
}

console.log("\nrecords written before any of this still open");
{
  const { post, get } = loadServer();
  // 예전 모양 그대로 / the old shape exactly: one row, whole state, transcript text sitting
  // inside the note where it used to live
  const legacy = JSON.parse(JSON.stringify(analysis));
  legacy.notes[0].text = "예전 방식으로 저장된 전사";
  delete legacy.strokes;                      // 예전 기록엔 필기가 없었다 / no ink back then
  legacy.cards.forEach((c) => { delete c.src; delete c.of; delete c.edited; });
  post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: legacy } });
  const back = get({ participant: "sm:P9" });
  check(back.state && back.state.cards.length === 3, "an old single-row record still loads");
  check(back.state.notes[0].text === "예전 방식으로 저장된 전사",
    "with its transcript still inside the note, where it used to be");
  check(back.state.strokes === undefined, "and no ink, which is what it had");
  check(get({ participant: "tx:P9" }).state === null,
    "there is no transcript record for it, and asking for one is not an error");
}

console.log("\nan old sheet, read by this server and by the previous client");
{
  // 예전 빌드가 쓴 그대로의 시트 / a sheet containing ONLY what older builds wrote: no stamp,
  // no part/parts, no label, transcript inside the note, and — for the oldest rows — not
  // even a kind the current code knows about. Nothing here has been touched since.
  const { post, get } = loadServer();
  const oldBoard = (n) => ({ savedAt: 1756000000000, pid: "P01", step: 2, lang: "ko", rules: [],
    cards: Array.from({ length: n }, (_, i) => ({ id: "c" + i, type: "when", title: "t" + i, desc: "d", x: 100 * i, y: 100 })),
    notes: [{ id: "n1", x: 300, y: 700, text: "참여자 메모" }], arrows: [], seq: 4, panelW: 566 });
  const oldAnalysis = { savedAt: 1756000100000, pid: "sm:P01", step: 2, lang: "ko", rules: [],
    cards: [{ id: "s1", type: "when", title: "해석", desc: "", sm: true, x: 900, y: 400 }],
    notes: [{ id: "n9", x: 900, y: 250, text: "예전 전사 본문", kind: "tx", sm: true }],
    arrows: [], seq: 9, panelW: 566 };

  post({ participant: "P01", kind: "autosave", queuedAt: "2026-08-20T09:00:00Z", payload: { participant: "P01", state: oldBoard(1) } });
  post({ participant: "P01", kind: "autosave", queuedAt: "2026-08-20T09:02:00Z", payload: { participant: "P01", state: oldBoard(2) } });
  post({ participant: "P01", kind: "submit",   queuedAt: "2026-08-20T09:05:00Z", payload: { participant: "P01", state: oldBoard(3) } });
  post({ participant: "sm:P01", kind: "sensemaking", queuedAt: "2026-08-21T09:00:00Z", payload: { participant: "sm:P01", state: oldAnalysis } });
  // 예전에는 없던 필드가 하나도 없는 행 / a row from before kind was even set
  post({ participant: "P02", payload: { participant: "P02", state: oldBoard(1) } });

  // 1. 예전 클라이언트가 하는 읽기 / every read the PREVIOUS client makes
  const roster = get({ list: "1" }).participants;
  check(roster.length === 2, "the roster still lists both participants", ` (${roster.map((r) => r.participant)})`);
  check(roster.every((r) => r.hidden === false && r.desc === ""),
    "with hidden/desc defaulted, since no mt: row exists for them");
  check(get({ participant: "P01" }).state.cards.length === 3, "their newest board loads");
  check(get({ participant: "sm:P01" }).state.cards.length === 1, "and so does the analysis over it");
  check(get({ participant: "sm:P01" }).state.notes[0].text === "예전 전사 본문",
    "with the transcript still inside the note, where the old build put it");
  const vs = get({ versions: "P01" }).versions;   // 예전 클라이언트는 every 를 보내지 않는다
  check(vs.length >= 2 && vs.some((v) => v.kind === "submit"),
    "the version list works without an every parameter", ` (${vs.length})`);
  check(vs.every((v) => v.label === ""), "old rows simply have no label");
  check(get({ row: String(vs[0].row) }).state !== null, "and each of those versions still opens");
  check(get({}).rows >= 5, "the plain health check still answers", ` (${get({}).rows})`);

  // 2. 새 클라이언트가 새로 하는 읽기, 예전 데이터 위에서 / the reads only the NEW client makes
  check(get({ participant: "tx:P01" }).state === null,
    "asking for a transcript record that never existed is not an error");
  check(get({ head: "sm:P01" }).head !== null, "head works on an old-shape row too");
  check(get({ versions: "sm:P01", every: "45000" }).versions.length === 1,
    "and the analysis history has exactly the one version there is");

  // 3. kind 없는 아주 오래된 행 / the oldest row of all, with no kind at all
  check(get({ participant: "P02" }).state.cards.length === 1, "a row written before kind existed still loads");
  check(roster.find((r) => r.participant === "P02").submits === 0, "and counts as no submit, which it was");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
process.exit(failures ? 1 : 0);
