#!/usr/bin/env python3
"""
Admin sensemaking layer: rebuild and experiment beside a participant's board.

SHAPE
  Sensemaking objects are ordinary cards/notes/arrows carrying sm:true, kept in the SAME
  state arrays. That is deliberate: every existing behaviour — rendering, dragging,
  auto-height measuring, arrows, marquee — applies to them for free, instead of a
  parallel object system that would need all of it re-implemented.

WHAT IS PROTECTED
  Participant objects (no sm flag) stay inert in admin: pointer-events:none per object
  and every mutating handler a no-op. Only sm objects are interactive. The rectangle
  enclosing the participant's work is drawn and labelled, and an sm object released
  overlapping it is pushed clear to the right — so the record stays visually intact.
  The region and the sm objects render only in admin mode.

STORAGE — the dangerous part
  Sensemaking is saved under a SEPARATE key, 'sm:' + participant, never the participant's
  own id. Three independent guards, because getting this wrong would mean a participant
  reopening their board and finding the researcher's experiment instead:
    1. pushSense() refuses unless isView() and viewPid are set, and asserts the key
       prefix before sending;
    2. roster_() skips 'sm:' keys, so they never appear as participants;
    3. latestState_() refuses to return a kind:'sensemaking' row for a bare id.
  Only the sm-flagged objects are sent; participant objects are filtered out of the
  payload entirely.

  pushSense writes directly rather than through enqueue(): the outbound queue belongs to
  the participant session and is frozen in admin mode by design. This write is
  best-effort and admin-side; if it fails the experiment is simply not saved, which is
  the right trade for never touching participant data.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SM = "oklch(0.62 0.11 62)"

STATE = [("hist: null, histList: [], travel: null,",
          "hist: null, histList: [], travel: null, senseOn: true,", 1)]

CODE = [
    # ---------------------------------------------------------------- helpers
    (
        "  refreshRoster() {",
        """  // ── 관리자 해석 레이어 / admin sensemaking ────────────────────────────
  // 참여자가 쓴 영역 / the rectangle enclosing the participant's own work
  senseBounds() {
    const rs = [];
    this.state.cards.forEach((c) => { if (!c.sm) rs.push(this.cardRect(c)); });
    (this.state.notes || []).forEach((n) => { if (!n.sm) rs.push({ x: n.x, y: n.y, w: CARD, h: n.h || 70 }); });
    if (!rs.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rs.forEach((r) => {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    const M = 24;
    return { x: x0 - M, y: y0 - M, w: (x1 - x0) + 2 * M, h: (y1 - y0) + 2 * M };
  }

  // 참여자 영역과 겹치면 오른쪽으로 밀어낸다 / an sm object released over the
  // participant's area is pushed clear, so their board stays visually intact
  keepOutOfRegion() {
    const b = this.senseBounds();
    if (!b) return;
    const hit = (x, y, w, h) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y;
    this.setState((s) => ({
      cards: s.cards.map((c) => {
        if (!c.sm) return c;
        const r = this.cardRect(c);
        return hit(c.x, c.y, r.w, r.h) ? Object.assign({}, c, { x: b.x + b.w + 20 }) : c;
      }),
      notes: (s.notes || []).map((n) => {
        if (!n.sm) return n;
        return hit(n.x, n.y, CARD, n.h || 70) ? Object.assign({}, n, { x: b.x + b.w + 20 }) : n;
      })
    }));
  }

  // 참여자 산출물을 해석 영역으로 복제 / copy participant objects into the sensemaking area
  duplicateIntoSense(all) {
    if (!this.isView() || !this.state.viewPid) return;
    const b = this.senseBounds();
    const off = b ? b.w + 80 : 400;
    const sel = this.state.sel || [];
    const take = (o) => !o.sm && (all || sel.indexOf(o.id) >= 0);
    let seq = this.state.seq;
    const idmap = {}, cards = [], notes = [], arrows = [];
    this.state.cards.forEach((c) => {
      if (!take(c)) return;
      const id = 's' + (seq++); idmap[c.id] = id;
      cards.push(Object.assign({}, c, { id: id, sm: true, x: c.x + off }));
    });
    (this.state.notes || []).forEach((n) => {
      if (!take(n)) return;
      const id = 's' + (seq++); idmap[n.id] = id;
      notes.push(Object.assign({}, n, { id: id, sm: true, x: n.x + off }));
    });
    // 복제된 것들 사이의 화살표만 따라온다 / only arrows whose BOTH ends were copied
    (this.state.arrows || []).forEach((a) => {
      const f = this.endpoint(a.from), t = this.endpoint(a.to);
      if (!f || !t) return;
      const m = (e) => (e.k === 'pt' ? { k: 'pt', x: e.x + off, y: e.y } : (idmap[e.id] ? { k: e.k, id: idmap[e.id] } : null));
      const nf = m(f), nt = m(t);
      if (nf && nt) arrows.push({ id: 's' + (seq++), from: nf, to: nt, sm: true });
    });
    if (!cards.length && !notes.length) return;
    this.setState((s) => ({
      cards: s.cards.concat(cards),
      notes: (s.notes || []).concat(notes),
      arrows: (s.arrows || []).concat(arrows),
      seq: seq, sel: []
    }));
  }

  clearSense() {
    if (!this.isView()) return;
    this.setState((s) => ({
      cards: s.cards.filter((c) => !c.sm),
      notes: (s.notes || []).filter((n) => !n.sm),
      arrows: (s.arrows || []).filter((a) => !a.sm),
      sel: []
    }));
  }

  loadSense(pid) {
    this.jsonp('participant=' + encodeURIComponent('sm:' + pid)).then((res) => {
      const st = res && res.ok && res.state;
      if (!st || this.state.viewPid !== pid) return;
      const tag = (arr) => (arr || []).map((o) => Object.assign({}, o, { sm: true }));
      this.setState((s) => ({
        cards: s.cards.concat(tag(st.cards)),
        notes: (s.notes || []).concat(tag(st.notes)),
        arrows: (s.arrows || []).concat(tag(st.arrows)),
        seq: Math.max(s.seq || 1, st.seq || 1)
      }), () => { this._ssig = this.senseSig(); });
    });
  }

  senseSig() {
    return JSON.stringify([
      this.state.cards.filter((c) => c.sm),
      (this.state.notes || []).filter((n) => n.sm),
      (this.state.arrows || []).filter((a) => a.sm)
    ]);
  }

  scheduleSense() {
    if (!this.isView() || !this.state.viewPid) return;
    if (this._st) clearTimeout(this._st);
    this._st = setTimeout(() => { this._st = null; this.pushSense(); }, 1500);
  }

  // 반드시 'sm:' 키로만 저장한다 / writes ONLY ever to the 'sm:' key, never a bare id
  pushSense() {
    const pid = this.state.viewPid, url = this.syncUrl();
    if (!this.isView() || !pid || !url) return;
    const key = 'sm:' + pid;
    if (key.indexOf('sm:') !== 0) return;                 // assertion, not decoration
    const state = {
      savedAt: Date.now(), pid: key, step: 2, lang: this.state.lang, rules: [],
      cards: this.state.cards.filter((c) => c.sm),
      notes: (this.state.notes || []).filter((n) => n.sm),
      arrows: (this.state.arrows || []).filter((a) => a.sm),
      seq: this.state.seq, panelW: this.state.panelW
    };
    try {
      fetch(url, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          participant: key, kind: 'sensemaking',
          queuedAt: new Date().toISOString(),
          payload: { participant: key, state: state }
        })
      });
    } catch (e) {}
  }

  refreshRoster() {""",
        1,
    ),
    # ---------------------------------------------------------------- load alongside the board
    (
        "      this.setState({ rosterMsg: '' });\n      this.applyState(remote);",
        "      this.setState({ rosterMsg: '' });\n      this.applyState(remote);\n"
        "      this._ssig = undefined;\n      this.loadSense(pid);",
        1,
    ),
    # ---------------------------------------------------------------- autosave the sm layer
    (
        "    if (this.state.step === 2 && !this.drag) { this.autoGrow(); this.measureCards(); }",
        "    if (this.state.step === 2 && !this.drag) { this.autoGrow(); this.measureCards(); }\n"
        "    // 해석 레이어만 따로 저장 / persist the sensemaking layer on its own key\n"
        "    if (this.isView() && this.state.viewPid) {\n"
        "      const sg = this.senseSig();\n"
        "      if (this._ssig === undefined) this._ssig = sg;\n"
        "      else if (sg !== this._ssig) { this._ssig = sg; this.scheduleSense(); }\n"
        "    }",
        1,
    ),
    # ---------------------------------------------------------------- push sm objects clear on release
    (
        "    if (d.kind === 'multi') {\n      // 드래그가 끝나면 한 번만 정수로 / round once, at the end",
        "    if (d.kind === 'move' || d.kind === 'note') { this.keepOutOfRegion(); }\n"
        "    if (d.kind === 'multi') {\n      // 드래그가 끝나면 한 번만 정수로 / round once, at the end",
        1,
    ),
]

PROPS = [
    (
        "      layerPE: RO ? 'none' : 'auto',",
        """      layerPE: 'auto',
      senseRegion: RO && !!this.state.viewPid && !!this.senseBounds(),
      regionX: (this.senseBounds() || {}).x || 0,
      regionY: (this.senseBounds() || {}).y || 0,
      regionW: (this.senseBounds() || {}).w || 0,
      regionH: (this.senseBounds() || {}).h || 0,
      onDupAll: () => this.duplicateIntoSense(true),
      onDupSel: () => this.duplicateIntoSense(false),
      onClearSense: () => this.clearSense(),""",
        1,
    ),
    # per-card interactivity and styling
    (
        "          key: c.id,\n          x: c.x, y: c.y,\n          outline:",
        """          key: c.id,
          x: c.x, y: c.y,
          // 해석 레이어 카드만 조작 가능 / only sensemaking objects are interactive in admin
          pe: (!RO || c.sm) ? 'auto' : 'none',
          bg: c.sm ? '#fdfbf5' : '#fffefb',
          bstyle: c.sm ? 'dashed' : 'solid',
          bd: c.sm ? '""" + SM + """' : '#e2dfd7',
          outline:""",
        1,
    ),
    (
        "        outline: this.isSel(n.id) ? '2px solid oklch(0.51 0.08 253)' : 'none',",
        "        outline: this.isSel(n.id) ? '2px solid oklch(0.51 0.08 253)' : 'none',\n"
        "        pe: (!RO || n.sm) ? 'auto' : 'none',",
        1,
    ),
]

# per-object handler gating: a participant object stays inert in admin, an sm object does not
HANDLERS = [
    ("          onDown: (e) => this.startMove(c.id, e),",
     "          onDown: (!RO || c.sm) ? (e) => this.startMove(c.id, e) : NOOP,", 1),
    ("        onDown: (e) => this.startNoteMove(n.id, e),",
     "        onDown: (!RO || n.sm) ? (e) => this.startNoteMove(n.id, e) : NOOP,", 1),
]

I18N = [
    ("      histBtn: '기록',",
     "      dupAllBtn: '전체 복제', dupSelBtn: '선택 복제', clearSenseBtn: '해석 지우기',\n"
     "      regionLabel: '참여자 산출물 (수정 불가)',\n"
     "      histBtn: '기록',", 1),
    ("      histBtn: 'History',",
     "      dupAllBtn: 'Duplicate all', dupSelBtn: 'Duplicate selection', clearSenseBtn: 'Clear workspace',\n"
     "      regionLabel: \"Participant's output (read-only)\",\n"
     "      histBtn: 'History',", 1),
]

MARKUP = [
    # admin-only duplication tools, beside back/refresh
    (
        '<button onClick="{{ onRefresh }}" style="padding:7px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:13.5px;cursor:pointer" style-hover="background:#f1efe8">{{ t.refreshBtn }}</button>',
        '<button onClick="{{ onRefresh }}" style="padding:7px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:13.5px;cursor:pointer" style-hover="background:#f1efe8">{{ t.refreshBtn }}</button>\n'
        '          <button onClick="{{ onDupAll }}" style="padding:7px 12px;border:1px dashed ' + SM + ';border-radius:7px;background:#fdfbf5;color:#7a5a1f;font-size:13.5px;cursor:pointer">{{ t.dupAllBtn }}</button>\n'
        '          <button onClick="{{ onDupSel }}" style="padding:7px 12px;border:1px dashed ' + SM + ';border-radius:7px;background:#fdfbf5;color:#7a5a1f;font-size:13.5px;cursor:pointer">{{ t.dupSelBtn }}</button>\n'
        '          <button onClick="{{ onClearSense }}" style="padding:7px 10px;border:1px solid #e2dfd7;border-radius:7px;background:transparent;color:#98958c;font-size:13.5px;cursor:pointer" style-hover="color:#b03f34">{{ t.clearSenseBtn }}</button>',
        1,
    ),
    # the protected region, drawn behind everything, admin only
    (
        "{{ arrowsLayer }}",
        '<sc-if value="{{ senseRegion }}" hint-placeholder-val="{{ false }}">\n'
        '          <div style="position:absolute;left:{{ regionX }}px;top:{{ regionY }}px;width:{{ regionW }}px;height:{{ regionH }}px;'
        'border:1.5px dashed #c9c6bd;border-radius:14px;background:rgba(255,255,255,0.35);pointer-events:none">\n'
        '            <div style="position:absolute;left:10px;top:-9px;padding:1px 8px;background:#f1efe8;border:1px solid #d6d3ca;border-radius:10px;font-size:11px;color:#7a776f;white-space:nowrap">{{ t.regionLabel }}</div>\n'
        '          </div>\n'
        '        </sc-if>\n'
        "        {{ arrowsLayer }}",
        1,
    ),
    (
        'style="position:absolute;left:{{ c.x }}px;top:{{ c.y }}px;width:168px;display:flex;flex-direction:column;gap:5px;background:#fffefb;border:1px solid #e2dfd7;border-radius:10px;padding:7px;box-shadow:0 3px 12px rgba(0,0,0,0.08);outline:{{ c.outline }};outline-offset:2px;cursor:{{ c.cursor }}"',
        'style="position:absolute;left:{{ c.x }}px;top:{{ c.y }}px;width:168px;display:flex;flex-direction:column;gap:5px;background:{{ c.bg }};border:1px {{ c.bstyle }} {{ c.bd }};border-radius:10px;padding:7px;box-shadow:0 3px 12px rgba(0,0,0,0.08);outline:{{ c.outline }};outline-offset:2px;pointer-events:{{ c.pe }};cursor:{{ c.cursor }}"',
        1,
    ),
    (
        'style="position:absolute;left:{{ n.x }}px;top:{{ n.y }}px;width:168px;padding:0 8px 8px;display:flex;flex-direction:column;gap:2px;outline:{{ n.outline }};outline-offset:2px;cursor:grab"',
        'style="position:absolute;left:{{ n.x }}px;top:{{ n.y }}px;width:168px;padding:0 8px 8px;display:flex;flex-direction:column;gap:2px;outline:{{ n.outline }};outline-offset:2px;pointer-events:{{ n.pe }};cursor:grab"',
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
    steps = STATE + CODE + PROPS + HANDLERS + I18N + [
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
