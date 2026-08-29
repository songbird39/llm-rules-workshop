#!/usr/bin/env python3
"""
Arrows can start and end on anything: a card, a note, or empty space.

SCHEMA
  Was:  { id, from: 'c3', to: 'c7' }            -- bare card ids
  Now:  { id, from: {k:'card'|'note'|'pt', id?, x?, y?}, to: {...} }

  Old boards are NOT rewritten. endpoint() accepts a bare string and reads it as
  {k:'card', id}, so a board saved before this change keeps working and keeps its
  original stored shape until the participant next edits it. Nothing to migrate, and
  nothing breaks if an old save is opened by a new build or vice versa (an older
  build simply ignores arrows it cannot resolve, because arrowEnds returns null).

NOTE HEIGHTS
  Arrow endpoints need a rect for notes too, so measureBoard now records note heights
  alongside card heights (same order-based DOM matching: notes are the layer children
  WITHOUT a title <input>).

FREE ENDPOINTS
  A 'pt' endpoint is a fixed canvas coordinate. It does not move when cards move,
  which is the point: it lets a participant point at a region rather than an object.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

CODE = [
    # ---------------------------------------------------------------- endpoint helpers
    (
        "  cardRect(c) { return { x: c.x, y: c.y, w: CARD, h: c.h || ((c.type === 'rule' && c.collapsed) ? 90 : 168) }; }",
        """  cardRect(c) { return { x: c.x, y: c.y, w: CARD, h: c.h || ((c.type === 'rule' && c.collapsed) ? 90 : 168) }; }

  // 화살표 끝점 / arrow endpoint. Old saves stored a bare card id, so a string is read
  // as {k:'card'}. Old boards therefore keep working without being rewritten.
  endpoint(e) {
    if (!e) return null;
    if (typeof e === 'string') return { k: 'card', id: e };
    return e;
  }

  epKey(e) {
    const p = this.endpoint(e);
    if (!p) return '';
    return p.k === 'pt' ? 'pt:' + Math.round(p.x) + ',' + Math.round(p.y) : p.k + ':' + p.id;
  }

  // 끝점이 가리키는 사각형(카드/메모) 또는 점(빈 공간)
  // The rect an endpoint refers to, or a bare point for empty space.
  anchor(e) {
    const p = this.endpoint(e);
    if (!p) return null;
    if (p.k === 'pt') return { pt: true, x: p.x, y: p.y };
    if (p.k === 'note') {
      const n = (this.state.notes || []).find((k) => k.id === p.id);
      return n ? { x: n.x, y: n.y, w: CARD, h: n.h || 70 } : null;
    }
    const c = this.state.cards.find((k) => k.id === p.id);
    return c ? this.cardRect(c) : null;
  }

  // 포인터 아래에 있는 것 / what is under the pointer: card, then note, else empty space
  hitTarget(p) {
    const c = this.state.cards.slice().reverse().find((k) => {
      const r = this.cardRect(k);
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    if (c) return { k: 'card', id: c.id };
    const n = (this.state.notes || []).slice().reverse().find((k) => {
      const h = k.h || 70;
      return p.x >= k.x && p.x <= k.x + CARD && p.y >= k.y && p.y <= k.y + h;
    });
    if (n) return { k: 'note', id: n.id };
    return { k: 'pt', x: Math.round(p.x), y: Math.round(p.y) };
  }""",
        1,
    ),
    # ---------------------------------------------------------------- arrowEnds
    (
        """  arrowEnds(a) {
    const f = this.state.cards.find((c) => c.id === a.from), tc = this.state.cards.find((c) => c.id === a.to);
    if (!f || !tc) return null;
    const rf = this.cardRect(f), rt = this.cardRect(tc);
    const edge = (r, tx, ty) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy };
      const s = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
      return { x: cx + dx * s, y: cy + dy * s };
    };
    const cf = { x: rf.x + rf.w / 2, y: rf.y + rf.h / 2 }, ct = { x: rt.x + rt.w / 2, y: rt.y + rt.h / 2 };
    return { p1: edge(rf, ct.x, ct.y), p2: edge(rt, cf.x, cf.y) };
  }""",
        """  arrowEnds(a) {
    const A = this.anchor(a.from), B = this.anchor(a.to);
    if (!A || !B) return null;
    const ctr = (r) => (r.pt ? { x: r.x, y: r.y } : { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    // 빈 공간 끝점은 그 점 그대로, 카드/메모는 테두리에서 만난다
    // A free point is used as-is; a card or note is met at its border.
    const edge = (r, tx, ty) => {
      if (r.pt) return { x: r.x, y: r.y };
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy };
      const s = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
      return { x: cx + dx * s, y: cy + dy * s };
    };
    const ca = ctr(A), cbb = ctr(B);
    return { p1: edge(A, cbb.x, cbb.y), p2: edge(B, ca.x, ca.y) };
  }""",
        1,
    ),
    # ---------------------------------------------------------------- pending arrow render
    (
        """    const p = this.state.pendingArrow;
    if (p) {
      const f = this.state.cards.find((c) => c.id === p.from);
      if (f) {
        const r = this.cardRect(f);
        kids.push(h('line', { key: 'pending', x1: r.x + r.w / 2, y1: r.y + r.h / 2, x2: p.x, y2: p.y, stroke: SEL, strokeWidth: 2.2, strokeDasharray: '6 5', strokeLinecap: 'round', markerEnd: 'url(#om-ah-sel)' }));
      }
    }""",
        """    const p = this.state.pendingArrow;
    if (p) {
      const A = this.anchor(p.from);
      if (A) {
        const c0 = A.pt ? { x: A.x, y: A.y } : { x: A.x + A.w / 2, y: A.y + A.h / 2 };
        kids.push(h('line', { key: 'pending', x1: c0.x, y1: c0.y, x2: p.x, y2: p.y, stroke: SEL, strokeWidth: 2.2, strokeDasharray: '6 5', strokeLinecap: 'round', markerEnd: 'url(#om-ah-sel)' }));
      }
    }""",
        1,
    ),
    # ---------------------------------------------------------------- start a link from a card
    (
        """      const p = this.toCanvas(e.clientX, e.clientY);
      this.drag = { kind: 'link', from: id };
      this.setState({ pendingArrow: { from: id, x: p.x, y: p.y } });
      return;""",
        """      const p = this.toCanvas(e.clientX, e.clientY);
      const from = { k: 'card', id: id };
      this.drag = { kind: 'link', from: from };
      this.setState({ pendingArrow: { from: from, x: p.x, y: p.y } });
      return;""",
        1,
    ),
    # ---------------------------------------------------------------- from a note
    (
        """  startNoteMove(id, e) {
    if (e.ctrlKey || e.metaKey) { e.stopPropagation(); this.toggleSel(id); return; }""",
        """  startNoteMove(id, e) {
    if (this.state.arrowMode) {
      e.stopPropagation(); e.preventDefault();
      const p = this.toCanvas(e.clientX, e.clientY);
      const from = { k: 'note', id: id };
      this.drag = { kind: 'link', from: from };
      this.setState({ pendingArrow: { from: from, x: p.x, y: p.y } });
      return;
    }
    if (e.ctrlKey || e.metaKey) { e.stopPropagation(); this.toggleSel(id); return; }""",
        1,
    ),
    # ---------------------------------------------------------------- from empty space
    (
        """    // 영역 선택 중 브라우저가 텍스트를 선택하지 않게 막는다.""",
        """    if (this.state.arrowMode) {
      // 빈 공간에서 시작하는 화살표 / an arrow that starts in empty space
      e.preventDefault();
      const q = this.toCanvas(e.clientX, e.clientY);
      const from = { k: 'pt', x: Math.round(q.x), y: Math.round(q.y) };
      this.drag = { kind: 'link', from: from };
      this.setState({ pendingArrow: { from: from, x: q.x, y: q.y } });
      return;
    }
    // 영역 선택 중 브라우저가 텍스트를 선택하지 않게 막는다.""",
        1,
    ),
    # ---------------------------------------------------------------- drop the link anywhere
    (
        """    if (d.kind === 'link') {
      const p = this.toCanvas(e.clientX, e.clientY);
      const hit = this.state.cards.slice().reverse().find((c) => {
        const r = this.cardRect(c);
        return c.id !== d.from && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      });
      if (hit && !this.state.arrows.some((a) => a.from === d.from && a.to === hit.id)) {
        this.setState((s) => ({ arrows: s.arrows.concat([{ id: 'a' + s.seq, from: d.from, to: hit.id }]), seq: s.seq + 1, pendingArrow: null }));
      } else this.setState({ pendingArrow: null });
      return;
    }""",
        """    if (d.kind === 'link') {
      const p = this.toCanvas(e.clientX, e.clientY);
      const to = this.hitTarget(p);
      const fromKey = this.epKey(d.from), toKey = this.epKey(to);
      const dup = this.state.arrows.some((a) => this.epKey(a.from) === fromKey && this.epKey(a.to) === toKey);
      // 같은 대상으로 이어지는 화살표와 중복은 만들지 않는다 / no self-links, no duplicates
      if (fromKey !== toKey && !dup) {
        this.setState((s) => ({ arrows: s.arrows.concat([{ id: 'a' + s.seq, from: d.from, to: to }]), seq: s.seq + 1, pendingArrow: null }));
      } else this.setState({ pendingArrow: null });
      return;
    }""",
        1,
    ),
    # ---------------------------------------------------------------- export shape
    (
        """      arrows: (this.state.arrows || []).map((a) => {
        const f = this.state.cards.find((c) => c.id === a.from), tc = this.state.cards.find((c) => c.id === a.to);
        return { from: f ? { type: f.type, title: f.title } : null, to: tc ? { type: tc.type, title: tc.title } : null };
      }),""",
        """      arrows: (this.state.arrows || []).map((a) => {
        // 끝점은 카드 / 메모 / 빈 공간(좌표) 중 하나 / an endpoint is a card, a note, or a point
        const describe = (e) => {
          const p = this.endpoint(e);
          if (!p) return null;
          if (p.k === 'pt') return { kind: 'point', x: p.x, y: p.y };
          if (p.k === 'note') {
            const n = (this.state.notes || []).find((k) => k.id === p.id);
            return n ? { kind: 'note', text: n.text } : null;
          }
          const c = this.state.cards.find((k) => k.id === p.id);
          return c ? { kind: 'card', type: c.type, title: c.title } : null;
        };
        return { from: describe(a.from), to: describe(a.to) };
      }),""",
        1,
    ),
    # ---------------------------------------------------------------- note heights
    (
        """    const els = [];
    for (let i = 0; i < layer.children.length; i++) {
      const el = layer.children[i];
      if (el.tagName === 'DIV' && el.querySelector('input')) els.push(el);
    }
    if (els.length !== this.state.cards.length) return;   // mid-render, try again next pass
    const hs = [];
    for (let i = 0; i < els.length; i++) hs.push(els[i].offsetHeight);
    if (!this.state.cards.some((c, i) => hs[i] && Math.abs((c.h || 0) - hs[i]) > 1)) return;""",
        """    const els = [], noteEls = [];
    for (let i = 0; i < layer.children.length; i++) {
      const el = layer.children[i];
      if (el.tagName !== 'DIV') continue;
      (el.querySelector('input') ? els : noteEls).push(el);
    }
    if (els.length !== this.state.cards.length) return;   // mid-render, try again next pass
    const hs = [];
    for (let i = 0; i < els.length; i++) hs.push(els[i].offsetHeight);
    // 메모 높이도 기록 — 화살표 끝점이 메모 테두리에 붙으려면 필요하다
    // Note heights too: an arrow ending on a note needs its rect.
    const nhs = [];
    for (let i = 0; i < noteEls.length; i++) nhs.push(noteEls[i].offsetHeight);
    const notesNow = this.state.notes || [];
    const noteChanged = nhs.length === notesNow.length &&
      notesNow.some((n, i) => nhs[i] && Math.abs((n.h || 0) - nhs[i]) > 1);
    if (noteChanged) {
      this.setState((s) => {
        const list = s.notes || [];
        if (list.length !== nhs.length) return null;
        return { notes: list.map((n, i) => (nhs[i] && Math.abs((n.h || 0) - nhs[i]) > 1 ? Object.assign({}, n, { h: nhs[i] }) : n)) };
      });
    }
    if (!this.state.cards.some((c, i) => hs[i] && Math.abs((c.h || 0) - hs[i]) > 1)) return;""",
        1,
    ),
]


def patch(text, label):
    for i, (old, new, want) in enumerate(CODE, 1):
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
    payload = json.dumps(patch(doc, "bundle"), ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload

    src.write_text(src_out, encoding="utf-8")
    print(f"patched {src.relative_to(ROOT)}")
    bundle.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")
    print(f"patched {bundle.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
