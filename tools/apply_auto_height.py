#!/usr/bin/env python3
"""
Cards grow downward to fit their text; scrolling inside a card is never needed.
Measured geometry is stored on the card so a board reloads exactly as it was left.

HOW
  Layout is CSS-driven, state only records the result — no feedback loop:
    - the card container loses its fixed height and sizes to its content
    - the diagram box and the text boxes get explicit min-heights that reproduce
      today's 168px card when the text is short, so nothing looks different until
      text actually overflows
    - autoGrow() sizes every [data-grow] textarea to its scrollHeight after render
    - measureCards() records each card's rendered offsetHeight into c.h

  measureCards setStates only when a height moved by >1px, so the pass converges on
  the first re-render and then goes quiet.

WHY c.h MATTERS BEYOND LAYOUT
  cardRect() feeds arrow endpoints and link hit-testing. With fixed 168 it would draw
  arrows to the wrong edge of a tall card. It now uses the measured height, falling
  back to the old constants when a card has not been measured yet (e.g. a board
  restored from an older save, before its first render pass).

GROUPING IS DELIBERATELY UNCHANGED
  rows() groups cards into "combinations" by top edge with a CARD*0.7 tolerance, and
  y-snapping aligns tops only ([c.y]). Both are height-independent, so combinations
  extracted from a board mean the same thing before and after this change. x-snapping
  uses CARD as a width, which is still 168.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# --------------------------------------------------------------- markup (src form)
MARKUP = [
    # card container: content-sized, and tagged so measureCards can find it
    (
        '<div onPointerDown="{{ c.onDown }}" style="position:absolute;left:{{ c.x }}px;top:{{ c.y }}px;width:168px;height:{{ c.h }}px;display:flex;',
        '<div data-card="{{ c.id }}" onPointerDown="{{ c.onDown }}" style="position:absolute;left:{{ c.x }}px;top:{{ c.y }}px;width:168px;display:flex;',
        1,
    ),
    # board diagram box: fixed height instead of a flex share (there is nothing to
    # share once the column is auto-height). 50px reproduces today's proportions.
    (
        '<div style="flex:0.95;min-height:0;display:flex;align-items:center;justify-content:center;border:1px solid #eae7df;border-radius:5px;background:#f7f5f0;padding:1px 2px;overflow:hidden">{{ c.diagram }}</div>',
        '<div style="flex:none;height:50px;display:flex;align-items:center;justify-content:center;border:1px solid #eae7df;border-radius:5px;background:#f7f5f0;padding:1px 2px;overflow:hidden">{{ c.diagram }}</div>',
        1,
    ),
    # when/how description: wrapper stops stretching, textarea grows instead
    (
        '<div style="flex:1;min-height:0;border-top:1px solid #eae7df;padding-top:4px">',
        '<div style="flex:none;border-top:1px solid #eae7df;padding-top:4px">',
        1,
    ),
    (
        'placeholder="{{ t.descPh }}" style="width:100%;height:100%;border:none;background:transparent;font-size:12px;line-height:1.45;color:#5b584f;outline:none;padding:0;pointer-events:auto"',
        'data-grow="1" placeholder="{{ t.descPh }}" style="width:100%;height:auto;min-height:48px;overflow:hidden;resize:none;border:none;background:transparent;font-size:12px;line-height:1.45;color:#5b584f;outline:none;padding:0;pointer-events:auto"',
        1,
    ),
    # expanded rule card body
    (
        '<div style="flex:1;min-height:0;border:1px solid #eae7df;border-radius:5px;background:#f7f5f0;padding:7px">',
        '<div style="flex:none;border:1px solid #eae7df;border-radius:5px;background:#f7f5f0;padding:7px">',
        1,
    ),
    (
        'placeholder="{{ t.writeRule }}" style="width:100%;height:100%;border:none;background:transparent;font-size:12px;font-weight:500;line-height:1.5;letter-spacing:-0.015em;text-align:center;color:#26251f;outline:none;padding:0;pointer-events:auto"',
        'data-grow="1" placeholder="{{ t.writeRule }}" style="width:100%;height:auto;min-height:92px;overflow:hidden;resize:none;border:none;background:transparent;font-size:12px;font-weight:500;line-height:1.5;letter-spacing:-0.015em;text-align:center;color:#26251f;outline:none;padding:0;pointer-events:auto"',
        1,
    ),
    # collapsed rule card text: auto height, no clipping needed any more
    (
        '<div data-scroll="1" style="flex:1;min-height:0;font-size:12px;line-height:1.4;color:#5b584f;overflow:{{ descOverflow }};padding:0 2px;pointer-events:auto">{{ c.desc }}</div>',
        '<div data-scroll="1" style="flex:none;min-height:30px;font-size:12px;line-height:1.4;color:#5b584f;overflow:{{ descOverflow }};padding:0 2px;pointer-events:auto">{{ c.desc }}</div>',
        1,
    ),
    # notes grow too — same reasoning, and they are card-shaped now
    (
        'placeholder="{{ t.notePh }}" rows="3" style="width:100%;border:1px dashed #c2beb2;',
        'data-grow="1" placeholder="{{ t.notePh }}" rows="3" style="width:100%;height:auto;min-height:62px;overflow:hidden;resize:none;border:1px dashed #c2beb2;',
        1,
    ),
]

# --------------------------------------------------------------- JS (identical in both)
CODE = [
    (
        "cardRect(c) { return { x: c.x, y: c.y, w: CARD, h: (c.type === 'rule' && c.collapsed) ? 90 : 168 }; }",
        "// 실제로 렌더된 높이를 쓴다 — 화살표 끝점과 링크 판정이 키 큰 카드에서도 맞도록\n"
        "  // Use the measured height so arrow endpoints and link hit-testing follow a tall\n"
        "  // card. Falls back to the old constants until the first measure pass runs.\n"
        "  cardRect(c) { return { x: c.x, y: c.y, w: CARD, h: c.h || ((c.type === 'rule' && c.collapsed) ? 90 : 168) }; }\n"
        "\n"
        "  // 글이 넘치지 않도록 textarea 높이를 내용에 맞춘다 / size every growable textarea to\n"
        "  // its content, so a card never needs an inner scrollbar\n"
        "  autoGrow() {\n"
        "    const list = document.querySelectorAll('textarea[data-grow]');\n"
        "    for (let i = 0; i < list.length; i++) {\n"
        "      const el = list[i];\n"
        "      el.style.height = 'auto';           // let it shrink back when text is deleted\n"
        "      el.style.height = el.scrollHeight + 'px';   // CSS min-height still applies\n"
        "    }\n"
        "  }\n"
        "\n"
        "  // 렌더된 높이를 카드에 기록 (저장·복원·화살표가 같은 값을 보도록)\n"
        "  // Record the rendered height on each card. Only writes when it actually moved,\n"
        "  // so this settles after one extra render instead of looping.\n"
        "  measureCards() {\n"
        "    const els = document.querySelectorAll('[data-card]');\n"
        "    if (!els.length) return;\n"
        "    const seen = {};\n"
        "    for (let i = 0; i < els.length; i++) seen[els[i].getAttribute('data-card')] = els[i].offsetHeight;\n"
        "    let changed = false;\n"
        "    const next = this.state.cards.map((c) => {\n"
        "      const h = seen[c.id];\n"
        "      if (h && Math.abs((c.h || 0) - h) > 1) { changed = true; return Object.assign({}, c, { h: h }); }\n"
        "      return c;\n"
        "    });\n"
        "    if (changed) this.setState({ cards: next });\n"
        "  }",
        1,
    ),
    (
        "componentDidUpdate() {\n    if (this.state.step === 2) this.bindWheel();",
        "componentDidUpdate() {\n"
        "    if (this.state.step === 2) this.bindWheel();\n"
        "    if (this.state.step === 2) { this.autoGrow(); this.measureCards(); }",
        1,
    ),
    (
        "    if (this.syncUrl() && this.queueRead().length) this.flush();\n  }",
        "    if (this.syncUrl() && this.queueRead().length) this.flush();\n"
        "    this.autoGrow();\n  }",
        1,
    ),
    # the prop no longer drives layout, but keep it truthful
    ("h: folded ? 90 : 168,", "h: c.h || (folded ? 90 : 168),", 1),
]


def to_bundle(s):
    return re.sub(
        r"\b(on[A-Z][a-zA-Z]*|autoFocus)=",
        lambda m: "sc-camel-" + re.sub(r"(?<!^)([A-Z])", r"-\1", m.group(1)).lower() + "=",
        s,
    )


def patch(text, label, bundle=False):
    steps = [(to_bundle(o), to_bundle(n), w) if bundle else (o, n, w) for (o, n, w) in MARKUP] + CODE
    for i, (old, new, want) in enumerate(steps, 1):
        n = text.count(old)
        if n != want:
            raise SystemExit(f"[{label}] patch {i} matched {n} times, expected {want}\n  {old[:120]!r}")
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
    assert "</" not in payload

    src.write_text(src_out, encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
