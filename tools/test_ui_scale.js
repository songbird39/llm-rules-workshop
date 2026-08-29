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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
process.exit(failures ? 1 : 0);
