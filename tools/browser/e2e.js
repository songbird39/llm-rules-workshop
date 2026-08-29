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
