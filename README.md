# Handoff: LLM 학습 규칙 설계 워크샵 (AI Learning-Rules Card Workshop)

## Overview

A research instrument for a study on how learners self-govern their LLM use. A
participant signs in with a code, picks (and edits) rules describing how they intend to
use AI for learning, then arranges **Rule · When · How** cards freely on a zoomable
board — drawing arrows and adding notes — to express their own governance design. Every
change autosaves; a submit writes the full board out as JSON.

It is run unattended on participants' own devices (phone, tablet, laptop) from a single
URL, so **cross-device resume and never-lose-data are functional requirements, not
niceties.**

## About the design files

The files in `src/` are **design references implemented in HTML** — a
working prototype of the intended look and behavior, not production code to lift
wholesale. If you are moving this into an existing codebase (React/Vue/Svelte/native),
**recreate the screens in that environment's established patterns**; if there is no
environment yet, pick a framework and implement there. The one part that *is* meant to
ship as-is is `server/Code.gs`.

Caveat for whoever rebuilds this: the prototype uses a small in-house template runtime
(`src/support.js`, `<x-dc>` templates, inline styles only, a `Component extends DCLogic`
logic class). Treat it as "a React class component whose render lives in the template".
Do not port the runtime — port the design and the behavior.

## Fidelity

**High-fidelity.** Colors, typography, spacing, copy (both languages), and interactions
are final and intentional. Recreate pixel-for-pixel; the values below are exact.
Two things are deliberately not final: the visual style of the diagram line-icons, and
the Google Sheet as a backend (see *Known limits*).

---

## Screens / Views

Single-page app, three sequential steps plus a persistent header. `state.step`
∈ {0,1,2} drives everything.

### Header (always visible)

- `display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; min-height:58px;
  padding:9px 18px; background:#faf8f3; border-bottom:1px solid #e2dfd7`
- Height is **auto with a min** — it wraps to 2–3 rows on narrow screens. This was a bug
  fix; do not reintroduce a fixed height or `nowrap`.
- Contents, left → right: Back button (step 2 only) · title block · participant chip +
  sync badge + logout (when signed in) · language `<select>` · flexible spacer ·
  step-specific action group.
- Title block: `min-width:0`, title 16px/600/`-0.01em` with
  `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`; step sub-label 11px,
  `letter-spacing:.06em`, `#98958c`.
- **Sync badge** (pill, `padding:3px 8px; border-radius:20px; font-size:11.5px`, 6px dot):
  | state | label (ko / en) | text | dot | bg |
  |---|---|---|---|---|
  | no endpoint | `⚠ 로컬 저장만 · 서버 미연결` / `⚠ Local only · no server` | `#8a6a1f` | `#d0a531` | `#f7f0dc` |
  | configured, idle | `서버 연결됨` / `Server connected` | `#98958c` | `#c9c5ba` | `#f4f2eb` |
  | reading on sign-in | `서버에서 불러오는 중…` / `Loading from server…` | `#98958c` | `#c9c5ba` | `#f4f2eb` |
  | writing | `저장 중…` / `Saving…` | `#98958c` | `#c9c5ba` | `#f4f2eb` |
  | written | `서버 저장됨` / `Saved to server` | `#5b7a5e` | `#7d9a80` | `#f4f2eb` |
  | queued offline | `오프라인 · 재시도 대기` / `Offline · will retry` | `#b03f34` | `#c9776c` | `#f4f2eb` |

  The badge must be visible whenever signed in — its job is to make a misconfigured
  session obvious to the operator *before* participants start.

### Step 0 — Participant sign-in

- Centered card on `#f1efe8`: `width:380px; background:#fffefb; border:1px solid #e2dfd7;
  border-radius:14px; padding:32px 34px; box-shadow:0 6px 24px rgba(0,0,0,.06)`,
  `gap:18px`.
- Title 17px/700; sub-copy 12.5px/1.6 `#7a776f`.
- Input: `padding:9px 12px; border:1px solid #dedbd3; border-radius:8px; background:#fdfcf9;
  font-size:15px; font-weight:600`, focus border `oklch(0.51 0.08 253)`, placeholder `P00`,
  autofocus, Enter submits.
