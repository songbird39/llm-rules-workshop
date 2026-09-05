// 스위트 전반부 / first half of the browser suite. Run it through e2e.js, not directly.
const { APP, SHOTS, check, near, boardCards, boardTransform, uiScale,
        boot, toStep1, toBoard, dragTileToBoard } = require("./harness");

module.exports = async function (browser) {
  // ------------------------------------------------- 1. drag fidelity under CSS zoom
  console.log("card follows the cursor (the CSS-zoom pointer maths)");
  for (const [w, h, want] of [[2560, 1440, 1.35], [1920, 1080, 1.2], [1440, 900, 1],
                              [1280, 800, 0.92], [1024, 768, 0.85]]) {
    const { page, errors } = await boot(browser, { width: w, height: h });
    const scale = await uiScale(page);
    check(near(scale, want, 0.001), `${w}px viewport resolves UI ${want}`, ` (got ${scale})`);

    await toBoard(page);
    await dragTileToBoard(page, "활동 전");
    let cards = await boardCards(page);
    // one 활동 tag from toBoard, plus the card just dropped
    check(cards.length === 1, "card dropped onto the board", ` (${cards.length})`);

    if (cards.length) {
      const before = cards[0];
      const gx = before.x + before.w / 2, gy = before.y + 8; // grab the header, not the textarea
      const DX = 140, DY = 90;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx + DX, gy + DY, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const after = (await boardCards(page))[0];
      const mx = after.x - before.x, my = after.y - before.y;
      // the drift bug this guards against would be off by a factor of the UI scale
      check(near(mx, DX, 14), `moves with cursor in x at UI ${want}`, ` (${mx.toFixed(1)} of ${DX})`);
      check(near(my, DY, 14), `moves with cursor in y at UI ${want}`, ` (${my.toFixed(1)} of ${DY})`);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-${w}.png` });
    check(errors.length === 0, `no console errors at ${w}px`, errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 2. nothing needs scrolling; the
  // wheel guard still yields when something genuinely overflows
  console.log("\ncard text never needs scrolling, and the wheel guard still works");
  {
    const { page } = await boot(browser);
    await toBoard(page);
    await dragTileToBoard(page, "외부 도구 열기", 0.5, 0.45); // longest shipped description
    const ta = page.locator("textarea").last();

    // since cards auto-grow, the description must NOT overflow any more
    check(await ta.evaluate((el) => el.scrollHeight - el.clientHeight) <= 1,
      "longest description does not overflow (card grew to fit)");

    // with nothing to scroll, the wheel should pan the board as usual
    const box = await ta.boundingBox();
    const panBefore = await boardTransform(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(150);
    check(panBefore !== (await boardTransform(page)),
      "wheel over a card pans the board when the text fits");

    // The yield-to-overflowing-text branch of the wheel handler is NOT exercised here.
    // Auto-growing cards mean the condition no longer arises naturally, and forcing it
    // by shrinking the textarea from the test does not hold: autoGrow() resets the
    // height on the next render, so the probe measures the wrong thing. That branch is
    // covered instead in tools/test_ui_scale.js, which executes the real handler
    // against fake targets (mid-text, at both edges, over empty canvas, ctrl+wheel).
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/scroll.png` });
    await page.close();
  }

  // ------------------------------------------------- 3. a guardrail card lands card-sized
  console.log("\nguardrail cards land at card size, tags do not");
  {
    const { page } = await boot(browser);
    await toBoard(page);
    await dragTileToBoard(page, "규칙 상기", 0.3, 0.3);
    const cards = await boardCards(page);           // width 168 only, so tags are excluded
    const scale = await uiScale(page);
    check(cards.length === 1, "one card on the board", ` (${cards.length})`);
    if (cards.length) {
      check(near(cards[0].w / scale, 168, 2), "card is CARD wide", ` (${(cards[0].w / scale).toFixed(0)})`);
      check(cards[0].h / scale > 150, "and card-height, not a bar", ` (${(cards[0].h / scale).toFixed(0)})`);
    }
    const tagW = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const t = [...L.children].find((c) => c.tagName === "DIV" && c.querySelector("input") && c.offsetWidth !== 168);
      return t ? t.offsetWidth : null;
    });
    check(tagW === 352, "the 활동 tag beside it is TAG_W", ` (${tagW})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rulecard.png` });
    await page.close();
  }

  // ------------------------------------------------- 3b. note/card parity + raise
  console.log("\nnotes match cards, clicking raises");
  {
    const { page, errors } = await boot(browser, { width: 1440, height: 900 });
    await toBoard(page, "T02");
    await dragTileToBoard(page, "활동 전", 0.3, 0.35);
    await dragTileToBoard(page, "활동 중", 0.55, 0.35);
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    await page.getByText("메모", { exact: false }).click();
    await page.mouse.click(cb.x + cb.width * 0.42, cb.y + cb.height * 0.7);
    await page.waitForTimeout(300);

    const geo = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const kids = [...L.children].filter((c) => c.tagName === "DIV");
      const card = kids.find((c) => c.offsetWidth === 168 && c.querySelector("input"));
      const note = kids.find((c) => c.querySelector("textarea") && !c.querySelector("input"));
      const corner = (par, el) => {
        const a = par.getBoundingClientRect(), b = el.getBoundingClientRect();
        return { fromBottom: +(a.bottom - b.bottom).toFixed(1), fromRight: +(a.right - b.right).toFixed(1) };
      };
      const cbtns = card.querySelectorAll("button");
      return {
        cardW: card.offsetWidth, noteW: note.offsetWidth,
        cardFont: getComputedStyle(card.querySelector("textarea")).fontSize,
        noteFont: getComputedStyle(note.querySelector("textarea")).fontSize,
        cardDel: corner(card, cbtns[cbtns.length - 1]),
        noteDel: (() => { const nb = note.querySelectorAll("button"); return corner(note, nb[nb.length - 1]); })(),
      };
    });
    check(geo.noteW === geo.cardW, "note width equals card width", ` (${geo.noteW})`);
    check(geo.noteFont === geo.cardFont, "note font equals card description font", ` (${geo.noteFont})`);
    check(near(geo.noteDel.fromBottom, geo.cardDel.fromBottom) && near(geo.noteDel.fromRight, geo.cardDel.fromRight),
      "delete button sits at the same corner offset",
      ` (note ${JSON.stringify(geo.noteDel)} card ${JSON.stringify(geo.cardDel)})`);

    const order = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV")
        .map((c) => { const i = c.querySelector("input"); return i ? i.value : "note"; });
    });
    const before = await order();
    const first = before.find((v) => v !== "note");
    await page.locator(`input[value="${first}"]`).last().click();  // click its TEXT, not the body
    await page.waitForTimeout(200);
    const after = await order();
    check(JSON.stringify(after) === JSON.stringify(before),
      "clicking a card's TEXT does not reorder it — that would drop the focus mid-click",
      ` (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
    check(await page.evaluate(() => document.activeElement.tagName) === "INPUT",
      "and the click lands in the field instead");
    // 몸통을 누르면 여전히 맨 앞으로 / a press on the body still raises
    await page.evaluate((t) => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...layer.children].find((c) => c.querySelector && c.querySelector("input")
        && c.querySelector("input").value === t);
      const r = el.getBoundingClientRect();
      window.__body = { x: r.x + r.width / 2, y: r.bottom - 6 };
    }, first);
    const bodyPt = await page.evaluate(() => window.__body);
    await page.mouse.move(bodyPt.x, bodyPt.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(250);
    const raised = await order();
    check(raised[raised.length - 1] === first, "pressing the card body still raises it",
      ` (${JSON.stringify(raised)})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/notes.png` });
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3c. drop lands where the ghost was
  // The ghost offset is in screen px (position:fixed, scaled by UI only) while a card
  // position is in canvas px (scaled by UI * board zoom), so this has to hold at any
  // board zoom, not just 100%.
  console.log("\ndrop lands where the drag ghost was");
  for (const target of [1, 0.6, 1.5]) {
    const { page } = await boot(browser, { width: 1440, height: 900 });
    await toBoard(page, "T04");
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const readZoom = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const m = /scale\(([\d.]+)\)/.exec(L.style.transform);
      return m ? parseFloat(m[1]) : 1;
    });
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    for (let i = 0; i < 40; i++) {
      const z = await readZoom();
      if (Math.abs(z - target) < 0.05) break;
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, z > target ? 120 : -120);
      await page.keyboard.up("Control");
      await page.waitForTimeout(60);
    }
    const zoom = await readZoom();

    const tile = page.getByText("활동 전", { exact: true }).first();
    await tile.scrollIntoViewIfNeeded();
    const tb = await tile.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.45, { steps: 10 });
    await page.waitForTimeout(120);
    const ghost = await page.evaluate(() => {
      const g = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "50");
      const r = g.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const card = (await boardCards(page)).pop();
    const dx = card.x - ghost.x, dy = card.y - ghost.y;
    // cards snap on a 10 local-px grid, which is 10 * zoom * UI on screen
    const tol = Math.max(12, 12 * zoom);
    check(Math.abs(dx) <= tol && Math.abs(dy) <= tol,
      `lands where the ghost was at board zoom ${zoom.toFixed(2)}`,
      ` (off by ${dx.toFixed(1)},${dy.toFixed(1)}; tol ${tol.toFixed(0)})`);
    // The ghost is position:fixed (UI zoom only) while the card is in the canvas layer
    // (UI * board zoom), so without an explicit transform the preview is the wrong size.
    // Width must match exactly. Height only approximately: the ghost is a simplified
    // preview (title bar + one empty box, no diagram or description) and cards are now
    // variable height, so an exact match is not a meaningful thing to ask for.
    check(Math.abs(ghost.w - card.w) <= 2,
      `ghost width matches the card at board zoom ${zoom.toFixed(2)}`,
      ` (${ghost.w.toFixed(0)} vs ${card.w.toFixed(0)})`);
    check(Math.abs(ghost.h - card.h) <= Math.max(10, 10 * zoom),
      `ghost height is about the card's at board zoom ${zoom.toFixed(2)}`,
      ` (${ghost.h.toFixed(0)} vs ${card.h.toFixed(0)})`);
    await page.close();
  }

  // ------------------------------------------------- 3d. cards grow to fit their text
  console.log("\ncards grow downward; geometry persists");
  {
    const { page, errors } = await boot(browser, { width: 1440, height: 900 });
    await toBoard(page, "T06");
    await dragTileToBoard(page, "활동 전", 0.35, 0.25);
    const heights = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      // exclude 활동 tags (they are TAG_W wide) — these assertions are about cards
      return [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input") && c.offsetWidth === 168)
        .map((c) => c.offsetHeight);
    });
    let h = await heights();
    // a full 3-line description no longer clips, which costs ~4px over the old fixed 168
    check(h.length === 1 && h[0] >= 168 && h[0] <= 178,
      "short text renders a card of about the old 168px", ` (${h[0]})`);

    const ta = page.locator("textarea").last();
    await ta.click();
    await ta.fill("가나다라마바사아자차카타파하 ".repeat(12));
    await page.waitForTimeout(500);
    h = await heights();
    check(h[0] > 200, "card grew downward to fit the text", ` (${h[0]}px)`);
    check(await ta.evaluate((el) => el.scrollHeight - el.clientHeight) <= 1,
      "no hidden overflow — scrolling is never needed");

    const stored = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("llm-guardrail") && x.endsWith(":T06"));
      // skip the 활동 tag toBoard drops to unlock 다음 — this is about the card
      return JSON.parse(localStorage.getItem(k)).cards.filter((c) => c.type !== "act").map((c) => c.h);
    });
    check(stored[0] > 200, "measured height persisted", ` (${stored[0]})`);

    // reload the SAME page — browser.newPage() would give an isolated context with
    // empty localStorage, which would not be a reload at all
    await page.reload({ waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 60000 });
    await page.fill('input[placeholder="P0000"]', "T06");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1200);
    const h2 = await heights();
    check(h2.length === 1 && Math.abs(h2[0] - stored[0]) <= 3,
      "board reloads at exactly the same height", ` (${h2[0]} vs ${stored[0]})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grow.png` });
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3e. marquee, ctrl-click, group move
  // NB: drags here are PACED (a move every ~50ms) rather than mouse.move({steps}).
  // Synthetic steps get coalesced/dropped under load and the assertions then measure
  // a fraction of the intended distance, which looks exactly like a maths bug.
  console.log("\nmarquee select, ctrl-click, group move");
  {
    const { page, errors } = await boot(browser, { width: 1440, height: 900 });
    await toBoard(page, "T11");
    await dragTileToBoard(page, "활동 전", 0.25, 0.35);
    await dragTileToBoard(page, "활동 중", 0.45, 0.35);
    await dragTileToBoard(page, "활동 후", 0.65, 0.35);
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const geo = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input") && c.offsetWidth === 168)
        .map((c) => ({ t: c.querySelector("input").value, x: c.offsetLeft, y: c.offsetTop,
                       sel: !!c.style.outline && c.style.outline !== "none" }));
    });

    // marquee across the row
    await page.mouse.move(cb.x + cb.width * 0.15, cb.y + cb.height * 0.26);
    await page.mouse.down();
    for (const f of [0.3, 0.5, 0.65, 0.80]) {
      await page.mouse.move(cb.x + cb.width * f, cb.y + cb.height * 0.60);
      await page.waitForTimeout(40);
    }
    const marqDrawn = await page.evaluate(() =>
      !![...document.querySelectorAll("div")].find((d) => /oklch\(0.51 0.08 253 \/ 0.1\)/.test(d.style.background)));
    await page.mouse.up();
    await page.waitForTimeout(250);
    check(marqDrawn, "marquee rectangle is drawn while dragging");
    let g = await geo();
    check(g.filter((c) => c.sel).length === 3, "marquee selected all three",
      ` (${g.filter((c) => c.sel).length})`);

    // group move: full distance, and relative layout preserved
    const before = g.map((c) => ({ t: c.t, x: c.x, y: c.y }));
    const first = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const c = [...L.children].filter((e) => e.tagName === "DIV" && e.querySelector("input") && e.offsetWidth === 168)[0];
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    await page.mouse.move(first.x + 80, first.y + 6);
    await page.mouse.down();
    await page.waitForTimeout(50);
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(first.x + 80 + 20 * i, first.y + 6 + 12 * i);
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = (await geo()).map((c) => ({ t: c.t, x: c.x, y: c.y }));
    const B = {}, A = {};
    before.forEach((c) => { B[c.t] = c; });   // key by title: raising reorders the array
    after.forEach((c) => { A[c.t] = c; });
    const k0 = before[0].t;
    const d0 = { x: A[k0].x - B[k0].x, y: A[k0].y - B[k0].y };
    check(Math.abs(d0.x - 120) <= 3 && Math.abs(d0.y - 72) <= 3,
      "group moved the full drag distance", ` (${JSON.stringify(d0)})`);
    check(Object.keys(B).every((t) => Math.abs((A[t].x - B[t].x) - d0.x) < 1 && Math.abs((A[t].y - B[t].y) - d0.y) < 1),
      "all three moved by the same delta (layout preserved)");

    // click empty canvas clears
    await page.mouse.click(cb.x + cb.width * 0.9, cb.y + cb.height * 0.85);
    await page.waitForTimeout(200);
    g = await geo();
    check(g.filter((c) => c.sel).length === 0, "clicking empty canvas clears the selection");

    // ctrl-click adds
    const rects = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((e) => e.tagName === "DIV" && e.querySelector("input") && e.offsetWidth === 168)
        .map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    });
    await page.keyboard.down("Control");
    await page.mouse.click(rects[0].x + 80, rects[0].y + 6);
    await page.waitForTimeout(120);
    await page.mouse.click(rects[2].x + 80, rects[2].y + 6);
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);
    g = await geo();
    check(g.filter((c) => c.sel).length === 2, "ctrl-click selected exactly two",
      ` (${g.filter((c) => c.sel).length})`);

    // panning must survive the change from pan-drag to marquee-drag
    const panBefore = await boardTransform(page);
    await page.keyboard.down("Alt");
    await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.8);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(cb.x + cb.width * 0.5 + 25 * i, cb.y + cb.height * 0.8 + 10 * i);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(200);
    check(panBefore !== (await boardTransform(page)), "Alt+drag still pans the board");

    // selection is UI-only and must never be saved
    const stored = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("llm-guardrail") && x.endsWith(":T11"));
      return "sel" in JSON.parse(localStorage.getItem(k));
    });
    check(!stored, "selection is not written to storage");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/select.png` });
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3f. arrows to anything
  console.log("\narrows attach to cards, notes and empty space");
  {
    const { page, errors } = await boot(browser, { width: 1440, height: 900 });
    await toBoard(page, "A1");
    await dragTileToBoard(page, "활동 전", 0.20, 0.18);
    await dragTileToBoard(page, "활동 중", 0.55, 0.18);
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    await page.getByText("메모", { exact: false }).click();
    await page.mouse.click(cb.x + cb.width * 0.25, cb.y + cb.height * 0.62);
    await page.waitForTimeout(300);

    const rects = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV").map((c) => {
        const r = c.getBoundingClientRect();
        return { kind: c.querySelector("input") ? (c.offsetWidth === 168 ? "card" : "tag") : "note",
                 x: r.x, y: r.y, w: r.width, h: r.height };
      });
    });
    const cards = rects.filter((r) => r.kind === "card"), notes = rects.filter((r) => r.kind === "note");
    const stored = () => page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("llm-guardrail") && x.endsWith(":A1"));
      return JSON.parse(localStorage.getItem(k)).arrows || [];
    });
    // arrow mode is sticky — enable once; clicking again would turn it off
    await page.getByText("화살표", { exact: false }).click();
    await page.waitForTimeout(150);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(50);
      for (let i = 1; i <= 4; i++) {
        await page.mouse.move(from.x + (to.x - from.x) * i / 4, from.y + (to.y - from.y) * i / 4);
        await page.waitForTimeout(50);
      }
      await page.mouse.up();
      await page.waitForTimeout(250);
    };
    const cardPt = (c) => ({ x: c.x + c.w / 2, y: c.y + 8 });
    const notePt = (n) => ({ x: n.x + n.w / 2, y: n.y + 20 });

    await drag(cardPt(cards[0]), cardPt(cards[1]));
    await drag(cardPt(cards[1]), notePt(notes[0]));
    await drag(notePt(notes[0]), { x: cb.x + cb.width * 0.80, y: cb.y + cb.height * 0.75 });
    await drag({ x: cb.x + cb.width * 0.85, y: cb.y + cb.height * 0.25 }, cardPt(cards[0]));
    const a = await stored();
    check(a.length === 4, "four arrows created", ` (${a.length})`);
    check(a[0] && a[0].from.k === "card" && a[0].to.k === "card", "card -> card");
    check(a[1] && a[1].to.k === "note", "card -> note");
    check(a[2] && a[2].from.k === "note" && a[2].to.k === "pt", "note -> empty space");
    check(a[3] && a[3].from.k === "pt" && a[3].to.k === "card", "empty space -> card");

    const arrowLines = () => page.evaluate(() => {
      const sv = [...document.querySelectorAll("svg")].find((x) => x.getAttribute("width") === "5000");
      return !sv ? [] : [...sv.querySelectorAll("line")]
        .filter((l) => l.getAttribute("stroke") !== "transparent" && !l.getAttribute("stroke-dasharray"))
        .map((l) => ({ x1: +l.getAttribute("x1"), y1: +l.getAttribute("y1"), x2: +l.getAttribute("x2"), y2: +l.getAttribute("y2") }));
    });
    const L = await arrowLines();
    check(L.length === 4, "four arrows rendered", ` (${L.length})`);
    check(L.every((l) => [l.x1, l.y1, l.x2, l.y2].every(isFinite)), "all endpoints finite");
    check(L.every((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 5), "no zero-length arrows");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/arrows.png` });

    // boards saved before the schema change stored bare card ids — they must still work
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("llm-guardrail") && x.endsWith(":A1"));
      const d = JSON.parse(localStorage.getItem(k));
      d.arrows = [{ id: "old1", from: d.cards[0].id, to: d.cards[1].id }];
      localStorage.setItem(k, JSON.stringify(d));
    });
    await page.reload({ waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 60000 });
    await page.fill('input[placeholder="P0000"]', "A1");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1200);
    const L2 = await arrowLines();
    check(L2.length === 1 && Math.hypot(L2[0].x2 - L2[0].x1, L2[0].y2 - L2[0].y1) > 5,
      "pre-change arrow (bare card ids) still renders", ` (${L2.length})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3g. Finish, with JSON as fallback
  // Writes are fire-and-forget (no-cors), so the only honest signal that the work did
  // not go out is a leftover item in the outbound queue. These stub the endpoint at
  // the network layer to exercise both paths.
  console.log("\nFinish submits; JSON download only when the server is unreachable");
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
  console.log("\nversion history: travel is read-only until restored");
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
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript", body: cbn + "(" + JSON.stringify(o) + ");" });
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
    const ta = page.locator("textarea").first();
    await ta.click();
    await ta.type("edited while browsing");
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
  console.log("\nadmin sensemaking: edits go to sm:PID, never the participant record");
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
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript", body: cbn + "(" + JSON.stringify(o) + ");" });
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
    check(o.length === 3 && o.every((x) => x.pe === "none"), "participant objects load and are inert");
    check(await page.evaluate(() => document.body.innerText.includes("참여자 산출물")), "protected region is labelled");

    await page.getByText("전체 복제", { exact: true }).click();
    await page.waitForTimeout(800);
    o = await objs();
    const sm = o.filter((x) => x.sm);
    check(o.length === 6, "duplicate all created copies", ` (${o.length})`);
    check(sm.length === 3 && sm.every((x) => x.pe === "auto"), "copies are marked and interactive");

    await page.waitForTimeout(2200);
    const keys = posted.map((x) => x && x.participant);
    check(posted.length > 0, "the workspace was saved", ` (${posted.length})`);
    check(keys.every((k) => k === "sm:P9"), "every POST targets sm:P9", ` (${JSON.stringify(keys)})`);
    check(!keys.some((k) => k === "P9"), "NO POST targets the participant's own record");
    check(posted.every((x) => x.kind === "sensemaking"), "every POST is kind sensemaking");
    const sent = posted[posted.length - 1].payload.state;
    check(sent.cards.every((c) => c.sm) && sent.notes.every((n) => n.sm),
      "payload contains only sm-flagged objects");

    const rect = (isSm) => page.evaluate((d) => {
      const L = [...document.querySelectorAll("div")].find((x) => x.style.width === "5000px");
      const el = [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input"))
        .find((c) => /dashed/.test(c.style.border) === d);
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
  console.log("\ntag width: hidden until hovered, then draggable");
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
  console.log("\nadmin image export: clean board and workspace board");
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
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript", body: cbn + "(" + JSON.stringify(o) + ");" });
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
      page.getByRole("button", { name: /이미지 저장/ }).click(),
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
      page.getByRole("button", { name: /해석 포함/ }).click(),
    ]);
    check(dl2 !== null, "workspace image downloads", dl2 ? ` (${dl2.suggestedFilename()})` : "");
    if (dl2) {
      const f2 = "/tmp/ws-board-sense.png";
      await dl2.saveAs(f2);
      check(fs2.statSync(f2).size > cleanSize,
        "the workspace image carries more than the clean one");
    }
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- 3l. delete a participant record
  // Irreversible, so the interesting assertions are the ones about NOT deleting.
  console.log("\ndeleting a participant record");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    let people = [{ participant: "P01", rows: 12, submits: 1, lastAt: "2026-08-29T10:00:00Z" },
                  { participant: "P02", rows: 4, submits: 0, lastAt: "2026-08-29T09:00:00Z" }];
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
        if (b.action === "delete") people = people.filter((x) => x.participant !== b.participant);
        return route.fulfill({ status: 200, body: "{}" });
      }
      const cbn = u.searchParams.get("callback");
      const reply = (o) => route.fulfill({ status: 200, contentType: "application/javascript", body: cbn + "(" + JSON.stringify(o) + ");" });
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
    const dlg = () => page.evaluate(() => {
      const o = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "70");
      return o ? o.innerText.replace(/\s+/g, " ").trim() : null;
    });
    const pressDelete = () => page.evaluate(() => {
      const o = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "70");
      [...o.querySelectorAll("button")].find((b) => b.textContent.trim() === "삭제").click();
    });
    check(JSON.stringify(await rows()) === JSON.stringify(["P01", "P02"]), "roster lists both");

    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((x) => x.title && x.title.includes("삭제")).click();
    });
    await page.waitForTimeout(400);
    const d = await dlg();
    check(!!d && d.includes("삭제할까요"), "confirmation dialog opens");
    check(!!d && d.includes("12"), "it states how many rows will go");
    check(posts.length === 0, "opening it posts nothing");

    await page.locator('input[placeholder="P01"]').fill("P0");
    await pressDelete();
    await page.waitForTimeout(600);
    check(posts.length === 0, "a mistyped code does not delete", ` (${posts.length} posts)`);
    check((await dlg()) !== null, "and the dialog stays open");

    await page.locator('input[placeholder="P01"]').fill("P01");
    await pressDelete();
    await page.waitForTimeout(2600);
    check(posts.length === 1 && posts[0].action === "delete" && posts[0].participant === "P01",
      "posts the delete action", ` (${JSON.stringify(posts[0])})`);
    check((await dlg()) === null, "dialog closes");
    check(JSON.stringify(await rows()) === JSON.stringify(["P02"]),
      "roster is reloaded and the record is gone", ` (${JSON.stringify(await rows())})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }
};
