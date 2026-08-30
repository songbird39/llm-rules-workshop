/**
 * Real-browser end-to-end checks for the workshop app.
 *
 *   node tools/browser/e2e.js            # headless, prints PASS/FAIL
 *   SHOTS=1 node tools/browser/e2e.js    # also write screenshots to /tmp/ws-shots
 *
 * SETUP (this sandbox, once per session):
 *   npm i playwright && npx playwright install chromium
 *   # Playwright's arm64 chromium needs libXdamage, which is absent and we have no
 *   # root. Fetch and extract it into a local prefix instead:
 *   mkdir -p /tmp/libs && cd /tmp/libs && apt-get download libxdamage1 && dpkg-deb -x *.deb .
 *   export LD_LIBRARY_PATH=/tmp/libs/usr/lib/aarch64-linux-gnu:$LD_LIBRARY_PATH
 *   # NB: puppeteer ships an x86-64 binary under a "linux_arm" path — it will not run.
 *
 * These drive the real UI, covering what tools/test_ui_scale.js cannot: that the
 * CSS-zoom pointer maths actually keeps a card under the cursor, and that card text
 * really scrolls instead of panning the board.
 *
 * SELECTOR NOTES (both cost me a debugging round):
 *  - Step-1 rule titles are <input value="…">, not text nodes, so getByText misses them.
 *  - Attribute selectors like [style*="width:168px"] do NOT match: the browser
 *    re-serialises the style attribute with spaces. Query the live layer instead.
 */
const path = require("path");
const { chromium } = require(process.env.PW || "/tmp/node_modules/playwright");

const APP = "file://" + path.resolve(__dirname, "../../index.html");
const SHOTS = process.env.SHOTS ? "/tmp/ws-shots" : null;