- Below: chips for participant codes already saved on this device (tap to resume).

### Step 1 — Choose rules

- Instruction line, then a responsive grid of the three rule categories:
  `grid-template-columns: repeat(auto-fit, minmax(min(100%,270px), 1fr)); gap:22px;
  align-items:start`. Reflows 3-up → 1-up without media queries; keep it.
- The three categories (`id`, label, sub) — labels are sentence *frames*, intentionally
  with blanks:
  1. `use` — “~~에만 AI를 사용한다” / *Set the scope of AI use*
  2. `way` — “AI를 통한 ~~는 ~~하게 한다” / *Set the manner of AI use*
  3. `alt` — “AI 대신 ~~로 한다” / *Choose a non-AI alternative*
- Rule cards are **multi-select and editable in place** (title + description); an edited
  card is flagged `custom:true` and is thereafter exempt from language switching.
- Footer action group: `<n> 개 선택됨` / `<n> selected` (or the prompt copy when none),
  plus **다음 →**, `opacity:.4` and inert until ≥1 selected.

### Step 2 — Combine (the board)

- Split view: resizable left panel (`state.panelW`, default 566px, drag handle) over a
  free canvas.
- Panel holds three decks — Rule cards (only the ones chosen in step 1), When cards, How
  cards — each with a heading + sub. Drag onto the board, or double-click to place.
- Canvas: pan (wheel/drag), zoom (⌘/ctrl-wheel, or −/+ with a monospace % readout, 32×33px
  buttons in a bordered group). Cards are **168px** wide (`CARD`), snapped to a **24px**
  grid (`snapToGrid` prop, default on).
- Cards support move, resize (width), duplicate, delete, inline text edit, and a small
  line-icon diagram per card type.
- **Arrow mode** (`↗ 화살표`): drag card → card to connect; an arrow shows an ✕ delete
  affordance on selection. Uses `pointerdown`, not `click`.
- **Note mode** (`✎ 메모`): click empty canvas to drop a free text note anywhere.
- Toolbar right group wraps (`flex-wrap:wrap; justify-content:flex-end`): zoom group,
  Arrow, Note, Reset view, **제출 · JSON 저장** (primary, `#1b1a17`), Clear (quiet, turns
  `#b03f34` on hover, confirms first).

---

## Interactions & behavior

- All pointer interaction is `pointerdown`/`pointermove`/`pointerup` on `window` —
  required for touch parity. Synthetic `click()` will not drive it.
- Rule selection, card placement, arrow drawing, note creation, panel resize, pan/zoom:
  no transitions on drag (position is state-driven per frame). Hover states are
  background-only (`#f1efe8` on light buttons, `#35332c` on the dark primary).
- Language switch (`ko`/`en`) retranslates only pre-laid, non-`custom` content; anything
  the participant typed keeps its original language. Choice persists in `localStorage`.
- Zoom clamps via `zoomBy(±0.08)`; **Reset view** returns `pan {0,0}`, `zoom 1`.
- Clear asks for confirmation, then empties cards, notes, arrows and selection.

## State management

`state`: `step, lang, pid, loginPid, rules[], cards[], notes[], arrows[], seq, panelW,
pan{x,y}, zoom, arrowMode, noteMode, pendingArrow, selArrow, focus…, sync, loadingRemote`.

Persistence has three layers:

1. **Device (always on).** Key `llm-guardrail-workshop-v4:<pid>` ← full state +
   `savedAt`. `:lang` and `:queue` are reserved sibling keys and must be excluded from
   the "saved participants" listing.
   After applying any loaded state (local or remote) the autosave baseline signature is
   re-seeded, so a sign-in or a device switch with no edits sends nothing — the first
   real edit is what triggers the first write.
2. **Server write.** Debounced **2500 ms** after any change to cards/notes/arrows/rules
   → one queued item `{id, kind:'autosave'|'submit', participant, queuedAt, payload}`;
   submit enqueues immediately. Queue lives in `:queue` (capped at 40), drains
   sequentially, and on failure stops, marks `offline`, and retries every **20 s**, on
   the `online` event, and on next page load. Autosaves for the same participant collapse
   to one queued item.
