# LLM 학습 규칙 설계 워크샵 — deploy

`index.html` is the whole app: one self-contained file, no build step, works offline
once loaded. Everything below is one-time setup.

The Apps Script endpoint is **already baked into `index.html`** (see §2), so the bare
Pages link works — no query string for participants to truncate.

## 1. Put it on a URL (GitHub Pages)

Repo: <https://github.com/songbird39/llm-rules-workshop> (public).
`index.html` lives at the **repo root** — Pages only serves from `/` or `/docs`, never
from a subfolder, which is why it is not under `prototype/` any more.

1. Push `main`:
   ```
   git push
   ```
2. Repo **Settings ▸ Pages** → Source: *Deploy from a branch*, Branch: `main`,
   folder `/ (root)`. Save.
3. After ~1 minute the app is live at
   <https://songbird39.github.io/llm-rules-workshop/>

That is the participant link. Nothing to append.

Works on phones, tablets and laptops; participants just open the link.
`index.html` is large (~22 MB) because fonts and the runtime are inlined — the first
load takes a few seconds on mobile data, then it is cached.

## 2. Collect responses on a server (Google Sheet)

See the setup comment at the top of `server/Code.gs`. Short version:

1. New Google Sheet → **Extensions ▸ Apps Script** → paste `Code.gs` → Save.
2. **Deploy ▸ New deployment ▸ Web app**, *Execute as: Me*, *Who has access: **Anyone***.
3. Copy the resulting `.../exec` URL.

**Done — this is already wired up.** The current endpoint is baked into both
`src/Card Workshop.dc.html` (`const SYNC_URL`) and the deployed `index.html`:

```
https://script.google.com/macros/s/AKfycbxsrbb98XMbg9jrRl5U8TdBJKnWvS5Fx5_uve26fdHFuKrd07huZYOn7k2YZDlEGCKQVQ/exec
```

Participants get the plain Pages URL, nothing appended.

⚠ **It must be the `/exec` deployment URL.** If you open `/exec` in a browser, Google
redirects and the address bar then shows
`script.googleusercontent.com/macros/echo?user_content_key=…`. That is **not** an
endpoint — it is a cached response for one already-executed GET. It cannot accept the
app's `doPost` writes, and its query params are frozen, so the JSONP resume read
(`?participant=&callback=`) does nothing. Using it loses all data silently. Get the
right URL from **Deploy ▸ Manage deployments ▸ Web app URL**.

### Changing the endpoint

Per-session override, highest priority, nothing to rebuild:

```
https://<user>.github.io/<repo>/?sync=https://script.google.com/macros/s/AKfy…/exec
```

Resolution order is `?sync=` → `window.WORKSHOP_SYNC_URL` → baked-in `SYNC_URL`.

For a permanent change, edit `const SYNC_URL` in `src/Card Workshop.dc.html` and
re-export `index.html`. The root `index.html` is generated — the only safe hand-edit is
that one string literal, which appears exactly once.

Three checks before a session:
1. Open the `/exec` URL in a browser — it returns `{"ok":true,"rows":N}`. (You'll land on
   a `googleusercontent.com/…/echo` address; that's the expected redirect. Don't copy it.)
2. Sign in on the live link and look at the header badge. It must **not** say
   `⚠ 로컬 저장만 · 서버 미연결` / `⚠ Local only · no server` — that means the endpoint
   is missing and data is staying on the device.
3. Move one card, wait ~3 s, then check the sheet for a new `autosave` row. Writes are
   fire-and-forget (`no-cors`), so the badge means "sent", not "stored" — the sheet is
   the only real confirmation.

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