let failures = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${extra}`);
};
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

// every card currently on the board, as viewport rects
const boardCards = (page) =>
  page.evaluate(() => {
    const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
    if (!L) return [];
    return [...L.children]
      .filter((c) => c.tagName === "DIV" && c.offsetWidth === 168)
      .map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
  });

const boardTransform = (page) =>
  page.evaluate(() => {
    const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
    return L ? L.style.transform : "";
  });

const uiScale = (page) =>
  page.evaluate(() => {
    const r = document.querySelector("div[style*='zoom']");
    return r ? parseFloat(getComputedStyle(r).zoom) : 1;
  });

async function boot(browser, { width = 2560, height = 1440, query = "" } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  await page.goto(APP + query, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector('input[placeholder="P00"]', { timeout: 120000 });
  return { page, errors };
}

async function toBoard(page, code = "T01") {
  await page.fill('input[placeholder="P00"]', code);
  await page.getByText("시작하기", { exact: false }).click();
  await page.waitForSelector("text=규칙 카드", { timeout: 30000 });
  for (const t of ["브레인스토밍 · 초안", "먼저 직접 시도"]) {
    await page.locator(`input[value="${t}"]`).first().evaluate((el) => {
      let n = el;
      while (n && !(n.getAttribute("style") || "").includes("cursor:pointer")) n = n.parentElement;
      (n || el.parentElement.parentElement).click();
    });
  }
  await page.getByText("다음", { exact: false }).click();
  await page.waitForSelector("text=언제 카드", { timeout: 30000 });
}

// drag a panel tile (identified by its visible title) onto the board
async function dragTileToBoard(page, title, fx = 0.45, fy = 0.4) {
  const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
  const tile = page.getByText(title, { exact: true }).first();
  // the "how" deck sits below the panel fold; without this the tile's box is
  // off-viewport and the synthetic drag silently does nothing
  await tile.scrollIntoViewIfNeeded();
  const tb = await tile.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width * fx, cb.y + cb.height * fy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  // ------------------------------------------------- 1. drag fidelity under CSS zoom
  console.log("card follows the cursor (the CSS-zoom pointer maths)");
  for (const [w, h, want] of [[2560, 1440, 1.35], [1920, 1080, 1.2], [1440, 900, 1]]) {
    const { page, errors } = await boot(browser, { width: w, height: h });
    const scale = await uiScale(page);
    check(near(scale, want, 0.001), `${w}px viewport resolves UI ${want}`, ` (got ${scale})`);

    await toBoard(page);
    await dragTileToBoard(page, "학습 전");
    let cards = await boardCards(page);
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

  // ------------------------------------------------- 3. rule cards land expanded
  console.log("\nrule card keeps its size on drop");
  {
    const { page } = await boot(browser);
    await toBoard(page);
    await dragTileToBoard(page, "브레인스토밍 · 초안", 0.3, 0.3);
    const cards = await boardCards(page);
    const scale = await uiScale(page);
    check(cards.length === 1, "rule card dropped", ` (${cards.length})`);
    if (cards.length) {
      check(near(cards[0].h / scale, 168, 3), "lands at full 168px, not collapsed to 90",
        ` (${(cards[0].h / scale).toFixed(0)}px)`);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rulecard.png` });
    await page.close();
  }

  // ------------------------------------------------- 3b. note/card parity + raise
  console.log("\nnotes match cards, clicking raises");
  {
    const { page, errors } = await boot(browser, { width: 1440, height: 900 });
    await toBoard(page, "T02");
    await dragTileToBoard(page, "학습 전", 0.3, 0.35);
    await dragTileToBoard(page, "학습 중", 0.55, 0.35);
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
        noteDel: corner(note, note.querySelector("button")),
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
    check(after[after.length - 1] === first,
      "clicking a card's text raises it to front", ` (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
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

    const tile = page.getByText("학습 전", { exact: true }).first();
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
    await dragTileToBoard(page, "학습 전", 0.35, 0.25);
    const heights = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input"))
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
      return JSON.parse(localStorage.getItem(k)).cards.map((c) => c.h);
    });
    check(stored[0] > 200, "measured height persisted", ` (${stored[0]})`);

    // reload the SAME page — browser.newPage() would give an isolated context with
    // empty localStorage, which would not be a reload at all
    await page.reload({ waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P00"]', { timeout: 60000 });
    await page.fill('input[placeholder="P00"]', "T06");
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
    await dragTileToBoard(page, "학습 전", 0.25, 0.20);
    await dragTileToBoard(page, "학습 중", 0.45, 0.20);
    await dragTileToBoard(page, "학습 후", 0.65, 0.20);
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const geo = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input"))
        .map((c) => ({ t: c.querySelector("input").value, x: c.offsetLeft, y: c.offsetTop,
                       sel: !!c.style.outline && c.style.outline !== "none" }));
    });

    // marquee across the row
    await page.mouse.move(cb.x + cb.width * 0.15, cb.y + cb.height * 0.10);
    await page.mouse.down();
    for (const f of [0.3, 0.5, 0.65, 0.80]) {
      await page.mouse.move(cb.x + cb.width * f, cb.y + cb.height * 0.45);
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
      const c = [...L.children].filter((e) => e.tagName === "DIV" && e.querySelector("input"))[0];
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
      return [...L.children].filter((e) => e.tagName === "DIV" && e.querySelector("input"))
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
    await dragTileToBoard(page, "학습 전", 0.20, 0.18);
    await dragTileToBoard(page, "학습 중", 0.55, 0.18);
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    await page.getByText("메모", { exact: false }).click();
    await page.mouse.click(cb.x + cb.width * 0.25, cb.y + cb.height * 0.62);
    await page.waitForTimeout(300);

    const rects = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.children].filter((c) => c.tagName === "DIV").map((c) => {
        const r = c.getBoundingClientRect();
        return { kind: c.querySelector("input") ? "card" : "note", x: r.x, y: r.y, w: r.width, h: r.height };
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
    await page.waitForSelector('input[placeholder="P00"]', { timeout: 60000 });
    await page.fill('input[placeholder="P00"]', "A1");
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
      await pg.waitForSelector('input[placeholder="P00"]', { timeout: 120000 });
      await pg.fill('input[placeholder="P00"]', "F1");
      await pg.getByText("시작하기", { exact: false }).click();
      await pg.waitForTimeout(400);
      for (const t of ["브레인스토밍 · 초안", "먼저 직접 시도"]) {
        const l = pg.locator(`input[value="${t}"]`).first();
        if (await l.count()) await l.evaluate((el) => {
          let n = el;
          while (n && !(n.getAttribute("style") || "").includes("cursor:pointer")) n = n.parentElement;
          (n || el.parentElement.parentElement).click();
        });
      }
      const nx = pg.getByText("다음", { exact: false });
      if (await nx.count()) await nx.click();
      await pg.waitForTimeout(500);
      return pg;
    };

    let pg = await start(false);
    check(await pg.getByText("완료", { exact: true }).count() > 0, "toolbar shows Finish");
    check(await pg.getByText("제출 · JSON 저장", { exact: false }).count() === 0, "old Submit-and-save label gone");
    let dl = null;
    pg.on("download", (d) => { dl = d; });
    await pg.getByText("완료", { exact: true }).click();
    await pg.waitForTimeout(2200);
    const okText = await dialogText(pg);
    check(!!okText && okText.includes("제출했습니다"), "success dialog when the endpoint answers");
    check(dl === null, "no JSON downloaded on a successful finish");
    check(await pg.getByText("JSON 내려받기", { exact: false }).count() === 0, "no download button on success");
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/finish-ok.png` });
    await pg.close();

    pg = await start(true);
    await pg.getByText("완료", { exact: true }).click();
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
      if (u.searchParams.get("participant")) return reply({ ok: true, state: mk(2) });
      return reply({ ok: true, rows: 0 });
    });
    await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P00"]', { timeout: 120000 });
    await page.fill('input[placeholder="P00"]', "H1");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1200);
    const nCards = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return L ? [...L.children].filter((c) => c.tagName === "DIV" && c.querySelector("input")).length : 0;
    });
    const pickSubmit = () => page.evaluate(() => {
      const o = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.zIndex === "60");
      [...o.querySelectorAll("button")].find((x) => /제출됨/.test(x.innerText)).click();
    });
    check(await nCards() === 2, "latest board loaded");

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

    await page.getByText("기록", { exact: true }).click();
    await page.waitForTimeout(700);
    await pickSubmit();
    await page.waitForTimeout(900);
    posts = 0;
    await page.getByText("이 버전으로 되돌리기", { exact: false }).click();
    await page.waitForTimeout(600);
    const ta2 = page.locator("textarea").first();
    await ta2.click();
    await ta2.type("after restore");
    await page.waitForTimeout(3800);
    check(posts > 0, "after restore, editing saves again", ` (${posts} posts)`);
    check(await nCards() === 1, "the restored board is the old one");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/history.png` });
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

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
