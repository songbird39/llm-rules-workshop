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

### What a session looks like

**로그인 화면** — the IRB information sheet and consent form sit open beside the
participant-code box, so it can be read without clicking anything first. Two buttons
download the **last page** — the sheet that actually gets signed — as a PDF or as a
200dpi PNG for printing.

The pages are baked in as images, not as an embedded PDF: `<embed>`/`<iframe>` PDF
rendering varies by browser (Safari and iOS show only the first page, or nothing), and a
consent document that silently fails to display is not an acceptable failure mode. They
are attached through a stylesheet injected at mount rather than written into the markup,
because the browser resolves `url()` while parsing — before the template engine
substitutes anything — so an interpolated `src` is fetched literally and 404s on every
load. If the IRB document changes, replace `assets/동의서-참여자배포용.pdf`, then:

```bash
python3 tools/consent.py     # re-rasterise into src (--check tells you if it is stale)
python3 tools/build.py       # splice src into index.html
```

**1단계 · 워크플로 만들기** — participants lay ① **활동** tags left to right in the order
they study, and attach ② **수단** post-its saying what each is done with. Tags are wider
than cards with a larger title, so the timeline reads as a different level from the cards
placed under it. A tag's width can be dragged from its right edge; the handle is
invisible until the pointer is over it, so nobody who isn't looking for it is bothered by
it. 다음 unlocks once at least one activity is on the board.

**2단계 · 가드레일 붙이기** — the same board, with ③ **제약** · ④ **언제** · ⑤ **발동 사건**
cards placed under each activity. The **① 활동 · ② 수단** tab reopens the workflow decks
without leaving the board.

Phase (활동 전 → 중 → 후) is framed in the hint line rather than enforced with lanes or
bands: participants are free to wrap to another row when a workflow branches or gets long,
and a horizontal phase axis would stop meaning anything the moment they did.

### Interface size

Every size in the app is a hardcoded px value (fonts run 9–17px), which is unreadably
small on a 1440p or 4K monitor. The app root now scales with CSS `zoom`, picked from the
viewport width at load:

| viewport width | scale |
|---|---|
| ≥ 2200px (1440p/4K at 100%) | 1.35 |
| ≥ 1700px | 1.2 |
| below that (laptops, tablets, phones) | 1.0 — unchanged |

Override per link with `?ui=` (clamped 0.8–2.0), combinable with `?sync=`:

```
https://songbird39.github.io/llm-rules-workshop/?ui=1.5
https://songbird39.github.io/llm-rules-workshop/?ui=1     ← exactly the old, unscaled UI
```

`?ui=1` is the escape hatch: if anything looks wrong mid-session, that restores the
pre-scaling behaviour without a redeploy. Browsers without CSS `zoom` support fall back
to 1.0 automatically.

This is separate from the **board zoom** (the −/+ control on the canvas, 35–160%), which
only scales the cards. The UI scale covers the panel, header and toolbar too.

⚠ If you change any pointer/drag code, re-run `node tools/test_ui_scale.js`. Pointer
events arrive in scaled client px while card positions are stored in unscaled px, so a
missing division makes cards drift away from the cursor.
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
https://script.google.com/macros/s/AKfycbwOKZ3D8lRPMXtdpkhj6GR-QNAtYIIhQfyIBrecUOdCIQJYhiwjM6BOs0F_ty1rAw79cQ/exec
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

## View mode (admin)

Sign in with the participant code **`admin`** instead of a real code. You get a list of
everyone in the sheet — code, record count, whether they submitted, last activity — and
clicking one opens their board **read-only**.

⚠ **Requires an Apps Script redeploy.** The roster uses a new `?list=1` action in
`server/Code.gs`. Paste the current file into the editor, then publish it.

Two ways, and they differ in one important respect:

| | URL | notes |
|---|---|---|
| **Deploy ▸ Manage deployments ▸ Edit ▸ Version: New version** | **unchanged** | preferred — nothing to re-bake |
| **Deploy ▸ New deployment** | **new `/exec` URL** | you must re-bake `SYNC_URL` or the app keeps talking to the old deployment |

Saving the script without publishing either way leaves the old code live, and the roster
shows *"Could not load the list."*

Old deployments keep serving the version they were pinned to, so a stale one still accepts
participant saves — it just lacks `?list=1`. That makes the failure quiet: saving looks
fine, only the roster breaks. If the roster errors, check that `SYNC_URL` above matches the
deployment you actually published to.

While viewing:

| blocked | still works |
|---|---|
| local save, autosave, any POST to the sheet | pan — drag the background, or scroll/trackpad |
| moving, editing, deleting, duplicating cards | zoom (−/+, or ctrl/⌘+scroll) and **화면 맞춤 / Reset view** |
| drawing arrows, adding notes | switching Step 1 / Step 2 |
| the card panel and submit/clear buttons (hidden) | refresh, back to list, reading everything |

Getting around a board: drag anywhere on the background to pan, scroll or two-finger
swipe to pan, ctrl/⌘+scroll to zoom. If a board looks empty, the participant's cards are
probably off to one side — press **화면 맞춤 / Reset view** to snap back to origin at 100%.

