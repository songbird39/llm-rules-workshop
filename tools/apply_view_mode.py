#!/usr/bin/env python3
"""
Add an admin view mode: browse participants' boards without being able to edit them.

WHY THE GUARDS MATTER
  componentDidUpdate() fires on any state change. It writes localStorage for
  state.pid and calls scheduleAutosave(), which after 2.5s enqueues a POST to the
  sheet. latestState_() returns the NEWEST row for a participant, so a single
  accidental card nudge while viewing P01 would become P01's canonical board.

  So view mode blocks the write paths themselves, not just the UI:
    1. state.pid stays '' while in admin mode (the viewed code lives in viewPid),
       which already makes all three write paths no-op, and
    2. every one of them additionally checks isView() explicitly.
  Belt and braces, because losing a participant's session is unrecoverable.

READ-ONLY UI
  - the 5000x5000 card layer gets pointer-events:none, so cards, notes and arrows
    cannot be grabbed, focused or typed into; the canvas underneath still receives
    events, so panning keeps working
  - every mutating handler is swapped for a no-op in renderVals(), so even keyboard
    focus or a synthetic event cannot change state
  - the card panel, its resizer, and the arrow/note/export/clear buttons are hidden
  - zoom, reset view, refresh and back-to-list stay available

NOT SECURITY. The admin code is in client-side JS on a public page; anyone who reads
the bundle can find it, and the Apps Script endpoint is world-writable regardless.
This prevents accidents, which is what it is for. Do not treat it as access control.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- constants
ADMIN_CONST = """
/* ─────────────────────────────────────────────────────────────────
   열람(관리자) 모드 / ADMIN VIEW MODE
   이 코드로 로그인하면 참여자 목록을 열고 각자의 보드를 '읽기 전용'으로
   볼 수 있습니다. 열람 중에는 로컬 저장·자동 저장·시트 전송이 모두 차단됩니다.
   Sign in with this code to browse participants' boards read-only.
   NOTE: this is accident prevention, not access control — the code sits in
   client-side JS on a public page. Change it here if you need a different one.
   ───────────────────────────────────────────────────────────────── */
