/**
 * Real-browser end-to-end checks for the workshop app.
 *
 *   node tools/browser/e2e.js            # both halves in one process
 *   PART=1 node tools/browser/e2e.js     # first half only  (tools/browser/part1.js)
 *   PART=2 node tools/browser/e2e.js     # second half only (tools/browser/part2.js)
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
 * SANDBOX LIMIT — why PART exists: the whole suite opens ~35 contexts against a 23MB
 * page, and a small machine runs out of memory partway and STALLS rather than fails.
 * Worse, redirecting stdout to a file block-buffers it, so the log dies well behind
 * where the process actually got and the stall looks like an early crash. On such a
 * machine run the halves separately — each passes alone — and pipe through `tee`
 * rather than `>` if you want to watch it advance.
 *
 * SELECTOR NOTES (both cost me a debugging round):
 *  - Step-1 rule titles are <input value="…">, not text nodes, so getByText misses them.
 *  - Attribute selectors like [style*="width:168px"] do NOT match: the browser
 *    re-serialises the style attribute with spaces. Query the live layer instead.
 */
const { chromium, tally } = require("./harness");

const only = process.env.PART || "";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  if (only !== "2") await require("./part1")(browser);
  if (only !== "1") await require("./part2")(browser);
  await browser.close();
  console.log(tally.failures ? `\n${tally.failures} FAILURE(S)` : "\nall passed");
  process.exit(tally.failures ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
