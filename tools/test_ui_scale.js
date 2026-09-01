/**
 * Tests for the UI-scale patch (tools/apply_ui_scale.py).
 *
 *   node tools/test_ui_scale.js
 *
 * No browser needed. It pulls the real UI resolver out of the built bundle and runs it
 * under mocked globals, then checks the pointer maths by modelling how a browser lays
 * out a subtree under CSS `zoom`.
 *
 * The bug this guards against: CSS `zoom` scales layout, so getBoundingClientRect() and
 * clientX come back in *scaled* client px while pan/panelW/card coords stay in unscaled
 * local px. Miss a division and cards drift away from the cursor by a factor of UI —
 * which would quietly ruin a participant session.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// ---- pull the app source out of the bundle ----
const bundle = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TAG = '<script type="__bundler/template">';
const j = bundle.indexOf(TAG);
const b = bundle.indexOf(">", j) + 1;
const e = bundle.indexOf("</script>", b);
const doc = JSON.parse(bundle.slice(b, e).trim());
const k = doc.indexOf("text/x-dc");
const src = doc.slice(doc.indexOf(">", k) + 1, doc.indexOf("</script>", k));

let failures = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${extra}`);
};

// ---- 1. the UI resolver, executed for real ----
const uiSrc = src.match(/const UI = \(function \(\) \{[\s\S]*?\}\)\(\);/)[0];
function resolveUI({ width, search = "", zoomSupported = true, noCSS = false }) {
  const fn = new Function(
    "CSS", "location", "window", "URLSearchParams",
    uiSrc.replace("const UI =", "return ").replace(/;$/, "")
  );
  return fn(
    noCSS ? undefined : { supports: (p, v) => p === "zoom" && zoomSupported },
    { search },
    { innerWidth: width },
    URLSearchParams
  );
}

console.log("UI resolver");
[
  [{ width: 2560 }, 1.35, "2560x1440 monitor"],
  [{ width: 1920 }, 1.2, "1080p"],
  [{ width: 1707 }, 1.2, "1440p at 150% OS scaling"],
  [{ width: 1440 }, 1, "laptop -> unchanged"],
  [{ width: 1024 }, 1, "tablet -> unchanged"],
  [{ width: 2560, search: "?ui=1" }, 1, "?ui=1 escape hatch"],
  [{ width: 1440, search: "?ui=1.5" }, 1.5, "explicit override"],
  [{ width: 1440, search: "?ui=9" }, 2, "clamped high"],
  [{ width: 1440, search: "?ui=0.1" }, 0.8, "clamped low"],
  [{ width: 1440, search: "?ui=abc" }, 1, "garbage param ignored"],
  [{ width: 2560, zoomSupported: false }, 1, "no CSS zoom support -> fail safe"],
  [{ width: 2560, noCSS: true }, 1, "no CSS API -> fail safe"],
].forEach(([inp, want, label]) => {
  const got = resolveUI(inp);
  check(Math.abs(got - want) < 1e-9, label, ` (got ${got}, want ${want})`);
});

// ---- 2. pointer maths ----
// Under CSS zoom=UI, a local point L inside the canvas appears on screen at:
//     client = rectLeft + (pan + L*zoom) * UI
// toCanvas() must invert exactly that.
const toCanvas = (cx, rectLeft, pan, zoom, UI) => ((cx - rectLeft) / UI - pan) / zoom;
const render = (L, rectLeft, pan, zoom, UI) => rectLeft + (pan + L * zoom) * UI;

console.log("\npointer round-trip (screen -> canvas -> screen)");
let rt = 0, rtTotal = 0;
for (const UI of [1, 1.2, 1.35, 2])
  for (const zoom of [0.35, 1, 1.6])
    for (const pan of [0, -370, 880])
      for (const L of [0, 137.5, -420, 3000]) {
        rtTotal++;
        const back = toCanvas(render(L, 300, pan, zoom, UI), 300, pan, zoom, UI);
        if (Math.abs(back - L) < 1e-6) rt++;
      }
check(rt === rtTotal, "all combinations invert exactly", ` (${rt}/${rtTotal})`);

// ---- 3. the drift a participant would actually see ----
console.log("\ndragging a card: move the mouse 100px, card must move 100px");
for (const UI of [1, 1.35])
  for (const zoom of [0.5, 1, 1.5]) {
    const rectLeft = 300, pan = 40, cardLocal = 200;
    const grab = render(cardLocal, rectLeft, pan, zoom, UI);
    const ox = toCanvas(grab, rectLeft, pan, zoom, UI) - cardLocal;
    const newLocal = toCanvas(grab + 100, rectLeft, pan, zoom, UI) - ox;
    const drift = render(newLocal, rectLeft, pan, zoom, UI) - grab - 100;
    check(Math.abs(drift) < 1e-6, `UI=${UI} zoom=${zoom}`, ` drift ${drift.toFixed(4)}px`);
  }

// ---- 4. the patch is actually present ----
console.log("\npatch sites");
[
  ["toCanvas divides by UI", "((cx - r.left) / UI - this.state.pan.x) / z"],
  ["panel resize divides by UI", "d.pw + (e.clientX - d.sx) / UI"],
  ["pan divides by UI", "d.px + (e.clientX - d.sx) / UI"],
  ["ghost divides by UI", "(this.state.ghost.x + GHOST_DX) / UI"],
  ["drop reuses the ghost offset", "this.addCard(d.type, d.tpl, p.x + GHOST_DX / k, p.y + GHOST_DY / k)"],
  ["root applies zoom", "zoom:{{ ui }}"],
  ["root compensates height", "height:calc(100vh / {{ ui }})"],
].forEach(([label, needle]) =>
  check(doc.split(needle).length - 1 === 1, label)
);

// ---- 5. card description must still fit its fixed-height box ----
// Panel deck cards are 168x168 with overflow:hidden and read-only text, so anything
// that does not fit is silently truncated for the participant. Enlarging the
// description font eats this budget, so compute it rather than trusting it.
console.log("\ncard description fits its box");
{
  const declared = doc.match(
    /border-top:1px solid #eae7df;padding-top:4px;font-size:([\d.]+)px;line-height:([\d.]+)/
  );
  // must match the diagram box specifically — the rule deck card has no diagram and
  // its body div otherwise looks the same up to the border.
  const diagramFlex = parseFloat(
    doc.match(/flex:([\d.]+);min-height:0;display:flex;align-items:center;justify-content:center;border:1px solid #eae7df;border-radius:5px;background:#f7f5f0;padding:1px 2px/)[1]
  );
  const fontPx = parseFloat(declared[1]);
  const lineH = parseFloat(declared[2]);

  const CARD = 168, PAD = 7, BORDER = 1, GAP = 5;
  const content = CARD - 2 * PAD - 2 * BORDER;       // 152
  const titleRow = 12.5 * 1.2 + 2 * 3;               // title text + its padding
  const forBoth = content - titleRow - 2 * GAP;      // diagram + description share this
  const descBox = forBoth * (1 / (diagramFlex + 1));
  const textArea = descBox - 1 /*border-top*/ - 4 /*padding-top*/;
  const linesThatFit = Math.floor(textArea / (fontPx * lineH));

  // widest description actually shipped, in both languages
  const descs = [...doc.matchAll(/desc:\s*'([^']*)'/g)].map((m) => m[1]);
  // CJK glyphs are ~1em, Latin ~0.5em
  const emWidth = (t) => [...t].reduce((n, c) => n + (c.codePointAt(0) > 0x1100 ? 1 : 0.5), 0);
  const charsPerLine = content / fontPx;
  const worst = descs.reduce(
    (acc, d) => Math.max(acc, Math.ceil(emWidth(d) / charsPerLine)),
    0
  );

  console.log(
    `       font ${fontPx}px, diagram flex ${diagramFlex} -> ${textArea.toFixed(1)}px of text room ` +
    `= ${linesThatFit} lines; longest of ${descs.length} descriptions needs ${worst}`
  );
  check(linesThatFit >= worst, "longest description is not truncated",
    ` (${linesThatFit} >= ${worst})`);
}

