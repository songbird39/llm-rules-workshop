// 스위트 6/6 — 코딩 / the coding layer: a global codebook on its own sheet, and
// regions that follow what they enclose. Run via e2e.js.
const { APP, SHOTS, check, near, boardCards, boardTransform, uiScale,
        boot, toStep1, toBoard, dragTileToBoard, realServer, say } = require("./harness");

// 판 번호는 한 군데서 / the version lives in one place, so bumping Code.gs does not
// quietly turn every stub into an "out of date" deployment
const SERVER_VERSION = require("fs")
  .readFileSync(require("path").join(__dirname, "../../server/Code.gs"), "utf8")
  .match(/var VERSION = '([^']+)'/)[1];

module.exports = async function (browser) {
  // ------------------------------------------------- coding
  // 코드북은 전체에 하나, 코딩은 참여자마다 / one codebook across everyone, and codings that
  // belong to a particular board. The square is recomputed from its members, so it follows
  // them: a coding that stops matching what it encloses is not a coding.
  say("\ncoding: a global codebook, and regions that follow what they enclose");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const board = {
      savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "act", title: "학습 계획", desc: "", dia: null, collapsed: false, w: 352, x: 300, y: 380 },
              { id: "c2", type: "when", title: "시작 전에", desc: "", dia: null, collapsed: false, x: 300, y: 520 }],
      notes: [], arrows: [], seq: 5, panelW: 566,
    };
    const { srv } = await realServer(page, {
      seed: (s) => s.post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: board } }),
    });
    const enter = async () => {
      await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
      await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
      await page.fill('input[placeholder="P0000"]', "admin");
      await page.getByText("시작하기", { exact: false }).click();
      await page.waitForTimeout(900);
      await page.getByText("P9", { exact: true }).first().click();
      await page.waitForTimeout(2400);
    };
    await enter();

    // 코드 탭은 관리자에게만 / the tab exists only here
    await page.getByText("코드", { exact: true }).click();
    await page.waitForTimeout(400);
    // placeholder 는 innerText 에 없다 / a placeholder is not innerText; look at the hint
    check(await page.evaluate(() => document.body.innerText.includes("보드에서 요소를 고른 뒤")),
      "the 코드 tab opens a codebook");

    // 폴더는 슬래시로 / a slash names the folder
    const add = async (text) => {
      await page.locator('input[placeholder*="새 코드"]').fill(text);
      await page.locator('input[placeholder*="새 코드"]').press("Enter");
      await page.waitForTimeout(500);
    };
    await add("정확성/검증 회피");
    await add("정확성/번역 의존");
    await add("폴더 없는 코드");
    check(await page.evaluate(() => document.body.innerText.includes("정확성")),
      "codes typed with a slash are filed under that folder");
    check(await page.evaluate(() => document.body.innerText.includes("폴더 없음")),
      "and one without a slash sits under 폴더 없음");
    check(srv.get({ codes: "all" }).codebook.length === 3, "all three reached the codes sheet",
      ` (${srv.get({ codes: "all" }).codebook.length})`);

    // 아무것도 안 골랐을 때 / pressing a code with nothing selected says so, and codes nothing
    await page.getByText("검증 회피", { exact: true }).click();
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.body.innerText.includes("먼저 보드에서")),
      "coding nothing says so rather than making an empty region");
    check(srv.get({ codes: "P9" }).codings.length === 0, "and writes no coding");

    // 두 카드를 골라 코드를 건다 / select two cards and code them
    const boardBox = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const pickAll = async () => {
      await page.mouse.move(boardBox.x + 12, boardBox.y + 12);
      await page.mouse.down();
      await page.mouse.move(boardBox.x + boardBox.width - 12, boardBox.y + boardBox.height - 12, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    };
    await pickAll();
    await page.getByText("검증 회피", { exact: true }).click();
    await page.waitForTimeout(600);
    const codings = srv.get({ codes: "P9" }).codings;
    check(codings.length === 1, "coding a selection writes one coding", ` (${codings.length})`);
    check(codings[0] && codings[0].members.length === 2, "over the elements that were selected",
      codings[0] ? ` (${codings[0].members.length})` : "");

    const region = () => page.evaluate(() => {
      const r = [...document.querySelectorAll("rect")].find((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5");
      if (!r) return null;
      return { x: +r.getAttribute("x"), y: +r.getAttribute("y"), w: +r.getAttribute("width"), h: +r.getAttribute("height") };
    });
    const r1 = await region();
    check(r1 !== null, "a square is drawn around them");
    check(await page.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "검증 회피")),
      "with the code named beside it");

    // 한 묶음에 두 번째 코드 / a second code on the same set shares the square
    await pickAll();
    await page.getByText("번역 의존", { exact: true }).click();
    await page.waitForTimeout(600);
    check(srv.get({ codes: "P9" }).codings.length === 2, "a second code on the same set is a second coding");
    check(await page.evaluate(() =>
      [...document.querySelectorAll("rect")].filter((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5").length === 1),
      "and they share ONE square rather than nesting two");
    check(await page.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "번역 의존")),
      "with both tags stacked beside it");

    // 따라오는지는 움직일 수 있는 것으로 본다 / test the following with something that can
    // actually move. The participant's own cards are deliberately immovable in admin mode,
    // so coding those and then failing to drag one says nothing about the region.
    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(900);
    // 복제본은 오른쪽으로 밀려 화면 밖으로 나간다 / copies land to the right, past the edge of a
    // 1700px window, so pan before trying to grab one
    await page.keyboard.down("Alt");
    await page.mouse.move(boardBox.x + boardBox.width * 0.6, boardBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(boardBox.x + boardBox.width * 0.6 - 520, boardBox.y + 80, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(400);
    await page.mouse.click(boardBox.x + boardBox.width - 30, boardBox.y + boardBox.height - 30);
    await page.waitForTimeout(250);
    const copy = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      // 활동 태그 복제본을 고른다 / take the copied ACTIVITY TAG: a plain card is mostly
      // textarea, and a press on text returns before a drag can start
      const els = [...L.querySelectorAll(':scope > [data-obj="card"]')].filter((c) => c.offsetHeight === 62);
      const el = els[els.length - 1];
      const r = el.getBoundingClientRect();
      return { x: r.x + 16, y: r.y + r.height / 2, x0: Math.round(r.x) };
    });
    // 그 복제본만 골라 코드를 건다 / select just that copy and code it
    await page.mouse.click(copy.x, copy.y);
    await page.waitForTimeout(250);
    await page.getByText("폴더 없는 코드", { exact: true }).click();
    await page.waitForTimeout(700);
    const boxes = () => page.evaluate(() => [...document.querySelectorAll("rect")]
      .filter((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5")
      .map((x) => ({ x: +x.getAttribute("x"), w: +x.getAttribute("width") })));
    const b1 = await boxes();
    check(b1.length === 2, "coding a second, different set draws its own square", ` (${b1.length})`);

    await page.mouse.move(copy.x, copy.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(copy.x - i * 34, copy.y + i * 8); await page.waitForTimeout(40); }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const movedTo = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const els = [...L.querySelectorAll(':scope > [data-obj="card"]')].filter((c) => c.offsetHeight === 62);
      return Math.round(els[els.length - 1].getBoundingClientRect().x);
    });
    check(Math.abs(movedTo - copy.x0) > 40, "an analysis copy can be dragged",
      ` (${copy.x0} -> ${movedTo})`);
    const b2 = await boxes();
    const moved = b2.some((b, i) => b1[i] && Math.abs(b.x - b1[i].x) > 40);
    check(moved, "and its square follows it, being recomputed from its members",
      ` (${JSON.stringify(b1.map((b) => Math.round(b.x)))} -> ${JSON.stringify(b2.map((b) => Math.round(b.x)))})`);

    // 태그를 누르면 코드가 풀린다 / clicking a tag takes that code off
    await page.evaluate(() => {
      const g = [...document.querySelectorAll("g")].find((x) => x.textContent.includes("번역 의존"));
      const r = g.getBoundingClientRect();
      g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    });
    await page.waitForTimeout(600);
    // 세 개 중 하나가 빠진다 / three codings by now: two on the pair, one on the copy
    check(srv.get({ codes: "P9" }).codings.length === 2, "clicking a tag removes that coding",
      ` (${srv.get({ codes: "P9" }).codings.length})`);

    // 다시 열어도 그대로 / and it is all still there on the next visit
    await enter();
    await page.waitForTimeout(600);
    check((await region()) !== null, "the coding comes back on reopening");
    check(await page.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "검증 회피")),
      "with its code");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

};
