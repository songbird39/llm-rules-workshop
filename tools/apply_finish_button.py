#!/usr/bin/env python3
"""
"제출 · JSON 저장" becomes a plain "완료 / Finish"; the JSON download is a fallback only.

Before, every submit also downloaded a file, which made a normal finish look like
something had gone wrong and left participants with a file they had no use for. Now
Finish submits, and the download is offered ONLY when the work could not reach the
server — which is exactly when a local copy is worth having.

HOW "could not reach the server" IS DECIDED
  Writes are fire-and-forget (mode:'no-cors'), so a POST resolving tells us nothing
  about whether Apps Script stored the row. The one honest signal available is the
  outbound queue: enqueue() flushes, and an item that is still queued a moment later
  did not go out. So: queue a submit, wait briefly, then look for a leftover item for
  this participant. Also treat "no endpoint configured" and a known-offline state as
  failures without waiting.

  The wording reflects that limit: success says the work was SENT, not stored. The
  sheet remains the only real confirmation, as documented in DEPLOY.md.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

CODE = [
    # finish() + a download that does NOT re-submit
    (
        """  exportJson() {
    if (this.isView()) return;   // 제출 버튼은 열람 모드에서 숨겨져 있지만 이중으로 막는다
    const data = this.snapshot();
    this.enqueue('submit');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });""",
        """  // 완료: 서버로 보내고, 보내지 못했을 때만 JSON 내려받기를 제안한다
  // Finish: submit, and offer the JSON download only if it could not be sent.
  finish() {
    if (this.isView()) return;
    this.enqueue('submit');          // queues and flushes
    if (!this.syncUrl()) { this.setState({ finish: 'fallback' }); return; }
    this.setState({ finish: 'wait' });
    setTimeout(() => {
      if (!this.state.finish) return;                 // closed in the meantime
      // 큐에 남아 있으면 나가지 못한 것 / anything still queued did not go out
      const stuck = this.queueRead().some((it) => it.participant === this.state.pid);
      this.setState({ finish: (stuck || this.state.sync === 'offline') ? 'fallback' : 'ok' });
    }, 1200);
  }

  // 제출과 분리 — 내려받기만 한다 / download only; does not enqueue another submit
  downloadJson() {
    if (this.isView()) return;
    const data = this.snapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });""",
        1,
    ),
]

PROPS = [
    (
        "      doLogout: () => this.logout(),",
        """      doLogout: () => this.logout(),
      doFinish: () => this.finish(),
      finishOpen: !!this.state.finish,
      finishFallback: this.state.finish === 'fallback',
      finishTitle: this.state.finish === 'wait' ? t.finishWait
        : this.state.finish === 'fallback' ? t.finishFailTitle : t.finishOkTitle,
      finishBody: this.state.finish === 'wait' ? t.finishWaitBody
        : this.state.finish === 'fallback' ? t.finishFailBody : t.finishOkBody,
      onDownload: () => this.downloadJson(),
      onCloseFinish: () => this.setState({ finish: null }),""",
        1,
    ),
]

STATE = [
    ("ghost: null, seq: 1, panelW: 566, sel: [], marquee: null,",
     "ghost: null, seq: 1, panelW: 566, sel: [], marquee: null, finish: null,", 1),
]

I18N = [
    (
        "      viewBadge: '열람 전용',",
        "      finishBtn: '완료', finishWait: '보내는 중…', finishWaitBody: '작업을 서버로 보내고 있습니다.',\n"
        "      finishOkTitle: '제출했습니다', finishOkBody: '작업을 서버로 보냈습니다. 이 창을 닫아도 됩니다.',\n"
        "      finishFailTitle: '서버에 보내지 못했습니다', finishFailBody: '인터넷 연결이 끊겼을 수 있습니다. 아래에서 JSON 파일을 내려받아 연구자에게 전달해 주세요. 연결이 돌아오면 자동으로 다시 시도합니다.',\n"
        "      downloadBtn: 'JSON 내려받기', closeBtn: '닫기',\n"
        "      viewBadge: '열람 전용',",
        1,
    ),
    (
        "      viewBadge: 'View only',",
        "      finishBtn: 'Finish', finishWait: 'Sending…', finishWaitBody: 'Sending your work to the server.',\n"
        "      finishOkTitle: 'Submitted', finishOkBody: 'Your work was sent to the server. You can close this.',\n"
        "      finishFailTitle: \"Couldn't reach the server\", finishFailBody: 'You may be offline. Download the JSON below and send it to the researcher. It will also retry automatically once the connection is back.',\n"
        "      downloadBtn: 'Download JSON', closeBtn: 'Close',\n"
        "      viewBadge: 'View only',",
        1,
    ),
]

MARKUP = [
    # toolbar: Finish, not Submit-and-save
    (
        '<button onClick="{{ exportJson }}" style="padding:7px 13px;border:1px solid transparent;border-radius:7px;background:#1b1a17;color:#faf8f3;font-size:13.5px;cursor:pointer" style-hover="background:#35332c">{{ t.exportBtn }}</button>',
        '<button onClick="{{ doFinish }}" style="padding:7px 13px;border:1px solid transparent;border-radius:7px;background:#1b1a17;color:#faf8f3;font-size:13.5px;cursor:pointer" style-hover="background:#35332c">{{ t.finishBtn }}</button>',
        1,
    ),
    # the confirmation dialog, at app-root level so it centres over everything
    (
        "    </div>\n  </div>\n  </sc-if>\n</div>",
        """    </div>
  </div>
  </sc-if>

  <sc-if value="{{ finishOpen }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(27,26,23,0.35);display:flex;align-items:center;justify-content:center;z-index:60">
      <div style="width:390px;max-width:86vw;background:#fffefb;border:1px solid #e2dfd7;border-radius:14px;padding:26px 28px;box-shadow:0 12px 36px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px">
        <div style="font-size:16px;font-weight:700;letter-spacing:-0.01em">{{ finishTitle }}</div>
        <div style="font-size:13px;line-height:1.65;color:#7a776f">{{ finishBody }}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:4px">
          <sc-if value="{{ finishFallback }}" hint-placeholder-val="{{ false }}">
            <button onClick="{{ onDownload }}" style="padding:8px 14px;border:1px solid #d6d3ca;border-radius:8px;background:#fff;font-size:13px;cursor:pointer" style-hover="background:#f1efe8">{{ t.downloadBtn }}</button>
          </sc-if>
          <button onClick="{{ onCloseFinish }}" style="padding:8px 16px;border:1px solid transparent;border-radius:8px;background:#1b1a17;color:#faf8f3;font-size:13px;cursor:pointer" style-hover="background:#35332c">{{ t.closeBtn }}</button>
        </div>
      </div>
    </div>
  </sc-if>
</div>""",
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