// ---- 5b. every guardrail card ships an icon ----
// 활동/수단 are tags and post-its and carry no icon by design; the three guardrail decks
// are card-shaped, so one without an icon renders a visibly plainer tile.
console.log("\nevery guardrail card has an icon");
{
  const deckBlock = doc.slice(doc.indexOf("      con: ["), doc.indexOf("    },", doc.indexOf("      trig: [")));
  const entries = [...deckBlock.matchAll(/\{ title: '([^']*)'[^}]*?\}/g)].map((m) => m[0]);
  const missing = entries.filter((e) => !/blank:/.test(e) && /dia: null/.test(e))
    .map((e) => e.match(/title: '([^']*)'/)[1]);
  check(missing.length === 0, "no card left without a diagram",
    missing.length ? ` (${missing.join(", ")})` : ` (${entries.length} checked)`);
}

// ---- 6. a rule card must look the same on the board as in the panel ----
console.log("\nrule card keeps its size on drop");
{
  check(!/collapsed: type === 'rule'/.test(doc), "not created pre-collapsed");
  check(/collapsed: false/.test(doc), "created expanded");
  // the fold control must still exist — collapsing stays available, just not default
  // the fold control was gated on the rule type and became unreachable, so it is gone;
  // `collapsed` survives only in older saved boards, where it no longer does anything
  check(!/onFold/.test(doc), "the unreachable fold control is gone");
  check(/h: c\.h \|\| 168/.test(doc), "cards fall back to 168 before being measured");
  check(/cardRect\(c\) \{ return \{ x: c\.x, y: c\.y, w: c\.w \|\| CARD, h: c\.h \|\| 168 \}; \}/.test(doc),
    "cardRect uses each object's own width and measured height");

  // 워크플로 층과 가드레일 층이 실제로 다른 크기인지 / the two levels must differ
  check(/const CARD = 168, TAG_W = 352/.test(doc), "a tag is wider than a card");
  check(/w: \(type === 'act' \? TAG_W : CARD\)/.test(doc), "activity tags are created at tag width");
  check(/tfs: c\.type === 'act' \? '15px' : '12\.5px'/.test(doc), "tags carry a larger title");
  check(/dmin: '48px'/.test(doc), "a description box opens at a usable height");
  check(/hasDiagram: !!c\.dia/.test(doc), "only objects with an icon render a diagram box");

  // 모든 보드 객체는 편집 가능한 본문을 가져야 한다 / EVERY board object needs a body to type
  // in. The description textarea was once nested inside the hasDiagram guard, so 활동 tags
  // and 수단 post-its (dia: null) rendered a title and nothing else — they looked fine and
  // could not be edited. The guard must wrap the icon box ONLY.
  {
    const board = doc.slice(doc.indexOf('<sc-for list="{{ cards }}"'), doc.indexOf("</sc-for>", doc.indexOf('<sc-for list="{{ cards }}"')));
    const guards = (board.match(/sc-if value="\{\{ c\.hasDiagram \}\}"/g) || []).length;
    check(guards === 1, "the icon guard wraps the icon box and nothing else", ` (${guards} guard${guards === 1 ? "" : "s"})`);
    const desc = board.indexOf("c.onDesc");
    const lastGuard = board.lastIndexOf("<sc-if value=\"{{ c.hasDiagram }}\"", desc);
    const closeAfterGuard = board.indexOf("</sc-if>", lastGuard);
    check(desc > 0 && closeAfterGuard < desc, "the icon guard does not swallow the description");
    // 활동 태그만 예외 / the ONE deliberate exception: an activity tag is a title bar.
    // Everything else must keep a body — that was a real bug once, when the description
    // sat inside the icon guard and the two icon-less types silently lost it.
    check(/hasDesc: c\.type !== 'act'/.test(doc), "only activity tags drop the description");
    check(board.indexOf('sc-if value="{{ c.hasDesc }}"') < desc,
      "and they drop it by a guard around the description, not by hiding it");
    check(/desc: type === 'act' \? '' : \(tpl\.desc \|\| ''\)/.test(doc),
      "a tag does not carry a description it can never show");
    check(/if \(!tag\) wrap\(c\.desc/.test(doc), "and the exported image matches the screen");
    check(/dsep: c\.dia \? '1px solid #eae7df' : 'none'/.test(doc), "the separator line appears only under an icon");
  }
  check(/act: '#6f6b62', means: '#6f6b62'/.test(doc), "workflow decks are neutral");

  // 모든 카드에 설명이 있어야 한다 / every deck entry needs a description: it is what a
  // participant reads while choosing, and for 활동 it is the ONLY place one appears.
  const decks = doc.slice(doc.indexOf("deck: {"), doc.indexOf("rules: ["));
  const empty = (decks.match(/desc: '' \}/g) || []).length;
  check(empty === 0, "no deck card is left without a description", ` (${empty} empty)`);
  check(/title: 'AI 사용', desc: 'ChatGPT\/Gemini\/Claude 등 사용'/.test(doc),
    "the AI card names the tools it means");
  // 발동 사건은 조건이지 동작이 아니다 / a trigger states a CONDITION, never an action:
  // both of these used to end in an open padlock, which said the guardrail lifts. What
  // happens is the 제약 card's job (규칙 일시 중지 is the one that releases).
  for (const k of ["w_retry", "w_struggle"]) {
    const body = doc.slice(doc.indexOf(`key === '${k}'`), doc.indexOf(";", doc.indexOf(`key === '${k}'`)));
    check(!body.includes("openLock"), `${k} no longer implies a release`);
  }
  check(/규칙 일시 중지/.test(doc), "releasing is still available, as a 제약 card");
  check(/con: 'oklch\(0\.51 0\.08 160\)'/.test(doc), "guardrail decks are colour-coded");

}

// ---- 6b. the consent document on the sign-in screen ----
// 브라우저는 보간 전에 마크업을 읽는다 / the browser resolves url() while parsing, BEFORE
// the template engine substitutes anything. src="{{ … }}" therefore fetches the literal
// string and 404s on every load; a data: placeholder is an ERR_INVALID_URL instead. The
// images must arrive through the stylesheet injected at mount, and the markup must carry
// nothing but a class name.
console.log("\nconsent document is embedded without a parse-time fetch");
{
  const pages = (src.match(/'data:image\/png;base64,/g) || []).length;
  check(pages === 6, "five page images plus the print-resolution last page", ` (${pages})`);
  check(/lastPdf: 'data:application\/pdf;base64,/.test(src), "the last page ships as a real PDF");
  check(/mountConsentStyles\(\)/.test(src), "pages are attached through an injected stylesheet");
  check(/componentDidMount\(\) \{\s*this\.mountConsentStyles\(\);/.test(src),
    "and that runs at mount");

  const step0 = doc.slice(doc.indexOf("{{ isStep0 }}"), doc.indexOf("{{ isRoster }}"));
  check(!/src="\{\{/.test(step0), "no interpolated src on the sign-in screen");
  check(!/url\(['"]?\{\{/.test(step0), "no interpolated url() either");
  check(/class="\{\{ pg\.cls \}\}"/.test(step0), "the page element carries only a class");
  check(/consentTitle:/.test(src) && /consentPdf:/.test(src), "the panel is translated");

  // 안내문은 PDF를 고치지 않고 앱에서만 알린다 / the deviation notice lives in the app,
  // never in the PDF: the embedded document is the IRB-approved file untouched.
  check(/changeTitle:/.test(src) && /changeBody:/.test(src), "the deviation notice is translated");
  for (const [word, what] of [["대면 실험에서 비대면", "the move to remote"],
                              ["세부 실험 절차가 변경", "the change of procedure"],
                              ["실험 진행자가 설명", "who explains the detail"]])
    check(src.includes(word), `the notice states ${what}`);
  const body = (src.match(/changeBody: '([^']*)'/) || [])[1] || "";
  check(body.length < 120, "and stays short enough to actually be read", ` (${body.length} chars)`);
  // it must sit OUTSIDE the scrolling list, or it scrolls away before the signature page
  const notice = step0.indexOf("{{ t.changeBody }}");
  const scroller = step0.indexOf("overflow-y:auto");
  check(notice > 0 && notice < scroller, "the notice is above the scrolling page list");
  // both download buttons are the LAST page — the sheet that gets signed
  check(/downloadConsent\(kind\)/.test(src) && /kind === 'pdf' \? CONSENT\.lastPdf : CONSENT\.lastPng/.test(src),
    "both downloads are scoped to the last page");
  check(/atob\(src\.slice\(comma \+ 1\)\)/.test(src),
    "downloads go through a Blob, not a huge data: href");
}

// ---- 6c. language switching ----
console.log("\nlanguage switching has no rule-deck left in it");
{
  const fn = src.slice(src.indexOf("setLang(nl)"), src.indexOf("startNew(type"));
  check(!/I18N\[[a-z]+\]\.rules/.test(fn), "setLang no longer reads the removed rule deck");
  check(!/c\.type === 'rule'/.test(fn), "and has no rule-card branch");
  check(!/rules:/.test(fn), "and does not rewrite state.rules");
  // 아이콘 없는 카드도 번역 대상 / matching must not be icon-only, or 활동 and 수단 are skipped
  check(/k\.title && k\.title === c\.title/.test(fn), "icon-less cards match by title");
  check(!/if \(!c\.dia\) return c;/.test(fn), "and are no longer skipped outright");
  check(/\(this\.state\.rules \|\| \[\]\)\.filter/.test(src),
    "a restored record with no rules cannot break the snapshot");
}

// ---- 6d. demo sessions ----
console.log("\ndemo ids are frozen out of every write path");
{
  check(/isDemo\(pid\) \{ return \/\^demo\/i\.test/.test(src), "any id starting with demo, case-insensitive");
  check(/frozen\(\) \{ return this\.isView\(\) \|\| !!this\.state\.travel \|\| this\.isDemo\(\); \}/.test(src),
    "and frozen() covers them, so localStorage, autosave and the queue all stop");
  check(/if \(!this\.isDemo\(pid\)\) this\.syncDown/.test(src), "a demo does not read from the sheet either");
  check(/syncDemo:/.test(src) && /this\.isDemo\(\) \? t\.syncDemo/.test(src), "and the header says so");
  const gs = fs.readFileSync(path.join(ROOT, "server", "Code.gs"), "utf8");
  check(/function isDemo_\(pid\)/.test(gs) && /skipped: 'demo'/.test(gs),
    "the server drops demo rows as a backstop for stale builds");
  check(/if \(isDemo_\(pid\)\) continue;/.test(gs), "and never lists one as a participant");
}

// ---- 6e. deck naming, order and the pen ----
console.log("\ndecks are renamed, regrouped and colour-coded");
{
  check(/mark: \{ act: '활동', means: '수단', con: '유도', when: '시점', trig: '조건' \}/.test(doc),
    "badges read 유도 · 시점 · 조건");
  check(/tabFlow: '규칙', tabGuard: '가드레일'/.test(doc), "the two sets are 규칙 and 가드레일");
  check(!/제약/.test(doc) && !/발동 사건/.test(doc), "no old deck name survives anywhere");
  // ③은 시점과 조건이 한 덱 / ③ is ONE deck holding both card kinds: they keep separate
  // colours because that distinction is the researcher's, but the participant meets one deck
  const panel = doc.slice(doc.indexOf("{{ showGuard }}"));
  const order = ["t.whenCards", "t.trigCards", "t.conCards"].map((k) => panel.indexOf(k));
  check(order[0] > 0 && order[0] < order[1] && order[1] < order[2],
    "the panel runs 시점 → 조건 → 유도");
  check(panel.indexOf("{{ t.conCards }}") > panel.indexOf("deckTrig"),
    "유도 comes after both, as deck ④");
  check((panel.match(/border-top:1px solid #ece9e1/g) || []).length === 2,
    "and there are two section headers, not three");
  for (const [name, col] of [["whenCards", "62"], ["trigCards", "253"], ["conCards", "160"]])
    check(new RegExp("color:oklch\\(0\\.51 0\\.08 " + col + "\\)\">\\{\\{ t\\." + name).test(panel),
      `${name} is tinted like its cards`);
}

console.log("\nthe pen draws, erases and is saved like anything else on the board");
{
  check(/const INKS = \['#e0a33a', '#cf5f7a', '#5b9464', '#4d7fbf'\]/.test(src), "four inks");
  check(/opacity: 0\.5/.test(src), "drawn at marker opacity, so crossing strokes both show");
  // 세 모드가 동시에 켜지면 안 된다 / pen, arrow and note all claim a plain drag
  check(/pen: st\.pen \? null : \(st\.lastInk \|\| INKS\[0\]\), arrowMode: false, noteMode: false/.test(src),
    "turning the pen on turns the arrow and note modes off");
  check(/if \(this\.state\.travel\) return;/.test(src), "and it is off while browsing history");
  check(/strokes: \(st\.strokes \|\| \[\]\)\.filter/.test(src), "the eraser removes whole strokes");
  check(/if \(this\.isView\(\) && !k\.sm\) return true;/.test(src),
    "and cannot rub out a participant's ink from view mode");
  check(/if \(this\.isView\(\)\) st\.sm = true;/.test(src), "admin ink lands in the sensemaking layer");
  check(/if \(pts\.length < 4\) return;/.test(src), "a single dot is not a stroke");
  check(/Math\.abs\(d\.pts\[n - 2\] - q\.x\) > 1\.5/.test(src), "sub-pixel moves are dropped");
  // 저장·복원·초기화·내보내기 모두 / ink must travel with everything else
  for (const [re, what] of [
    [/strokes: this\.state\.strokes, seq: this\.state\.seq, panelW: this\.state\.panelW, step/, "local save"],
    [/strokes: d\.strokes \|\| \[\]/, "restore"],
    [/this\.state\.arrows, this\.state\.strokes, this\.state\.rules\]/, "the change signature"],
    [/cards: \[\], notes: \[\], arrows: \[\], strokes: \[\], selArrow: null/, "reset"],
    [/strokes: \(s\.strokes \|\| \[\]\)\.filter\(\(k\) => !k\.sm\)/, "clearing the sensemaking layer"],
  ]) check(re.test(src), `ink is carried through ${what}`);
  check(/g\.globalAlpha = 0\.5;/.test(src) && /strokes\.forEach\(\(k\) => \{/.test(src),
    "and is painted into the exported image");
  check(/return \{ x: a - PEN_W, y: b - PEN_W/.test(src), "which is sized to include it");
}

// ---- 7. view mode must not be able to write ----
// The whole point: viewing P01 must never produce a localStorage write or a sheet
// POST, because latestState_() takes the newest row and would adopt the accident.
console.log("\nview mode cannot write");
{
  // 7a. the guard must be the FIRST statement of each write path — stronger than
  // "appears somewhere in the body", and it is what makes the bail-out unconditional.
  // frozen() = isView() || travel — the write paths bail on the wider guard, so that
  // browsing version history cannot push an old board over the newest one either.
  const guardedFirst = (signature, guard = "frozen") => {
    const i = doc.indexOf("  " + signature + " {");
    if (i < 0) return false;
    const head = doc.slice(i + signature.length + 5, i + signature.length + 60);
    return new RegExp("^\\s*if \\(this\\." + guard + "\\(\\)\\) return;").test(head);
  };
  check(guardedFirst("scheduleAutosave()"), "scheduleAutosave bails on frozen() first");
  check(guardedFirst("enqueue(kind)"), "enqueue bails on frozen() first");
  check(guardedFirst("finish()", "isView"), "finish bails on isView() first");
  check(guardedFirst("downloadJson()", "isView"), "downloadJson bails on isView() first");
  check(/this\.state\.pid && !this\.frozen\(\)/.test(doc),
    "componentDidUpdate localStorage write checks frozen()");
  check(/frozen\(\) \{ return this\.isView\(\) \|\| !!this\.state\.travel \|\| this\.isDemo\(\); \}/.test(src),
    "frozen() covers view mode, version browsing and demo sessions");

  // 7b. admin mode must leave state.pid empty — that alone disables every path
  check(/admin: true, viewPid: '', loginPid: '', pid: '', step: 0/.test(doc),
    "admin login clears state.pid");
  check(/openParticipant\(pid\) \{\s*this\.setState\(\{ viewPid: pid/.test(doc),
    "viewed code goes to viewPid, not pid");

  // 7c. simulate the guards for real
  const frozen = (st) => !!st.admin || !!st.travel;
  const wouldWriteLocal = (st) => st.step > 0 && !!st.pid && !frozen(st);
  const wouldAutosave = (st) => !frozen(st) && st.step >= 1 && !!st.pid;
  const wouldEnqueue = wouldAutosave;
  const participant = { admin: false, pid: "P01", step: 2 };
  const viewing = { admin: true, pid: "", viewPid: "P01", step: 2 };
  check(wouldWriteLocal(participant) && wouldAutosave(participant) && wouldEnqueue(participant),
    "participant mode still saves normally");
  check(!wouldWriteLocal(viewing) && !wouldAutosave(viewing) && !wouldEnqueue(viewing),
    "view mode writes nothing");
  // even if a future edit forgets to clear pid, isView() alone must stop it
  const sloppy = { admin: true, pid: "P01", step: 2 };
  check(!wouldWriteLocal(sloppy) && !wouldAutosave(sloppy) && !wouldEnqueue(sloppy),
    "isView() alone stops writes even if pid leaks in");
  // browsing history as a PARTICIPANT must not overwrite their newest work
  const browsing = { admin: false, pid: "P01", step: 2, travel: { row: 12 } };
  check(!wouldWriteLocal(browsing) && !wouldAutosave(browsing) && !wouldEnqueue(browsing),
    "browsing an old version freezes writes for participants too");

  // 7d. read-only UI
  // Protection is per-object now, not a blanket layer setting: that is what lets the
  // admin sensemaking objects be editable while the participant's stay inert.
  check(/pe: \(!RO \|\| c\.sm\) \? 'auto' : 'none'/.test(doc),
    "participant cards are inert in admin; sensemaking cards are not");
  check(/pe: \(!RO \|\| n\.sm\) \? 'auto' : 'none'/.test(doc),
    "same for notes");
  check(/onDown: \(!RO \|\| c\.sm\) \? \(e\) => this\.startMove\(c\.id, e\) : NOOP/.test(doc),
    "card drag handler gated per object");
  check(/showPanel: !RO/.test(doc), "card panel hidden while viewing");
  check(/canEdit: !RO/.test(doc), "editing toolbar hidden while viewing");
  // Deck tiles use "RO ? NOOP :"; board objects use the per-object form so that admin
  // sensemaking copies stay editable while the participant's do not. Both must exist.
  const deckNoops = (doc.match(/RO \? NOOP :/g) || []).length;
  const objNoops = (doc.match(/\(!RO \|\| [cn]\.sm\) \?/g) || []).length;
  check(deckNoops >= 2, "deck tiles are inert in admin", ` (${deckNoops})`);
  check(objNoops >= 9, "every board handler is gated per object", ` (${objNoops})`);
  for (const h of ["onTitle", "onDesc", "onDup", "onDel", "onText"]) {
    check(new RegExp(h + ": \\(!RO \\|\\| [cn]\\.sm\\) \\?").test(doc),
      `${h} cannot edit a participant object in admin`);
  }

  // 7d-bis. view controls must survive the canEdit guard, editing controls must not.
  // resetView lives between the note and export buttons, so it is easy to sweep into
  // the guard by accident — and it is the control that recovers off-screen content.
  {
    const gi = doc.indexOf('<sc-if value="{{ canEdit }}"');
    const gEnd = doc.indexOf("</sc-if>", doc.indexOf("clearAll", gi));
    const guarded = doc.slice(gi, gEnd);
    const inGuard = (name) => guarded.includes("{{ " + name + " }}");
    // still reachable while viewing
    ["resetView", "zoomIn", "zoomOut"].forEach((n) =>
      check(!inGuard(n), `${n} stays available in view mode`)
    );
    // correctly hidden while viewing
    ["toggleArrowMode", "toggleNoteMode", "doFinish", "clearAll"].forEach((n) =>
      check(inGuard(n), `${n} hidden in view mode`)
    );
    // panning does not depend on the card layer, which is pointer-events:none
    check(/window\.addEventListener\('pointermove'/.test(doc), "pan listener is global");
    check(/if \(this\.state\.step === 2\) this\.bindWheel\(\)/.test(doc),
      "wheel pan binds on the board step");
  }

  // 7d-ter. text inside a card must be reachable and scrollable while viewing
  check(/pointer-events:auto/.test(doc), "card text re-enabled under pointer-events:none");
  // three now: the card description, the note, and the card title. The two rule-card
  // text boxes went with the rule type.
  check((doc.match(/pointer-events:auto/g) || []).length === 3,
    "every remaining text element is re-enabled",
    ` (${(doc.match(/pointer-events:auto/g) || []).length})`);
  check(/descOverflow: RO \? 'auto' : 'hidden'/.test(doc),
    "collapsed rule card scrolls in view mode, stays clipped for participants");

  // ---- the wheel handler, executed for real -----------------------------
  // It must scroll overflowing card text instead of panning, but still pan once the
  // text is at its edge, or the board feels stuck over a long card.
  console.log("\nwheel over a card scrolls the text, not the board");
  {
    const body = doc.match(/this\._wheel = \(e\) => \{[\s\S]*?\n    \};/)[0];
    let panned, zoomed;
    const run = (target, deltaY, mod) => {
      panned = zoomed = false;
      const fn = new Function("e", "self", body.replace("this._wheel = (e) => {", "").replace(/\};$/, "")
        .replace(/this\.zoomBy\([^)]*\)/g, "self.zoom()")
        .replace(/this\.setState\(\([\s\S]*?\)\);/g, "self.pan();"));
      const e = {
        deltaY, deltaX: 0, ctrlKey: !!mod, metaKey: false,
        target, preventDefault: () => {}
      };
      fn(e, { zoom: () => (zoomed = true), pan: () => (panned = true) });
      return { panned, zoomed };
    };
    // a textarea with 200px of content in a 100px box
    const mk = (scrollTop) => ({
      tagName: "TEXTAREA", scrollHeight: 200, clientHeight: 100, scrollTop,
      closest: function () { return this; }
    });
    const bare = { tagName: "DIV", closest: () => null };

    check(!run(mk(0), 60).panned, "scrolling down mid-text does not pan");
    check(!run(mk(50), -60).panned, "scrolling up mid-text does not pan");
    check(run(mk(100), 60).panned, "at the bottom it pans again");
    check(run(mk(0), -60).panned, "at the top it pans again");
    check(run(bare, 60).panned, "over empty canvas it pans");
    check(run(mk(0), 60, true).zoomed, "ctrl+wheel still zooms over a card");
  }

  // 7f. the sensemaking layer must never write to a participant's own record
  check(/const key = 'sm:' \+ pid;/.test(doc), "sensemaking writes build an sm: key");
  check(/if \(key\.indexOf\('sm:'\) !== 0\) return;/.test(doc), "and assert the prefix before sending");
  check(/participant: key, kind: 'sensemaking'/.test(doc), "posted as kind sensemaking under that key");
  check(/if \(!this\.isView\(\) \|\| !pid \|\| !url\) return;/.test(doc),
    "pushSense refuses outside admin view mode");
  check(/cards: this\.state\.cards\.filter\(\(c\) => c\.sm\)/.test(doc),
    "only sm-flagged objects are sent, participant objects are filtered out");

  // 7g. deleting a participant record
  check(/action: 'delete', participant: r\.participant/.test(doc), "delete posts an explicit action");
  check(/this\.state\.delTyped\.trim\(\) !== r\.participant\) return;/.test(doc),
    "delete refuses unless the code was retyped");
  check(/const still = list\.some\(\(x\) => x\.participant === r\.participant\);/.test(doc),
    "and verifies from a fresh roster rather than assuming success");

  // 7e. the roster path
  check(/this\.jsonp\('list=1'\)/.test(doc), "roster fetched via ?list=1");
  check(/ADMIN_CODE/.test(doc), "admin code constant present");
  check(/isStep0: this\.state\.step === 0 && !this\.state\.admin/.test(doc),
    "login screen suppressed in admin mode");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
process.exit(failures ? 1 : 0);
