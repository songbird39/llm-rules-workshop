// 스위트 3/3 / final third of the browser suite. Run it through e2e.js, not directly.
const { APP, SHOTS, check, near, boardCards, boardTransform, uiScale,
        boot, toStep1, toBoard, dragTileToBoard, realServer } = require("./harness");

module.exports = async function (browser) {
  // ------------------------------------------------- analysis, against the REAL server
  // 스텁이 아니라 진짜 Code.gs 를 뒤에 둔다 / the endpoint here is server/Code.gs itself,
  // running in node over a simulated sheet. This is the check that answers "I made changes,
  // left, came back, and they were gone": a stub would have happily handed back whatever
  // the test handed it, and said nothing about whether the sheet-backed scan finds it.
  console.log("\nanalysis edits survive leaving and coming back (real Code.gs behind the page)");
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

  // ------------------------------------------------- work saved by the older build
  // 공동연구자가 이미 해 둔 분석 / a coauthor's analysis, saved by the build before any of
  // this: one row, whole state, transcript text sitting inside the note. Opening it must
  // show that text, and — the part that could quietly destroy it — saving the board
  // afterwards must not strip the text out before the transcript record exists.
  console.log("\nanalysis saved by the older build opens, and survives being edited");
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
  console.log("\nthe previous build still works against the new server");
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
  console.log("\nan out-of-date Apps Script is named as the problem");
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

  // ------------------------------------------------- sizing
  console.log("\ntags run longer rather than wrapping; the board reads bigger than the library");
  {
    const { page, errors } = await boot(browser, { width: 1700, height: 1000 });
    await toStep1(page, "SZ1");
    const libTag = await page.evaluate(() => {
      const d = [...document.querySelectorAll("div")].filter((x) => getComputedStyle(x).cursor === "grab")[0];
      const r = d.getBoundingClientRect();
      return { h: Math.round(r.height), fs: getComputedStyle(d.querySelector("span:nth-of-type(3)") || d).fontSize };
    });
    await dragTileToBoard(page, "피드백 받기", 0.15, 0.15);
    await dragTileToBoard(page, "AI 사용", 0.15, 0.45);
    const objs = () => page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...layer.children].filter((c) => c.querySelector && c.querySelector("input"))
        .map((c) => ({ t: c.querySelector("input").value, w: Math.round(c.getBoundingClientRect().width),
                       h: Math.round(c.getBoundingClientRect().height) }));
    });
    const before = await objs();
    const tagBefore = before.find((o) => o.t === "피드백 받기");
    const pillBefore = before.find((o) => o.t === "AI 사용");
    check(tagBefore.h > libTag.h, "the board tag is taller than the library chevron",
      ` (${tagBefore.h} vs ${libTag.h})`);

    const typeInto = async (name, text) => {
      await page.evaluate((n) => {
        const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
        const el = [...layer.children].find((c) => c.querySelector && c.querySelector("input")
          && c.querySelector("input").value === n);
        const i = el.querySelector("input");
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }, name);
      await page.keyboard.type(text);
      await page.waitForTimeout(700);
    };
    await typeInto("피드백 받기", " 수정사항을 직접 정리해서 씁니다 그리고 더 길게");
    await typeInto("AI 사용", " 수정사항을 직접 정리해서 씁니다");
    const after = await objs();
    const tagAfter = after.find((o) => o.t.startsWith("피드백"));
    const pillAfter = after.find((o) => o.t.startsWith("AI 사용"));
    check(tagAfter.w > tagBefore.w + 100, "the tag runs longer to fit its label",
      ` (${tagBefore.w} → ${tagAfter.w})`);
    check(pillAfter.w > pillBefore.w + 100, "and so does the 수단 pill",
      ` (${pillBefore.w} → ${pillAfter.w})`);
    // 줄바꿈은 없다 / never wraps: a timeline slot that grows downward stops reading as one slot
    check(tagAfter.h === tagBefore.h && pillAfter.h === pillBefore.h,
      "neither grows taller, so neither has wrapped",
      ` (${tagBefore.h}→${tagAfter.h}, ${pillBefore.h}→${pillAfter.h})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- undo
  console.log("\nundo steps back five changes; 기록 is admin-only now");
  {
    const { page, errors } = await boot(browser, { width: 1700, height: 1000 });
    await toStep1(page, "UND");
    check((await page.getByRole("button", { name: "기록" }).count()) === 0,
      "a participant is not offered version browsing");
    check((await page.getByRole("button", { name: "↩", exact: true }).count()) === 1, "but is offered undo");

    const count = () => page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return layer ? [...layer.children].filter((c) => c.querySelector && c.querySelector("input")).length : -1;
    });
    const box = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const dropNth = async (i, fx, fy) => {
      const t = await page.evaluate((n) => {
        const d = [...document.querySelectorAll("div")].filter((x) => getComputedStyle(x).cursor === "grab")[n];
        const r = d.getBoundingClientRect();
        return { x: r.x, y: r.y, h: r.height };
      }, i);
      await page.mouse.move(t.x + 40, t.y + t.h / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(700);          // 단계가 뭉치지 않도록 / clear of UNDO_GROUP_MS
    };
    const spots = [[0, 0.15, 0.15], [1, 0.15, 0.35], [2, 0.15, 0.55], [3, 0.45, 0.15],
                   [4, 0.45, 0.35], [5, 0.45, 0.55], [6, 0.75, 0.15]];
    for (const [i, x, y] of spots) await dropNth(i, x, y);
    check((await count()) === 7, "seven tags laid down", ` (${await count()})`);
    for (let k = 0; k < 6; k++) {
      await page.getByRole("button", { name: "↩", exact: true }).click();
      await page.waitForTimeout(250);
    }
    // 다섯 장만 들고 있으므로 여섯 번 눌러도 다섯 단계 / only five snapshots are kept, so a
    // sixth press has nothing left to undo — it must not wipe the board
    check((await count()) === 2, "six presses step back five changes and then stop", ` (${await count()})`);

    await dropNth(0, 0.75, 0.5);
    check((await count()) === 3, "a new change after undoing is kept");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    check((await count()) === 2, "and Ctrl+Z undoes it too");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- a session starts blank
  // 다음 참여자가 앞사람 보드를 보면 안 된다 / the next participant must not open onto the
  // previous one's board. Per-code storage makes that true; this keeps it true.
  console.log("\nevery new participant starts on an empty board");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 950 });
    const count = () => page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return {
        objects: layer ? [...layer.children].filter((c) => c.querySelector && c.querySelector("input")).length : -1,
        strokes: document.querySelectorAll("polyline").length
      };
    });
    await toStep1(page, "BLK1");
    let st = await count();
    check(st.objects === 0 && st.strokes === 0, "a fresh code opens onto nothing", ` (${JSON.stringify(st)})`);

    // 앞 참여자가 작업을 남긴 뒤에도 / and still nothing after the previous one left work behind
    await dragTileToBoard(page, "학습 계획", 0.3, 0.3);
    await page.waitForTimeout(3000);              // let the autosave land
    await page.getByText("나가기", { exact: false }).click();
    await page.waitForTimeout(400);
    await toStep1(page, "BLK2");
    st = await count();
    check(st.objects === 0 && st.strokes === 0,
      "and so does the next participant on the same machine", ` (${JSON.stringify(st)})`);

    // 그렇다고 앞사람 작업이 사라지면 안 된다 / without losing the first participant's work
    await page.getByText("나가기", { exact: false }).click();
    await page.waitForTimeout(400);
    await toStep1(page, "BLK1");
    await page.waitForTimeout(800);
    st = await count();
    check(st.objects === 1, "while the first participant's board is still theirs", ` (${JSON.stringify(st)})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- demo sessions
  // 데모는 리허설이지 데이터가 아니다 / a demo is a rehearsal, not data: nothing may reach
  // the sheet and nothing may be left in this browser for the next participant to find.
  console.log("\na demo id saves nothing, anywhere");
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [], posts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/macros/s/**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") posts.push(req.postData() || "");
      else posts.push("GET " + req.url().split("?")[1]);
      await route.fulfill({ status: 200, body: "{}" });
    });
    await page.goto(APP, { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });

    await page.fill('input[placeholder="P0000"]', "demo0");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForSelector("text=무엇을 하나요?", { timeout: 30000 });
    await dragTileToBoard(page, "학습 계획", 0.15, 0.12);
    await page.getByRole("button", { name: /다음/ }).click();
    await page.waitForSelector("text=시스템이 어떻게 개입하나요?", { timeout: 30000 });
    await dragTileToBoard(page, "규칙 상기", 0.5, 0.45);
    await page.waitForTimeout(4000);            // well past the 2.5s autosave
    check(posts.length === 0, "a demo neither posts nor reads from the sheet",
      posts.length ? ` (${posts[0].slice(0, 80)})` : "");
    const keys = await page.evaluate(() => Object.keys(localStorage)
      .filter((k) => k.indexOf("llm-guardrail-workshop-v4:") === 0)
      .filter((k) => !/:(lang|queue)$/.test(k)));
    check(keys.length === 0, "and writes no board of its own to this browser", ` (${JSON.stringify(keys)})`);
    const queued = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("llm-guardrail-workshop-v4:queue") || "[]"); }
      catch (e) { return []; }
    });
    check(queued.length === 0, "and nothing is sitting in the outbound queue", ` (${queued.length})`);
    check((await page.locator("text=데모").count()) > 0, "the header says it is a demo");

    // 제출를 눌러도 마찬가지 / finishing must not post either
    await page.getByRole("button", { name: /제출/ }).click();
    await page.waitForTimeout(1200);
    check(posts.length === 0, "finishing a demo still posts nothing",
      posts.length ? ` (${posts[0].slice(0, 80)})` : "");
    await page.keyboard.press("Escape");

    // 다음 참여자에게 흔적이 남지 않는다 / the next participant finds no trace of it
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    check((await page.evaluate(() => Object.keys(localStorage)
      .some((k) => k.indexOf("llm-guardrail-workshop-v4:demo") === 0))) === false,
      "and leaves nothing behind for the next session to find");

    // 진짜 참여자는 평소대로 저장된다 / a real participant is unaffected
    await page.fill('input[placeholder="P0000"]', "R01");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForSelector("text=무엇을 하나요?", { timeout: 30000 });
    await dragTileToBoard(page, "학습 계획", 0.15, 0.12);
    await page.waitForTimeout(4000);
    check(posts.some((x) => x.includes("R01")), "a real participant still saves",
      ` (${posts.length} request${posts.length === 1 ? "" : "s"})`);
    check(!posts.some((x) => /demo/i.test(x)), "and no demo rode along with it");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- language switch
  console.log("\nswitching language translates the board and survives old records");
  {
    const { page, errors } = await boot(browser, { width: 1600, height: 1000 });
    await toStep1(page, "LNG");
    await dragTileToBoard(page, "개념 학습", 0.16, 0.12);        // tag: no icon
    await dragTileToBoard(page, "AI 사용", 0.16, 0.42);        // post-it: no icon
    await page.getByRole("button", { name: /다음/ }).click();
    await page.waitForSelector("text=시스템이 어떻게 개입하나요?", { timeout: 30000 });
    await dragTileToBoard(page, "규칙 상기", 0.55, 0.42);       // card: has an icon
    const titles = () => page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...layer.children].filter((c) => c.tagName === "DIV" && c.querySelector("input"))
        .map((c) => c.querySelector("input").value);
    });
    await page.selectOption("select", "en");
    await page.waitForTimeout(600);
    const en = await titles();
    // 아이콘 없는 카드도 번역되어야 한다 / the icon-less types were once skipped, so half
    // the board stayed in Korean after a switch
    check(en.includes("Learning a concept"), "an activity tag is translated", ` (${JSON.stringify(en)})`);
    check(en.includes("Using AI"), "a 수단 post-it is translated");
    check(en.includes("Show the rule"), "an icon-bearing card is translated");
    await page.selectOption("select", "ko");
    await page.waitForTimeout(600);
    const ko = await titles();
    check(ko.includes("개념 학습") && ko.includes("AI 사용") && ko.includes("규칙 상기"),
      "and everything comes back", ` (${JSON.stringify(ko)})`);

    // 편집한 문구는 그대로 / text the participant edited must survive a switch
    await page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...layer.children].find((c) => c.querySelector("input") && c.querySelector("input").value === "개념 학습");
      const input = el.querySelector("input");
      input.focus(); input.select();
    });
    await page.keyboard.type("내 활동");
    await page.waitForTimeout(250);
    await page.selectOption("select", "en");
    await page.waitForTimeout(600);
    check((await titles()).includes("내 활동"), "edited text is left alone");

    // 규칙 단계 시절 기록 / a record saved before the rule step was removed. Restoring one
    // and switching language read I18N[lang].rules, which no longer exists: newR[0] threw
    // "Cannot read properties of undefined (reading '0')". Reported from the live site.
    const old = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const oldErrors = [];
    old.on("pageerror", (e) => oldErrors.push(e.message.split("\n")[0]));
    await old.goto(APP, { waitUntil: "load", timeout: 120000 });
    await old.evaluate(() => localStorage.setItem("llm-guardrail-workshop-v4:OLD", JSON.stringify({
      savedAt: Date.now(), pid: "OLD", step: 2, lang: "ko",
      rules: [{ id: "r0", cat: "a", title: "번역은 직접", desc: "…", sel: true }],
      cards: [{ id: "c1", type: "rule", title: "번역은 직접", desc: "…", x: 200, y: 200 }],
      notes: [], arrows: [], seq: 2, panelW: 566
    })));
    await old.reload({ waitUntil: "load" });
    await old.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await old.fill('input[placeholder="P0000"]', "OLD");
    await old.getByText("시작하기", { exact: false }).click();
    await old.waitForTimeout(900);
    await old.selectOption("select", "en");
    await old.waitForTimeout(700);
    check(oldErrors.length === 0, "a pre-rule-step record survives a language switch",
      oldErrors.length ? ` (${oldErrors[0]})` : "");
    await old.close();

    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- consent document
  console.log("\nconsent document reads and downloads from the sign-in screen");
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [], failed = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
    // 마크업에 남은 보간된 url()은 여기서 잡힌다 / a url() left in the markup shows up here
    // as a request for the literal "{{ … }}" — the whole reason for the stylesheet.
    page.on("requestfailed", (r) => failed.push(r.url().slice(0, 90)));
    await page.goto(APP, { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.waitForTimeout(800);

    const pages = await page.evaluate(() => [...document.querySelectorAll('[role="img"]')]
      .map((d) => ({ bg: getComputedStyle(d).backgroundImage.slice(0, 30), len: getComputedStyle(d).backgroundImage.length })));
    check(pages.length === 5, "five consent pages on the sign-in screen", ` (${pages.length})`);
    check(pages.every((p) => p.bg.startsWith('url("data:image/png') && p.len > 10000),
      "each page has its image painted from the stylesheet");
    check(failed.length === 0, "nothing is fetched from the markup", failed.length ? ` (${failed[0]})` : "");

    const fits = await page.evaluate(() => {
      const first = document.querySelector('[role="img"]');
      const scroller = first.parentElement.parentElement;
      const panel = scroller.parentElement;
      let card = document.querySelector('input[placeholder="P0000"]');
      while (card && getComputedStyle(card).boxShadow === "none") card = card.parentElement;
      const p = panel.getBoundingClientRect(), c = card.getBoundingClientRect();
      return { scrolls: scroller.scrollHeight > scroller.clientHeight + 2,
               clear: p.right <= c.x + 1 && p.bottom <= innerHeight + 1 && c.right <= innerWidth + 1 };
    });
    check(fits.scrolls, "the document scrolls inside its panel");
    check(fits.clear, "and does not overlap or overflow the sign-in card");

    for (const [label, ext, magic] of [["동의서 PDF", "pdf", "%PDF"], ["동의서 이미지", "png", "PNG"]]) {
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 20000 }),
        page.getByText(label, { exact: false }).click()
      ]);
      const file = await dl.path();
      const bytes = require("fs").readFileSync(file);
      check(dl.suggestedFilename().endsWith("." + ext), `${label} downloads a .${ext}`,
        ` (${dl.suggestedFilename()})`);
      check(bytes.length > 20000 && bytes.slice(0, 5).toString("latin1").includes(magic),
        `${label} is a real ${ext.toUpperCase()}`, ` (${bytes.length} bytes)`);
    }

    await page.fill('input[placeholder="P0000"]', "CN1");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForSelector("text=무엇을 하나요?", { timeout: 30000 });
    check(true, "signing in still works with the document beside it");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- every object is editable
  // 활동 태그와 수단 포스트잇에는 아이콘이 없다 / activity tags and 수단 post-its carry no icon.
  // The description textarea was once nested inside the icon's sc-if, so those two types
  // rendered a title and nothing else: they looked right and could not be typed into.
  console.log("\nevery board object can be edited, icon or not");
  {
    const { page, errors } = await boot(browser);
    await toStep1(page, "ED1");
    await dragTileToBoard(page, "개념 학습", 0.14, 0.12);          // tag, no icon
    await dragTileToBoard(page, "AI 사용 안 함", 0.14, 0.42);     // post-it, no icon
    await page.getByRole("button", { name: /다음/ }).click();
    await page.waitForSelector("text=시스템이 어떻게 개입하나요?", { timeout: 30000 });
    await dragTileToBoard(page, "규칙 상기", 0.52, 0.42);         // guardrail card, has icon

    const objects = () => page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...layer.children]
        .filter((c) => c.tagName === "DIV" && c.querySelector("input"))
        .map((c) => ({ title: c.querySelector("input").value, body: !!c.querySelector("textarea") }));
    });
    const laid = await objects();
    // 규칙 카드(활동·수단)는 보드에서 이름만, 가드레일 카드만 설명을 갖는다
    // 규칙 cards are labels once placed; only guardrail cards keep a description
    check(laid.length === 3, "three objects on the board", ` (${laid.length})`);
    check(laid.filter((o) => o.title === "개념 학습" || o.title === "AI 사용 안 함").every((o) => !o.body),
      "규칙 cards are labels only on the board", ` (${JSON.stringify(laid)})`);
    check(laid.filter((o) => o.title === "규칙 상기").every((o) => o.body),
      "a guardrail card still carries its description");

    for (const name of ["규칙 상기"]) {
      const focused = await page.evaluate((n) => {
        const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
        const el = [...layer.children].find((c) => c.tagName === "DIV"
          && c.querySelector("input") && c.querySelector("input").value === n);
        const ta = el && el.querySelector("textarea");
        if (!ta) return false;
        ta.focus();
        return true;
      }, name);
      if (!focused) { check(false, `${name}: description is typeable`); continue; }
      await page.keyboard.type("ZZ");
      await page.waitForTimeout(200);
      const body = await page.evaluate((n) => {
        const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
        const el = [...layer.children].find((c) => c.tagName === "DIV"
          && c.querySelector("input") && c.querySelector("input").value === n);
        return el.querySelector("textarea").value;
      }, name);
      check(body.includes("ZZ"), `${name}: description is typeable`, ` ("${body.slice(0, 24)}")`);
    }
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 4. ?ui=1 escape hatch
  console.log("\n?ui=1 escape hatch");
  {
    const { page } = await boot(browser, { query: "?ui=1" });
    check(near(await uiScale(page), 1, 0.001), "?ui=1 restores unscaled rendering");
    await page.close();
  }
};
