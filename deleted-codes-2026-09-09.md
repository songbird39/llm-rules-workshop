# 삭제한 코드 / codes deleted — 2026-09-09

네 폴더(timing, embodiment, target, negotiate)의 코드 14개를 코드북에서 지웠습니다.
**코딩 65건은 시트에 그대로 있습니다** — 지운 것은 코드뿐이고, 보드가 태그를 그리지
않을 뿐입니다. 아래 id 로 같은 코드를 되살리면 그 65건도 다시 보입니다.

Fourteen codes across four folders were removed from the codebook. **The 65 codings
that used them are still on the sheet** — only the codes were deleted, and the board
simply stops drawing their tags. Restoring a code under the same id brings its codings
back into view.

## 되살리는 법 / to restore one

Apps Script 엔드포인트로 아래와 같이 POST 하면 됩니다 (`deleted: false`):

```js
fetch(EXEC_URL, {
  method: 'POST', mode: 'no-cors',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    kind: 'code', id: 'kmttsq87ucu8', name: 'before-LLM',
    folder: 'timing', color: '', deleted: false
  })
});
```

id 가 같아야 합니다. 이름이나 폴더는 바꿔도 되고, 코딩은 id 로만 연결되어 있습니다.
The id must match; the name and folder can be changed freely, since a coding refers
to nothing but the id.

## 지운 코드 / what was deleted

| folder | name | id | codings |
|---|---|---|---|
| timing | before-LLM | `kmttsq87ucu8` | 2 |
| timing | while-LLM | `kmttsqd76o1b` | 1 |
| timing | after-LLM | `kmttsqjfwlt4` | 2 |
| timing | before-user | `kmttu2pqwmt2` | 2 |
| timing | while-user | `kmttu4fxkjij` | 0 |
| timing | after-user | `kmttu4imgcgs` | 3 |
| embodiment | attitude-behavior | `kmttsr36wokj` | 11 |
| embodiment | artifact | `kmttsrfydc46` | 7 |
| embodiment | prompt | `kmttsrih33ib` | 6 |
| embodiment | tool(external) | `kmttsrt2jlak` | 2 |
| target | for-user | `kmttss3hb787` | 9 |
| target | for-LLM | `kmttss5hgetl` | 8 |
| negotiate | negotiable | `kmtttyrmta57` | 4 |
| negotiate | non-negotiable | `kmtttywqndny` | 8 |

합계 / total: 14 codes, 65 codings.

## 남은 코드북 / what remains — 20 codes

- **value** (10): quality-accuracy, authentic-language, authentic-personal,
  preserve-learning, convenience-efficiency, engagement, enrich, motivate,
  agency-control, desirable-difficulty
- **focus** (3): production, retrieval, understanding
- **srl** (3): planning, learning, reflecting
- **friction** (4): ease-desirable, against-undesirable, no-change-friction,
  remind-prompt

시트의 코딩 240건은 손대지 않았습니다. / All 240 codings are untouched on the sheet.

---

# 합친 코드 / codes merged — 2026-09-09

`value/engagement` 가 두 개 있었습니다. 남긴 쪽은 `kmttssypfuez`, 없앤 쪽은
`kmttstukcw3v` 입니다.

Two `value/engagement` codes existed. `kmttssypfuez` was kept; `kmttstukcw3v` is gone.

- **옮긴 코딩 3건 / 3 codings repointed** to the surviving code — same coding ids,
  their `code` now `kmttssypfuez`:
  `gmttuek8grth3` (P8967), `gmtu061wnahxa` (P4202), `gmtu0d8j3s36p` (P4202)
- **지운 코딩 10건 / 10 codings dropped as redundant** — each of these sets ALREADY
  carried the surviving engagement code, so keeping both would have put the same code
  on one set twice, which the app itself treats as a toggle rather than a duplicate:

  | coding id | participant | members |
  |---|---|---|
  | `gmttudd3pu3ts` | P8967 | s190, s191, s189 |
  | `gmttwqufcjoxy` | P5705 | s115, s111, s116, s112 |
  | `gmttxj7myuugu` | P7059 | s335, s336, s337, s340, s341, s342 |
  | `gmttxx2gizl3x` | P4113 | s54 |
  | `gmttxy1kvkuu9` | P4113 | c96, c95 |
  | `gmttxz6uxlb2c` | P4113 | s72, c91, c167 |
  | `gmtty0cqb7i1t` | P4113 | s64, c93, c92 |
  | `gmtty55l5oove` | P4113 | s67, c171 |
  | `gmttyoggv225t` | P7194 | s191, s192 |
  | `gmtu09bupw40s` | P4202 | s88, s89 |

결과 / result: engagement 24 + 13 → **27건**, 서로 다른 27개 묶음에.
코딩 총계 240 → 230. 이름이 같은 코드는 이제 없습니다.

engagement went 24 + 13 → **27 codings on 27 distinct sets**; the total went 240 → 230.
No two codes share a name any more.

되살리려면 위 표의 coding id 로 `kind:'coding'`, `deleted:false`, `name:'kmttstukcw3v'`
(또는 살리고 싶은 코드 id) 로 POST 하면 됩니다. 시트는 append-only 라 원래 행은 그대로
남아 있습니다. / To undo, POST the coding id back with `deleted:false`; the sheet is
append-only, so the original rows are all still there.
