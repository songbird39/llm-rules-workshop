#!/usr/bin/env python3
"""
Scale the drag ghost with the board zoom, so the preview is the size of the card.

The ghost is position:fixed, so it is scaled by the UI zoom alone (168 * UI on screen).
The card it previews lives in the canvas layer and is scaled by UI * board zoom. At any
board zoom other than 100% the preview was therefore the wrong size — noticeably too
large when zoomed out.

Using transform:scale rather than resizing the box: a smaller width/height would shrink
the frame but leave the title and body text at their original px, so the preview would
stop looking like a card. transform scales the whole subtree, text included.

transform-origin:0 0 keeps the top-left pinned to (ghostX, ghostY), which is what the
drop position now matches — see tools/apply_drop_offset.py. Scaling from the centre
would reintroduce an offset that grows with zoom.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

PATCHES = [
    (
        '<div style="position:fixed;left:{{ ghostX }}px;top:{{ ghostY }}px;width:168px;height:168px;pointer-events:none;z-index:50;opacity:0.92;',
        '<div style="position:fixed;left:{{ ghostX }}px;top:{{ ghostY }}px;width:168px;height:168px;transform:scale({{ ghostScale }});transform-origin:0 0;pointer-events:none;z-index:50;opacity:0.92;',
        1,
    ),
    (
        "      ghostX: this.state.ghost ? (this.state.ghost.x + GHOST_DX) / UI : 0,",
        "      // 보드 확대율만큼 미리보기도 같이 확대 / preview scales with the board, so it is\n"
        "      // the size of the card that will land\n"
        "      ghostScale: this.state.zoom || 1,\n"
        "      ghostX: this.state.ghost ? (this.state.ghost.x + GHOST_DX) / UI : 0,",
        1,
    ),
]


def patch(text, label):
    for i, (old, new, want) in enumerate(PATCHES, 1):
        n = text.count(old)
        if n != want:
            raise SystemExit(f"[{label}] patch {i} matched {n} times, expected {want}\n  {old[:110]!r}")
        text = text.replace(old, new)
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
    payload = json.dumps(patch(doc, "bundle"), ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload

    src.write_text(src_out, encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
