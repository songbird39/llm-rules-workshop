#!/usr/bin/env python3
"""
Drop rule cards at full size instead of pre-collapsed.

addCard() created rule cards with `collapsed: type === 'rule'`, so a rule card that
looked like a full 168px card in the panel shrank to 90px the moment it landed on the
board — and swapped its centred body text for the small collapsed summary. Every other
card type keeps its size on drop, so rule cards were the odd one out.

Now they land expanded (168px, editable textarea). The fold control is untouched, so a
participant can still collapse a rule card deliberately; it just is not the default.

Also aligns line-height 1.45 -> 1.5 so the board's rule textarea matches the panel
card's body metrics exactly. The one remaining difference is vertical centring: the
panel card centres its text, the board card top-aligns it because it is an editable
textarea and textareas cannot be vertically centred without hacks. Top alignment is the
right behaviour for something you type into.

Single creation path: both drag-drop (onUp -> addCard) and double-click
(quickAdd -> addCard) go through addCard, so one change covers both.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

PATCHES = [
    # land expanded, like every other card type
    (
        "dia: tpl.dia || null, collapsed: type === 'rule', x: this.fix(x), y: this.fix(y) }",
        "dia: tpl.dia || null, collapsed: false, x: this.fix(x), y: this.fix(y) }",
        1,
    ),
    # match the panel card's line-height so the text metrics are identical
    (
        "font-size:12px;font-weight:500;line-height:1.45;letter-spacing:-0.015em;text-align:center;color:#26251f;outline:none;padding:0",
        "font-size:12px;font-weight:500;line-height:1.5;letter-spacing:-0.015em;text-align:center;color:#26251f;outline:none;padding:0",
        1,
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
