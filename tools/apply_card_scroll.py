#!/usr/bin/env python3
"""
Let text inside a card scroll, instead of the board panning underneath it.

TWO SEPARATE BLOCKERS

1. The wheel handler on the canvas calls e.preventDefault() unconditionally and pans.
   Any wheel event over a card - including over an overflowing description - panned the
   board instead of scrolling the text. That affected PARTICIPANTS too: nobody could
   wheel-scroll a description longer than the card. Now the handler first checks whether
   the pointer is over an overflowing textarea (or an element marked data-scroll) and,
   if scrolling in that direction is still possible, lets the browser scroll it natively.
   At the top/bottom edge it falls through to panning, so the board never feels stuck.

2. View mode sets pointer-events:none on the whole card layer, which makes the
   textareas untargetable — you cannot click, select or scroll them. Re-enabled with
   pointer-events:auto on the text elements only. The card body stays inert, so cards
   still cannot be dragged, and every mutating handler is already a no-op. In
   participant mode the layer is pointer-events:auto anyway, so this changes nothing.

Collapsed rule cards render their text in a div with overflow:hidden. In view mode that
becomes overflow:auto (via descOverflow) so the clipped remainder is reachable; for
participants it stays clipped, which is the intended collapsed look.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# ---- 1. wheel: let overflowing card text scroll itself -----------------------
WHEEL_OLD = """    this._wheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoomBy(e.deltaY > 0 ? -0.08 : 0.08);
      else this.setState((s) => ({ pan: { x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY } }));
    };"""

WHEEL_NEW = """    this._wheel = (e) => {
      // 카드 안 글이 넘칠 때는 보드를 움직이지 말고 카드 안에서 스크롤되게 둔다.
      // Let overflowing text inside a card scroll itself rather than panning the board.
      // Falls through to panning at the top/bottom edge, so the board never feels stuck.
      if (!e.ctrlKey && !e.metaKey && e.deltaY) {
        const sc = e.target && e.target.closest && e.target.closest('textarea,[data-scroll]');
        if (sc && sc.scrollHeight - sc.clientHeight > 1) {
          const room = e.deltaY > 0
            ? sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1
            : sc.scrollTop > 0;
          if (room) return;
        }
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoomBy(e.deltaY > 0 ? -0.08 : 0.08);
      else this.setState((s) => ({ pan: { x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY } }));
    };"""

# ---- 2. make the text elements hit-testable even under pointer-events:none ---
PE = ";pointer-events:auto"

MARKUP_PATCHES = [
    (WHEEL_OLD, WHEEL_NEW, 1),
    # when/how card description
    (
        'placeholder="{{ t.descPh }}" style="width:100%;height:100%;border:none;background:transparent;font-size:12px;line-height:1.45;color:#5b584f;outline:none;padding:0"',
        'placeholder="{{ t.descPh }}" style="width:100%;height:100%;border:none;background:transparent;font-size:12px;line-height:1.45;color:#5b584f;outline:none;padding:0' + PE + '"',
        1,
    ),
    # expanded rule card body
    (
        'placeholder="{{ t.writeRule }}" style="width:100%;height:100%;border:none;background:transparent;font-size:12px;font-weight:500;line-height:1.5;letter-spacing:-0.015em;text-align:center;color:#26251f;outline:none;padding:0"',
        'placeholder="{{ t.writeRule }}" style="width:100%;height:100%;border:none;background:transparent;font-size:12px;font-weight:500;line-height:1.5;letter-spacing:-0.015em;text-align:center;color:#26251f;outline:none;padding:0' + PE + '"',
        1,
    ),
    # collapsed rule card: scrollable while viewing, still clipped for participants
    (
        '<div style="flex:1;min-height:0;font-size:12px;line-height:1.4;color:#5b584f;overflow:hidden;padding:0 2px">{{ c.desc }}</div>',
        '<div data-scroll="1" style="flex:1;min-height:0;font-size:12px;line-height:1.4;color:#5b584f;overflow:{{ descOverflow }};padding:0 2px' + PE + '">{{ c.desc }}</div>',
        1,
    ),
    # sticky notes
    (
        'placeholder="{{ t.notePh }}" rows="3" style="width:100%;border:1px dashed #c2beb2;border-radius:7px;background:rgba(255,254,251,0.7);font-size:13px;line-height:1.55;color:#44423b;outline:none;padding:8px 10px;font-family:inherit"',
        'placeholder="{{ t.notePh }}" rows="3" style="width:100%;border:1px dashed #c2beb2;border-radius:7px;background:rgba(255,254,251,0.7);font-size:13px;line-height:1.55;color:#44423b;outline:none;padding:8px 10px;font-family:inherit' + PE + '"',
        1,
    ),
    # Card title (long titles are ellipsised — let them be clicked into and read).
    # Anchored on the style string only: src self-closes the tag (`/>`) while the
    # bundle does not, so the full element text differs between the two files.
    (
        'style="flex:1;min-width:0;border:none;background:transparent;font-size:12.5px;font-weight:600;letter-spacing:-0.01em;outline:none;padding:0"',
        'style="flex:1;min-width:0;border:none;background:transparent;font-size:12.5px;font-weight:600;letter-spacing:-0.01em;outline:none;padding:0' + PE + '"',
        1,
    ),
]

# ---- 3. the prop that drives the collapsed-card overflow ---------------------
PROP_PATCH = (
    "      layerPE: RO ? 'none' : 'auto',",
    "      layerPE: RO ? 'none' : 'auto',\n"
    "      descOverflow: RO ? 'auto' : 'hidden',",
    1,
)


def to_bundle(s):
    """src uses React-style attributes; the build rewrites them."""
    return re.sub(
        r"\b(on[A-Z][a-zA-Z]*|autoFocus)=",
        lambda m: "sc-camel-" + re.sub(r"(?<!^)([A-Z])", r"-\1", m.group(1)).lower() + "=",
        s,
    )


def patch(text, label, bundle=False):
    steps = [
        (to_bundle(o), to_bundle(n), w) if bundle else (o, n, w)
        for (o, n, w) in MARKUP_PATCHES
    ] + [PROP_PATCH]
    for i, (old, new, want) in enumerate(steps, 1):
        n = text.count(old)
        if n != want:
            raise SystemExit(
                f"[{label}] patch {i} matched {n} times, expected {want}\n"
                f"  looking for: {old[:110]!r}"
            )
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
    payload = json.dumps(patch(doc, "bundle", bundle=True), ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload, "unescaped </ would truncate the script element"

    src.write_text(src_out, encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
