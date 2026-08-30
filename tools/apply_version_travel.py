#!/usr/bin/env python3
"""
Version history and version travel, for participants and for admin view mode.

BROWSING MUST NOT OVERWRITE
  The danger: load an old version, and the ordinary autosave immediately pushes it as
  the newest row — silently destroying the participant's latest work just because
  somebody looked at history. So while a version is open, the board is FROZEN:
  frozen() = isView() || travel, and it guards the same three write paths view mode
  guards (localStorage, scheduleAutosave, enqueue).

  Coming back out is explicit:
    restore  - adopt this version as current; from here autosave resumes and pushes it
               as a NEW row. Nothing in the sheet is rewritten or deleted; history is
               append-only, so a restore is just another entry.
    cancel   - discard it and reload the newest state from the server.
  In admin view mode only cancel is offered: restore would be a write, and view mode
  never writes.

THINNING
  The server keeps one version per ~2 minutes plus EVERY submit (a deliberate finish is
  never thinned away). See versions_() in server/Code.gs.

REQUIRES AN APPS SCRIPT REDEPLOY - ?versions= and ?row= are new server actions.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

STATE = [
    ("sel: [], marquee: null, finish: null,",
     "sel: [], marquee: null, finish: null, hist: null, histList: [], travel: null,", 1),
]

CODE = [
    # ---------------------------------------------------------------- freeze
    (
        "  isView() { return !!this.state.admin; }",
        """  isView() { return !!this.state.admin; }

  // 저장이 멈춘 상태 / writes are frozen: admin view mode, or while browsing an old
  // version. Browsing history must never push the old board over the newest one.
  frozen() { return this.isView() || !!this.state.travel; }""",
        1,
    ),
    # ---------------------------------------------------------------- history + travel
    (
        "  refreshRoster() {",
        """  // ── 기록 / version history ────────────────────────────────────────────
  openHistory() {
    const pid = this.state.viewPid || this.state.pid;
    if (!pid || !this.syncUrl()) { this.setState({ hist: 'error', histList: [] }); return; }
    this.setState({ hist: 'loading', histList: [] });
    this.jsonp('versions=' + encodeURIComponent(pid)).then((res) => {
      if (res && res.ok && res.versions) {
        this.setState({ hist: 'open', histList: res.versions });
      } else {
        this.setState({ hist: 'error' });
      }
    });
  }

  // 그 시점의 보드를 불러온다 — 저장은 얼어 있다 / load that snapshot; writes stay frozen
  travelTo(v) {
    this.setState({ hist: 'loading' });
    this.jsonp('row=' + encodeURIComponent(v.row)).then((res) => {
      if (!res || !res.ok || !res.state) { this.setState({ hist: 'error' }); return; }
      this.setState({ travel: { row: v.row, at: v.at }, hist: null });
      this.applyState(res.state);
    });
  }

  // 이 버전을 현재 상태로 채택 / adopt it as current. History is append-only, so this
  // adds a new row rather than rewriting anything.
  restoreTravel() {
    if (this.isView()) return;
    this.setState({ travel: null }, () => { this.seedSig(); this.scheduleAutosave(); });
  }

  cancelTravel() {
    const pid = this.state.viewPid || this.state.pid;
    this.setState({ travel: null });
    if (!pid) return;
    this.loadRemote(pid).then((st) => { if (st) this.applyState(st); });
  }

  refreshRoster() {""",
        1,
    ),
    # ---------------------------------------------------------------- freeze the write paths
    (
        "      if (this.state.step > 0 && this.state.pid && !this.isView()) {",
        "      if (this.state.step > 0 && this.state.pid && !this.frozen()) {",
        1,
    ),
    (
        "  scheduleAutosave() {\n    if (this.isView()) return;   // 열람 모드에서는 절대 저장하지 않는다",
        "  scheduleAutosave() {\n    if (this.frozen()) return;   // 열람 모드·기록 열람 중에는 절대 저장하지 않는다",
        1,
    ),
    (
        "  enqueue(kind) {\n    if (this.isView()) return;   // 열람 모드에서는 시트에 아무것도 보내지 않는다",
        "  enqueue(kind) {\n    if (this.frozen()) return;   // 열람 모드·기록 열람 중에는 시트에 아무것도 보내지 않는다",
        1,
    ),
]

PROPS = [
    (
        "      doFinish: () => this.finish(),",
        """      doFinish: () => this.finish(),
      onHistory: () => this.openHistory(),
      histOpen: !!this.state.hist,
      histBusy: this.state.hist === 'loading',
      histNote: this.state.hist === 'loading' ? t.histLoading
        : this.state.hist === 'error' ? t.histError
        : (this.state.histList || []).length ? '' : t.histEmpty,
      hasHistNote: this.state.hist !== 'open' || !(this.state.histList || []).length,
      onCloseHist: () => this.setState({ hist: null }),
      versions: (this.state.histList || []).map((v) => ({
        key: 'v' + v.row,
        when: v.at ? new Date(v.at).toLocaleString() : '-',
        tag: v.kind === 'submit' ? t.submittedTag : t.autoTag,
        tagColor: v.kind === 'submit' ? 'oklch(0.51 0.08 253)' : '#a7a49b',
        onOpen: () => this.travelTo(v)
      })),
      travelling: !!this.state.travel,
      travelLabel: this.state.travel && this.state.travel.at
        ? new Date(this.state.travel.at).toLocaleString() : '',
      canRestore: !!this.state.travel && !RO,
      onRestore: () => this.restoreTravel(),
      onCancelTravel: () => this.cancelTravel(),""",
        1,
    ),
]

I18N = [
    (
        "      finishBtn: '완료',",
        "      histBtn: '기록', histTitle: '저장 기록', histSub: '되돌아갈 시점을 선택하세요. 지금 작업은 그대로 남아 있습니다.',\n"
        "      histLoading: '불러오는 중…', histEmpty: '아직 저장 기록이 없습니다.',\n"
        "      histError: '기록을 불러오지 못했습니다. Apps Script를 새 버전으로 다시 배포했는지 확인해 주세요.',\n"
        "      autoTag: '자동 저장', travelPrefix: '기록 보는 중 · ', travelBody: '이 시점의 보드입니다. 저장은 멈춰 있습니다.',\n"
        "      restoreBtn: '이 버전으로 되돌리기', cancelTravelBtn: '최신으로 돌아가기',\n"
        "      finishBtn: '완료',",
        1,
    ),
    (
        "      finishBtn: 'Finish',",
        "      histBtn: 'History', histTitle: 'Saved versions', histSub: 'Pick a point to go back to. Your current work stays where it is.',\n"
        "      histLoading: 'Loading…', histEmpty: 'No saved versions yet.',\n"
        "      histError: 'Could not load history. Check that the Apps Script was redeployed as a new version.',\n"
        "      autoTag: 'autosave', travelPrefix: 'Viewing history · ', travelBody: 'This is the board at that moment. Saving is paused.',\n"
        "      restoreBtn: 'Restore this version', cancelTravelBtn: 'Back to latest',\n"
        "      finishBtn: 'Finish',",
        1,
    ),
]

MARKUP = [
    # History button, outside the canEdit guard so admin gets it too
    (
        '<button onClick="{{ resetView }}"',
        '<button onClick="{{ onHistory }}" style="padding:7px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:13.5px;cursor:pointer" style-hover="background:#f1efe8">{{ t.histBtn }}</button>\n'
        '        <button onClick="{{ resetView }}"',
        1,
    ),
    # "you are looking at history" bar
    (
        '  <sc-if value="{{ isStep0 }}" hint-placeholder-val="{{ true }}">',
        '''  <sc-if value="{{ travelling }}" hint-placeholder-val="{{ false }}">
    <div style="flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 18px;background:#f7f0dc;border-bottom:1px solid #e6dcc0">
      <span style="font-size:12.5px;font-weight:600;color:#8a6a1f">{{ t.travelPrefix }}{{ travelLabel }}</span>
      <span style="font-size:12.5px;color:#8a6a1f">{{ t.travelBody }}</span>
      <div style="flex:1"></div>
      <sc-if value="{{ canRestore }}" hint-placeholder-val="{{ false }}">
        <button onClick="{{ onRestore }}" style="padding:6px 12px;border:1px solid transparent;border-radius:7px;background:#1b1a17;color:#faf8f3;font-size:12.5px;cursor:pointer">{{ t.restoreBtn }}</button>
      </sc-if>
      <button onClick="{{ onCancelTravel }}" style="padding:6px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:12.5px;cursor:pointer">{{ t.cancelTravelBtn }}</button>
    </div>
  </sc-if>

  <sc-if value="{{ isStep0 }}" hint-placeholder-val="{{ true }}">''',
        1,
    ),
    # the history dialog
    (
        '  <sc-if value="{{ finishOpen }}" hint-placeholder-val="{{ false }}">',
        '''  <sc-if value="{{ histOpen }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(27,26,23,0.35);display:flex;align-items:center;justify-content:center;z-index:60">
      <div style="width:420px;max-width:88vw;max-height:76vh;background:#fffefb;border:1px solid #e2dfd7;border-radius:14px;padding:24px 26px;box-shadow:0 12px 36px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px">
        <div style="font-size:16px;font-weight:700;letter-spacing:-0.01em">{{ t.histTitle }}</div>
        <div style="font-size:12.5px;line-height:1.6;color:#7a776f">{{ t.histSub }}</div>
        <sc-if value="{{ hasHistNote }}" hint-placeholder-val="{{ true }}">
          <div style="font-size:12.5px;line-height:1.6;color:#8a6a1f;background:#f7f0dc;border-radius:8px;padding:10px 13px">{{ histNote }}</div>
        </sc-if>
        <div style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
          <sc-for list="{{ versions }}" as="v" hint-placeholder-count="0">
            <button onClick="{{ v.onOpen }}" style="display:flex;align-items:baseline;gap:10px;text-align:left;padding:9px 12px;border:1px solid #e2dfd7;border-radius:9px;background:#fff;cursor:pointer" style-hover="border-color:oklch(0.51 0.08 253)">
              <span style="font-size:12.5px;color:#44423b">{{ v.when }}</span>
              <span style="flex:1"></span>
              <span style="font-size:11px;color:{{ v.tagColor }}">{{ v.tag }}</span>
            </button>
          </sc-for>
        </div>
        <div style="display:flex;justify-content:flex-end;padding-top:2px">
          <button onClick="{{ onCloseHist }}" style="padding:8px 16px;border:1px solid #d6d3ca;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">{{ t.closeBtn }}</button>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ finishOpen }}" hint-placeholder-val="{{ false }}">''',
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
    steps = STATE + CODE + PROPS + I18N + [
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
