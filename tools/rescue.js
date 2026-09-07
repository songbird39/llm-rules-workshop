/**
 * 시트에서 해석을 직접 건져 낸다 / rescue an analysis straight out of the sheet.
 *
 *   node tools/rescue.js <responses.csv> P4113 > P4113-analysis.json
 *
 * 앱이 못 읽는다고 없어진 게 아니다 / the app failing to READ a record does not mean the
 * record is gone. Every save appends rows and nothing ever deletes them, so if the work
 * reached the sheet at all it is still sitting in the json column — possibly cut across
 * several rows that an out-of-date deployment cannot put back together.
 *
 * This does what the server would: gather the newest complete group of slices for
 * sm:<pid>, join them, and print the analysis as a file the app can load back in with
 * "↑ 파일에서". It also picks up the transcript record if there is one.
 *
 * File ▸ Download ▸ Comma-separated values in the Sheet gives you the CSV.
 */
const fs = require("fs");

const [, , csvPath, pid] = process.argv;
if (!csvPath || !pid) {
  console.error("usage: node tools/rescue.js <responses.csv> <participant>");
  process.exit(2);
}

// CSV 는 줄바꿈과 따옴표를 품는다 / a transcript cell contains newlines and quotes, so the
// file cannot be split on lines or commas — parse it properly.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const head = rows[0] || [];
const iPid = Math.max(0, head.indexOf("participant"));
const iJson = head.indexOf("json") >= 0 ? head.indexOf("json") : 9;

function assemble(key) {
  const mine = [];
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][iPid] || "").trim() !== key) continue;
    let b = null;
    try { b = JSON.parse(rows[i][iJson]); } catch (e) { continue; }
    if (b) mine.push({ row: i + 1, body: b });
  }
  if (!mine.length) return { state: null, seen: 0 };
  // 조각을 스탬프별로 / group the slices by stamp, newest complete group wins
  const groups = {};
  mine.forEach(({ body }) => {
    if (!body.parts) return;
    const g = (groups[body.stamp] = groups[body.stamp] || { parts: body.parts, s: {} });
    g.s[body.part] = (body.payload && body.payload.chunk) || "";
  });
  const stamps = Object.keys(groups).sort((a, b) => Number(b) - Number(a));
  for (const st of stamps) {
    const g = groups[st];
    let joined = "", whole = true;
    for (let k = 0; k < g.parts; k++) {
      if (g.s[k] === undefined) { whole = false; break; }
      joined += g.s[k];
    }
    if (!whole) continue;
    try { return { state: JSON.parse(joined), seen: mine.length, from: "slices@" + st }; } catch (e) {}
  }
  // 조각이 아니면 통째로 저장된 마지막 행 / not sliced: the last row holding a whole state
  for (let i = mine.length - 1; i >= 0; i--) {
    const st = mine[i].body.payload && mine[i].body.payload.state;
    if (st && (st.cards || st.texts)) return { state: st, seen: mine.length, from: "row " + mine[i].row };
  }
  return { state: null, seen: mine.length };
}

const sm = assemble("sm:" + pid);
const tx = assemble("tx:" + pid);
if (!sm.state) {
  console.error(`no analysis found for ${pid} (${sm.seen} rows carried that key)`);
  console.error("check the participant column for exactly \"sm:" + pid + "\"");
  process.exit(1);
}
const texts = (tx.state && tx.state.texts) || {};
console.error(`recovered ${pid}: ${sm.from}, ${(sm.state.cards || []).length} cards, ` +
  `${(sm.state.notes || []).length} notes, ${Object.keys(texts).length} transcripts` +
  (tx.from ? ` (transcripts from ${tx.from})` : ""));
process.stdout.write(JSON.stringify({
  participant: pid, savedAt: Date.now(), app: "llm-rules-workshop",
  state: sm.state, texts: texts
}, null, 2));