const ADMIN_CODE = 'admin';
"""

PATCHES = [
    # ---------------------------------------------------------------- constant
    (
        "const AUTOSAVE_MS = 2500;",
        "const AUTOSAVE_MS = 2500;\n" + ADMIN_CONST,
        1,
    ),
    # ---------------------------------------------------------------- state
    (
        "ghost: null, seq: 1, panelW: 566 };",
        "ghost: null, seq: 1, panelW: 566, admin: false, viewPid: '', roster: [], rosterMsg: '' };",
        1,
    ),
    # ---------------------------------------------------------------- login
    (
        """  login(rawPid) {
    const pid = (rawPid || '').trim();
    if (!pid) return;""",
        """  isView() { return !!this.state.admin; }

  // 관리자 코드로 로그인하면 참여자 목록 화면으로 / admin code opens the roster
  loginAdmin() {
    this.setState({
      admin: true, viewPid: '', loginPid: '', pid: '', step: 0,
      cards: [], notes: [], arrows: [], roster: [], rosterMsg: 'loading'
    }, () => this.refreshRoster());
  }

  refreshRoster() {
    if (!this.syncUrl()) { this.setState({ rosterMsg: 'error' }); return; }
    this.setState({ rosterMsg: 'loading' });
    this.jsonp('list=1').then((res) => {
      if (!this.state.admin) return;
      if (res && res.ok && res.participants) {
        this.setState({ roster: res.participants, rosterMsg: res.participants.length ? '' : 'empty' });
      } else {
        this.setState({ rosterMsg: 'error' });
      }
    });
  }

  // 참여자 보드를 읽기 전용으로 연다 / open one participant's board, read-only.
  // pid는 viewPid에만 담고 state.pid는 비워 둔다 — 저장 경로가 전부 죽는다.
  openParticipant(pid) {
    this.setState({ viewPid: pid, rosterMsg: 'loading' });
    this.loadRemote(pid).then((remote) => {
      if (!this.state.admin || this.state.viewPid !== pid) return;
      if (!remote) { this.setState({ rosterMsg: 'nosnap' }); return; }
      this.setState({ rosterMsg: '' });
      this.applyState(remote);
    });
  }

  backToRoster() {
    this.setState({ viewPid: '', step: 0, cards: [], notes: [], arrows: [], rosterMsg: '' },
      () => this.refreshRoster());
  }

  login(rawPid) {
    const pid = (rawPid || '').trim();
    if (!pid) return;
    if (pid.toLowerCase() === ADMIN_CODE.toLowerCase()) { this.loginAdmin(); return; }""",
        1,
    ),
    # ---------------------------------------------------------------- logout
    (
        "  logout() { this.setState({ pid: '', loginPid: '', step: 0, noteMode: false }); }",
        "  logout() { this.setState({ pid: '', loginPid: '', step: 0, noteMode: false, admin: false, viewPid: '', roster: [], rosterMsg: '' }); }",
        1,
    ),
    # ---------------------------------------------------------------- JSONP helper
    (
        """  loadRemote(pid) {
    const url = this.syncUrl();
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {""",
        """  loadRemote(pid) {
    return this.jsonp('participant=' + encodeURIComponent(pid))
      .then((res) => (res && res.ok && res.state ? res.state : null));
  }

  // 공용 JSONP 호출 / shared JSONP call — resolves the parsed object, or null
  jsonp(query) {
    const url = this.syncUrl();
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {""",
        1,
    ),
    (
        "      window[cb] = (res) => finish(res && res.ok && res.state ? res.state : null);\n"
        "      s.onerror = () => finish(null);\n"
        "      s.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'participant=' + encodeURIComponent(pid) + '&callback=' + cb;",
        "      window[cb] = (res) => finish(res || null);\n"
        "      s.onerror = () => finish(null);\n"
        "      s.src = url + (url.indexOf('?') < 0 ? '?' : '&') + query + '&callback=' + cb;",
        1,
    ),
    # ---------------------------------------------------------------- WRITE GUARD 1: localStorage
    (
        "      if (this.state.step > 0 && this.state.pid) {\n        localStorage.setItem(STORE + ':' + this.state.pid,",
        "      if (this.state.step > 0 && this.state.pid && !this.isView()) {\n        localStorage.setItem(STORE + ':' + this.state.pid,",
        1,
    ),
    # ---------------------------------------------------------------- WRITE GUARD 2: autosave timer
    (
        "  scheduleAutosave() {\n    if (!this.syncUrl() || this.state.step < 1 || !this.state.pid) return;",
        "  scheduleAutosave() {\n    if (this.isView()) return;   // 열람 모드에서는 절대 저장하지 않는다\n    if (!this.syncUrl() || this.state.step < 1 || !this.state.pid) return;",
        1,
    ),
    # ---------------------------------------------------------------- WRITE GUARD 3: queue/POST
    (
        "  enqueue(kind) {\n    if (!this.syncUrl() || !this.state.pid || this.state.step < 1) return;",
        "  enqueue(kind) {\n    if (this.isView()) return;   // 열람 모드에서는 시트에 아무것도 보내지 않는다\n    if (!this.syncUrl() || !this.state.pid || this.state.step < 1) return;",
        1,
    ),
    # ---------------------------------------------------------------- WRITE GUARD 4: export/submit
    (
        "  exportJson() {\n    const data = this.snapshot();",
        "  exportJson() {\n    if (this.isView()) return;   // 제출 버튼은 열람 모드에서 숨겨져 있지만 이중으로 막는다\n    const data = this.snapshot();",
        1,
    ),
]

# ---------------------------------------------------------------- i18n
I18N_KO = (
    "      step0: '참여자 로그인', loginTitle: '참여자 코드를 입력해 주세요',",
    "      viewBadge: '열람 전용', viewBanner: '열람 모드입니다. 이 화면에서는 참여자의 작업이 수정되거나 저장되지 않습니다.',\n"
    "      rosterTitle: '참여자 목록', rosterSub: '열람할 참여자를 선택하세요.',\n"
    "      rosterLoading: '불러오는 중…', rosterEmpty: '아직 저장된 참여자가 없습니다.',\n"
    "      rosterError: '목록을 불러오지 못했습니다. Apps Script를 새 버전으로 다시 배포했는지 확인해 주세요.',\n"
    "      noSnap: '이 참여자의 저장된 보드가 없습니다.', backList: '← 목록', refreshBtn: '새로고침',\n"
    "      rowsSuffix: '개 기록', submittedTag: '제출됨', neverSaved: '기록 없음',\n"
    "      step0: '참여자 로그인', loginTitle: '참여자 코드를 입력해 주세요',",
)
I18N_EN = (
    "      step0: 'Participant sign-in', loginTitle: 'Enter your participant code',",
    "      viewBadge: 'View only', viewBanner: 'View mode. Nothing on this screen is edited or saved to the participant record.',\n"
    "      rosterTitle: 'Participants', rosterSub: 'Choose a participant to view.',\n"
    "      rosterLoading: 'Loading…', rosterEmpty: 'No participants saved yet.',\n"
    "      rosterError: 'Could not load the list. Check that the Apps Script was redeployed as a new version.',\n"
    "      noSnap: 'No saved board for this participant.', backList: '← List', refreshBtn: 'Refresh',\n"
    "      rowsSuffix: ' records', submittedTag: 'submitted', neverSaved: 'no records',\n"
    "      step0: 'Participant sign-in', loginTitle: 'Enter your participant code',",
)

# ---------------------------------------------------------------- render props
PROPS_OLD = """    return {
      t: t,
      lang: this.state.lang,
      onLang: (e) => this.setLang(e.target.value),
      pid: this.state.pid,
      isStep0: this.state.step === 0,
      isLoggedIn: this.state.step > 0,
      showSync: this.state.step > 0,"""

PROPS_NEW = """    const RO = this.isView();          // 읽기 전용 / read-only
    const NOOP = () => {};
    const viewing = RO && !!this.state.viewPid;

    return {
      t: t,
      lang: this.state.lang,
      onLang: (e) => this.setLang(e.target.value),
      pid: viewing ? this.state.viewPid : this.state.pid,
      isStep0: this.state.step === 0 && !this.state.admin,
      isRoster: this.state.admin && !this.state.viewPid,
      isViewing: viewing,
      canEdit: !RO,
      showPanel: !RO,
      layerPE: RO ? 'none' : 'auto',
      rosterList: (this.state.roster || []).map((r) => ({
        key: r.participant,
        label: r.participant,
        meta: (r.rows || 0) + t.rowsSuffix + (r.submits ? ' · ' + t.submittedTag : ''),
        when: r.lastAt ? new Date(r.lastAt).toLocaleString() : t.neverSaved,
        onOpen: () => this.openParticipant(r.participant)
      })),
      rosterBusy: this.state.rosterMsg === 'loading',
      rosterNote:
        this.state.rosterMsg === 'loading' ? t.rosterLoading :
        this.state.rosterMsg === 'empty' ? t.rosterEmpty :
        this.state.rosterMsg === 'error' ? t.rosterError :
        this.state.rosterMsg === 'nosnap' ? t.noSnap : '',
      hasRosterNote: !!this.state.rosterMsg,
      onRefresh: () => (this.state.viewPid ? this.openParticipant(this.state.viewPid) : this.refreshRoster()),
      onBackList: () => this.backToRoster(),
      isLoggedIn: this.state.step > 0 || viewing,
      showSync: this.state.step > 0 && !RO,"""

# handler gating — swap mutating callbacks for no-ops in view mode
HANDLER_PATCHES = [
    # step-1 rule cards
    ("        onAdd: () => this.addCustom(cat.id),",
     "        onAdd: RO ? NOOP : () => this.addCustom(cat.id),", 1),
    ("          onToggle: (e) => this.toggleRule(r.id, e),",
     "          onToggle: RO ? NOOP : (e) => this.toggleRule(r.id, e),", 1),
    ("          onTitle: (e) => this.patchRule(r.id, 'title', e.target.value),",
     "          onTitle: RO ? NOOP : (e) => this.patchRule(r.id, 'title', e.target.value),", 1),
    ("          onDesc: (e) => this.patchRule(r.id, 'desc', e.target.value),",
     "          onDesc: RO ? NOOP : (e) => this.patchRule(r.id, 'desc', e.target.value),", 1),
    # panel deck cards
    ("      onDown: (e) => this.startNew(type, tpl, e),\n      onAdd: () => this.quickAdd(type, tpl)",
     "      onDown: RO ? NOOP : (e) => this.startNew(type, tpl, e),\n      onAdd: RO ? NOOP : () => this.quickAdd(type, tpl)", 1),
]


MARKUP_PATCHES = [
    # ---- toolbar: hide editing buttons, add view-mode controls -------------
    (
        '        <button onClick="{{ toggleArrowMode }}"',
        '        <sc-if value="{{ isViewing }}" hint-placeholder-val="{{ false }}">\n'
        '          <button onClick="{{ onBackList }}" style="padding:7px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:13.5px;cursor:pointer" style-hover="background:#f1efe8">{{ t.backList }}</button>\n'
        '          <button onClick="{{ onRefresh }}" style="padding:7px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:13.5px;cursor:pointer" style-hover="background:#f1efe8">{{ t.refreshBtn }}</button>\n'
        '        </sc-if>\n'
        '        <sc-if value="{{ canEdit }}" hint-placeholder-val="{{ true }}">\n'
        '        <button onClick="{{ toggleArrowMode }}"',
        1,
    ),
    (
        '<button onClick="{{ clearAll }}" title="{{ t.clearTip }}" style="padding:7px 10px;border:1px solid #e2dfd7;border-radius:7px;background:transparent;color:#98958c;font-size:13.5px;cursor:pointer" style-hover="color:#b03f34;border-color:#ddc0bb">{{ t.clear }}</button>',
        '<button onClick="{{ clearAll }}" title="{{ t.clearTip }}" style="padding:7px 10px;border:1px solid #e2dfd7;border-radius:7px;background:transparent;color:#98958c;font-size:13.5px;cursor:pointer" style-hover="color:#b03f34;border-color:#ddc0bb">{{ t.clear }}</button>\n'
        '        </sc-if>',
        1,
    ),
    # ---- header: a clear "view only" badge instead of the sync pill --------
    (
        '        <sc-if value="{{ showSync }}" hint-placeholder-val="{{ false }}">',
        '        <sc-if value="{{ isViewing }}" hint-placeholder-val="{{ false }}">\n'
        '          <span style="padding:3px 9px;border-radius:20px;background:#f7f0dc;color:#8a6a1f;font-size:11.5px;font-weight:600;white-space:nowrap">{{ t.viewBadge }}</span>\n'
        '        </sc-if>\n'
        '        <sc-if value="{{ showSync }}" hint-placeholder-val="{{ false }}">',
        1,
    ),
    # ---- roster screen, inserted before the step-1 screen ------------------
    (
        '  <sc-if value="{{ isStep1 }}" hint-placeholder-val="{{ false }}">',
        '''  <sc-if value="{{ isRoster }}" hint-placeholder-val="{{ false }}">
    <div style="flex:1;min-height:0;overflow-y:auto;background:#f1efe8">
      <div style="max-width:760px;margin:0 auto;padding:28px 32px 40px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <div style="font-size:17px;font-weight:700;letter-spacing:-0.01em">{{ t.rosterTitle }}</div>
          <div style="flex:1"></div>
          <button onClick="{{ onRefresh }}" style="padding:6px 12px;border:1px solid #d6d3ca;border-radius:7px;background:#fff;font-size:13px;cursor:pointer" style-hover="background:#faf8f3">{{ t.refreshBtn }}</button>
        </div>
        <div style="font-size:12.5px;line-height:1.6;color:#7a776f">{{ t.viewBanner }}</div>
        <sc-if value="{{ hasRosterNote }}" hint-placeholder-val="{{ false }}">
          <div style="font-size:12.5px;line-height:1.6;color:#8a6a1f;background:#f7f0dc;border-radius:8px;padding:10px 13px">{{ rosterNote }}</div>
        </sc-if>
        <div style="display:flex;flex-direction:column;gap:8px">
          <sc-for list="{{ rosterList }}" as="r" hint-placeholder-count="0">
            <button onClick="{{ r.onOpen }}" style="display:flex;align-items:baseline;gap:12px;text-align:left;padding:12px 15px;border:1px solid #e2dfd7;border-radius:10px;background:#fffefb;cursor:pointer" style-hover="border-color:oklch(0.51 0.08 253);box-shadow:0 3px 12px rgba(0,0,0,0.07)">
              <span style="font-size:14px;font-weight:700;letter-spacing:-0.01em;min-width:64px">{{ r.label }}</span>
              <span style="font-size:12px;color:#7a776f">{{ r.meta }}</span>
              <span style="flex:1"></span>
              <span style="font-size:11.5px;color:#a7a49b;white-space:nowrap">{{ r.when }}</span>
            </button>
          </sc-for>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ isStep1 }}" hint-placeholder-val="{{ false }}">''',
        1,
    ),
    # ---- hide the card panel and its resizer while viewing -----------------
    (
        '    <div style="flex:0 0 {{ panelW }}px;display:flex;flex-direction:column;background:#faf8f3;overflow-y:auto">',
        '    <sc-if value="{{ showPanel }}" hint-placeholder-val="{{ true }}">\n'
        '    <div style="flex:0 0 {{ panelW }}px;display:flex;flex-direction:column;background:#faf8f3;overflow-y:auto">',
        1,
    ),
    (
        '    <div onPointerDown="{{ onResizeDown }}" title="{{ t.resizeTip }}"',
        '    </sc-if>\n'
        '    <sc-if value="{{ showPanel }}" hint-placeholder-val="{{ true }}">\n'
        '    <div onPointerDown="{{ onResizeDown }}" title="{{ t.resizeTip }}"',
        1,
    ),
    (
        '    <div ref="{{ canvasRef }}" onPointerDown="{{ onCanvasDown }}"',
        '    </sc-if>\n'
        '    <div ref="{{ canvasRef }}" onPointerDown="{{ onCanvasDown }}"',
        1,
    ),
    # ---- make the card layer inert while viewing (panning still works) -----
    (
        '<div style="position:absolute;left:0;top:0;width:5000px;height:5000px;transform-origin:0 0;transform:translate({{ panX }}px, {{ panY }}px) scale({{ zoom }})">',
        '<div style="position:absolute;left:0;top:0;width:5000px;height:5000px;transform-origin:0 0;pointer-events:{{ layerPE }};transform:translate({{ panX }}px, {{ panY }}px) scale({{ zoom }})">',
        1,
    ),
]


def to_bundle(s):
    """src markup uses React-style attributes; the build rewrites them.

        onClick=       -> sc-camel-on-click=
        onPointerDown= -> sc-camel-on-pointer-down=
        autoFocus=     -> sc-camel-auto-focus=

    sc-if / sc-for / hint-placeholder-* are identical in both, and `ref=` is left
    alone. Markup patches are authored in source form and converted for the bundle.
    """
    return re.sub(
        r"\b(on[A-Z][a-zA-Z]*|autoFocus)=",
        lambda m: "sc-camel-" + re.sub(r"(?<!^)([A-Z])", r"-\1", m.group(1)).lower() + "=",
        s,
    )


def patch(text, label, bundle=False):
    markup = [
        (to_bundle(o), to_bundle(n), w) if bundle else (o, n, w)
        for (o, n, w) in MARKUP_PATCHES
    ]
    steps = (list(PATCHES) + [I18N_KO + (1,), I18N_EN + (1,), (PROPS_OLD, PROPS_NEW, 1)]
             + HANDLER_PATCHES + markup)
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

    # Patch BOTH in memory before writing EITHER, so a failed anchor on the second
    # file cannot leave the two out of sync.
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
