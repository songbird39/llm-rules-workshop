#!/usr/bin/env python3
"""
Marquee selection, ctrl/cmd multi-select, and group move.

INTERACTION CHANGE, deliberate and worth knowing
  Plain drag on empty canvas used to pan. It now draws a selection marquee, which is
  what "drag to group select" asks for and matches Miro/FigJam. Panning is still
  available four ways, so navigation is not lost:
      middle-button drag · Alt+drag · Space+drag · scroll / two-finger swipe
  To revert, make onCanvasDown always take the pan branch.

SELECTION IS TRANSIENT
  `sel` is a separate state array of ids, never written onto card/note objects. sig()
  covers cards/notes/arrows/rules only, so selecting never marks the board dirty and
  never triggers an autosave. Nothing about selection reaches the sheet.

GROUP MOVE DOES NOT SNAP
  A single card snaps to its neighbours (SNAP=10). Applying that per-card to a group
  would distort the arrangement the participant built, so a group move applies one
  shared delta and preserves relative positions exactly.

MATCHING DOM TO STATE
  The template engine drops interpolated data-* attributes (learned the hard way in
  apply_auto_height.py), so marquee hit-testing reads geometry from the layer's
  children by position: notes render before cards, and only cards carry a title
  <input>. offsetLeft/offsetTop are pre-transform, i.e. already canvas coordinates,
  so no zoom conversion is needed.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

SEL_COLOR = "oklch(0.51 0.08 253)"

CODE = [
    # ---------------------------------------------------------------- state
    (
        "ghost: null, seq: 1, panelW: 566, admin: false,",
        "ghost: null, seq: 1, panelW: 566, sel: [], marquee: null, admin: false,",
        1,
    ),
    # ---------------------------------------------------------------- helpers
    (
        "  raiseCard(id) {",
        """  // ── 선택 / selection ────────────────────────────────────────────────
  isSel(id) { return (this.state.sel || []).indexOf(id) >= 0; }

  toggleSel(id) {
    this.setState((s) => {
      const cur = s.sel || [];
      return { sel: cur.indexOf(id) >= 0 ? cur.filter((x) => x !== id) : cur.concat([id]) };
    });
  }

  // 보드 위 요소들의 실제 사각형 (캔버스 좌표) / rects of everything on the board, in
  // canvas coordinates. offsetLeft/Top are pre-transform, so no zoom conversion needed.
  boardRects() {
    const layer = this.cardsLayer();
    if (!layer) return [];
    const noteEls = [], cardEls = [];
    for (let i = 0; i < layer.children.length; i++) {
      const el = layer.children[i];
      if (el.tagName !== 'DIV') continue;
      (el.querySelector('input') ? cardEls : noteEls).push(el);
    }
    const out = [];
    const add = (el, item) => {
      if (el) out.push({ id: item.id, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    (this.state.notes || []).forEach((n, i) => add(noteEls[i], n));
    this.state.cards.forEach((c, i) => add(cardEls[i], c));
    return out;
  }

  hitsIn(x, y, w, h) {
    return this.boardRects()
      .filter((r) => r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y)
      .map((r) => r.id);
  }

  raiseCard(id) {""",
        1,
    ),
    # ---------------------------------------------------------------- canvas: marquee or pan
    (
        "    this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.state.pan.x, py: this.state.pan.y };\n  }",
        """    // 가운데 버튼 · Alt · Space = 화면 이동, 그냥 드래그 = 영역 선택
    // middle button / Alt / Space pan; a plain drag draws a selection marquee
    if (e.button === 1 || e.altKey || this._space) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.state.pan.x, py: this.state.pan.y };
      return;
    }
    const p = this.toCanvas(e.clientX, e.clientY);
    const add = e.ctrlKey || e.metaKey;
    this.drag = { kind: 'marq', x0: p.x, y0: p.y, add: add, base: add ? (this.state.sel || []).slice() : [] };
    this.setState({ marquee: { x: p.x, y: p.y, w: 0, h: 0 }, sel: add ? (this.state.sel || []) : [] });
  }""",
        1,
    ),
    # ---------------------------------------------------------------- card press
    (
        """    // 클릭하면 맨 앞으로 / clicking raises, even when the pointer landed on text or a
    // button and the drag below is skipped
    this.raiseCard(id);
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'BUTTON') return;
    e.stopPropagation();
    const c = this.state.cards.find((k) => k.id === id);
    const p = this.toCanvas(e.clientX, e.clientY);
    this.drag = { kind: 'move', id: id, ox: p.x - c.x, oy: p.y - c.y };
  }""",
        """    // Ctrl/Cmd 클릭 = 선택 토글 (이동하지 않음) / ctrl-click toggles selection
    if (e.ctrlKey || e.metaKey) { e.stopPropagation(); this.toggleSel(id); return; }
    // 클릭하면 맨 앞으로 / clicking raises, even when the pointer landed on text or a
    // button and the drag below is skipped
    this.raiseCard(id);
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'BUTTON') return;
    e.stopPropagation();
    const p = this.toCanvas(e.clientX, e.clientY);
    if (this.isSel(id) && (this.state.sel || []).length > 1) { this.startGroup(p); return; }
    this.setState({ sel: [id] });
    const c = this.state.cards.find((k) => k.id === id);
    this.drag = { kind: 'move', id: id, ox: p.x - c.x, oy: p.y - c.y };
  }

  // 선택된 것들을 함께 이동 / move the whole selection by one shared delta, so the
  // arrangement is preserved exactly (per-item snapping would distort it)
  startGroup(p) {
    const sel = this.state.sel || [];
    const items = [];
    this.state.cards.forEach((c) => { if (sel.indexOf(c.id) >= 0) items.push({ id: c.id, kind: 'card', x: c.x, y: c.y }); });
    (this.state.notes || []).forEach((n) => { if (sel.indexOf(n.id) >= 0) items.push({ id: n.id, kind: 'note', x: n.x, y: n.y }); });
    this.drag = { kind: 'multi', x0: p.x, y0: p.y, items: items };
  }""",
        1,
    ),
    # ---------------------------------------------------------------- note press
    (
        """  startNoteMove(id, e) {
    this.raiseNote(id);
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.stopPropagation();
    const n = (this.state.notes || []).find((k) => k.id === id);
    const p = this.toCanvas(e.clientX, e.clientY);
    this.drag = { kind: 'note', id: id, ox: p.x - n.x, oy: p.y - n.y };
  }""",
        """  startNoteMove(id, e) {
    if (e.ctrlKey || e.metaKey) { e.stopPropagation(); this.toggleSel(id); return; }
    this.raiseNote(id);
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.stopPropagation();
    const p = this.toCanvas(e.clientX, e.clientY);
    if (this.isSel(id) && (this.state.sel || []).length > 1) { this.startGroup(p); return; }
    this.setState({ sel: [id] });
    const n = (this.state.notes || []).find((k) => k.id === id);
    this.drag = { kind: 'note', id: id, ox: p.x - n.x, oy: p.y - n.y };
  }""",
        1,
    ),
    # ---------------------------------------------------------------- move branches
    (
        "    } else if (d.kind === 'resize') {",
        """    } else if (d.kind === 'marq') {
      const p = this.toCanvas(e.clientX, e.clientY);
      const x = Math.min(d.x0, p.x), y = Math.min(d.y0, p.y);
      const w = Math.abs(p.x - d.x0), h = Math.abs(p.y - d.y0);
      const hits = this.hitsIn(x, y, w, h);
      const merged = d.add ? d.base.concat(hits.filter((id) => d.base.indexOf(id) < 0)) : hits;
      this.setState({ marquee: { x: x, y: y, w: w, h: h }, sel: merged });
    } else if (d.kind === 'multi') {
      const p = this.toCanvas(e.clientX, e.clientY);
      const dx = p.x - d.x0, dy = p.y - d.y0;
      const at = {};
      d.items.forEach((it) => { at[it.id] = it; });
      this.setState((s) => ({
        cards: s.cards.map((c) => {
          const it = at[c.id];
          return it ? Object.assign({}, c, { x: Math.round(it.x + dx), y: Math.round(it.y + dy) }) : c;
        }),
        notes: (s.notes || []).map((n) => {
          const it = at[n.id];
          return it ? Object.assign({}, n, { x: Math.round(it.x + dx), y: Math.round(it.y + dy) }) : n;
        })
      }));
    } else if (d.kind === 'resize') {""",
        1,
    ),
    # ---------------------------------------------------------------- release
    (
        "  onUp(e) {\n    const d = this.drag;\n    this.drag = null;\n    if (!d) return;",
        "  onUp(e) {\n    const d = this.drag;\n    this.drag = null;\n    if (!d) return;\n"
        "    if (d.kind === 'marq') { this.setState({ marquee: null }); return; }",
        1,
    ),
    # ---------------------------------------------------------------- space = pan
    (
        "    this._online = () => this.flush();",
        "    // Space 를 누르고 있는 동안은 화면 이동 / hold Space to pan instead of marquee\n"
        "    this._key = (e) => {\n"
        "      const t = e.target && e.target.tagName;\n"
        "      if (t === 'TEXTAREA' || t === 'INPUT') return;\n"
        "      if (e.code === 'Space' || e.key === ' ') this._space = e.type === 'keydown';\n"
        "    };\n"
        "    window.addEventListener('keydown', this._key);\n"
        "    window.addEventListener('keyup', this._key);\n"
        "    this._online = () => this.flush();",
        1,
    ),
]

PROPS = [
    (
        "      layerPE: RO ? 'none' : 'auto',",
        "      layerPE: RO ? 'none' : 'auto',\n"
        "      marq: !!this.state.marquee,\n"
        "      marqX: this.state.marquee ? this.state.marquee.x : 0,\n"
        "      marqY: this.state.marquee ? this.state.marquee.y : 0,\n"
        "      marqW: this.state.marquee ? this.state.marquee.w : 0,\n"
        "      marqH: this.state.marquee ? this.state.marquee.h : 0,",
        1,
    ),
    # per-card / per-note outline
    (
        "          key: c.id,\n          x: c.x, y: c.y,",
        "          key: c.id,\n          x: c.x, y: c.y,\n"
        "          outline: this.isSel(c.id) ? '2px solid " + SEL_COLOR + "' : 'none',",
        1,
    ),
]

MARKUP = [
    # marquee rectangle, drawn in canvas coordinates inside the transformed layer
    (
        "{{ arrowsLayer }}",
        "{{ arrowsLayer }}\n"
        '        <sc-if value="{{ marq }}" hint-placeholder-val="{{ false }}">\n'
        '          <div style="position:absolute;left:{{ marqX }}px;top:{{ marqY }}px;width:{{ marqW }}px;height:{{ marqH }}px;'
        "border:1px solid " + SEL_COLOR + ";background:oklch(0.51 0.08 253 / 0.10);border-radius:2px;pointer-events:none\"></div>\n"
        "        </sc-if>",
        1,
    ),
    (
        'style="position:absolute;left:{{ c.x }}px;top:{{ c.y }}px;width:168px;display:flex;flex-direction:column;gap:5px;background:#fffefb;border:1px solid #e2dfd7;border-radius:10px;padding:7px;box-shadow:0 3px 12px rgba(0,0,0,0.08);cursor:{{ c.cursor }}"',
        'style="position:absolute;left:{{ c.x }}px;top:{{ c.y }}px;width:168px;display:flex;flex-direction:column;gap:5px;background:#fffefb;border:1px solid #e2dfd7;border-radius:10px;padding:7px;box-shadow:0 3px 12px rgba(0,0,0,0.08);outline:{{ c.outline }};outline-offset:2px;cursor:{{ c.cursor }}"',
        1,
    ),
    (
        'style="position:absolute;left:{{ n.x }}px;top:{{ n.y }}px;width:168px;padding:0 8px 8px;display:flex;flex-direction:column;gap:2px;cursor:grab"',
        'style="position:absolute;left:{{ n.x }}px;top:{{ n.y }}px;width:168px;padding:0 8px 8px;display:flex;flex-direction:column;gap:2px;outline:{{ n.outline }};outline-offset:2px;cursor:grab"',
        1,
    ),
]


def to_bundle(s):
    return re.sub(
        r"\b(on[A-Z][a-zA-Z]*|autoFocus)=",
        lambda m: "sc-camel-" + re.sub(r"(?<!^)([A-Z])", r"-\1", m.group(1)).lower() + "=",
        s,
    )


def patch(text, label, bundle=False):
    steps = CODE + PROPS + [
        (to_bundle(o), to_bundle(n), w) if bundle else (o, n, w) for (o, n, w) in MARKUP
    ]
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
