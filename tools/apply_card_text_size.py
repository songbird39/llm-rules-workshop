#!/usr/bin/env python3
"""
Enlarge the card description text (10.5px -> 12px).

10.5px was the smallest body text in the app. The catch is that cards are a fixed
168x168 box with overflow:hidden, so a bigger font means fewer lines fit and the
longest descriptions get silently truncated. To pay for it we shrink the diagram
panel's flex from 1.15 to 0.95 — the diagram is an SVG with
viewBox="0 0 120 52" + preserveAspectRatio="xMidYMid meet", so a shorter box
scales it down rather than cropping it.

Budget (panel deck card, the read-only one where truncation is unrecoverable):

  content box            168 - 2*7 padding - 2*1 border      = 152px
  title row              12.5px text + 2*3 padding           ~  21px
  two 5px gaps                                               =  10px
  left for diagram+desc                                      = 121px
  desc at flex 1 of 1.95                                     =  62.0px
  minus 1px border-top + 4px padding-top                     =  57.0px
  12px * 1.45 line-height                                    =  17.4px/line
  -> 3.2 lines, and the longest description needs 3          OK

tools/test_ui_scale.js re-checks that budget so it can't silently regress.

Applies to src/Card Workshop.dc.html and the index.html bundle. Idempotent-unsafe by
design: each patch asserts its exact expected occurrence count.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

PATCHES = [
    # description text: panel deck cards (x2 — the "when" and "how" decks)
    (
        "border-top:1px solid #eae7df;padding-top:4px;font-size:10.5px;line-height:1.45;color:#5b584f;overflow:hidden",
        "border-top:1px solid #eae7df;padding-top:4px;font-size:12px;line-height:1.45;color:#5b584f;overflow:hidden",
        2,
    ),
    # description text: collapsed rule card on the board
    (
        "font-size:10.5px;line-height:1.4;color:#5b584f;overflow:hidden;padding:0 2px",
        "font-size:12px;line-height:1.4;color:#5b584f;overflow:hidden;padding:0 2px",
        1,
    ),
    # description text: editable card on the board
    (
        "font-size:10.5px;line-height:1.45;color:#5b584f;outline:none;padding:0",
        "font-size:12px;line-height:1.45;color:#5b584f;outline:none;padding:0",
        1,
    ),
    # buy the vertical room back from the diagram (x3 — 2 panel decks + board card)
    (
        "flex:1.15;min-height:0;display:flex;align-items:center;justify-content:center;border:1px solid #eae7df",
        "flex:0.95;min-height:0;display:flex;align-items:center;justify-content:center;border:1px solid #eae7df",
        3,
    ),
]


def patch(text, label):
    for i, (old, new, want) in enumerate(PATCHES, 1):
        n = text.count(old)
        if n != want:
            raise SystemExit(
                f"[{label}] patch {i} matched {n} times, expected {want}\n"
                f"  looking for: {old[:80]!r}"
            )
        text = text.replace(old, new)
    return text


def main():
    src = ROOT / "src" / "Card Workshop.dc.html"
    src.write_text(patch(src.read_text(encoding="utf-8"), "src"), encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")

    bundle = ROOT / "index.html"
    b = bundle.read_text(encoding="utf-8")
    tag = '<script type="__bundler/template">'
    j = b.index(tag)
    start = b.index(">", j) + 1
    end = b.index("</script>", start)
    doc = json.loads(b[start:end].strip())
    payload = json.dumps(patch(doc, "bundle"), ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload, "unescaped </ would truncate the script element"
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
