/**
 * Shared rig for the browser suite: the page helpers every section borrows.
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
  *
*/
const path = require("path");
const { chromium } = require(process.env.PW || "/tmp/node_modules/playwright");

const APP = "file://" + path.resolve(__dirname, "../../index.html");
const SHOTS = process.env.SHOTS ? "/tmp/ws-shots" : null;

const tally = { failures: 0 };
const check = (ok, label, extra = "") => {
  if (!ok) tally.failures++;
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
  // 시트에 손대지 않는다 / never touch the live sheet. SYNC_URL is baked into the build,
  // so an un-stubbed page autosaves real rows to the research spreadsheet AND pulls them
  // back on the next login — which is not just pollution, it makes the suite read its own
  // droppings: one run typed a title, the next run's login restored it from the server and
  // the language check failed on data no test had put on the board. Sections that need to
  // observe posts install their own route afterwards; the last route registered wins.
  await page.route("**/macros/s/**", (r) => r.fulfill({ status: 200, body: "{}" }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  await page.goto(APP + query, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
  return { page, errors };
}

// Log in and stop on step 1: the workflow board (활동 / 수단 in the panel).
async function toStep1(page, code = "T01") {
  await page.fill('input[placeholder="P0000"]', code);
  await page.getByText("시작하기", { exact: false }).click();
  await page.waitForSelector("text=무엇을 하나요?", { timeout: 30000 });
}

// Log in, lay one activity tag (다음 is gated on having one), and advance to step 2,
// where the guardrail decks live. The board therefore starts with ONE tag on it.
async function toBoard(page, code = "T01") {
  await toStep1(page, code);
  await dragTileToBoard(page, "학습 계획", 0.12, 0.10);
  await page.getByRole("button", { name: /다음/ }).click();
  await page.waitForSelector("text=시스템이 어떻게 개입하나요?", { timeout: 30000 });
}

// Drag a panel tile onto the board. Matched by prefix on the tile's own text, not
// getByText(exact): a 활동 tag renders its title and subtitle as two spans, so an exact
// match never resolves. Scrolls the tile into view first — decks below the panel fold
// report an off-viewport box and the synthetic drag silently does nothing.
async function dragTileToBoard(page, title, fx = 0.45, fy = 0.4) {
  const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
  await page.evaluate((q) => {
    const d = [...document.querySelectorAll("div")]
      .filter((x) => getComputedStyle(x).cursor === "grab")
      .find((x) => x.innerText.replace(/\s+/g, " ").trim().startsWith(q));
    if (d) d.scrollIntoView({ block: "center" });
  }, title);
  await page.waitForTimeout(150);
  const t = await page.evaluate((q) => {
    const d = [...document.querySelectorAll("div")]
      .filter((x) => getComputedStyle(x).cursor === "grab")
      .find((x) => x.innerText.replace(/\s+/g, " ").trim().startsWith(q));
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, h: r.height };
  }, title);
  if (!t) throw new Error("deck tile not found: " + title);
  await page.mouse.move(t.x + 40, t.y + t.h / 2);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.move(cb.x + cb.width * fx, cb.y + cb.height * fy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
// 진짜 서버를 페이지 뒤에 붙인다 / put the REAL server behind the page. A hand-written stub
// answers whatever the test wants it to; Code.gs answers what the deployment will. Every
// route that matters — save, list, load, reload — goes through the actual scan-and-
// reassemble logic this way.
async function realServer(page, { seed } = {}) {
  const { loadServer } = require("../gasnode");
  const srv = loadServer();
  if (seed) seed(srv);
  const posts = [];
  // route() 는 기다려야 한다 / await it: an unawaited route can miss the first navigation,
  // and the page then talks to nothing at all
  await page.route("**/macros/s/**", async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "POST") {
      let body = {};
      try { body = JSON.parse(route.request().postData() || "{}"); } catch (e) {}
      posts.push(body);
      let out = { ok: false };
      try { out = srv.post(body); } catch (e) { out = { ok: false, error: String(e) }; }
      return route.fulfill({ status: 200, body: JSON.stringify(out) });
    }
    const params = {};
    u.searchParams.forEach((v, k) => { params[k] = v; });
    // 서버가 JSONP 를 만들게 둔다 / let the server build the JSONP itself, callback and all —
    // wrapping it here would skip the very code the browser depends on
    let body, ok = true;
    try { body = srv.getText(params); } catch (e) { ok = false; body = String(e); }
    return route.fulfill({
      status: 200,
      contentType: params.callback ? "application/javascript" : "application/json",
      body: ok ? body : JSON.stringify({ ok: false, error: body }),
    });
  });
  return { srv, posts };
}

module.exports = { realServer, APP, SHOTS, chromium, tally, check, near, boardCards,
  boardTransform, uiScale, boot, toStep1, toBoard, dragTileToBoard };
