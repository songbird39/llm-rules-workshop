#!/usr/bin/env python3
"""
Keep "Reset view" (화면 맞춤) available in admin view mode.

The view-mode patch wrapped the editing buttons in <sc-if canEdit>, but resetView sits
between the note and export buttons in the toolbar, so it got hidden along with them.
That is the one control that snaps pan back to 0,0 and zoom to 100% — without it, if a
participant's cards sit off to one side, the board looks empty and unreachable.

resetView only touches pan/zoom. sig() does not include pan or zoom, so it cannot even
schedule an autosave, and the write guards block that path regardless. It is safe to
expose while viewing.

Panning itself was never broken: pointermove/pointerup are bound to window, and the
wheel handler binds whenever step === 2 (which view mode reaches via applyState).
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

RESET_BTN = (
    '        <button onClick="{{ resetView }}" style="padding:7px 12px;border:1px solid '
    '#d6d3ca;border-radius:7px;background:#fff;font-size:13.5px;cursor:pointer" '
    'style-hover="background:#f1efe8">{{ t.fit }}</button>\n'
)
GUARD_OPEN = '        <sc-if value="{{ canEdit }}" hint-placeholder-val="{{ true }}">\n'

MARKUP_PATCHES = [
    # 1. pull resetView out of the guarded block
    (RESET_BTN, "", 1),
    # 2. re-insert it just above the guard, so it shows in both modes
    (GUARD_OPEN, RESET_BTN + GUARD_OPEN, 1),
]


def to_bundle(s):
    """src uses React-style attributes; the build rewrites them (onClick -> sc-camel-on-click)."""
    return re.sub(
        r"\b(on[A-Z][a-zA-Z]*|autoFocus)=",
        lambda m: "sc-camel-" + re.sub(r"(?<!^)([A-Z])", r"-\1", m.group(1)).lower() + "=",
        s,
    )


def patch(text, label, bundle=False):
    steps = [
        (to_bundle(o), to_bundle(n), w) if bundle else (o, n, w)
        for (o, n, w) in MARKUP_PATCHES
    ]
    for i, (old, new, want) in enumerate(steps, 1):
        n = text.count(old)
        if n != want:
            raise SystemExit(
                f"[{label}] patch {i} matched {n} times, expected {want}\n"
                f"  looking for: {old[:100]!r}"
            )
        text = text.replace(old, new, 1)
    return text


def main():
    src = ROOT / "src" / "Card Workshop.dc.html"
    bundle = ROOT / "index.html"

    src_out = patch(src.read_text(encoding="utf-8"), "src")

    b = bundle.read_text(encoding="utf-8")
    tag = '<script type="__bundler/template">'
    j = b.index(tag)
    start = b.index(">", j) + 1
    end = b.index("</script>", start)
    doc = json.loads(b[start:end].strip())
    payload = json.dumps(patch(doc, "bundle", bundle=True), ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload, "unescaped </ would truncate the script element"

    src.write_text(src_out, encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