3. **Server read (cross-device).** On sign-in: paint the local copy instantly, then fetch
   the participant's newest server snapshot. Apply it **only if**
   `remote.savedAt > local.savedAt` **and** this device has nothing queued; otherwise the
   local copy wins and is pushed up. This ordering is the whole cross-device guarantee.

Endpoint resolution order: `props.syncUrl` → `?sync=<url>` query param →
`window.WORKSHOP_SYNC_URL` → `SYNC_URL` constant → empty (local-only).

### Wire protocol

- **Write:** `POST <exec>` , `mode:'no-cors'`, `Content-Type: text/plain;charset=utf-8`,
  body = the queue item JSON. Fire-and-forget: the response is opaque, so "saved" means
  *sent*, not acknowledged.
- **Read:** JSONP — `GET <exec>?participant=<pid>&callback=<fn>`, 9 s timeout, callback
  and `<script>` cleaned up either way. JSONP (not CORS) because Apps Script cannot set
  CORS headers on `doGet`.
- **Health:** `GET <exec>` → `{"ok":true,"rows":N}`.
- If you replace the backend with a real service, keep this contract and you can leave
  the client untouched — or better, swap the two calls for `fetch` with proper CORS and
  drop the JSONP path entirely.

## Design tokens

Type: **Pretendard** (Korean + Latin, `pretendard.css`), monospace only for the zoom
readout. Sizes in use: 11, 11.5, 12.5, 13, 13.5, 15, 16, 17 px. Weights 400/600/700.
Display tracking `-0.01em`; label tracking `.04–.06em`.

Deck accents (`ACC`) / tints (`TINT`):

| deck | accent | tint |
|---|---|---|
| rule | `oklch(0.51 0.08 253)` | `oklch(0.93 0.026 253)` |
| when | `oklch(0.51 0.08 62)` | `oklch(0.93 0.026 62)` |
| how | `oklch(0.51 0.08 160)` | `oklch(0.93 0.026 160)` |

Ink `#1b1a17` → `#44423b` → `#7a776f` → `#98958c` → icon `#96938a`.
Surfaces `#fffefb`, `#fdfcf9`, `#faf8f3`, `#f7f5f0`, `#f4f2eb`, `#f1efe8`.
Lines `#eae7df`, `#e8e5dd`, `#e2dfd7`, `#dedbd3`, `#d6d3ca`.
Semantic: danger `#b03f34` / border `#ddc0bb`; ok `#5b7a5e`; warn `#8a6a1f` on `#f7f0dc`.
Radii 6, 7, 8, 14, 20(pill), 50%. Shadow `0 6px 24px rgba(0,0,0,.06)`.
Spacing in use: 1, 4, 5, 6, 8, 10, 12, 16, 18, 22, 32/34. Grid snap 24. Card width 168.

## Assets

No images or icon fonts. The per-card diagrams are inline SVG built in the logic class
(`diagram(key)`): 2.2px strokes, round caps, `#96938a` ink plus the one deck accent.
Only web font is Pretendard from jsDelivr — **self-host it** in production.

## Files

```
src/Card Workshop.dc.html   the design + all logic (~1170 lines) — the source of truth
src/support.js              prototype runtime; do NOT port
index.html                  self-contained 22 MB build (repo root = GitHub Pages);
                            opens offline; what participants run
server/Code.gs              Apps Script backend — ships as-is
DEPLOY.md                   GitHub Pages + Apps Script setup, and the pre-session checklist
```

## Known limits / next steps

- **Google Sheet backend** is right for a pilot, wrong past a few hundred participants:
  writes are unacknowledged, `doGet` scans the sheet linearly, and there is no auth or
  rate limiting. First real refactor: a small endpoint (Supabase / Firestore / anything
  with CORS) keyed on participant code, with acked writes.
- **Participant code is the only identity** — anyone with a code can read that board.
  Acceptable for a supervised study; not acceptable if data is sensitive.
- The 22 MB single-file build exists so the study can run with zero infrastructure. In a
  real app, drop it — bundle normally and self-host the font.
- The offline → queue → 20 s retry branch has not been exercised against a genuinely
  unreachable endpoint. Test it before the first real run.
