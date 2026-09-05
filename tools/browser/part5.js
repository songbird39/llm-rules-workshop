// 스위트 5/5 — 제출·기록·관리자 / submitting, version travel, and the admin roster. Via e2e.js.
const { APP, SHOTS, check, near, boardCards, boardTransform, uiScale,
        boot, toStep1, toBoard, dragTileToBoard, say } = require("./harness");

module.exports = async function (browser) {
  // ------------------------------------------------- 3g. Finish, with JSON as fallback
  // Writes are fire-and-forget (no-cors), so the only honest signal that the work did
  // not go out is a leftover item in the outbound queue. These stub the endpoint at
  // the network layer to exercise both paths.
  say("\nFinish submits; JSON download only when the server is unreachable");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const dialogText = (pg) => pg.evaluate(() => {
      const ov = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "60");
      return ov ? ov.innerText.replace(/\s+/g, " ").trim() : null;
    });
    const start = async (fail) => {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
      await pg.route("**/macros/s/**", (r) => (fail ? r.abort() : r.fulfill({ status: 200, body: "{}" })));
      await pg.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
      await pg.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
      await toBoard(pg, "F1");     // login, lay one activity, advance to step 2
      return pg;
    };

    let pg = await start(false);
    check(await pg.getByText("제출", { exact: true }).count() > 0, "toolbar shows Submit");
    check(await pg.getByText("제출 · JSON 저장", { exact: false }).count() === 0, "old Submit-and-save label gone");
    let dl = null;
    pg.on("download", (d) => { dl = d; });
    await pg.getByText("제출", { exact: true }).click();
    await pg.waitForTimeout(2200);
    const okText = await dialogText(pg);
    check(!!okText && okText.includes("제출했습니다"), "success dialog when the endpoint answers");
    check(dl === null, "no JSON downloaded on a successful finish");
    check(await pg.getByText("JSON 내려받기", { exact: false }).count() === 0, "no download button on success");
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/finish-ok.png` });
    await pg.close();

    pg = await start(true);
    await pg.getByText("제출", { exact: true }).click();
    await pg.waitForTimeout(2500);
    const failText = await dialogText(pg);
    check(!!failText && failText.includes("보내지 못했습니다"), "failure dialog when unreachable");
    const btn = pg.getByText("JSON 내려받기", { exact: false });
    check(await btn.count() > 0, "download offered as the fallback");
    const [got] = await Promise.all([
      pg.waitForEvent("download", { timeout: 8000 }).catch(() => null),
      btn.click(),
    ]);
    check(got !== null, "download actually fires", got ? ` (${got.suggestedFilename()})` : "");
    const q = await pg.evaluate(() => JSON.parse(localStorage.getItem("llm-guardrail-workshop-v4:queue") || "[]"));
    check(q.some((it) => it.kind === "submit" && it.participant === "F1"),
      "the unsent submit stays queued for retry", ` (${q.length} queued)`);
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/finish-fail.png` });
    await pg.close();
  }

  // ------------------------------------------------- 3h. version history and travel
  // The endpoint is stubbed at the network layer so history, travel, restore and cancel
  // can be exercised without a live sheet. The property that matters: browsing an old
  // version must not write anything, or looking at history would destroy the newest work.
  say("\nversion history: travel is read-only until restored");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const V = [{ row: 9, at: "2026-08-29T10:00:00.000Z", kind: "autosave" },
               { row: 4, at: "2026-08-29T09:30:00.000Z", kind: "submit" }];
    const mk = (n) => ({
      savedAt: Date.now(), pid: "H1", step: 2, lang: "ko", rules: [],
      cards: Array.from({ length: n }, (_, i) => ({
        id: "c" + (i + 1), type: "when", title: "V" + n + "-" + (i + 1), desc: "x",
        dia: "w_before", collapsed: false, x: 200 + i * 200, y: 200 })),
      notes: [], arrows: [], seq: 9, panelW: 566,
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let posts = 0;
    await page.route("**/macros/s/**", async (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") { posts++; return route.fulfill({ status: 200, body: "{}" }); }
      const cbn = u.searchParams.get("callback");
      // 스텁도 버전을 밝힌다 / the stub reports a version too, or the page would think the
      // deployment is old and put a banner across the top of every one of these checks
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript",
        body: cbn + "(" + JSON.stringify(Object.assign({ version: "2026-09-05" }, o)) + ");" });
      if (u.searchParams.get("versions")) return reply({ ok: true, versions: V });
      if (u.searchParams.get("row")) return reply({ ok: true, row: +u.searchParams.get("row"), state: mk(u.searchParams.get("row") === "9" ? 2 : 1) });
      if (u.searchParams.get("list")) return reply({ ok: true, participants: [
        { participant: "H1", rows: 9, submits: 1, lastAt: "2026-08-29T10:00:00.000Z" }] });
      const who = u.searchParams.get("participant");
      if (who && who.indexOf("sm:") === 0) return reply({ ok: true, state: null });
      if (who) return reply({ ok: true, state: mk(2) });
      return reply({ ok: true, rows: 0 });
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.style.cursor === "pointer"
        && d.textContent.includes("H1"));
      if (row) row.click();
    });
    await page.waitForTimeout(1500);
    const nCards = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return L ? [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input")).length : 0;
    });
    const pickSubmit = () => page.evaluate(() => {
      const o = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "60");
      [...o.querySelectorAll("button")].find((x) => /제출됨/.test(x.innerText)).click();
    });
    for (let k = 0; k < 20 && (await nCards()) !== 2; k++) await page.waitForTimeout(200);
    check(await nCards() === 2, "latest board loaded", ` (${await nCards()})`);

    await page.getByText("기록", { exact: true }).click();
    await page.waitForTimeout(700);
    const dlg = await page.evaluate(() => {
      const o = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "60");
      return o ? o.innerText.replace(/\s+/g, " ").trim() : null;
    });
    check(!!dlg && dlg.includes("저장 기록"), "history dialog opens");
    check(!!dlg && dlg.includes("제출됨") && dlg.includes("자동 저장"), "submits and autosaves are labelled");

    await pickSubmit();
    await page.waitForTimeout(900);
    check(await nCards() === 1, "travelled to the older version");
    check(await page.evaluate(() => document.body.innerText.includes("기록 보는 중")), "history banner shown");

    posts = 0;
    // 참여자 글자는 이제 아예 잠겨 있다 / a participant's text is now locked outright in
    // admin, so the old "type into it and check nothing posts" no longer types. Assert
    // the stronger property — the field cannot be reached — and that the silence holds.
    const taPE = await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      return ta ? ta.style.pointerEvents : "missing";
    });
    check(taPE === "none", "a participant field cannot even be clicked while browsing", ` (${taPE})`);
    // 값을 강제로 밀어 넣어도 / even forcing a value in and firing the event the app listens
    // for must not produce a write, which is the property the old typing test was after
    await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      if (!ta) return;
      ta.value = "edited while browsing";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(3500);
    check(posts === 0, "no POST while browsing history", ` (${posts})`);
    const kept = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("llm-guardrail") && x.endsWith(":H1"));
      return k ? JSON.parse(localStorage.getItem(k)).cards.length : null;
    });
    check(kept === null || kept === 2, "localStorage still holds the NEWEST board", ` (${kept})`);

    await page.getByText("최신으로 돌아가기", { exact: false }).click();
    await page.waitForTimeout(900);
    check(await nCards() === 2, "cancel returns to the latest board");
    check(await page.evaluate(() => !document.body.innerText.includes("기록 보는 중")), "banner cleared after cancel");

    check((await page.getByText("이 버전으로 되돌리기").count()) === 0,
      "admin is never offered restore — view mode exists to protect the record");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3i. admin sensemaking layer
  // The property that matters: nothing here may ever write to the participant's own
  // record. Every POST is inspected, not just counted.
  say("\nadmin sensemaking: edits go to sm:PID, never the participant record");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const board = {
      savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "when", title: "P-A", desc: "a", dia: "w_before", collapsed: false, x: 200, y: 200 },
              { id: "c2", type: "when", title: "P-B", desc: "b", dia: "w_during", collapsed: false, x: 400, y: 200 }],
      notes: [{ id: "n1", x: 200, y: 420, text: "참여자 메모" }], arrows: [], seq: 5, panelW: 566,
    };
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const posted = [];
    await page.route("**/macros/s/**", async (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") {
        try { posted.push(JSON.parse(route.request().postData() || "{}")); } catch (e) { posted.push({ parseError: true }); }
        return route.fulfill({ status: 200, body: "{}" });
      }
      const cbn = u.searchParams.get("callback");
      // 스텁도 버전을 밝힌다 / the stub reports a version too, or the page would think the
      // deployment is old and put a banner across the top of every one of these checks
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript",
        body: cbn + "(" + JSON.stringify(Object.assign({ version: "2026-09-05" }, o)) + ");" });
      if (u.searchParams.get("list")) return reply({ ok: true, participants: [{ participant: "P9", rows: 3, submits: 1, lastAt: "2026-08-29T10:00:00Z" }] });
      const who = u.searchParams.get("participant");
      if (who === "P9") return reply({ ok: true, state: board });
      if (who && who.indexOf("sm:") === 0) return reply({ ok: true, state: null });
      return reply({ ok: true, rows: 0 });
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(900);
    await page.getByText("P9", { exact: true }).first().click();
    await page.waitForTimeout(1200);

    const objs = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV" && (c.querySelector("input") || c.querySelector("textarea")))
        .map((c) => ({
          pe: c.style.pointerEvents,
          sm: /dashed/.test(c.style.border) || /oklch\(0.62 0.11 62\)/.test(c.style.boxShadow),
        }));
    });
    let o = await objs();
    // 이제 참여자 것도 포인터를 받는다 — 고르기 위해서 / participant objects now DO take the
    // pointer, so one of them can be selected and copied on its own; what stays locked is
    // their text and their position, checked further down by actually dragging one
    check(o.length === 3 && o.every((x) => x.pe === "auto"), "participant objects load and can be picked");
    check(await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input, textarea"))
        .every((c) => [...c.querySelectorAll("input, textarea")].every((f) => f.style.pointerEvents === "none"));
    }), "but every one of their text fields is inert");
    check(await page.evaluate(() => document.body.innerText.includes("참여자 산출물")), "protected region is labelled");

    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(800);
    o = await objs();
    check(o.length === 6, "duplicate all created copies", ` (${o.length})`);
    // 복제본은 눈으로는 원본과 같다 / a copy is indistinguishable from the original by eye —
    // that is deliberate — so what proves it is a copy is the record, not the styling
    check(o.every((x) => x.pe === "auto"), "and everything on the board can be picked up");
    check(o.filter((x) => x.sm).length === 0, "copies carry no tint of their own");

    await page.waitForTimeout(2200);
    const keys = posted.map((x) => x && x.participant);
    check(posted.length > 0, "the workspace was saved", ` (${posted.length})`);
    check(keys.every((k) => k === "sm:P9"), "every POST targets sm:P9", ` (${JSON.stringify(keys)})`);
    check(!keys.some((k) => k === "P9"), "NO POST targets the participant's own record");
    check(posted.every((x) => x.kind === "sensemaking"), "every POST is kind sensemaking");
    // 기록은 이제 조각으로 온다 / the record arrives in slices now, so reassemble it the way
    // the server does — newest stamp, parts in order — before looking inside
    const assemble = (list) => {
      const groups = {};
      list.forEach((b) => {
        if (!b.parts) return;
        (groups[b.stamp] = groups[b.stamp] || { parts: b.parts, s: {} }).s[b.part] = b.payload.chunk;
      });
      const stamps = Object.keys(groups).sort((x, y) => Number(y) - Number(x));
      for (const st of stamps) {
        const g = groups[st];
        let joined = "", whole = true;
        for (let i = 0; i < g.parts; i++) { if (g.s[i] === undefined) { whole = false; break; } joined += g.s[i]; }
        if (whole) return JSON.parse(joined);
      }
      const legacy = list.filter((b) => b.payload && b.payload.state).pop();
      return legacy ? legacy.payload.state : null;
    };
    const sent = assemble(posted.filter((b) => b.kind === "sensemaking"));
    check(sent.cards.every((c) => c.sm) && sent.notes.every((n) => n.sm),
      "payload contains only sm-flagged objects");
    check(sent.cards.every((c) => c.src === "p" && c.of) && sent.notes.every((n) => n.src === "p" && n.of),
      "and every one of them records the participant object it was copied from");
    check(!sent.cards.some((c) => c.edited) && !sent.notes.some((n) => n.edited),
      "a copy nobody has rewritten is not marked edited");

    // 복제본은 이제 겉으로 구분되지 않는다 / a copy is no longer visually distinguishable, so
    // pick by DOM order instead: duplicateIntoSense appends, so the originals come first
    const rect = (isSm) => page.evaluate((d) => {
      const L = [...document.querySelectorAll("div")].find((x) => x.style.width === "5000px");
      const els = [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input"));
      // 복제본은 원본 수만큼 뒤에 붙는다 / the copies are appended one-for-one, so the first
      // of them sits at the halfway mark. Taking the LAST one put it against the right
      // edge of the viewport, where the drag had nowhere to go.
      const el = d ? els[els.length / 2] : els[0];
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, left: el.offsetLeft };
    }, isSm);
    const drag = async (r) => {
      await page.mouse.move(r.x + 80, r.y + 6);
      await page.mouse.down();
      await page.waitForTimeout(50);
      for (let i = 1; i <= 4; i++) { await page.mouse.move(r.x + 80 + 15 * i, r.y + 6 + 10 * i); await page.waitForTimeout(50); }
      await page.mouse.up();
      await page.waitForTimeout(450);
    };
    const b0 = await rect(true); await drag(b0);
    check(Math.abs((await rect(true)).left - b0.left) > 30, "a sensemaking card can be dragged");
    const p0 = await rect(false); await drag(p0);
    check((await rect(false)).left === p0.left, "a participant card cannot be dragged");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sense.png` });
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3j. tag width handle
  say("\ntag width: hidden until hovered, then draggable");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 950 });
    await page.fill('input[placeholder="P0000"]', "TW");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(700);
    const tile = await page.evaluate(() => {
      const d = [...document.querySelectorAll("div")].filter((x) => getComputedStyle(x).cursor === "grab")
        .find((x) => x.innerText.trim().startsWith("학습 계획"));
      const r = d.getBoundingClientRect();
      return { x: r.x, y: r.y, h: r.height };
    });
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    await page.mouse.move(tile.x + 40, tile.y + tile.h / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + 240, cb.y + 160, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const tag = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const c = [...L.children].find((x) => x.tagName === "DIV" && x.querySelector("input"));
      const hb = c.querySelector("div[title]");
      const hr = hb ? hb.getBoundingClientRect() : null;
      return { w: c.offsetWidth, op: hb ? getComputedStyle(hb).opacity : null,
               hx: hr ? hr.x + hr.width / 2 : null, hy: hr ? hr.y + hr.height / 2 : null };
    });
    let g = await tag();
    check(g.w === 352, "tag starts at TAG_W", ` (${g.w})`);
    check(g.op === "0", "handle is invisible until hovered", ` (opacity ${g.op})`);
    await page.mouse.move(g.hx, g.hy);
    await page.waitForTimeout(200);
    check((await tag()).op === "1", "hovering the right edge reveals it");
    await page.mouse.down();
    await page.waitForTimeout(60);
    for (let i = 1; i <= 5; i++) { await page.mouse.move(g.hx + 24 * i, g.hy); await page.waitForTimeout(50); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const w2 = (await tag()).w;
    check(Math.abs(w2 - 472) <= 6, "dragging widens the tag", ` (352 -> ${w2})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3k. admin image export
  // Analysis happens from the image, so this must capture the WHOLE board rather than
  // the viewport, and the clean version must not contain the sensemaking layer.
  say("\nadmin image export: clean board and workspace board");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const board = {
      savedAt: Date.now(), pid: "IMG", step: 2, lang: "ko", rules: [],
      cards: [
        { id: "c1", type: "act", title: "개념 학습", desc: "처음 배우는 개념", dia: null, collapsed: false, w: 352, x: 120, y: 120 },
        { id: "c2", type: "con", title: "단계별 힌트", desc: "직접적으로 제공하는 대신 단계별 힌트를 제공한다", dia: "h_hint", collapsed: false, x: 120, y: 260 },
        { id: "c3", type: "trig", title: "시간 제한 시", desc: "", dia: "w_time", collapsed: false, x: 320, y: 260 }],
      notes: [{ id: "n1", x: 520, y: 130, text: "참여자 메모입니다" }],
      arrows: [{ id: "a1", from: { k: "card", id: "c2" }, to: { k: "card", id: "c3" } }],
      seq: 9, panelW: 566,
    };
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/macros/s/**", async (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") return route.fulfill({ status: 200, body: "{}" });
      const cbn = u.searchParams.get("callback");
      // 스텁도 버전을 밝힌다 / the stub reports a version too, or the page would think the
      // deployment is old and put a banner across the top of every one of these checks
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript",
        body: cbn + "(" + JSON.stringify(Object.assign({ version: "2026-09-05" }, o)) + ");" });
      if (u.searchParams.get("list")) return reply({ ok: true, participants: [{ participant: "IMG", rows: 2, submits: 1, lastAt: "2026-08-29T10:00:00Z" }] });
      const who = u.searchParams.get("participant");
      if (who === "IMG") return reply({ ok: true, state: board });
      if (who && who.indexOf("sm:") === 0) return reply({ ok: true, state: null });
      return reply({ ok: true, rows: 0 });
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(900);
    await page.getByText("IMG", { exact: true }).first().click();
    await page.waitForTimeout(1200);

    const fs2 = require("fs");
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
      page.getByRole("button", { name: /이미지 \(원본\)/ }).click(),
    ]);
    check(dl !== null, "clean image downloads", dl ? ` (${dl.suggestedFilename()})` : "");
    let cleanSize = 0;
    if (dl) {
      const f = "/tmp/ws-board.png";
      await dl.saveAs(f);
      cleanSize = fs2.statSync(f).size;
      check(fs2.readFileSync(f).slice(1, 4).toString() === "PNG", "it is a PNG");
      check(cleanSize > 3000, "png has real content", ` (${cleanSize} bytes)`);
    }
    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(700);
    const [dl2] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
      page.getByRole("button", { name: /이미지 \(해석\)/ }).click(),
    ]);
    check(dl2 !== null, "analysis image downloads", dl2 ? ` (${dl2.suggestedFilename()})` : "");
    if (dl2) {
      const f2 = "/tmp/ws-board-sense.png";
      await dl2.saveAs(f2);
      // 한 장에 두 겹을 겹쳐 그리지 않는다 / never both layers in one picture: the analysis
      // image holds the analysis and nothing else, so it is a DIFFERENT image, not a
      // bigger one. Same board copied whole, so the two come out close in size.
      const senseSize = fs2.statSync(f2).size;
      check(senseSize > 3000, "and has real content", ` (${senseSize} bytes)`);
      check(fs2.readFileSync(f2).compare(fs2.readFileSync("/tmp/ws-board.png")) !== 0,
        "it is a different picture from the original", ` (${cleanSize} vs ${senseSize})`);
    }
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3l. hide, restore, describe
  // 삭제가 없어진 자리 / what replaced delete. The property worth asserting is that
  // hiding is only ever a list filter: nothing is destroyed, and the roster the server
  // returns is untouched by it.
  say("\nhiding a record, restoring it, and saying whose it is");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    // 정렬 기준이 진짜 '만든 시각'인지 보려면 두 시각이 엇갈려야 한다 / the two orderings must
    // DISAGREE, or a list sorted by last activity would pass a created-time check
    const people = [{ participant: "P01", rows: 12, submits: 1, firstAt: "2026-08-20T09:00:00Z", lastAt: "2026-08-29T10:00:00Z", hidden: false, desc: "" },
                    { participant: "P02", rows: 4, submits: 0, firstAt: "2026-08-18T09:00:00Z", lastAt: "2026-08-29T09:00:00Z", hidden: true, desc: "파일럿" }];
    const posts = [];
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/macros/s/**", async (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") {
        let b = {};
        try { b = JSON.parse(route.request().postData() || "{}"); } catch (e) {}
        posts.push(b);
        return route.fulfill({ status: 200, body: "{}" });
      }
      const cbn = u.searchParams.get("callback");
      // 스텁도 버전을 밝힌다 / the stub reports a version too, or the page would think the
      // deployment is old and put a banner across the top of every one of these checks
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript",
        body: cbn + "(" + JSON.stringify(Object.assign({ version: "2026-09-05" }, o)) + ");" });
      if (u.searchParams.get("list")) return reply({ ok: true, participants: people });
      return reply({ ok: true, state: null });
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1000);
    const rows = () => page.evaluate(() =>
      [...document.querySelectorAll("span")].filter((s) => s.style.minWidth === "64px").map((s) => s.textContent));
    // 코드로 찾는다 / find the control by the row it belongs to. Picking by index quietly
    // restored the wrong participant once the list was ordered by created time.
    const hideBtn = (code) => page.evaluate((c) => {
      const row = [...document.querySelectorAll("div")].find((d) => d.style.borderRadius === "10px"
        && [...d.querySelectorAll("span")].some((s) => s.style.minWidth === "64px" && s.textContent === c));
      const b = [...row.querySelectorAll("button")].find((x) => /숨기기$|되돌리기/.test(x.textContent.trim()));
      b.click();
    }, code);

    check(JSON.stringify(await rows()) === JSON.stringify(["P01"]),
      "the hidden one is out of the default list", ` (${JSON.stringify(await rows())})`);
    check(await page.evaluate(() => document.body.innerText.includes("숨긴 항목 (1)")),
      "and the toggle says how many are hidden");
    check(!(await page.evaluate(() => /삭제/.test(document.body.innerText))),
      "the word delete appears nowhere in the roster");
    // 목록은 목록이다 / the plain list is a list: neither control is reachable from it
    const controls = () => page.evaluate(() => ({
      fields: document.querySelectorAll('input[placeholder*="설명"]').length,
      hides: [...document.querySelectorAll("button")].filter((x) => /숨기기$|되돌리기/.test(x.textContent.trim())).length,
    }));
    let c = await controls();
    check(c.fields === 0, "no description field in the plain list", ` (${c.fields})`);
    check(c.hides === 1, "and the only 숨기기 is the mode button itself", ` (${c.hides})`);

    // 설명 편집 모드 / description mode
    await page.getByText("설명 편집", { exact: true }).click();
    await page.waitForTimeout(400);
    c = await controls();
    check(c.fields === 1, "description mode opens the field", ` (${c.fields})`);
    check(c.hides === 1, "and brings no hide control with it", ` (${c.hides})`);
    await page.locator('input[placeholder*="설명"]').first().fill("이지원 · 9월 2일");
    await page.waitForTimeout(1500);
    const meta = posts.filter((b) => b.kind === "meta");
    check(meta.length === 1, "typing a description writes exactly one meta row", ` (${meta.length})`);
    check(meta[0] && meta[0].participant === "mt:P01", "under the mt: key", meta[0] ? ` (${meta[0].participant})` : "");
    check(meta[0] && meta[0].payload.state.desc === "이지원 · 9월 2일", "carrying the text");
    check(meta[0] && meta[0].payload.state.hidden === false, "and the flag it must not clobber");
    await page.getByText("설명 편집", { exact: true }).click();
    await page.waitForTimeout(400);
    check((await controls()).fields === 0, "leaving the mode closes the field");
    check(await page.evaluate(() => document.body.innerText.includes("이지원 · 9월 2일")),
      "but the description still reads in the list");

    // 숨기기 모드 / hide mode
    await page.getByText("숨기기", { exact: true }).click();
    await page.waitForTimeout(400);
    check((await controls()).hides === 2, "hide mode puts a control on the row");
    await hideBtn("P01");
    await page.waitForTimeout(500);
    check(JSON.stringify(await rows()) === JSON.stringify([]), "hiding empties the list");
    const hid = posts.filter((b) => b.kind === "meta").pop();
    check(hid.payload.state.hidden === true, "the hide is posted as a flag, not a deletion");
    check(hid.payload.state.desc === "이지원 · 9월 2일", "and it keeps the description alongside it");
    check(!posts.some((b) => b.action === "delete"), "nothing anywhere posts a delete");

    // 숨긴 항목 보기 / the hidden view, and back
    await page.getByText("숨긴 항목", { exact: false }).click();
    await page.waitForTimeout(400);
    // P02 는 나중에 활동했지만 먼저 열렸다 / P02 was active LAST but opened FIRST, so this
    // order can only have come from the created time
    check(JSON.stringify(await rows()) === JSON.stringify(["P02", "P01"]),
      "the hidden view holds both, oldest session first", ` (${JSON.stringify(await rows())})`);
    check(await page.evaluate(() => document.body.innerText.includes("8/18/2026")),
      "and the time shown is the one it is sorted by");
    check(await page.evaluate(() => document.body.innerText.includes("기록은 지워지지 않았습니다")),
      "it says plainly that nothing was deleted");
    await hideBtn("P01");
    await page.waitForTimeout(500);
    check(JSON.stringify(await rows()) === JSON.stringify(["P02"]), "restoring takes it back out of hiding");
    check(posts.filter((b) => b.kind === "meta").pop().payload.state.hidden === false, "posted as a flag again");
    await page.getByText("참여자 목록", { exact: false }).first().click();
    await page.waitForTimeout(400);
    check(JSON.stringify(await rows()) === JSON.stringify(["P01"]), "and it is back in the normal list");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }
};
