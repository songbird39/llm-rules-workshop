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
  ["ghost divides by UI", "(this.state.ghost.x + 14) / UI"],
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

// ---- 6. a rule card must look the same on the board as in the panel ----
console.log("\nrule card keeps its size on drop");
{
  check(!/collapsed: type === 'rule'/.test(doc), "not created pre-collapsed");
  check(/collapsed: false/.test(doc), "created expanded");
  // the fold control must still exist — collapsing stays available, just not default
  check(/onFold: \(\) => this\.patch\(c\.id, 'collapsed', !c\.collapsed\)/.test(doc),
    "fold control still present");
  check(/h: folded \? 90 : 168/.test(doc), "collapsed height still defined");

  // text metrics parity between the panel card body and the board card textarea
  const grab = (re) => {
    const m = doc.match(re);
    return m ? m[0] : null;
  };
  const panel = grab(/font-size:12px;font-weight:500;line-height:[\d.]+;letter-spacing:-0\.015em;color:#26251f;overflow:hidden;text-align:center/);
  const board = grab(/font-size:12px;font-weight:500;line-height:[\d.]+;letter-spacing:-0\.015em;text-align:center;color:#26251f;outline:none/);
  const lh = (s) => s && s.match(/line-height:([\d.]+)/)[1];
  check(panel !== null && board !== null, "found both rule-card renderings");
  check(lh(panel) === lh(board),
    "line-height matches", ` (panel ${lh(panel)} vs board ${lh(board)})`);

  // and the longest rule description still fits the expanded board card
  const ruleDescs = [...doc.matchAll(/\['(?:use|way|alt)', '[^']*', '([^']*)'\]/g)].map((m) => m[1]);
  const CARD = 168, PAD = 7, BORDER = 1, GAP = 5;
  const content = CARD - 2 * PAD - 2 * BORDER;            // 152
  const titleRow = 12.5 * 1.2 + 2 * 3;
  const footer = 13;
  const box = content - titleRow - footer - 2 * GAP;      // the desc box (flex:1, alone)
  const textArea = box - 2 * PAD - 2 * BORDER;            // its own padding+border
  const linesFit = Math.floor(textArea / (12 * 1.5));
  const emWidth = (t) => [...t].reduce((n, c) => n + (c.codePointAt(0) > 0x1100 ? 1 : 0.5), 0);
  const perLine = (content - 2 * PAD) / 12;
  const worst = ruleDescs.reduce((a, d) => Math.max(a, Math.ceil(emWidth(d) / perLine)), 0);
  console.log(`       expanded rule card: ${textArea.toFixed(1)}px of text room = ${linesFit} lines; ` +
    `longest of ${ruleDescs.length} rule descriptions needs ${worst}`);
  check(linesFit >= worst, "longest rule description fits", ` (${linesFit} >= ${worst})`);
}

// ---- 7. view mode must not be able to write ----
// The whole point: viewing P01 must never produce a localStorage write or a sheet
// POST, because latestState_() takes the newest row and would adopt the accident.
console.log("\nview mode cannot write");
{
  // 7a. the guard must be the FIRST statement of each write path — stronger than
  // "appears somewhere in the body", and it is what makes the bail-out unconditional.
  const guardedFirst = (signature) => {
    const i = doc.indexOf("  " + signature + " {");
    if (i < 0) return false;
    const head = doc.slice(i + signature.length + 5, i + signature.length + 60);
    return /^\s*if \(this\.isView\(\)\) return;/.test(head);
  };
  check(guardedFirst("scheduleAutosave()"), "scheduleAutosave bails on isView() first");
  check(guardedFirst("enqueue(kind)"), "enqueue bails on isView() first");
  check(guardedFirst("exportJson()"), "exportJson bails on isView() first");
  check(/this\.state\.pid && !this\.isView\(\)/.test(doc),
    "componentDidUpdate localStorage write checks isView()");

  // 7b. admin mode must leave state.pid empty — that alone disables every path
  check(/admin: true, viewPid: '', loginPid: '', pid: '', step: 0/.test(doc),
    "admin login clears state.pid");
  check(/openParticipant\(pid\) \{\s*this\.setState\(\{ viewPid: pid/.test(doc),
    "viewed code goes to viewPid, not pid");

  // 7c. simulate the guards for real
  const isView = (admin) => !!admin;
  const wouldWriteLocal = (st) => st.step > 0 && !!st.pid && !isView(st.admin);
  const wouldAutosave = (st) => !isView(st.admin) && st.step >= 1 && !!st.pid;
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

  // 7d. read-only UI
  check(/layerPE: RO \? 'none' : 'auto'/.test(doc), "card layer goes pointer-events:none");
  check(/showPanel: !RO/.test(doc), "card panel hidden while viewing");
  check(/canEdit: !RO/.test(doc), "editing toolbar hidden while viewing");
  const noops = (doc.match(/RO \? NOOP :/g) || []).length;
  check(noops >= 6, "mutating handlers swapped for no-ops", ` (${noops} found)`);

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
    ["toggleArrowMode", "toggleNoteMode", "exportJson", "clearAll"].forEach((n) =>
      check(inGuard(n), `${n} hidden in view mode`)
    );
    // panning does not depend on the card layer, which is pointer-events:none
    check(/window\.addEventListener\('pointermove'/.test(doc), "pan listener is global");
    check(/if \(this\.state\.step === 2\) this\.bindWheel\(\)/.test(doc),
      "wheel pan binds on the board step");
  }

  // 7d-ter. text inside a card must be reachable and scrollable while viewing
  check(/pointer-events:auto/.test(doc), "card text re-enabled under pointer-events:none");
  check((doc.match(/pointer-events:auto/g) || []).length === 5,
    "all five text elements re-enabled",
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

  // 7e. the roster path
  check(/this\.jsonp\('list=1'\)/.test(doc), "roster fetched via ?list=1");
  check(/ADMIN_CODE/.test(doc), "admin code constant present");
  check(/isStep0: this\.state\.step === 0 && !this\.state\.admin/.test(doc),
    "login screen suppressed in admin mode");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
process.exit(failures ? 1 : 0);
