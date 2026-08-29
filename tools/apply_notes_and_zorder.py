#!/usr/bin/env python3
"""
Batch 1a: note/card parity, and click-brings-to-front.

NOTES MATCH CARDS
  width   200px -> 168px (CARD)
  font    13px  -> 12px  (the card description size)
  delete  moved from a header row above the note to a footer row below it, matching
          the card's footer exactly (height:13px, right-aligned, line-height:13px).
  The note keeps its dashed border, which is what distinguishes it from a card.

CLICK BRINGS TO FRONT
  Cards were reordered to the end of the array (= painted last) only when a drag
  actually started, and startMove returns early when the pointer lands on an INPUT,
  TEXTAREA or BUTTON. So clicking a card's text left it behind its neighbours.
  The raise now happens before that early return, and notes get the same treatment,
  which they previously had not at all.

  Raising is pure z-order: it reorders the array, so sig() sees a change and an
  autosave follows. That is correct - stacking order is part of the board the
  participant arranged, and it is what makes reopening restore the same view.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

NOTE_OLD = '''<div onPointerDown="{{ n.onDown }}" style="position:absolute;left:{{ n.x }}px;top:{{ n.y }}px;width:200px;display:flex;flex-direction:column;gap:2px;cursor:grab">
            <div style="display:flex;justify-content:flex-end;height:12px">
              <button onClick="{{ n.onDel }}" title="{{ t.noteDelTip }}" style="border:none;background:transparent;color:#bfbcb3;font-size:11px;line-height:12px;cursor:pointer;padding:0 2px" style-hover="color:#b03f34">✕</button>
            </div>
            <textarea value="{{ n.text }}" onChange="{{ n.onText }}" autoFocus="{{ n.autoFocus }}" placeholder="{{ t.notePh }}" rows="3" style="width:100%;border:1px dashed #c2beb2;border-radius:7px;background:rgba(255,254,251,0.7);font-size:13px;line-height:1.55;color:#44423b;outline:none;padding:8px 10px;font-family:inherit;pointer-events:auto" style-focus="border-color:oklch(0.51 0.08 253);background:#fffefb"></textarea>
          </div>'''

NOTE_NEW = '''<div onPointerDown="{{ n.onDown }}" style="position:absolute;left:{{ n.x }}px;top:{{ n.y }}px;width:168px;display:flex;flex-direction:column;gap:2px;cursor:grab">
            <textarea value="{{ n.text }}" onChange="{{ n.onText }}" autoFocus="{{ n.autoFocus }}" placeholder="{{ t.notePh }}" rows="3" style="width:100%;border:1px dashed #c2beb2;border-radius:7px;background:rgba(255,254,251,0.7);font-size:12px;line-height:1.55;color:#44423b;outline:none;padding:8px 10px;font-family:inherit;pointer-events:auto" style-focus="border-color:oklch(0.51 0.08 253);background:#fffefb"></textarea>
            <div style="display:flex;align-items:center;gap:5px;height:13px">
              <div style="flex:1"></div>
              <button onClick="{{ n.onDel }}" title="{{ t.noteDelTip }}" style="border:none;background:transparent;color:#bfbcb3;font-size:11px;line-height:13px;cursor:pointer;padding:0 2px" style-hover="color:#b03f34">✕</button>
            </div>
          </div>'''

CARD_RAISE_OLD = """    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'BUTTON') return;
    e.stopPropagation();
    const c = this.state.cards.find((k) => k.id === id);
    const p = this.toCanvas(e.clientX, e.clientY);
    this.drag = { kind: 'move', id: id, ox: p.x - c.x, oy: p.y - c.y };
    this.setState((s) => ({ cards: s.cards.filter((k) => k.id !== id).concat([c]) }));"""

CARD_RAISE_NEW = """    // 클릭하면 맨 앞으로 / clicking raises, even when the pointer landed on text or a
    // button and the drag below is skipped
    this.raiseCard(id);
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'BUTTON') return;
    e.stopPropagation();
    const c = this.state.cards.find((k) => k.id === id);
    const p = this.toCanvas(e.clientX, e.clientY);
    this.drag = { kind: 'move', id: id, ox: p.x - c.x, oy: p.y - c.y };"""

NOTE_RAISE_OLD = """  startNoteMove(id, e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;"""

NOTE_RAISE_NEW = """  // 맨 앞으로 올리기 / raise to the top of the paint order (arrays paint in order)
  raiseCard(id) {
    this.setState((s) => {
      const c = s.cards.find((k) => k.id === id);
      if (!c || s.cards[s.cards.length - 1] === c) return null;
      return { cards: s.cards.filter((k) => k.id !== id).concat([c]) };
    });
  }

  raiseNote(id) {
    this.setState((s) => {
      const list = s.notes || [];
      const n = list.find((k) => k.id === id);
      if (!n || list[list.length - 1] === n) return null;
      return { notes: list.filter((k) => k.id !== id).concat([n]) };
    });
  }

  startNoteMove(id, e) {
    this.raiseNote(id);
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;"""

PATCHES = [(NOTE_OLD, NOTE_NEW, 1)]
CODE_PATCHES = [(CARD_RAISE_OLD, CARD_RAISE_NEW, 1), (NOTE_RAISE_OLD, NOTE_RAISE_NEW, 1)]


def to_bundle(s):
    return re.sub(
        r"\b(on[A-Z][a-zA-Z]*|autoFocus)=",
        lambda m: "sc-camel-" + re.sub(r"(?<!^)([A-Z])", r"-\1", m.group(1)).lower() + "=",
        s,
    )


def patch(text, label, bundle=False):
    steps = [(to_bundle(o), to_bundle(n), w) if bundle else (o, n, w) for (o, n, w) in PATCHES]
    steps += CODE_PATCHES  # JS is identical in both files
    for i, (old, new, want) in enumerate(steps, 1):
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
    payload = json.dumps(patch(doc, "bundle", bundle=True), ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload

    src.write_text(src_out, encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
