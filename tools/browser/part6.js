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
    // 설명문은 없앴다 / the explanation was removed; the input is the tab's own tell
    check(await page.evaluate(() => !!document.querySelector('input[placeholder*="새 코드"]')),
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
        (d.innerText || "").indexOf("검증 회피") === 0 && d.querySelectorAll("button").length === 2).pop();
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
        if (sp.length !== 3) return;                       // 표시 · 색 · 이름
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

    /* 원소를 지우면 묶음도 줄어야 한다 / delete one element of a coded group and the group has
       to shrink with it. A coding is identified by its member SET, and the stored set still
       named the deleted one — so the set no longer matched anything that could be selected.
       The square kept drawing over the survivors, but a second code applied to those same
       survivors made a NEW group sitting on top of the old one, and nothing could ever join
       the first again. */
    await pickAll();
    await page.getByText("스스로 먼저", { exact: true }).first().click();
    await page.waitForTimeout(600);
    const squaresNow = () => page.evaluate(() =>
      [...document.querySelectorAll("rect")].filter((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5").length);
    const had = await squaresNow();
    // 해석 복제본 하나를 지운다 / delete one of the analysis copies, which is deletable here
    const gone = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...L.querySelectorAll(':scope > [data-obj="card"]')].find((c) => /(^|\s)cd-s/.test(c.className));
      if (!el) return null;
      const id = (/(?:^|\s)cd-([A-Za-z0-9_-]+)/.exec(el.className) || [])[1];
      const btn = [...el.querySelectorAll("button")].pop();
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      return id;
    });
    await page.waitForTimeout(700);
    check(gone !== null, "an analysis copy is deleted from a coded set", ` (${gone})`);
    check((await squaresNow()) === had, "the square survives on what is left of the set",
      ` (${had} -> ${await squaresNow()})`);
    // 남은 것들에 코드를 하나 더 / another code onto exactly what remains
    await pickAll();
    await page.getByText("검증 회피", { exact: true }).first().click();
    await page.waitForTimeout(700);
    check((await squaresNow()) === had,
      "and a code added to the survivors JOINS that square instead of drawing a second",
      ` (${had} -> ${await squaresNow()})`);
    const bothOn = await ticks();
    check(bothOn["스스로 먼저"] === "✓" && bothOn["검증 회피"] === "✓",
      "with both codes ticked against the one set", ` (${JSON.stringify(bothOn)})`);

    /* 지운 코드는 보드에서 사라진다 / a code that has been deleted stops being drawn. Its
       codings stay on the sheet — that is the point, they are evidence of what was read —
       but the tag fell back to the code's own id, so a deleted code came back as a pill
       reading `kmttsq87ucu8`. Kept in the record, gone from the board. */
    const tagTexts = () => page.evaluate(() =>
      [...document.querySelectorAll("text")].map((t) => t.textContent.trim()));
    const squares = () => page.evaluate(() =>
      [...document.querySelectorAll("rect")].filter((x) => (x.getAttribute("stroke-dasharray") || "") === "3 5").length);
    await add("임시/버릴 코드");
    /* 아직 코드가 없는 원소를 찾아 쓴다 / find an element that carries NO code yet. It needs a
       set of its own, or deleting the throwaway later leaves a square standing on somebody
       else's code and proves nothing. */
    const spots = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="card"], :scope > [data-obj="note"]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height - 4 }; });
    });
    let lone = null;
    for (const sp of spots) {
      await page.mouse.click(boardBox.x + boardBox.width - 30, boardBox.y + boardBox.height - 30);
      await page.waitForTimeout(180);
      await page.mouse.click(sp.x, sp.y);
      await page.waitForTimeout(220);
      const t = await ticks();
      if ((await page.evaluate(() => window.__wsDiag().sel)).length === 1 &&
          Object.values(t).every((v) => v === "")) { lone = sp; break; }
    }
    check(lone !== null, "an element with no code on it yet was found to try this on");
    await page.getByText("버릴 코드", { exact: true }).first().click();
    await page.waitForTimeout(700);
    const withTemp = await squares();
    check((await tagTexts()).includes("버릴 코드"), "a live code is drawn on the board");
    const codingsBefore = srv.get({ codes: "P9" }).codings.length;

    // 이름을 비우면 지워진다 / clearing the name in the rename box deletes it. 두 번 묻는다 —
    // the rename box, then the confirm about codings already made
    const twice = (d) => d.accept("");
    page.on("dialog", twice);
    await page.evaluate(() => {
      // 이름 글자에서 위로 올라간다 / walk up from the name itself: the span sits in the apply
      // button, whose parent is the row, whose second button is the rename one
      const sp = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === "버릴 코드");
      const row = sp && sp.closest("button") && sp.closest("button").parentElement;
      if (row) [...row.querySelectorAll(":scope > button")][1].click();
    });
    await page.waitForTimeout(900);
    page.off("dialog", twice);
    const after = await tagTexts();
    check(!after.includes("버릴 코드"), "deleting it takes its tag off the board");
    check(!after.some((t) => /^k[a-z0-9]{8,}$/.test(t)),
      "and it does not come back as its own id", ` (${JSON.stringify(after.slice(0, 6))})`);
    check((await squares()) === withTemp - 1,
      "the square it was the only code on goes with it", ` (${withTemp} -> ${await squares()})`);
    check(srv.get({ codes: "P9" }).codings.length === codingsBefore,
      "while the coding itself stays on the sheet, which is the whole point",
      ` (${codingsBefore} -> ${srv.get({ codes: "P9" }).codings.length})`);

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



  // ------------------------------------------------- exporting the whole corpus
  /* 브라우저는 폴더에 파일을 쓸 수 없다 / a browser cannot write into a folder — it can only
     download. 그래서 앱 안에 있어야 한다 / and it has to live in the APP, because the same JSONP
     from a page opened off disk never gets an answer back: file:// is not the origin that
     reaches the sheet. This is the button, and this is what it produces. */
  say("\nexporting every participant as one corpus");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // 내보내기가 조용히 실패하지 않게 / the export logs what it caught, so a mistake in the
    // shaping does not surface as "could not read the roster"
    const logs = [];
    page.on("console", (m) => logs.push(m.text().slice(0, 300)));
    /* 해석 보드만 쓴다 / the export reads the ANALYSIS board only, so that is what this seeds.
       놓인 차례가 아니라 자리 / and the objects are stored in an order that has nothing to do with
       where they sit, so anything that leaned on array order comes out wrong. */
    const analysis = {
      savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
      cards: [
        // 두 번째 줄이 먼저 저장돼 있다 / the SECOND row is stored first
        { id: "b1", type: "act", title: "둘째 줄 활동", desc: "", dia: null, collapsed: false,
          w: 352, x: 100, y: 900, sm: true, src: "p", of: "z9" },
        { id: "a2", type: "act", title: "오른쪽 활동", desc: "", dia: null, collapsed: false,
          w: 352, x: 800, y: 100, sm: true, src: "p", of: "z2" },
        { id: "a1", type: "act", title: "왼쪽 활동", desc: "", dia: null, collapsed: false,
          w: 352, x: 100, y: 100, sm: true, src: "p", of: "z1" },
        { id: "s1", type: "con", title: "질문 제안", desc: "고친 설명", dia: "h_ask", collapsed: false,
          w: 168, x: 120, y: 300, sm: true, src: "p", of: "z3", edited: true },
        { id: "s2", type: "con", title: "개입 없음", desc: "", dia: "h_self", collapsed: false,
          w: 168, x: 2000, y: 2000, sm: true, src: "a" },
      ],
      notes: [{ id: "n1", x: 900, y: 600, text: "", kind: "tx", sm: true, src: "a" }],
      arrows: [], strokes: [], seq: 40,
    };
    const { srv } = await realServer(page, {
      seed: (s) => {
        // 참여자 보드도 시트에는 있다 / the participant's own board is on the sheet too — and must
        // NOT appear in the export, which is the point of the layer being fixed
        s.post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: {
          savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
          cards: [{ id: "z1", type: "act", title: "참여자 원본 태그", desc: "", dia: null,
                    collapsed: false, w: 352, x: 100, y: 100 }],
          notes: [], arrows: [], seq: 9, panelW: 566 } } });
        s.post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: analysis } });
        s.post({ participant: "tx:P9", kind: "transcript",
                 payload: { participant: "tx:P9", state: { texts: { n1: "참여자가 말한 것" }, cards: [] } } });
        s.post({ kind: "code", id: "k1", name: "ease-desirable", folder: "friction", color: "", deleted: false });
        s.post({ kind: "code", id: "k2", name: "commitment", folder: "value", color: "", deleted: false });
        s.post({ kind: "coding", id: "g1", participant: "P9", name: "k1", members: ["s1", "n1"], deleted: false });
        s.post({ kind: "coding", id: "g2", participant: "P9", name: "k2", members: ["n1", "s1"], deleted: false });
      },
    });
    // 내려받기를 가로챈다 / catch the download instead of writing it anywhere
    await page.exposeFunction("__grab", (name, text) => { (page.__files = page.__files || {})[name] = text; });
    await page.addInitScript(() => {
      const realCreate = document.createElement.bind(document);
      document.createElement = (tag) => {
        const el = realCreate(tag);
        if (String(tag).toLowerCase() === "a") {
          const realClick = el.click.bind(el);
          el.click = function () {
            if (this.download && this.href && this.href.startsWith("blob:")) {
              fetch(this.href).then((r) => r.text()).then((t) => window.__grab(this.download, t));
              return;
            }
            return realClick();
          };
        }
        return el;
      };
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => document.body.innerText.includes("모두 내보내기")),
      "the roster offers an export of everyone");
    await page.getByText("모두 내보내기", { exact: true }).click();
    await page.waitForTimeout(4000);
    const files = page.__files || {};
    const names = Object.keys(files);
    check(names.some((n) => n.endsWith(".md")) && names.some((n) => n.endsWith(".json")),
      "pressing it produces both files", ` (${names.join(", ")})`);
    const md = files[names.find((n) => n.endsWith(".md"))] || "";
    const js = JSON.parse(files[names.find((n) => n.endsWith(".json"))] || "{}");
    // 자리가 곧 순서 / the tags come out in the order they were laid, not the order they were stored
    check(/### 1\. 왼쪽 활동/.test(md) && /### 2\. 오른쪽 활동/.test(md) && /### 3\. 둘째 줄 활동/.test(md),
      "tags are ordered by where they sit, not by the order they were stored",
      ` (${(md.match(/### \d\. [^\n]*/g) || []).join(" | ")})`);
    // 줄이 바뀌면 다시 왼쪽부터 / a second row starts again from the left rather than continuing
    check(md.indexOf("왼쪽 활동") < md.indexOf("오른쪽 활동") &&
      md.indexOf("오른쪽 활동") < md.indexOf("둘째 줄 활동"),
      "and a wrapped row is read after the first, not merged into it");
    check(!md.includes("참여자 원본 태그"),
      "the participant's own board is not in the export at all");
    check(md.includes("- **질문 제안**  _(`con`, diagram `h_ask`, copied, **edited**)_"),
      "a card keeps its type, its diagram and where it came from",
      ` (${(md.match(/- \*\*질문 제안[^\n]*/) || [""])[0]})`);
    check(/- \*\*개입 없음\*\*  _\(`con`, diagram `h_self`, written\)_/.test(md),
      "and one written in the analysis says so instead of claiming to be a copy");
    check(/묶음 1 — friction\/ease-desirable · value\/commitment/.test(md),
      "both codes on one set stay in ONE block", ` (${(md.match(/### 묶음[^\n]*/) || [""])[0]})`);
    check(md.includes("참여자가 말한 것"), "and the transcript body is in it, pulled from the tx record");
    check(/copied, \*\*edited\*\*/.test(md), "with provenance kept — copied, and edited after copying");
    const p = js.participants[0];
    check(p.codedClusters.length === 1 && p.codedClusters[0].codes.length === 2,
      "the json says the same: one cluster, two codes",
      ` (${p.codedClusters.length} clusters)`);
    check(p.codedClusters[0].members.map((m) => m.id).join(",") === "s1,n1",
      "members ordered by position", ` (${p.codedClusters[0].members.map((m) => m.id).join(",")})`);
    check(!logs.some((l) => l.indexOf("[export]") === 0), "and nothing was caught on the way",
      ` (${logs.filter((l) => l.indexOf("[export]") === 0)[0] || ""})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }



  // ------------------------------------------ merging codes that share a name
  /* 같은 이름 코드가 둘이면 한 코드다 / two codes with the same name in the same folder are one
     code, and reading them apart splits a count that belongs together. 합치되 아무것도 잃지
     않아야 한다 / merging must lose nothing: every coding follows to the code that stays,
     including codings belonging to OTHER participants, and a set that already carried both
     collapses rather than carrying the same code twice. */
  say("\nmerging codes that share a name");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const analysis = {
      savedAt: Date.now(), pid: "sm:P9", step: 2, lang: "ko", rules: [],
      cards: [
        { id: "s1", type: "con", title: "하나", desc: "", dia: null, collapsed: false,
          w: 168, x: 200, y: 200, sm: true, src: "a" },
        { id: "s2", type: "con", title: "둘", desc: "", dia: null, collapsed: false,
          w: 168, x: 600, y: 200, sm: true, src: "a" },
      ],
      notes: [], arrows: [], strokes: [], seq: 30,
    };
    const { srv } = await realServer(page, {
      seed: (s) => {
        s.post({ participant: "P9", kind: "autosave", payload: { participant: "P9", state: {
          savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
          cards: [], notes: [], arrows: [], seq: 9, panelW: 566 } } });
        s.post({ participant: "sm:P9", kind: "sensemaking", payload: { participant: "sm:P9", state: analysis } });
        // 같은 폴더 같은 이름 둘 / two with the same folder AND name; k2 is used more
        s.post({ kind: "code", id: "k1", name: "transfer", folder: "value", color: "", deleted: false });
        s.post({ kind: "code", id: "k2", name: "transfer", folder: "value", color: "", deleted: false });
        // 이름만 같고 폴더가 다른 것은 건드리면 안 된다 / same name, different folder — must NOT merge
        s.post({ kind: "code", id: "k3", name: "transfer", folder: "bloom", color: "", deleted: false });
        // k2 를 더 많이 썼다 (4 대 3) / k2 is the more used of the pair — four codings to three —
        // so it is the one that should stay, and the fewest rows have to be rewritten
        s.post({ kind: "coding", id: "g1", participant: "P9", name: "k2", members: ["s1"], deleted: false });
        s.post({ kind: "coding", id: "g2", participant: "P9", name: "k2", members: ["s2"], deleted: false });
        s.post({ kind: "coding", id: "g6", participant: "P9", name: "k2", members: ["s1", "s2"], deleted: false });
        s.post({ kind: "coding", id: "g7", participant: "P4", name: "k2", members: ["s2"], deleted: false });
        // 이미 k2 가 걸린 묶음들이라 합쳐진다 / these two sets already carry k2, so they collapse
        s.post({ kind: "coding", id: "g3", participant: "P9", name: "k1", members: ["s2", "s1"], deleted: false });
        s.post({ kind: "coding", id: "g4", participant: "P9", name: "k1", members: ["s1"], deleted: false });
        // 다른 참여자의 것은 옮겨져야 한다 / another participant's must MOVE, not collapse
        s.post({ kind: "coding", id: "g5", participant: "P4", name: "k1", members: ["s1"], deleted: false });
      },
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "admin");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(900);
    await page.getByText("P9", { exact: true }).first().click();
    await page.waitForTimeout(2500);
    await page.getByText("코드", { exact: true }).click();
    await page.waitForTimeout(600);
    const named = () => srv.get({ codes: "all" }).codebook.filter((c) => !c.deleted && c.name === "transfer");
    check(named().length === 3, "three codes named transfer to start with", ` (${named().length})`);
    check(await page.evaluate(() => document.body.innerText.includes("같은 이름 합치기 (1)")),
      "the codebook offers to merge one pair — not the one in another folder",
      ` (${await page.evaluate(() => (document.body.innerText.match(/같은 이름 합치기[^\n]*/) || [""])[0])})`);
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.accept(); });
    await page.getByText("같은 이름 합치기", { exact: false }).click();
    await page.waitForTimeout(1800);
    check(/value\/transfer/.test(asked) && /1/.test(asked),
      "it says what it will merge before doing it", ` (${asked.slice(0, 90)})`);
    const book = srv.get({ codes: "all" }).codebook.filter((c) => !c.deleted);
    const transfers = book.filter((c) => c.name === "transfer");
    check(transfers.length === 2, "one of the pair is gone, the other folder untouched",
      ` (${transfers.map((c) => c.folder + "/" + c.id).join(", ")})`);
    check(transfers.some((c) => c.id === "k2") && transfers.some((c) => c.id === "k3"),
      "and the one that stays is the one that was used more",
      ` (${transfers.map((c) => c.id).join(",")})`);
    const cods = srv.get({ codes: "all" }).codings.filter((g) => !g.deleted);
    check(!cods.some((g) => g.code === "k1"), "no coding still points at the merged-away code",
      ` (${cods.filter((g) => g.code === "k1").length} left)`);
    const g5 = cods.find((g) => g.id === "g5");
    check(g5 && g5.code === "k2" && g5.participant === "P4",
      "a coding moves across, and stays with its own participant",
      g5 ? ` (${g5.participant}/${g5.code})` : " (LOST)");
    check(!cods.some((g) => g.id === "g3") && !cods.some((g) => g.id === "g4"),
      "while sets that already carried the survivor collapse rather than doubling it",
      ` (${["g3", "g4"].filter((id) => cods.some((g) => g.id === id)).join(",") || "both gone"})`);
    check(cods.filter((g) => g.participant === "P9").length === 3,
      "leaving one coding per distinct set", ` (${cods.filter((g) => g.participant === "P9").length})`);
    // 남의 코딩이 이 보드에 그려지면 안 된다 / and it must not have leaked onto this board
    check((await page.evaluate(() => window.__wsDiag().codings)).length === 3,
      "the open board still shows only its own codings, not P4's",
      ` (${JSON.stringify(await page.evaluate(() => window.__wsDiag().codings))})`);
    check(!(await page.evaluate(() => document.body.innerText.includes("같은 이름 합치기"))),
      "the offer goes once there is nothing left to merge");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

};
