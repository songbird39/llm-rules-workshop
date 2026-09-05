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

// 색 값 도우미 / palette helpers, used by more than one block
const chroma = (v) => Number(String(v).replace(/oklch\([\d.]+ ([\d.]+).*/, "$1"));
const accOf = (t) => (src.match(new RegExp("\\n  " + t + ": '([^']+)'")) || [])[1];

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
  [{ width: 1280 }, 0.92, "a small laptop scales down a little"],
  [{ width: 1024 }, 0.85, "and a smaller one further"],
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
  ["ghost converts from the snapped board coordinate", "(r.left / UI) + bx * z + this.state.pan.x"],
  ["drop reuses the ghost's own coordinate", "d.bx !== undefined ? d.bx :"],
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
  // 카드의 접기는 사라졌다 / cards no longer fold: that control was gated on the rule
  // type and became unreachable. `collapsed` came back for a different owner — the
  // transcription note — so the check is now that no CARD offers it.
  check(!/onDown: \(!RO \|\| c\.sm\).*onFold/.test(doc), "cards still have no fold control");
  check(/onFoldDown: own \? /.test(doc), "but a transcription note does");
  check(/h: c\.h \|\| 168/.test(doc), "cards fall back to 168 before being measured");
  check(/cardRect\(c\) \{ return \{ x: c\.x, y: c\.y, w: c\.w \|\| CARD, h: c\.h \|\| 168 \}; \}/.test(doc),
    "cardRect uses each object's own width and measured height");

  // 워크플로 층과 가드레일 층이 실제로 다른 크기인지 / the two levels must differ
  check(/const CARD = 168, TAG_W = 352/.test(doc), "a tag is wider than a card");
  check(/w: \(type === 'act' \? TAG_W : CARD\)/.test(doc), "activity tags are created at tag width");
  // 활동 태그는 이제 독자적인 마크업(잉크 셰브론)이라 카드 글자 크기와 무관하다
  // an activity tag now has its own markup — the ink chevron — with its own type scale
  check(/height:62px;[^"]*font-size:16\.5px|font-size:16\.5px/.test(doc),
    "the board tag is set larger than the library chevron");
  check(/font-size:15px;font-weight:700;letter-spacing:-0\.015em;white-space:nowrap;color:#f7f5ef/.test(doc),
    "the library chevron stays compact, still ahead of a guardrail card's 12.5px");
  // 한 줄 유지 / one line always: a timeline slot that wraps stops reading as one slot
  check(/white-space:nowrap/.test(doc), "and neither ever wraps");
  check(/const over = input \? input\.scrollWidth - input\.clientWidth : 0;/.test(doc),
    "a tag grows by exactly the overflow instead");
  check(/ws\.push\(Math\.min\(TAG_MAX, want\)\)/.test(doc), "up to the width cap");
  check(/cw: c\.type === 'means' \? 'auto'/.test(doc), "and a 수단 pill hugs its own text");
  check((doc.match(/clip-path:polygon\(0 0, calc\(100% - 17px\) 0, 100% 50%/g) || []).length === 6,
    "both ends are pointed on the panel tile, the board tag and the drag ghost",
    ` (${(doc.match(/clip-path:polygon\(0 0, calc\(100% - 17px\) 0, 100% 50%/g) || []).length} layers)`);
  // 코 끝 실선 / the keyline: without the 1.6px offset layer two snapped tags merge
  check(/left:-1\.6px;right:1\.6px;background:#413e37/.test(doc), "and the nose keeps a keyline");
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
    check(/desc: \(type === 'act' \|\| type === 'means'\) \? '' : \(tpl\.desc \|\| ''\)/.test(doc),
      "규칙 cards do not carry a description they can never show");
    check(/if \(!tag && c\.type !== 'means'\) wrap\(c\.desc/.test(doc),
      "and the exported image matches the screen");
    check(/hasDesc: c\.type !== 'act' && c\.type !== 'means'/.test(doc),
      "only 가드레일 cards keep a description on the board");
    check(/dsep: c\.dia \? '1px solid #eae7df' : 'none'/.test(doc), "the separator line appears only under an icon");
  }
  check(/act: '#6f6b62', means: '#6f6b62'/.test(doc), "workflow decks are neutral");

  // 모든 카드에 설명이 있어야 한다 / every deck entry needs a description: it is what a
  // participant reads while choosing, and for 활동 it is the ONLY place one appears.
  const decks = doc.slice(doc.indexOf("deck: {"), doc.indexOf("rules: ["));
  // 가드레일 카드의 설명은 내용 그 자체 / a guardrail card's description IS its content — it
  // says what the system does — so a blank one is a mistake. A 규칙 card's description is only
  // a hint shown while choosing, so leaving one blank is a decision, not a bug.
  let emptyGuard = 0, guardSeen = 0;
  for (const name of ["con", "when", "trig"]) {
    let at = -1;
    while ((at = decks.indexOf(name + ": [", at + 1)) >= 0) {
      const block = decks.slice(at, decks.indexOf("],", at));
      guardSeen++;
      emptyGuard += (block.match(/desc: '',(?![^\n]*blank:)/g) || []).length;
    }
  }
  check(guardSeen === 6, "all three guardrail decks found, in both locales", ` (${guardSeen})`);
  check(emptyGuard === 0, "no guardrail card is left without a description", ` (${emptyGuard} empty)`);
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
  // 세 덱이 같은 채도를 쓰는지 / all three decks must share the accent chroma, or one of
  // them reads washed out beside the others — which is exactly what happened to 유도
  const accs = ["con", "when", "trig"].map(accOf);
  check(accs.every(Boolean) && new Set(accs.map(chroma)).size === 1,
    "every deck accent carries the same chroma", ` (${accs.map(chroma).join(", ")})`);

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
  check(/componentDidMount\(\)[\s\S]{0,220}?this\.mountConsentStyles\(\);/.test(src),
    "and that runs at mount");
  // 하이드레이션 전에는 감춘다 / hide until hydrated: the raw template was readable for a
  // moment on load, and what it read was "{{ t.delTitle }}" in a dialog nobody opened
  check(/x-dc\{visibility:hidden/.test(doc) && /html\[data-dc-ready\] x-dc\{visibility:visible/.test(doc),
    "the raw template is hidden until the engine has run");
  check(/animation:dc-ready 0s linear 10s forwards/.test(doc),
    "with a CSS-only reveal, so a boot failure is not a blank page");
  check(/setAttribute\('data-dc-ready', '1'\)/.test(src), "and mount is what reveals it");

  const step0 = doc.slice(doc.indexOf("{{ isStep0 }}"), doc.indexOf("{{ isRoster }}"));
  check(!/src="\{\{/.test(step0), "no interpolated src on the sign-in screen");
  check(!/url\(['"]?\{\{/.test(step0), "no interpolated url() either");
  check(/class="\{\{ pg\.cls \}\}"/.test(step0), "the page element carries only a class");
  check(/consentTitle:/.test(src) && /consentPdf:/.test(src), "the panel is translated");

  // 안내문은 PDF를 고치지 않고 앱에서만 알린다 / the deviation notice lives in the app,
  // never in the PDF: the embedded document is the IRB-approved file untouched.
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
  const acc = (type) => (src.match(new RegExp("\\n  " + type + ": '([^']+)'")) || [])[1];
  for (const [name, type] of [["whenCards", "when"], ["trigCards", "trig"], ["conCards", "con"]])
    check(!!acc(type) && panel.includes("color:" + acc(type) + "\">{{ t." + name),
      `${name} is tinted with its own ACC colour`, ` (${acc(type)})`);
  // 시점과 조건은 한 색 계열의 두 명도 / 시점 and 조건 are two shades of ONE hue, not two hues
  const hue = (v) => Number(String(v).replace(/.*\s([\d.]+)\)$/, "$1"));
  const lig = (v) => Number(String(v).replace(/oklch\(([\d.]+).*/, "$1"));
  // 같은 계열이되 확실히 달라야 한다 / same family, but unmistakably different: too close
  // and the pair reads as a rendering fault rather than a distinction
  const dh = Math.abs(hue(acc("when")) - hue(acc("trig")));
  check(dh >= 35 && dh <= 70, "시점 and 조건 are apart in hue, but still one warm family", ` (${dh}°)`);
  check(Math.abs(lig(acc("when")) - lig(acc("trig"))) >= 0.10,
    "and differ in shade as well", ` (${lig(acc("when"))} vs ${lig(acc("trig"))})`);
  // 눈에 보이는 건 띠 색이다 / the tint band is what is actually seen. The first attempt at
  // this pair differed plenty in ACC — 9px badge text — while the tints stayed near-identical
  // creams, and it read as a rendering fault rather than a distinction. So check the tints.
  const tints = src.slice(src.indexOf("const TINT = {"), src.indexOf("};", src.indexOf("const TINT = {")));
  const tint = (type) => (tints.match(new RegExp(type + ": '(oklch\\([^']+)'")) || [])[1];
  const dth = Math.abs(hue(tint("when")) - hue(tint("trig")));
  check(dth >= 35, "the tint bands differ in hue too, not just the badge text", ` (${dth}°)`);
  check(hue(tint("when")) === hue(acc("when")) && hue(tint("trig")) === hue(acc("trig")),
    "and each tint sits on its own deck's hue");
  check(Math.abs(hue(acc("con")) - hue(acc("when"))) > 60, "유도 stays a different hue entirely");
  // 파랑은 이제 선택을 뜻한다 / blue now means selection, and belongs to no deck
  check(/const SELECT_BLUE = 'oklch\([^']+\)'/.test(src) && /const SEL = SELECT_BLUE/.test(src),
    "a selected arrow uses the selection blue, not a deck colour");
  const selBlue = (src.match(/const SELECT_BLUE = '([^']+)'/) || [])[1];
  check(chroma(selBlue) === chroma(accOf("con")), "and the selection blue sits on the same chroma",
    ` (${selBlue})`);
}

console.log("\nthe pen draws, erases and is saved like anything else on the board");
{
  // 펜도 같은 색상환 위에 / the markers live on the same wheel, just brighter — they are
  // drawn at 55%, so a deck-weight chroma would disappear into the paper
  const inks = (src.match(/const INKS = \[([^\]]+)\]/) || [])[1] || "";
  const inkList = inks.match(/'([^']+)'/g) || [];
  check(inkList.length === 4, "four inks", ` (${inkList.length})`);
  check(inkList.every((v) => v.includes("oklch")), "stated in the same colour space as the decks");
  // 보드마카처럼 / like a board marker: multiply, not plain alpha. Alpha washes out what
  // it crosses; multiply darkens it, and two strokes go deeper where they overlap.
  check(/const PEN_W = 6, PEN_A = 0\.55;/.test(src), "drawn at marker weight and opacity");
  check(/mixBlendMode: 'multiply'/.test(src), "the ink layer multiplies rather than washes out");
  check(/inkLayer\(\)/.test(src) && /pointerEvents: 'none'/.test(src),
    "it is its own layer and never intercepts a drag");
  const iArrows = doc.indexOf("{{ arrowsLayer }}");
  const iCards = doc.indexOf('<sc-for list="{{ cards }}"');
  const iInk = doc.indexOf("{{ inkLayer }}");
  check(iArrows > 0 && iArrows < iCards && iCards < iInk,
    "the board stacks arrows → cards → ink, so a stroke can cross a card");
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
  check(/g\.globalAlpha = PEN_A;\s*\n\s*g\.globalCompositeOperation = 'multiply';/.test(src),
    "the export blends it the same way");
  check(/g\.globalAlpha = 1; g\.globalCompositeOperation = 'source-over';/.test(src),
    "and puts the context back afterwards");
  check(src.indexOf("strokes.forEach") > src.indexOf("cards.forEach"),
    "painting it last, matching the screen order");
  check(/return \{ x: a - PEN_W, y: b - PEN_W/.test(src), "which is sized to include it");
}

// ---- 6f. board objects are found by marker, not by guesswork ----
console.log("\nboard objects are identified explicitly");
{
  // "input 이 있으면 카드" 규칙은 마퀴 사각형까지 메모로 셌다 / the old rule — a DIV with an
  // <input> is a card, otherwise a note — also swept up the sensemaking region box and the
  // marquee rectangle. The marquee only exists while dragging, so notes shifted by one
  // exactly during a marquee drag and the wrong note was hit.
  check(!/querySelector\('input'\) \? cardEls : noteEls/.test(doc), "no card/note guessing left");
  check(!/querySelector\('input'\) \? els : noteEls/.test(doc), "not in measureCards either");
  const markers = (doc.match(/<div data-obj="(card|note)"/g) || []).length;
  check(markers === 4, "every board object carries a static marker",
    ` (${markers}: note, chevron, chip, card)`);
  const walkers = (doc.match(/querySelectorAll\(':scope > \[data-obj=/g) || []).length;
  check(walkers === 5, "and all three walkers select by it", ` (${walkers} selectors)`);
  // 정적이어야 한다 / it must be static: the engine drops interpolated data-* attributes
  check(!/data-obj="\{\{/.test(doc), "the marker is literal, since interpolated data-* is dropped");
}

// ---- 6g. the ghost lands where it is shown ----
console.log("\nthe drag preview is the drop, not an approximation of it");
{
  // 스냅을 두 번 계산하면 배율 큰 화면에서 한 칸씩 어긋난다 / snapping twice — once to draw the
  // preview, once on release — let the two round to different 24px cells on a scaled
  // display, so the ghost sat a whole grid cell from where the card landed.
  check(/d\.bx = bx; d\.by = by;/.test(src), "the drop coordinate is fixed once, on the move");
  check(/d\.bx !== undefined \? d\.bx :/.test(src), "and the drop reuses it rather than recomputing");
  check(/const bx = g\.bx, by = g\.by;/.test(src), "the ghost draws at that same coordinate");
}

console.log("\nzoom and page scroll");
{
  // 핀치는 이벤트를 잔뜩 쏟아낸다 / a pinch delivers a stream of wheel events, so a fixed step
  // per event ran through several zoom levels in one gesture
  check(/Math\.max\(-0\.04, Math\.min\(0\.04, -e\.deltaY \* 0\.0035\)\)/.test(src),
    "pinch zoom is proportional to the gesture and capped per event");
  check(!/zoomBy\(e\.deltaY > 0 \? -0\.08 : 0\.08\)/.test(src), "not a fixed step any more");
  // 문서 자체가 스크롤되면 툴바가 화면 밖으로 밀려난다 / if the document scrolls, the toolbar
  // slides off; every screen already scrolls inside itself
  check(/html,body\{overflow:hidden\}/.test(doc), "the page itself never scrolls");
}

console.log("\nwide characters are measured as wide");
{
  // 눈금이 아니라 실측 / measured, not counted: input.size works in "0"-width units, too
  // coarse for a chip that hugs its text — wide enough never to clip Hangul left visible
  // slack after the label
  check(/function textPx\(str\)/.test(src), "the label is measured, not counted in notches");
  check(/tw: c\.type === 'means' \? Math\.max\(28, textPx\(c\.title \|\| c\.titlePlaceholder\) \+ 3\)/.test(src),
    "and the chip's input takes that width plus room for the caret");
  check(!/size="\{\{ c\.tsize \}\}"/.test(doc), "the coarse size attribute is gone");
  check(/0\.13 \* t\.length/.test(src), "letter-spacing is added back, since measureText ignores it");
}

// ---- 6h. the 수단 chip ----
console.log("\n수단 is a chip with an ink bar, in the library and on the board");
{
  const bar = (doc.match(/width:9px;background:(#413e37|\{\{ c\.chipInk \}\})/g) || []).length;
  check(bar === 3, "the ink bar appears on the tile, the board object and the ghost", ` (${bar})`);
  check((doc.match(/border:2px solid (#413e37|\{\{ c\.chipInk \}\})/g) || []).length === 3,
    "and all three carry the 2px ink border");
  check((doc.match(/height:38px/g) || []).length >= 3, "all three are 38px tall");
  // 해석 레이어는 잉크 색으로 / an admin's own chip is told apart by its ink
  check(/chipInk: c\.sm \? 'oklch\(0\.62 0\.11 62\)' : '#413e37'/.test(doc),
    "a sensemaking chip is inked differently");
  // 칩도 자기 조작을 갖는다 / the chip keeps its own controls
  const chip = doc.slice(doc.indexOf("{{ c.isMeans }}"), doc.indexOf("{{ c.isPlainCard }}"));
  for (const h of ["onDupDown", "onDelDown"])
    check(chip.includes(h), `the chip keeps ${h}`);
  // ✎ 는 없앴다 / no edit button: clicking the label edits and dragging anywhere else moves,
  // which is only true since raiseCard stopped recreating the node under the pointer
  check(!chip.includes("onEditDown"), "and needs no edit button");
}

// ---- 6i. icons that are not in the font ----
console.log("\nthe duplicate icon is drawn, not typed");
{
  // U+29C9 는 글꼴에 없다 / U+29C9 is absent from the font stack — measured against a
  // guaranteed-missing codepoint it came out exactly as wide, so every browser substituted
  // a glyph of its own and it read as lines rather than two sheets.
  check(!doc.includes("\u29C9"), "U+29C9 is gone");
  const dup = (doc.match(/<svg width="11" height="11" viewBox="0 0 12 12"/g) || []).length;
  check(dup === 4, "every duplicate button draws it instead", ` (${dup}: chevron, chip, card, note)`);
  check(/stroke="currentColor"/.test(doc), "and it inherits the button's colour");
}

// ---- 6j. an opaque script error is not the app's ----
console.log("\na failing endpoint does not look like a broken app");
{
  // s.onerror 는 '못 불러온' 경우만 잡는다 / onerror only covers a script that fails to LOAD.
  // One that loads and then fails to parse — an Apps Script returning an HTML error page —
  // throws, and cross-origin the browser masks it as a bare "Script error." with no file.
  check(/window\.addEventListener\('error', this\._scriptErr, true\)/.test(src),
    "the opaque cross-origin error is intercepted, in the capture phase");
  check(/if \(e\.filename \|\| \(e\.message && !\/\^script error\/i\.test\(e\.message\)\)\) return;/.test(src),
    "and only when it has no file and no message of its own");
  check(/sync: 'offline', loadingRemote: false/.test(src),
    "the indicator then says offline rather than sitting on loading");
  check(/window\.removeEventListener\('error', this\._scriptErr, true\)/.test(src),
    "and the listener is removed on unmount");
}

// ---- 6k. horizontal panning ----
console.log("\nsideways panning works on a mouse, not just a trackpad");
{
  check(/if \(e\.shiftKey && !dx\) \{ dx = dy; dy = 0; \}/.test(src),
    "shift+wheel is read as horizontal");
  // !dx 가 핵심 / the !dx guard is the point: browsers that already convert shift+wheel to
  // deltaX would otherwise have the swap applied twice and cancel out
  check(/let dx = e\.deltaX, dy = e\.deltaY;/.test(src), "and only when the device sent no deltaX of its own");
}

// ---- 6l. the board layers must not clip ----
console.log("\nink and arrows survive outside the layer's own box");
{
  // SVG 는 뷰포트 밖을 잘라낸다 / an SVG clips whatever falls outside its viewport, and both
  // board layers start at board (0,0) sized 5000. Board coordinates go negative the moment
  // you pan right, so ink drawn left of the origin was recorded and then thrown away — it
  // read as an invisible dead zone. A <div> is not clipped that way, which is why the cards
  // looked fine and only the pen and the arrows were affected.
  const layers = (src.match(/overflow: 'visible', pointerEvents: 'none'/g) || []).length;
  check(layers === 3, "ink, arrows and leader lines all draw outside their box",
    ` (${layers})`);
}

// ---- 6m. the analysis layer's two note kinds, and what they hang off ----
console.log("\ntwo kinds of analysis note, sized by hand and tied to a step");
{
  // 색이 유일한 구분 / colour is the only thing that separates them, so the three grounds
  // must actually be three: participant, admin remark, transcript
  check(/bg: n\.sm \? \(tx \? TX_BG : '#fdfbf5'\) : 'transparent'/.test(doc),
    "a participant note, an admin note and a transcript note are three different grounds");
  check(/const TX_INK = 'oklch\(0\.52 0\.055 250\)'/.test(src), "transcript ink is defined once");
  check(/font: tx \? 'ui-monospace/.test(doc), "and transcript is set in mono, not the UI face");
  check(/noteKind: 'tx'/.test(doc), "the transcript tool arms its own note kind");
  check(/kind: s\.noteKind \|\| 'memo'/.test(doc), "and a plain click still makes a plain memo");

  // 크기를 잡으면 늘어나기를 멈춘다 / a hand-set size must STOP the auto-grow, or the note
  // springs back on the next render and the resize looks broken
  check(/textarea\[data-grow\]:not\(\.nogrow\)/.test(doc), "autoGrow skips a hand-sized note");
  check(/cls: n\.manual \? 'nogrow' : ''/.test(doc), "and the flag rides on a class");
  // 보간된 data-* 는 사라진다 / interpolated data-* attributes are dropped by the engine,
  // which is exactly why this cannot be data-manual
  check(!/data-\w+="\{\{/.test(doc), "no interpolated data-* attribute anywhere in the markup");
  check(/ov: n\.manual \? 'auto' : 'hidden'/.test(doc), "a hand-sized note scrolls rather than clipping");
  check(/w: Math\.max\(NOTE_MIN_W/.test(doc) && /h: Math\.max\(NOTE_MIN_H/.test(doc),
    "and it resizes in both directions, with a floor");
  check(/!n\.manual && !n\.collapsed && nhs\[i\]/.test(doc),
    "the height measurer leaves hand-sized and folded notes alone");

  // 단계에 매다는 선 / the leader line
  check(/canNote: RO && c\.sm && c\.type === 'act'/.test(doc),
    "the note button sits only on an activity tag in the analysis layer");
  check(/y: Math\.round\(r\.y \+ mine\.length \* 96\)/.test(doc),
    "several notes per step stack instead of landing on each other");
  // 태그 쪽 끝이 메모 위치에 따라 움직여야 한다 / the tag-side end must move with the note,
  // which is precisely what arrowEnds' border-meeting maths already does
  check(/return this\.arrowEnds\(\{ from: \{ k: 'card', id: n\.link \}, to: \{ k: 'note', id: n\.id \} \}\)/.test(doc),
    "the line leaves from the tag edge that faces the note");
  check(/unlinkNote\(id\)/.test(doc), "a link can be broken without deleting the note");
  check(/n\.link === id \? Object\.assign\(\{\}, n, \{ link: null \}\)/.test(doc),
    "and deleting a step unties its notes instead of leaving them pointing at nothing");
  // 서버에 남아야 한다 / it has to survive a reload: sm notes are saved whole, so the
  // link and the size ride along, but only if the note is flagged sm in the first place
  check(/notes: \(this\.state\.notes \|\| \[\]\)\.filter\(\(n\) => n\.sm\)/.test(doc),
    "analysis notes are what gets written to the sm: record");
  check(/concat\(\[this\.mine\(\{\s*id: id, x: Math\.round\(r\.x \+ r\.w \+ 56\)/.test(doc),
    "and a step note is flagged sm when it is made");
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
  check(/tpe: \(PEN \|\| \(RO && !c\.sm\)\) \? 'none' : 'auto'/.test(doc),
    "a participant's card text is inert in admin; a sensemaking card's is not");
  check(/const own = !RO \|\| n\.sm;/.test(doc), "notes make the same judgement once, by name");
  check(/tpe: \(PEN \|\| !own\) \? 'none' : 'auto'/.test(doc), "and apply it to the text field");
  // 참여자 것은 고를 수는 있어야 한다 / a participant's object must still be SELECTABLE in
  // admin, or "duplicate selection" can only ever mean "duplicate everything"
  check(/onDown: \(!RO \|\| c\.sm\) \? \(e\) => this\.startMove\(c\.id, e\) : \(e\) => this\.pickOnly\(c\.id, e\)/.test(doc),
    "a participant card answers a click by being selected");
  check(/if \(e\.ctrlKey \|\| e\.metaKey\) \{ this\.toggleSel\(id\); return; \}/.test(doc),
    "and ctrl-click adds it to the selection");
  check(/ctrls: \(RO && !c\.sm\) \? 'none' : 'flex'/.test(doc),
    "but its duplicate and delete controls are not drawn at all");
  // 같은 값이 펜도 처리한다 / the same value answers to the pen: with it up the board is
  // paper, so a stroke can start on top of a card instead of dragging it
  check(/const PEN = !!this\.state\.pen;/.test(doc), "and both go inert while the pen is up");
  check(/onTitle: \(!RO \|\| c\.sm\) \?/.test(doc), "card text stays gated per object");
  // 글자를 누르면 올리지 않는다 / a press on text must not raise: raiseCard reorders
  // state.cards, the node under the pointer is recreated, and the focus goes with it — so
  // the label of any card that was not already frontmost could not be clicked into.
  check(/if \(t === 'INPUT' \|\| t === 'TEXTAREA' \|\| t === 'BUTTON'\) return;\s*\n\s*\/\/ 글자·버튼이 아닐 때만/.test(doc),
    "raising happens only when the press missed the text");
  // 해석 레이어에서는 관리자도 참여자와 같은 도구를 쓴다 / in the analysis layer the admin
  // gets the participant's own tools: the deck panel, the pen, the arrow, the note. What
  // stays theirs alone is the participant flow — 다음 · 제출 · 초기화.
  check(/showPanel: this\.canAuthor\(\) && !\(viewing && this\.state\.panelOff\)/.test(doc),
    "the deck panel opens in analysis mode, and only the admin can fold it away");
  // 참여자에게서 덱을 빼앗을 수는 없다 / a participant cannot lose the deck: without it there
  // is no task. The fold is gated on `viewing`, not on the flag alone.
  check(/panelOff: false/.test(doc), "the fold starts open");
  check(/canDraw: this\.canAuthor\(\)/.test(doc), "and so do the drawing tools");
  check(/canAuthor\(\) \{ return this\.isView\(\) \? \(!!this\.state\.viewPid && !this\.state\.travel\) : true; \}/.test(doc),
    "authoring is off in the roster and while browsing an old version");
  check(/canEdit: !RO/.test(doc), "the participant-flow buttons stay participant-only");
  check(/mine\(o\) \{ return this\.isView\(\) \? Object\.assign\(\{\}, o, \{ sm: true \}\) : o; \}/.test(doc),
    "everything the admin creates is flagged sm, so it saves to the sm: key");
  check(/concat\(\[this\.mine\(card\)\]\)/.test(doc), "a card dragged in during analysis is flagged");
  check(/concat\(\[this\.mine\(\{ id: id/.test(doc), "and so is a note");
  // Deck tiles use "RO ? NOOP :"; board objects use the per-object form so that admin
  // sensemaking copies stay editable while the participant's do not. Both must exist.
  const deckNoops = (doc.match(/this\.canAuthor\(\) \? \(e\) => this\.startNew/g) || []).length;
  const objNoops = (doc.match(/\(!RO \|\| c\.sm\) \?/g) || []).length;
  check(deckNoops >= 1, "deck tiles are live for whoever may author", ` (${deckNoops})`);
  check(objNoops >= 7, "every card handler is gated per object", ` (${objNoops})`);
  for (const h of ["onTitle", "onDesc", "onDup", "onDel"]) {
    check(new RegExp(h + ": \\(!RO \\|\\| c\\.sm\\) \\?").test(doc),
      `${h} cannot edit a participant card in admin`);
  }
  // 메모는 같은 판단을 own 한 번으로 / notes make the same judgement once and reuse it,
  // so the check is that every note handler goes through it and none slips past
  for (const h of ["onText", "onDel", "onFold", "onUnlinkDown", "onSizeDown", "onDupDown"]) {
    check(new RegExp(h + ": own \\?").test(doc), `${h} cannot edit a participant note in admin`);
  }

  // 7d-bis. view controls must survive the canEdit guard, editing controls must not.
  // resetView lives between the note and export buttons, so it is easy to sweep into
  // the guard by accident — and it is the control that recovers off-screen content.
  {
    // 툴바는 두 겹으로 나뉜다 / the toolbar is guarded in two layers: canDraw covers the
    // tools the admin shares with the participant, canEdit the participant's own flow.
    const di = doc.indexOf('<sc-if value="{{ canDraw }}"');
    const ei = doc.indexOf('<sc-if value="{{ canEdit }}"', di);
    const eEnd = doc.indexOf("</sc-if>", doc.indexOf("clearAll", ei));
    const drawBlock = doc.slice(di, ei);
    const editBlock = doc.slice(ei, eEnd);
    check(di > 0 && ei > di, "the drawing tools and the participant flow are separate blocks");
    // still reachable while viewing
    ["resetView", "zoomIn", "zoomOut"].forEach((n) =>
      check(!drawBlock.includes("{{ " + n + " }}") && !editBlock.includes("{{ " + n + " }}"),
        `${n} stays available in view mode`)
    );
    // shared with the admin in analysis mode
    ["toggleArrowMode", "toggleNoteMode", "togglePen"].forEach((n) =>
      check(drawBlock.includes("{{ " + n + " }}"), `${n} is a drawing tool, open to both`)
    );
    // never the admin's: these drive the participant through their own session
    ["doFinish", "clearAll", "goNext"].forEach((n) =>
      check(editBlock.includes("{{ " + n + " }}"), `${n} stays participant-only`)
    );
    // panning does not depend on the card layer, which is pointer-events:none
    check(/window\.addEventListener\('pointermove'/.test(doc), "pan listener is global");
    check(/if \(this\.state\.step >= 1\) this\.bindWheel\(\)/.test(doc),
      "wheel pan binds on both board steps");
  }

  // 7d-ter. text inside a card must be reachable and scrollable while viewing
  check(/pointer-events:\{\{ [cn]\.tpe \}\}/.test(doc), "card text re-enabled under pointer-events:none");
  check(/const TPE = PEN \? 'none' : 'auto';/.test(doc), "but not while the pen is up");
  // 이제 값으로 넘긴다 / the value is passed in now, because text must also go inert while
  // the pen is up: an input that hard-codes auto keeps taking presses whatever its card says
  // 다섯 / five now: the card description, the note, the card title, the chevron's label and
  // the 수단 chip's — the last two live in their own branches, not the shared card markup
  check((doc.match(/;pointer-events:\{\{ [cn]\.tpe \}\}/g) || []).length === 5,
    "every remaining text element is re-enabled",
    ` (${(doc.match(/;pointer-events:\{\{ [cn]\.tpe \}\}/g) || []).length})`);
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
  check(/if \(!this\.isView\(\) \|\| !pid \|\| !url \|\| this\.state\.travel\) return;/.test(doc),
    "pushSense refuses outside admin view mode, and while browsing history");
  check(/if \(!this\.isView\(\) \|\| !this\.state\.viewPid \|\| this\.state\.travel\) return;/.test(doc),
    "and it is never even scheduled from an old version");
  check(/cards: this\.state\.cards\.filter\(\(c\) => c\.sm\)/.test(doc),
    "only sm-flagged objects are sent, participant objects are filtered out");

  // 7g. hiding a record, and saying whose it is — there is no delete any more
  check(!/action: 'delete'/.test(doc), "the client has no delete path at all");
  check(!/delTyped|askDelete|confirmDelete/.test(doc), "and nothing left of its confirm dialog");
  check(/const key = 'mt:' \+ pid;/.test(doc), "hide and description write to an mt: key");
  check(/participant: key, kind: 'meta'/.test(doc), "posted as kind meta, one more appended row");
  check(/state: \{ hidden: !!r\.hidden, desc: r\.desc \|\| '' \}/.test(doc),
    "carrying both the flag and the description, so neither can clobber the other");
  // 숨김은 되돌릴 수 있어야 뜻이 있다 / hiding is only meaningful if it comes back
  check(/this\.state\.showHidden \? !!r\.hidden : !r\.hidden/.test(doc),
    "the two roster views are exact complements, so nothing falls out of both");
  check(/this\._mt = setTimeout/.test(doc), "the typed description is coalesced, not one row per keystroke");
  // 배포가 밀렸을 때 / a backend still on the old version returns mt: rows as participants
  check(/filter\(\(r\) => String\(r\.participant \|\| ''\)\.indexOf\('mt:'\) !== 0\)/.test(doc),
    "and a stale deployment cannot make the meta rows look like participants");

  // 7e. the roster path
  check(/this\.jsonp\('list=1'\)/.test(doc), "roster fetched via ?list=1");
  check(/ADMIN_CODE/.test(doc), "admin code constant present");
  check(/isStep0: this\.state\.step === 0 && !this\.state\.admin/.test(doc),
    "login screen suppressed in admin mode");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
process.exit(failures ? 1 : 0);
