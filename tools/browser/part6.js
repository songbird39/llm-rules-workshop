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

    /* 색은 폴더의 것 / the colour belongs to the folder, not the code: two codes filed
       together are two readings of the same dimension and must look like it. It is worked
       out on every render rather than stored, so a code renamed into another folder takes
       its new folder's colour instead of keeping the one it was born with. */
    await add("독립성/스스로 먼저");
    const swatches = () => page.evaluate(() => {
      const out = {};
      [...document.querySelectorAll("span")].forEach((sp) => {
        const label = sp.parentElement && sp.parentElement.innerText;
        const bg = sp.style.background;
        if (bg && sp.style.width === "10px" && label) out[label.split("\n")[0].trim()] = bg;
      });
      return out;
    });
    const sw = await swatches();
    check(sw["검증 회피"] && sw["검증 회피"] === sw["번역 의존"],
      "two codes in one folder share a colour", ` (${sw["검증 회피"]})`);
    check(sw["스스로 먼저"] && sw["스스로 먼저"] !== sw["검증 회피"],
      "and a different folder gets a different one", ` (${sw["스스로 먼저"]})`);
    check(sw["폴더 없는 코드"] && sw["폴더 없는 코드"] !== sw["검증 회피"] &&
      sw["폴더 없는 코드"] !== sw["스스로 먼저"],
      "with an unfiled code on a neutral ink of its own", ` (${sw["폴더 없는 코드"]})`);
    // 폴더를 옮기면 색도 따라간다 / moved between folders, the colour moves with it
    page.once("dialog", (d) => d.accept("독립성/검증 회피"));
    await page.evaluate(() => {
      // 그 코드의 줄에 있는 고치기 버튼 / the edit button on THAT code's row, not the first one
      const row = [...document.querySelectorAll("div")].filter((d) =>
        (d.innerText || "").indexOf("검증 회피") === 0 && d.querySelectorAll("button").length === 3).pop();
      row.querySelectorAll("button")[1].click();
    });
    await page.waitForTimeout(600);
    const sw2 = await swatches();
    check(sw2["검증 회피"] === sw2["스스로 먼저"],
      "a code moved to another folder takes that folder's colour",
      ` (${sw2["검증 회피"]} vs ${sw2["스스로 먼저"]})`);

    // 아무것도 안 골랐을 때 / pressing a code with nothing selected says so, and codes nothing
    await page.getByText("검증 회피", { exact: true }).first().click();
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
    await page.getByText("검증 회피", { exact: true }).first().click();
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
    await page.getByText("번역 의존", { exact: true }).first().click();
    await page.waitForTimeout(600);
    check(srv.get({ codes: "P9" }).codings.length === 2, "a second code on the same set is a second coding");
    check(await page.evaluate(() =>
      [...document.querySelectorAll("rect")].filter((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5").length === 1),
      "and they share ONE square rather than nesting two");
    check(await page.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "번역 의존")),
      "with both tags stacked beside it");

    /* 고른 묶음이 이미 뭘 달고 있는지 / which codes THIS selection already carries, said in the
       panel rather than only out on the board. Pressing a code that is already on the set
       takes it off, so a ticked row is exactly the row whose press will remove it. */
    const ticks = () => page.evaluate(() => {
      const out = {};
      [...document.querySelectorAll("button")].forEach((b) => {
        const sp = b.querySelectorAll(":scope > span");
        if (sp.length !== 4) return;                       // 표시 · 색 · 이름 · 횟수
        out[sp[2].textContent.trim()] = sp[0].textContent.trim();
      });
      return out;
    });
    const on = await ticks();
    check(on["번역 의존"] === "✓" && on["검증 회피"] === "✓",
      "both codes on the selection are ticked in the panel",
      ` (${JSON.stringify(on)})`);
    check(on["스스로 먼저"] === "" && on["폴더 없는 코드"] === "",
      "and the ones not on it are not");
    // 다른 것을 고르면 표시도 바뀐다 / a different selection, a different set of ticks
    await page.mouse.click(boardBox.x + boardBox.width - 30, boardBox.y + boardBox.height - 30);
    await page.waitForTimeout(400);
    const none = await ticks();
    check(Object.keys(none).length > 0 && Object.values(none).every((v) => v === ""),
      "nothing selected, nothing ticked", ` (${JSON.stringify(none)})`);
    await pickAll();
    await page.waitForTimeout(300);
    const again = await ticks();
    check(again["검증 회피"] === "✓", "and selecting them again brings the ticks back");

    /* 묶음은 테두리로 / the SET is picked up from the square's edge — that set is the
       coding's identity, everything is filed under it, so getting it back is what lets a
       second code join the same group. 코드는 태그로 / a code is picked from its tag, and
       only a picked code shows the ✗ that takes it off. */
    /* 겉모습 말고 상태를 읽는다 / read the app's OWN selection. Counting outlined elements
       said "still two" while the selection had in fact collapsed to one — the check passed
       and the bug stayed. */
    const selNow = () => page.evaluate(() => window.__wsDiag().sel.slice().sort());
    const clearSel = async () => {
      await page.mouse.click(boardBox.x + boardBox.width - 30, boardBox.y + boardBox.height - 30);
      await page.waitForTimeout(300);
    };
    await clearSel();
    check((await ticks())["검증 회피"] === "", "with nothing selected the ticks are clear");
    const edge = await page.evaluate(() => {
      const r = [...document.querySelectorAll("rect")].find((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5");
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y };      // 위쪽 변 / the top edge
    });
    await page.mouse.click(edge.x, edge.y);
    await page.waitForTimeout(400);
    const back = await ticks();
    check(back["검증 회피"] === "✓" && back["번역 의존"] === "✓",
      "pressing the square's edge selects the set it was made over", ` (${JSON.stringify(back)})`);
    check(srv.get({ codes: "P9" }).codings.length === 2, "and takes nothing off");

    // 태그를 누르면 그 코드가 골라진다 / a tag press picks the code, and reveals its ✗
    const tagAt = () => page.evaluate(() => {
      const t = [...document.querySelectorAll("text")].find((x) => x.textContent === "검증 회피");
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const xMarks = () => page.evaluate(() =>
      [...document.querySelectorAll("text")].filter((t) => t.textContent === "✗").length);
    check((await xMarks()) === 0, "no ✗ before a code is picked");
    const tb2 = await tagAt();
    await page.mouse.click(tb2.x, tb2.y);
    await page.waitForTimeout(350);
    check((await xMarks()) === 1, "pressing a code tag picks it and offers an ✗", ` (${await xMarks()})`);
    check(srv.get({ codes: "P9" }).codings.length === 2,
      "and pressing it does NOT take the code off, which the plain click used to do");
    // ✗ 를 누르면 뗀다 / the ✗ takes it off
    const xBox = await page.evaluate(() => {
      const t = [...document.querySelectorAll("text")].find((x) => x.textContent === "✗");
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(xBox.x, xBox.y);
    await page.waitForTimeout(700);
    check(srv.get({ codes: "P9" }).codings.length === 1, "pressing the ✗ takes that code off",
      ` (${srv.get({ codes: "P9" }).codings.length})`);
    check((await xMarks()) === 0, "and the ✗ goes with it");

    /* 글자를 누르는 것은 고르기가 아니다 / clicking into an element to read or fix its text must
       not collapse the group. With the group went the very set you were about to put
       another code on, which made coding a set of several a thing you had to redo. */
    await page.mouse.click(edge.x, edge.y);
    await page.waitForTimeout(350);
    const many = await selNow();
    check(many.length >= 2, "a set is selected", ` (${JSON.stringify(many)})`);
    const field = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...L.children].find((c) => c.style.outlineWidth && c.style.outlineWidth !== "0px"
        && (c.querySelector("input") || c.querySelector("textarea")));
      if (!el) return null;
      const f = el.querySelector("input") || el.querySelector("textarea");
      const r = f.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    check(field !== null, "and one of its members has a field to press");
    const wasTicked = await ticks();
    if (field) {
      await page.mouse.click(field.x, field.y);
      await page.waitForTimeout(350);
      check(JSON.stringify(await selNow()) === JSON.stringify(many),
        "pressing that field leaves the whole set selected",
        ` (${JSON.stringify(many)} -> ${JSON.stringify(await selNow())})`);
      check(JSON.stringify(await ticks()) === JSON.stringify(wasTicked),
        "so the panel still reads against that same set",
        ` (${JSON.stringify(wasTicked)} -> ${JSON.stringify(await ticks())})`);
    }

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
    await page.getByText("폴더 없는 코드", { exact: true }).first().click();
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

    // 고르고 나서 ✗ 로 뗀다 / pick the tag, then press its ✗ — two steps, not one slip
    const before = srv.get({ codes: "P9" }).codings.length;
    await page.evaluate(() => {
      const g = [...document.querySelectorAll("g")].find((x) => x.textContent.includes("번역 의존"));
      const r = g.getBoundingClientRect();
      g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    });
    await page.waitForTimeout(350);
    check(srv.get({ codes: "P9" }).codings.length === before,
      "picking a tag on its own removes nothing");
    await page.evaluate(() => {
      const t = [...document.querySelectorAll("text")].find((x) => x.textContent === "✗");
      const g = t.parentElement;
      const r = g.getBoundingClientRect();
      g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    });
    await page.waitForTimeout(600);
    check(srv.get({ codes: "P9" }).codings.length === before - 1, "and then the ✗ does",
      ` (${srv.get({ codes: "P9" }).codings.length})`);

    // 다시 열어도 그대로 / and it is all still there on the next visit
    await enter();
    await page.waitForTimeout(600);
    check((await region()) !== null, "the coding comes back on reopening");
    check(await page.evaluate(() => [...document.querySelectorAll("text")].some((t) => t.textContent === "폴더 없는 코드")),
      "with its code");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- finding a combination
  // 조합은 "같은 묶음에 함께" 를 뜻한다 / a combination means codes applied to the SAME set. A
  // participant who used both codes in different places is the answer to a different
  // question, and returning them would look exactly like the right answer.
  say("\nfinding a code combination means co-occurrence, not co-presence");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const mk = (pid) => ({
      savedAt: Date.now(), pid: pid, step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "act", title: "학습 계획", desc: "", dia: null, collapsed: false, w: 352, x: 300, y: 380 }],
      notes: [], arrows: [], seq: 5, panelW: 566,
    });
    await realServer(page, {
      seed: (s) => {
        ["P01", "P02", "P03"].forEach((pid) => {
          s.post({ participant: pid, kind: "autosave", payload: { participant: pid, state: mk(pid) } });
        });
        s.post({ kind: "code", id: "k1", name: "검증 회피", folder: "정확성", color: "oklch(0.52 0.115 305)" });
        s.post({ kind: "code", id: "k2", name: "번역 의존", folder: "정확성", color: "oklch(0.55 0.110 250)" });
        // P01: 한 묶음이 두 코드를 모두 진다 / one set carries BOTH — a real co-occurrence
        s.post({ kind: "coding", id: "g1", participant: "P01", name: "k1", members: ["c1"] });
        s.post({ kind: "coding", id: "g2", participant: "P01", name: "k2", members: ["c1"] });
        // P02: 두 코드를 쓰긴 하지만 서로 다른 묶음에 / uses both, but never together
        s.post({ kind: "coding", id: "g3", participant: "P02", name: "k1", members: ["c1"] });
        s.post({ kind: "coding", id: "g4", participant: "P02", name: "k2", members: ["n9"] });
        // P03: 하나만 / only one of them
        s.post({ kind: "coding", id: "g5", participant: "P03", name: "k1", members: ["c1"] });
      },
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1800);

    // 목록에 코드 숫자가 뜬다 / the roster carries the counts
    // P01 은 코딩 둘, 코드 종류도 둘 / P01 has two codings of two different codes
    check(await page.evaluate(() => document.body.innerText.includes("코드 2 · 2종")),
      "the roster says how many codings a participant has and how many kinds");
    check(await page.evaluate(() => document.body.innerText.includes("코드 1 · 1종")),
      "and one with a single coding reads as one of one kind");

    await page.getByText("P01", { exact: true }).first().click();
    await page.waitForTimeout(2400);
    await page.getByText("코드", { exact: true }).click();
    await page.waitForTimeout(500);

    const tick = async (name) => {
      await page.evaluate((n) => {
        const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === n);
        l.querySelector("input").click();
      }, name);
      await page.waitForTimeout(200);
    };
    await tick("검증 회피");
    await page.getByText("찾기", { exact: true }).click();
    await page.waitForTimeout(500);
    let hits = await page.evaluate(() => [...document.querySelectorAll("button")]
      .filter((b) => /묶음$/.test(b.textContent.trim()))
      .map((b) => b.textContent.replace(/\s+/g, " ").trim()));
    check(hits.length === 3, "one code alone finds everyone who used it", ` (${JSON.stringify(hits)})`);

    await tick("번역 의존");
    await page.getByText("찾기", { exact: true }).click();
    await page.waitForTimeout(500);
    hits = await page.evaluate(() => [...document.querySelectorAll("button")]
      .filter((b) => /묶음$/.test(b.textContent.trim()))
      .map((b) => b.textContent.replace(/\s+/g, " ").trim()));
    check(hits.length === 1, "both codes together finds only the co-occurrence",
      ` (${JSON.stringify(hits)})`);
    check(hits[0] && hits[0].indexOf("P01") === 0, "which is the participant who coded one set with both",
      hits[0] ? ` (${hits[0]})` : "");
    check(!hits.some((h) => h.indexOf("P02") === 0),
      "and NOT the one who used both codes in different places");

    // 결과는 링크다 / the results are links
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /묶음$/.test(x.textContent.trim()));
      b.click();
    });
    await page.waitForTimeout(2000);
    check(await page.evaluate(() => document.body.innerText.includes("P01")),
      "and clicking one opens that participant");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

};
