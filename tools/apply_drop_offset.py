#!/usr/bin/env python3
"""
Make the drop position match the drag ghost.

While dragging, the ghost is drawn at cursor + (14, 12) screen px — down and to the
right of the pointer. On release, addCard() placed the card at (p.x - CARD/2, p.y - 26),
i.e. horizontally centred on the cursor and slightly above it. So the card jumped left
and up at the moment you let go.

Now a single pair of constants, GHOST_DX/GHOST_DY, drives both, so the two cannot drift
apart again.

UNIT CARE. The ghost offset is in screen px: the ghost is position:fixed, so its px are
multiplied by the UI zoom only. A card's position is in local canvas px, which render
multiplied by UI *and* the board zoom. To land the card's top-left under the same screen
point the ghost occupied:

    rendered(L) = rectLeft + (pan + L*zoom) * UI
    want rendered(L) = cursorClient + GHOST_D
    => L = p + GHOST_D / (zoom * UI)

so the offset is divided by (zoom * UI) when converting into canvas coordinates.

NOT FIXED (pre-existing, and out of scope here): the ghost is a fixed 168px box scaled
only by UI, while the dropped card is scaled by UI * zoom. At board zoom other than
100% the ghost is therefore a different *size* from the card it previews. Position now
matches at any zoom; size still does not.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

PATCHES = [
    # one source of truth for the offset
    (
        "const CARD = 168, STORE = 'llm-guardrail-workshop-v4';",
        "const CARD = 168, STORE = 'llm-guardrail-workshop-v4';\n"
        "// 드래그 중 미리보기와 놓았을 때의 위치를 같게 만드는 오프셋 (커서 기준 오른쪽 아래)\n"
        "// Ghost/drop offset, in screen px, down-and-right of the cursor. Used by BOTH the\n"
        "// drag preview and addCard on release so they cannot disagree.\n"
        "const GHOST_DX = 14, GHOST_DY = 12;",
        1,
    ),
    # the ghost uses the constants
    (
        "      ghostX: this.state.ghost ? (this.state.ghost.x + 14) / UI : 0,\n"
        "      ghostY: this.state.ghost ? (this.state.ghost.y + 12) / UI : 0,",
        "      ghostX: this.state.ghost ? (this.state.ghost.x + GHOST_DX) / UI : 0,\n"
        "      ghostY: this.state.ghost ? (this.state.ghost.y + GHOST_DY) / UI : 0,",
        1,
    ),
    # the drop lands where the ghost was, not centred on the cursor
    (
        "        this.addCard(d.type, d.tpl, p.x - CARD / 2, p.y - 26);",
        "        // 미리보기와 같은 자리에 놓는다 / land where the ghost was.\n"
        "        // screen px -> canvas px: divide by board zoom and UI zoom.\n"
        "        const k = (this.state.zoom || 1) * UI;\n"
        "        this.addCard(d.type, d.tpl, p.x + GHOST_DX / k, p.y + GHOST_DY / k);",
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
