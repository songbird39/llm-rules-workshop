#!/usr/bin/env python3
"""
Apply the UI-scale patch to the workshop app.

The app hardcodes every size in px (font-size 9–17px), which is unreadably small on a
1440p/4K monitor. This scales the whole interface with CSS `zoom` on the app root and
corrects the four places where pointer coordinates would otherwise disagree with layout
coordinates.

Runs against BOTH:
  - src/Card Workshop.dc.html   (readable source)
  - index.html                  (22 MB bundle; the app document is stored as a JSON
                                 string inside <script type="__bundler/template">, so we
                                 unpack -> patch -> re-serialize rather than string-poke
                                 the escaped text)

Every patch asserts it matched exactly once. Re-running is a no-op-safe error, not a
double-apply.
"""
import json
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

UI_CONST = """
/* ─────────────────────────────────────────────────────────────────
   UI 배율 / UI SCALE
   모든 크기가 px로 고정되어 있어 고해상도 모니터에서 글씨가 작습니다.
   앱 루트에 CSS zoom을 걸어 전체를 확대합니다.
   Every size in this app is a hardcoded px value, so the whole UI is
   tiny on a 1440p/4K display. We scale the app root with CSS `zoom`.
     ?ui=1      → exactly the old, unscaled behaviour (escape hatch)
     ?ui=1.5    → force a specific scale (clamped 0.8–2)
     no param   → auto from viewport width
   Pointer maths divides by UI in four places (toCanvas, pan, panel
   resize, drag ghost); if the browser lacks `zoom` support we fall
   back to 1 so those divisions stay correct rather than silently
   throwing the board out of alignment.
   ───────────────────────────────────────────────────────────────── */
const UI = (function () {
  try {
    if (typeof CSS === 'undefined' || !CSS.supports || !CSS.supports('zoom', '1.5')) return 1;
    const q = parseFloat(new URLSearchParams(location.search).get('ui'));
    if (q > 0) return Math.min(2, Math.max(0.8, q));
    const w = window.innerWidth || 0;
    return w >= 2200 ? 1.35 : w >= 1700 ? 1.2 : 1;
  } catch (e) { return 1; }
})();
"""

PATCHES = [
    # 1. the UI constant, right after the other layout constants
    (
        "const CARD = 168, STORE = 'llm-guardrail-workshop-v4';\n",
        "const CARD = 168, STORE = 'llm-guardrail-workshop-v4';\n" + UI_CONST,
    ),
    # 2. screen -> canvas. (cx - r.left) is in client px, which CSS zoom has already
    #    multiplied by UI; pan is in unscaled local px. Divide before subtracting.
    (
        "    return { x: (cx - r.left - this.state.pan.x) / z, y: (cy - r.top - this.state.pan.y) / z };",
        "    return { x: ((cx - r.left) / UI - this.state.pan.x) / z, y: ((cy - r.top) / UI - this.state.pan.y) / z };",
    ),
    # 3. panel resize: clientX delta is client px, panelW is local px
    (
        "this.setState({ panelW: Math.min(940, Math.max(210, d.pw + (e.clientX - d.sx))) });",
        "this.setState({ panelW: Math.min(940, Math.max(210, d.pw + (e.clientX - d.sx) / UI)) });",
    ),
    # 4. pan: same mismatch
    (
        "this.setState({ pan: { x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) } });",
        "this.setState({ pan: { x: d.px + (e.clientX - d.sx) / UI, y: d.py + (e.clientY - d.sy) / UI } });",
    ),
    # 5. drag ghost is position:fixed *inside* the zoomed subtree, so its px left/top get
    #    multiplied by UI on screen. Pre-divide so it tracks the cursor.
    (
        "      ghostX: this.state.ghost ? this.state.ghost.x + 14 : 0,\n"
        "      ghostY: this.state.ghost ? this.state.ghost.y + 12 : 0,",
        "      ghostX: this.state.ghost ? (this.state.ghost.x + 14) / UI : 0,\n"
        "      ghostY: this.state.ghost ? (this.state.ghost.y + 12) / UI : 0,\n"
        "      ui: UI,",
    ),
    # 6. the app root: apply the zoom, and shrink the layout height to compensate so the
    #    scaled result still fills exactly one viewport (100vh is not affected by zoom).
    (
        '<div style="display:flex;flex-direction:column;height:100vh;overflow:hidden">',
        '<div style="display:flex;flex-direction:column;height:calc(100vh / {{ ui }});zoom:{{ ui }};overflow:hidden">',
    ),
]


def patch(text, label):
    for i, (old, new) in enumerate(PATCHES, 1):
        n = text.count(old)
        if n != 1:
            raise SystemExit(
                f"[{label}] patch {i} matched {n} times, expected 1.\n"
                f"  looking for: {old[:90]!r}"
            )
        text = text.replace(old, new)
    return text


def main():
    # --- readable source ---
    src = ROOT / "src" / "Card Workshop.dc.html"
    s = src.read_text(encoding="utf-8")
    src.write_text(patch(s, "src"), encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")

    # --- bundle ---
    bundle = ROOT / "index.html"
    b = bundle.read_text(encoding="utf-8")
    tag = '<script type="__bundler/template">'
    j = b.index(tag)
    start = b.index(">", j) + 1
    end = b.index("</script>", start)
    raw = b[start:end]
    doc = json.loads(raw.strip())
    doc2 = patch(doc, "bundle")
    # The template is a JSON string sitting inside a <script> element, so a literal
    # "</" in it would close that element early and corrupt the bundle. The original
    # bundler escapes the slash; match it exactly. / is a valid JSON escape, so
    # JSON.parse still yields the same string.
    payload = json.dumps(doc2, ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload, "unescaped </ would truncate the script element"
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