**Reading text longer than its card:** put the pointer over the card's text and scroll.
The text scrolls inside the card; once it hits top or bottom the board resumes panning.
You can also click into the text and select it. (Typing does nothing — the handler is a
no-op and the value is controlled, so it reverts immediately.) This applies to
participants too: before, a wheel event anywhere over the board panned it, so nobody
could scroll a description longer than its card.

Why this is belt-and-braces: `componentDidUpdate` fires on *any* state change and writes
both localStorage and a queued sheet POST, and `latestState_()` returns the **newest** row
for a participant. So one accidental nudge while viewing P01 would silently become P01's
canonical board. View mode therefore (a) keeps `state.pid` empty — the viewed code lives
in `viewPid` — which by itself makes every write path a no-op, and (b) additionally bails
out of `scheduleAutosave`, `enqueue` and `exportJson` on the first line. Cards are also
`pointer-events:none` and every mutating handler is swapped for a no-op.

**This is not access control.** `ADMIN_CODE` sits in client-side JS on a public page —
anyone who reads the bundle can find it, and the Apps Script endpoint accepts writes from
anyone regardless. It prevents *your own accidents*, which is what it is for. Change the
code in `src/Card Workshop.dc.html` (`const ADMIN_CODE`) if you want a different word, and
avoid handing a participant `admin` as their code.

Re-run `node tools/test_ui_scale.js` after touching any of this — it asserts the write
guards are the first statement in each path.

## Board image export (admin only)

Two buttons appear while viewing a participant:

- **이미지 저장 / Save image** — the participant's board only
- **이미지 (해석 포함) / Image (with workspace)** — including your sensemaking copies

It captures the **whole board**, not the viewport, so work spread across several rows or
sitting off-screen is included. The board is painted onto a canvas at 2× rather than
screenshotted or serialised from the DOM: nothing is fetched, so the canvas is never
tainted, and the page's own Pretendard is available to canvas text, so Korean renders as
it does on screen. Card icons are lifted from the SVGs already on the page.

To capture what a participant actually **submitted** rather than their latest state, open
History first, travel to the submit, then export.

## Sensemaking workspace (admin only)

Open a participant in view mode and you get an editable area beside their board, for
rebuilding and experimenting with a different arrangement.

- The participant's own objects stay **inert** — each is individually
  `pointer-events:none` with no-op handlers — and the rectangle enclosing their work is
  drawn and labelled *참여자 산출물 (수정 불가)*.
- **전체 복제 / Duplicate all** copies their whole board to the right of that rectangle.
  **선택 복제 / Duplicate selection** copies only what you marquee-selected (drag on
  empty canvas to select; participant objects can be selected even though they can't be
  edited). Arrows come along when both of their ends were copied.
- Copies are marked with an amber dashed border, and are fully editable: drag, retype,
  connect, delete. Drop one over the participant's rectangle and it is pushed clear.
- **해석 지우기 / Clear workspace** removes your copies and leaves their board untouched.
- All of it is admin-only; participants never see the region or the copies.

**Where it is stored, and why that matters.** The workspace saves to a *separate* key —
`sm:` + the participant code — never their own record. Three independent guards, because
getting this wrong would mean a participant reopening their board and finding your
experiment instead:

1. the client asserts the `sm:` prefix before every send, and only sm-flagged objects go
   in the payload;
2. `roster_()` skips `sm:` keys, so they never appear as participants;
3. `latestState_()` refuses to return a `kind:'sensemaking'` row for a bare participant id.

The e2e suite inspects **every** outbound POST and fails if any targets a bare code.

One deliberate limitation: this write is best-effort and bypasses the offline retry
queue, because that queue belongs to the participant session and is frozen in admin
mode. If the network drops mid-experiment the workspace simply isn't saved — the right
trade for never touching participant data.

⚠ Needs the same Apps Script redeploy as version history.

## Version history

The **기록 / History** button (next to the zoom controls, available to participants and
in admin view mode) lists saved versions and loads any of them back onto the board.

Every autosave already lands in the sheet, so history is a read problem, not a capture
one. Autosaves fire every 2.5s of activity, so the list is thinned server-side to **one
per ~2 minutes plus every submit** — a deliberate finish is never thinned away.

**Browsing never overwrites.** While a version is open the board is frozen: no
localStorage write, no autosave, no POST. Coming back out is explicit:

| | what it does |
|---|---|
| **이 버전으로 되돌리기 / Restore** | adopts that version as current; saving resumes and pushes it as a **new** row |
| **최신으로 돌아가기 / Back to latest** | discards it and reloads the newest state |

Nothing in the sheet is ever rewritten or deleted — history is append-only, so a restore
is just another entry. In admin view mode only *Back to latest* is offered, because
Restore would be a write and view mode never writes.

⚠ **Needs the Apps Script redeploy** (see §2) — `?versions=` and `?row=` are new server
actions, alongside `?list=`. Without it the History dialog shows *"Could not load
history."*

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
