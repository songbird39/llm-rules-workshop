# LLM 학습 규칙 설계 워크샵 — deploy

`index.html` is the whole app: one self-contained file, no build step, works offline
once loaded. Everything below is one-time setup.

## 1. Put it on a URL (GitHub Pages)

1. Create a repo (public, e.g. `llm-rules-workshop`).
2. Commit the contents of this `deploy/` folder to the repo root — at minimum `index.html`.
3. Repo **Settings ▸ Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)`. Save.
4. After ~1 minute the app is live at
   `https://<user>.github.io/<repo>/`

Works on phones, tablets and laptops; participants just open the link.
`index.html` is large (~22 MB) because fonts and the runtime are inlined — the first
load takes a few seconds on mobile data, then it is cached.

## 2. Collect responses on a server (Google Sheet)

See the setup comment at the top of `apps-script/Code.gs`. Short version:

1. New Google Sheet → **Extensions ▸ Apps Script** → paste `Code.gs` → Save.
2. **Deploy ▸ New deployment ▸ Web app**, *Execute as: Me*, *Who has access: **Anyone***.
3. Copy the resulting `.../exec` URL.

Then point the app at it. **Use the URL parameter — this is the primary path:**

```
https://<user>.github.io/<repo>/?sync=https://script.google.com/macros/s/AKfy…/exec
```

Send participants *that* link (or a shortened version of it). Nothing to edit, nothing
to re-commit, and you can point a session at a different sheet by changing the link.

Optional permanent bake-in: in the source `Card Workshop.dc.html` set
`const SYNC_URL = 'https://…/exec';` and re-export `index.html`. Do not hand-edit the
22 MB `index.html` — it is generated.

Two checks before a session:
1. Open the `/exec` URL in a browser — it returns `{"ok":true,"rows":N}`.
2. Sign in on the live link and look at the header badge. It must **not** say
   `⚠ 로컬 저장만 · 서버 미연결` / `⚠ Local only · no server` — that means the endpoint
   is missing and data is staying on the device.

## Cross-device continuity

Sign in with the same participant code on any device on the link and the board comes
back exactly as it was left — cards, positions, notes, arrows, rule selections, panel
width, language.

How it resolves: the device's own copy paints instantly, then the server's newest
snapshot loads (badge: `서버에서 불러오는 중…`) and replaces it if the server copy is
newer. If this device has changes that never reached the server, the local copy wins and
is pushed up instead — so switching devices mid-session never silently discards work.

Reads use JSONP, so no CORS configuration is needed; the *Who has access: **Anyone***
setting is what makes it work.

## What gets saved

| when | what |
|---|---|
| autosave | 2.5 s after any change to cards, notes, arrows or rule selection |
| submit | when a participant presses **제출 · JSON 저장** (they also get the JSON file) |

Each write is one sheet row: participant code, kind (`autosave` / `submit`), timestamps,
selected rules, card combinations, annotations, arrows, plus the full JSON in the last
column. Autosaves are collapsed in the queue, so one row per settle, not per keystroke.
The last column also carries the full board state, which is what cross-device resume
reads back.

**Offline safety:** every change is still saved to the device (`localStorage`, per
participant code). If the network drops, writes queue on the device and retry when it
returns or on next page load — the header badge shows `저장 중… / 서버 저장됨 /
오프라인 · 재시도 대기`. No participant work is lost if the sheet is unreachable.

Note the Apps Script write is fire-and-forget (`no-cors`), so the badge means "sent",
not "acknowledged by Google". Spot-check the sheet at the start of a session.
