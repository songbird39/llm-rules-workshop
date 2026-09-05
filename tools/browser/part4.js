// 스위트 4/4 — 저장과 불러오기 / the persistence quarter: what reaches the sheet,
// what comes back, and what happens when two people or two builds meet. Run via e2e.js.
const { APP, SHOTS, check, near, boardCards, boardTransform, uiScale,
        boot, toStep1, toBoard, dragTileToBoard, realServer, say } = require("./harness");

module.exports = async function (browser) {
  // ------------------------------------------------- analysis, against the REAL server
  // 스텁이 아니라 진짜 Code.gs 를 뒤에 둔다 / the endpoint here is server/Code.gs itself,
  // running in node over a simulated sheet. This is the check that answers "I made changes,
  // left, came back, and they were gone": a stub would have happily handed back whatever
  // the test handed it, and said nothing about whether the sheet-backed scan finds it.
  say("\nanalysis edits survive leaving and coming back (real Code.gs behind the page)");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const board = {
      savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "act", title: "학습 계획", desc: "", dia: null, collapsed: false, w: 352, x: 300, y: 400 }],
      notes: [{ id: "n1", x: 300, y: 700, text: "참여자 메모" }], arrows: [], seq: 5, panelW: 566,
    };
    const { srv, posts } = await realServer(page, {
      seed: (s) => s.post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: board } }),
    });
    const enter = async () => {
      await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
      await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
      await page.fill('input[placeholder="P0000"]', "admin");
      await page.getByText("시작하기", { exact: false }).click();
      await page.waitForTimeout(900);
      await page.getByText("P9", { exact: true }).first().click();
      await page.waitForTimeout(1600);
    };
    await enter();
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();

    // 분석 작업을 한다 / do a session's worth of analysis
    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(700);
    await page.getByText("✎ 전사", { exact: true }).click();
    await page.waitForTimeout(150);
    await page.mouse.click(cb.x + cb.width * 0.55, cb.y + cb.height * 0.35);
    await page.waitForTimeout(400);
    // 실제 전사 분량 / a real transcript, far past what one cell holds
    const transcript = "\"먼저 스스로 써 보고 나서 확인만 받으려고 했어요.\" 라고 말했다.\n".repeat(2000);
    await page.evaluate((t) => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const ta = [...L.querySelectorAll(':scope > [data-obj="note"] textarea')].pop();
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(ta, t);
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, transcript);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "펜", exact: true }).click();
    await page.waitForTimeout(150);
    await page.mouse.move(cb.x + 140, cb.y + cb.height * 0.8);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(cb.x + 140 + i * 24, cb.y + cb.height * 0.8 + i * 8); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.getByRole("button", { name: "펜", exact: true }).click();
    await page.waitForTimeout(6500);          // 큰 기록은 5초 간격 / a big record waits 5s

    const shape = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const ns = [...L.querySelectorAll(':scope > [data-obj="note"]')];
      return {
        cards: [...L.querySelectorAll(':scope > [data-obj="card"]')].length,
        notes: ns.length,
        ink: document.querySelectorAll("polyline").length,
        chars: ns.reduce((a, n) => a + (n.querySelector("textarea") || { value: "" }).value.length, 0),
      };
    });
    const left = await shape();
    check(left.cards === 2 && left.notes === 3, "the analysis is on the board before leaving",
      ` (${JSON.stringify(left)})`);
    check(posts.some((b) => b.kind === "sensemaking"), "a board record was written");
    check(posts.some((b) => b.kind === "transcript"), "and the transcript went to its own record");
    check(srv.get({ participant: "sm:P9" }).state !== null, "the server can find the board record");
    check((srv.get({ participant: "tx:P9" }).state || {}).texts !== undefined,
      "and the transcript record");

    // 나갔다가 다시 들어온다 / leave, and come back — the exact thing that was broken
    await page.getByText("← 목록", { exact: false }).click();
    await page.waitForTimeout(600);
    await page.getByText("P9", { exact: true }).first().click();
    await page.waitForTimeout(2200);
    const back = await shape();
    check(back.cards === left.cards && back.notes === left.notes,
      "everything is still there on re-entry", ` (${JSON.stringify(back)})`);
    check(back.ink === left.ink && back.ink > 0, "the ink came back too");
    check(back.chars === left.chars && back.chars > 60000,
      "and the whole transcript, not a truncated one",
      ` (${back.chars} of ${left.chars})`);

    // 그리고 완전히 새로 열어도 / and again from a cold load, not just a re-render
    await enter();
    const cold = await shape();
    check(JSON.stringify(cold) === JSON.stringify(left), "a fresh page load finds it all as well",
      ` (${JSON.stringify(cold)})`);
    check(!(await page.evaluate(() => document.body.innerText.includes("오래되었습니다"))),
      "and a current deployment says nothing about being out of date");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- analysis history and a second editor
  // 해석에도 역사가 있어야 한다 / the analysis needs a history of its own: it is a separate
  // record from the participant's board, two people may write to it, and until now the
  // only way to find out you had been overwritten was to notice work missing.
  say("\nanalysis history: checkpoints, going back, and a second editor");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const board = {
      savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "act", title: "학습 계획", desc: "", dia: null, collapsed: false, w: 352, x: 300, y: 400 }],
      notes: [], arrows: [], seq: 5, panelW: 566,
    };
    const { srv } = await realServer(page, {
      seed: (s) => s.post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: board } }),
    });
    page.on("dialog", (d) => d.accept("1차 코딩 완료"));   // 저장점 이름 / the checkpoint name
    const enter = async () => {
      await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
      await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
      await page.fill('input[placeholder="P0000"]', "admin");
      await page.getByText("시작하기", { exact: false }).click();
      await page.waitForTimeout(900);
      await page.getByText("P9", { exact: true }).first().click();
      await page.waitForTimeout(1800);
    };
    const nSm = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="card"]')].length;
    });
    await enter();

    // 한 장 복제하고 저장점 / one copy, then mark it
    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(2600);
    check(await nSm() === 2, "one copy on the board", ` (${await nSm()})`);
    await page.getByText("저장점", { exact: false }).click();
    await page.waitForTimeout(900);
    const marked = srv.get({ versions: "sm:P9", every: "1" }).versions.filter((v) => v.kind === "checkpoint");
    check(marked.length === 1, "the checkpoint is written as its own kind", ` (${marked.length})`);
    check(marked[0] && marked[0].label === "1차 코딩 완료", "carrying the name that was typed",
      marked[0] ? ` (${marked[0].label})` : "");

    // 더 작업한다 / carry on working, so there is something to come back FROM
    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(2800);
    check(await nSm() === 3, "more analysis on the board", ` (${await nSm()})`);

    // 해석 기록을 연다 / open the analysis history
    await page.getByText("기록", { exact: true }).click();
    await page.waitForTimeout(1400);
    check(await page.evaluate(() => document.body.innerText.includes("해석 기록")),
      "the history dialog offers the analysis as well as the participant's board");
    // 기본은 참여자 보드 / it opens on the participant's board, as 기록 always has, and the
    // analysis is one tab away
    check(!(await page.evaluate(() => document.body.innerText.includes("1차 코딩 완료"))),
      "and opens on the participant's board, where the checkpoint does not belong");
    await page.getByText("해석 기록", { exact: true }).click();
    await page.waitForTimeout(1400);
    check(await page.evaluate(() => document.body.innerText.includes("1차 코딩 완료")),
      "the analysis tab lists the checkpoint by name");

    // 저장점으로 돌아간다 / travel to the checkpoint
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("1차 코딩 완료"));
      b.click();
    });
    await page.waitForTimeout(1600);
    check(await nSm() === 2, "going back to it restores that moment's analysis", ` (${await nSm()})`);
    check(await page.evaluate(() => document.body.innerText.includes("기록 보는 중")), "and saving is paused");
    // 참여자 보드는 건드리지 않는다 / the participant's own card is still there, untouched
    check(await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="card"] input')].some((i) => i.value === "학습 계획");
    }), "while the participant's board underneath is untouched");

    // 되돌아가기 / and back to the latest, without adopting it
    await page.getByText("최신으로 돌아가기", { exact: false }).click();
    await page.waitForTimeout(1800);
    check(await nSm() === 3, "cancelling returns to the newest analysis", ` (${await nSm()})`);

    // ── 두 번째 편집자 / a second editor writes to the same record ──────────
    const theirs = {
      savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "z1", type: "when", title: "공동연구자가 쓴 것", sm: true, src: "a", x: 1400, y: 300 }],
      notes: [], arrows: [], strokes: [], seq: 30,
    };
    srv.post({ participant: "sm:P9", kind: "sensemaking", stamp: Date.now() + 60000,
               payload: { participant: "sm:P9", state: theirs } });
    // 감시는 20초마다 / the watch polls every 20s
    await page.waitForTimeout(21000);
    check(await page.evaluate(() => document.body.innerText.includes("다른 사람이 이 해석을 저장했습니다")),
      "the second editor's save is noticed and named");
    const before = srv.get({ participant: "sm:P9" }).state.cards.length;
    await page.waitForTimeout(3000);
    check(srv.get({ participant: "sm:P9" }).state.cards.length === before,
      "and nothing of ours is written over it while it is unresolved");

    await page.getByText("상대 버전 불러오기", { exact: false }).click();
    await page.waitForTimeout(2000);
    check(await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="card"] input')].some((i) => i.value === "공동연구자가 쓴 것");
    }), "loading theirs brings their work onto the board");
    check(!(await page.evaluate(() => document.body.innerText.includes("다른 사람이 이 해석을"))),
      "and clears the warning");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- work saved by the older build
  // 공동연구자가 이미 해 둔 분석 / a coauthor's analysis, saved by the build before any of
  // this: one row, whole state, transcript text sitting inside the note. Opening it must
  // show that text, and — the part that could quietly destroy it — saving the board
  // afterwards must not strip the text out before the transcript record exists.
  say("\nanalysis saved by the older build opens, and survives being edited");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const transcript = "예전 빌드에서 붙여넣은 전사입니다.\n두 번째 줄\n세 번째 줄";
    const board = {
      savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "act", title: "학습 계획", desc: "", dia: null, collapsed: false, w: 352, x: 300, y: 400 }],
      notes: [], arrows: [], seq: 5, panelW: 566,
    };
    // 예전 모양 그대로 / exactly the old shape: no src, no strokes, text inside the note
    const legacyAnalysis = {
      savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "s5", type: "act", title: "학습 계획", desc: "", sm: true, x: 900, y: 400, w: 352 }],
      notes: [{ id: "n7", x: 900, y: 250, text: transcript, kind: "tx", sm: true }],
      arrows: [], seq: 9, panelW: 566,
    };
    const { srv } = await realServer(page, {
      seed: (s) => {
        s.post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: board } });
        s.post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: legacyAnalysis } });
      },
    });
    const enter = async () => {
      await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
      await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
      await page.fill('input[placeholder="P0000"]', "admin");
      await page.getByText("시작하기", { exact: false }).click();
      await page.waitForTimeout(900);
      await page.getByText("P9", { exact: true }).first().click();
      await page.waitForTimeout(1800);
    };
    const texts = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="note"] textarea')].map((t) => t.value);
    });
    await enter();
    check((await texts()).includes(transcript), "the old record's transcript is there on opening",
      ` (${JSON.stringify(await texts())})`);

    // 보드만 건드린다 — 전사는 손대지 않는다 / touch the BOARD only, not the transcript: this is
    // the dangerous case, because the board save is what drops the text from the note
    const cardBox = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...L.querySelectorAll(':scope > [data-obj="card"]')].pop();
      const r = el.getBoundingClientRect();
      return { x: r.x + 120, y: r.y + 8 };
    });
    await page.mouse.move(cardBox.x, cardBox.y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) { await page.mouse.move(cardBox.x + i * 14, cardBox.y + i * 9); await page.waitForTimeout(50); }
    await page.mouse.up();
    await page.waitForTimeout(3000);

    const saved = srv.get({ participant: "sm:P9" }).state;
    const txRec = srv.get({ participant: "tx:P9" }).state;
    check(saved && saved.notes.every((n) => !n.text), "the new board record carries no transcript text");
    check(txRec && txRec.texts && txRec.texts.n7 === transcript,
      "because it was moved into the transcript record FIRST",
      txRec ? "" : " (no transcript record was written at all)");

    await enter();
    check((await texts()).includes(transcript), "so it is still there after a reload",
      ` (${JSON.stringify(await texts())})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- the older build against this server
  // 서버만 먼저 배포했을 때 / the coauthor keeps working in a tab loaded from the previous
  // build while the new Code.gs is already deployed. Their client knows nothing about
  // slices or tx: records, so the new server has to keep answering them in the old shape.
  say("\nthe previous build still works against the new server");
  {
    const { loadServer } = require("../gasnode");
    const srv = loadServer();
    const legacy = {
      savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "s5", type: "when", title: "예전", desc: "", sm: true, x: 900, y: 400 }],
      notes: [{ id: "n7", x: 900, y: 250, text: "예전 전사", kind: "tx", sm: true }],
      arrows: [], seq: 9,
    };
    // 예전 클라이언트가 보내는 그대로 / exactly what the older client posts
    srv.post({ participant: "sm:P9", kind: "sensemaking", queuedAt: new Date().toISOString(),
               payload: { participant: "sm:P9", state: legacy } });
    const back = srv.get({ participant: "sm:P9" });
    check(back.state && back.state.notes[0].text === "예전 전사",
      "the new server stores and returns an old-shape save unchanged");
    check(back.version === "2026-09-05", "and reports its version, which the old client ignores");
    // 그리고 새 클라이언트가 저장한 것을 예전 클라이언트가 읽어도 / and a record this build
    // sliced across rows still comes back as one plain state, which is all the old client
    // knows how to read
    const big = JSON.parse(JSON.stringify(legacy));
    big.notes[0].text = "긴".repeat(40000);
    const json = JSON.stringify(big);
    const size = 30000, n = Math.ceil(json.length / size);
    for (let i = 0; i < n; i++) {
      srv.post({ participant: "sm:P9", kind: "sensemaking", stamp: 7, part: i, parts: n,
                 payload: { participant: "sm:P9", chunk: json.slice(i * size, (i + 1) * size) } });
    }
    const reassembled = srv.get({ participant: "sm:P9" });
    check(reassembled.state && reassembled.state.notes[0].text.length === 40000,
      "a sliced record reads back as one whole state", ` (${(reassembled.state.notes[0].text || "").length})`);
  }

  // ------------------------------------------------- an out-of-date deployment says so
  // 배포를 미루면 조용히 어긋난다 / a deferred redeploy fails silently: the new client slices a
  // record across rows, an old server cannot reassemble them, and the analysis saves and
  // then will not load — with nothing anywhere saying why. That is not a state to leave
  // anyone guessing in.
  say("\nan out-of-date Apps Script is named as the problem");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // 옛 배포 흉내 / an old deployment: answers the roster, but reports no version
    await page.route("**/macros/s/**", async (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") return route.fulfill({ status: 200, body: "{}" });
      const cb = u.searchParams.get("callback");
      const out = u.searchParams.get("list")
        ? { ok: true, participants: [{ participant: "P9", rows: 3, submits: 1, lastAt: "2026-08-29T10:00:00Z" }] }
        : { ok: true, state: null };
      return route.fulfill({ status: 200, contentType: "application/javascript", body: cb + "(" + JSON.stringify(out) + ");" });
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => document.body.innerText.includes("Apps Script가 오래되었습니다")),
      "the admin is told the deployment is old");
    check(await page.evaluate(() => document.body.innerText.includes("버전: 새 버전")),
      "and told exactly what to do about it");
    check(await page.evaluate(() => document.body.innerText.includes("P9")),
      "while the roster still works, since reading mostly does");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

};
