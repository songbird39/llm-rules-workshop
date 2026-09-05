// 스위트 후반부 / second half of the browser suite. Run it through e2e.js, not directly.
const { APP, SHOTS, check, near, boardCards, boardTransform, uiScale,
        boot, toStep1, toBoard, dragTileToBoard } = require("./harness");

module.exports = async function (browser) {
  // ------------------------------------------------- pen and step-1 arrows
  console.log("\ndrawing tools: the pen, and arrows in step 1 too");
  {
    const { page, errors } = await boot(browser, { width: 1700, height: 1000 });
    await toStep1(page, "INK");
    // 1단계에도 있어야 한다 / step 1 needs them too: a workflow is where people most want
    // to circle a group or join two things no card connects
    check((await page.getByRole("button", { name: "화살표" }).count()) === 1, "step 1 has the arrow tool");
    check((await page.getByRole("button", { name: "펜" }).count()) === 1, "step 1 has the pen");

    const box = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const strokes = () => page.evaluate(() => document.querySelectorAll("polyline").length);
    const inks = () => page.evaluate(() => [...document.querySelectorAll("polyline")].map((x) => x.getAttribute("stroke")));
    const swatch = (i) => page.evaluate((n) => {
      const b = [...document.querySelectorAll("button")]
        .filter((x) => x.style.borderRadius === "50%" && x.style.width === "19px")[n];
      if (b) b.click();
      return !!b;
    }, i);
    const draw = async (y, n) => {
      await page.mouse.move(box.x + 300, box.y + y);
      await page.mouse.down();
      for (let i = 0; i < n; i++) { await page.mouse.move(box.x + 300 + i * 18, box.y + y + (i % 2) * 20); await page.waitForTimeout(16); }
      await page.mouse.up();
      await page.waitForTimeout(250);
    };

    await dragTileToBoard(page, "학습 계획", 0.14, 0.14);
    await page.getByRole("button", { name: "펜" }).click();
    await page.waitForTimeout(250);
    const count = await page.evaluate(() => [...document.querySelectorAll("button")]
      .filter((x) => x.style.borderRadius === "50%" && x.style.width === "19px").length);
    check(count === 4, "four inks to choose from", ` (${count})`);
    check(await page.evaluate(() => {
      const svg = [...document.querySelectorAll("svg")].find((x) => x.style.mixBlendMode);
      return svg ? getComputedStyle(svg).mixBlendMode : "none";
    }) === "multiply", "ink multiplies, like a board marker, rather than washing out");
    // 카드 위에서 획을 시작할 수 있어야 한다 / a stroke must be able to START on a card.
    // A card that takes the pointerdown makes striking one through impossible, and an
    // ancestor's pointer-events:none does not stop a card that sets auto itself.
    const tag = await page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...layer.children].find((c) => c.querySelector && c.querySelector("input"));
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(tag.x, tag.y);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) { await page.mouse.move(tag.x + i * 14, tag.y + i * 4); await page.waitForTimeout(14); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    check((await page.evaluate(() => document.querySelectorAll("polyline").length)) === 1,
      "a stroke can start on top of a card");
    const moved = await page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...layer.children].find((c) => c.querySelector && c.querySelector("input"));
      return el.style.left;
    });
    check(moved === "80px" || parseInt(moved, 10) < 200, "and drawing on a card does not drag it", ` (left ${moved})`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "✕");
      if (b) b.click();
    });
    await page.waitForTimeout(200);
    await draw(300, 12);
    check((await strokes()) === 2, "a drag draws a stroke", ` (${await strokes()})`);
    await swatch(2);
    await draw(430, 10);
    const two = await inks();
    check(two.length === 3 && two[2] !== two[1], "a second stroke takes the newly picked ink", ` (${JSON.stringify(two)})`);

    // 지우개는 획 단위 / the eraser takes whole strokes
    await page.getByRole("button", { name: "지우개" }).click();
    await page.waitForTimeout(200);
    await page.mouse.move(box.x + 320, box.y + 430);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 430);
    await page.mouse.up();
    await page.waitForTimeout(300);
    check((await strokes()) === 2, "the eraser removes a whole stroke, not part of one", ` (${await strokes()})`);

    // 펜을 켜면 다른 모드는 꺼진다 / three modes cannot own the same drag
    await page.getByRole("button", { name: "화살표" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "펜" }).click();
    await page.waitForTimeout(150);
    const bg = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("화살표"));
      return b ? b.style.background : "NO BUTTON";
    });
    check(bg !== "NO BUTTON" && bg !== "rgb(27, 26, 23)" && bg !== "#1b1a17",
      "turning the pen on turns the arrow tool off", ` (${bg})`);

    // 저장되고 다시 돌아온다 / it is board content, so it comes back
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await toStep1(page, "INK");
    await page.waitForTimeout(800);
    check((await strokes()) === 2, "ink survives a reload", ` (${await strokes()})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- deck naming and order
  console.log("\nthe decks are 규칙 (①②) and 가드레일 (③④)");
  {
    const { page, errors } = await boot(browser, { width: 1700, height: 1050 });
    await toBoard(page, "DCK");
    const tabs = await page.evaluate(() => [...document.querySelectorAll("button")]
      .filter((b) => (b.style.borderBottom || "").includes("2px")).map((b) => b.textContent.trim()));
    check(JSON.stringify(tabs) === JSON.stringify(["규칙", "가드레일"]), "the tabs name the two sets", ` (${JSON.stringify(tabs)})`);
    const heads = await page.evaluate(() => [...document.querySelectorAll("span")]
      .filter((s) => s.style.fontSize === "14px" && s.style.fontWeight === "600")
      .map((s) => s.textContent.trim()));
    check(JSON.stringify(heads) === JSON.stringify(["③", "시점", "·", "조건", "④", "유도"]),
      "③ is 시점 · 조건 and ④ is 유도", ` (${JSON.stringify(heads)})`);
    const badges = await page.evaluate(() => [...document.querySelectorAll("span")]
      .filter((s) => s.style.fontSize === "9px").map((s) => s.textContent.trim()));
    check(!badges.includes("제약") && !badges.includes("발동") && badges.includes("시점") && badges.includes("조건"),
      "and the card badges follow", ` (${JSON.stringify([...new Set(badges)])})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- library shows descriptions on hover
  console.log("\n규칙 cards: label on the board, description on hover in the library");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 950 });
    await toStep1(page, "LIB");
    const tiles = await page.evaluate(() => [...document.querySelectorAll("div")]
      .filter((x) => getComputedStyle(x).cursor === "grab")
      .map((t) => ({ text: t.innerText.replace(/\s+/g, " ").trim(), tip: t.title })));
    const ideation = tiles.find((t) => t.text === "아이디에이션");
    check(!!ideation, "the tile shows its name and nothing else");
    check(ideation && ideation.tip.startsWith("글쓰기 소재 등"),
      "and carries its description in the hover tooltip", ideation ? ` ("${ideation.tip.split("\n")[0]}")` : "");
    const plan = tiles.find((t) => t.text === "학습 계획");
    check(plan && !plan.tip.includes("\n") === false || (plan && plan.tip.length > 0),
      "a card with no description still explains how to use it");
    // 가드레일 카드는 설명을 그대로 보여준다 / a guardrail tile still shows its description inline
    await dragTileToBoard(page, "학습 계획", 0.15, 0.12);
    await page.getByRole("button", { name: /다음/ }).click();
    await page.waitForSelector("text=시스템이 어떻게 개입하나요?", { timeout: 30000 });
    const guardTile = await page.evaluate(() => {
      const d = [...document.querySelectorAll("div")].filter((x) => getComputedStyle(x).cursor === "grab")
        .find((x) => x.innerText.includes("규칙 상기"));
      return d ? d.innerText.replace(/\s+/g, " ").trim() : null;
    });
    check(guardTile && guardTile.includes("표출"), "a guardrail tile still reads its description inline",
      ` ("${String(guardTile).slice(0, 40)}")`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- toolbar, edit button, ghost
  console.log("\nboth steps share one toolbar; a tag says how to rename it");
  {
    const { page, errors } = await boot(browser, { width: 1700, height: 1000 });
    const tools = () => page.evaluate(() => [...document.querySelectorAll("button")]
      .map((b) => b.textContent.trim()).filter(Boolean));
    await toStep1(page, "TB1");
    const step1 = await tools();
    for (const label of ["↗ 화살표", "펜", "✎ 메모", "↩", "초기화"])
      check(step1.some((t) => t === label), `step 1 has ${label}`, ` (${JSON.stringify(step1.slice(0, 12))})`);
    check(step1.some((t) => t.includes("다음")), "and 다음, not 제출");
    check(!step1.some((t) => t === "제출"), "step 1 does not offer 제출");

    await dragTileToBoard(page, "학습 계획", 0.3, 0.25);
    await page.getByRole("button", { name: /다음/ }).click();
    await page.waitForSelector("text=시스템이 어떻게 개입하나요?", { timeout: 30000 });
    const step2 = await tools();
    for (const label of ["↗ 화살표", "펜", "✎ 메모", "↩", "초기화"])
      check(step2.some((t) => t === label), `step 2 keeps ${label}`);
    check(step2.some((t) => t === "제출"), "and offers 제출, which can be pressed more than once");

    // 태그의 ✎ 는 이름 칸에 커서를 넣는다 / the ✎ puts the caret in the label. autoFocus cannot
    // do this: the input is already mounted, so the flag re-renders and focuses nothing.
    // ✎ 는 없앴다 / no edit button any more: clicking the label edits and dragging anywhere
    // else moves. That only became true once raiseCard stopped recreating the node under the
    // pointer — before it, the label of a card that was not already frontmost swallowed the
    // first click, which is why the button existed at all.
    const chevron = await page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const c = [...layer.children].find((x) => x.getAttribute && x.getAttribute("data-obj") === "card");
      const r = c.getBoundingClientRect(); const i = c.querySelector("input").getBoundingClientRect();
      return { left: c.style.left, tx: i.x + 24, ty: i.y + i.height / 2, mx: r.x + 26, my: r.y + r.height / 2,
               edit: [...c.querySelectorAll("button")].some((b) => b.textContent.trim() === "✎") };
    });
    check(!chevron.edit, "the tag carries no edit button");
    await page.mouse.move(chevron.tx, chevron.ty);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(250);
    check(await page.evaluate(() => document.activeElement.tagName) === "INPUT",
      "clicking the label edits it");
    await page.keyboard.type("고친 이름");
    await page.waitForTimeout(250);
    await page.mouse.move(chevron.mx, chevron.my);
    await page.mouse.down();
    await page.mouse.move(chevron.mx + 70, chevron.my + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    check(await page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...layer.children].find((x) => x.getAttribute && x.getAttribute("data-obj") === "card").style.left;
    }) !== chevron.left, "and dragging anywhere else moves it");

    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- small screens
  console.log("\nthe layout holds together on a small screen");
  {
    for (const [w, h, maxBar] of [[1440, 900, 60], [1280, 800, 60], [1024, 768, 60]]) {
      const { page, errors } = await boot(browser, { width: w, height: h });
      await toStep1(page, "SM" + w);
      const m = await page.evaluate(() => {
        const bar = [...document.querySelectorAll("div")]
          .find((d) => d.style.flexWrap === "wrap" && d.textContent.includes("초기화"));
        const canvas = document.querySelector('div[style*="radial-gradient"]');
        const panel = [...document.querySelectorAll("div")]
          .find((d) => /^0 0 \d{3}px$/.test(d.style.flex || ""));
        return {
          bar: bar ? Math.round(bar.getBoundingClientRect().height) : -1,
          panel: panel ? Math.round(panel.getBoundingClientRect().width) : -1,
          board: canvas ? Math.round(canvas.getBoundingClientRect().width) : -1
        };
      });
      // 툴바가 두 줄로 접히면 보드가 그만큼 줄어든다 / a wrapped toolbar eats board height
      check(m.bar > 0 && m.bar <= maxBar, `${w}px: the toolbar stays one row`, ` (${m.bar}px)`);
      // 좁을수록 패널이 보드를 잡아먹던 문제 / the fixed panel used to take half a small screen
      check(m.board > m.panel, `${w}px: the board is wider than the panel`,
        ` (board ${m.board} vs panel ${m.panel})`);
      check(errors.length === 0, `${w}px: no console errors`, errors.length ? ` (${errors[0]})` : "");
      await page.close();
    }
  }

  // ------------------------------------------------- marquee picks the right notes
  // 마퀴 사각형 자체가 메모로 세어졌다 / the marquee rectangle was itself counted as a note.
  // The layer's DIV children were split by "has an <input> → card, otherwise note", but the
  // layer also holds the sensemaking region box and the marquee — and the marquee exists
  // ONLY while dragging, so notes shifted by one exactly during a marquee drag and note i
  // was tested against note i-1's rectangle. Seeded rather than clicked, because creating
  // notes by synthetic click is flaky and this is about geometry, not the note tool.
  console.log("\nthe marquee selects the notes it actually covers");
  {
    const { page, errors } = await boot(browser, { width: 1600, height: 1000 });
    await page.evaluate(() => localStorage.setItem("llm-guardrail-workshop-v4:MQ", JSON.stringify({
      savedAt: Date.now(), pid: "MQ", step: 2, lang: "ko", rules: [],
      cards: [], strokes: [], arrows: [], seq: 9, panelW: 378,
      notes: [{ id: "n1", x: 60, y: 60, text: "IN-A" }, { id: "n2", x: 60, y: 200, text: "IN-B" },
              { id: "n3", x: 1500, y: 1200, text: "FAR" }]
    })));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "MQ");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1200);
    const read = () => page.evaluate(() => [...document.querySelectorAll('[data-obj="note"]')]
      .map((n) => ({ t: n.querySelector("textarea").value, sel: !!(n.style.outline && n.style.outline !== "none") })));
    check((await read()).length === 3, "three notes restored");
    const box = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + 20 + 70 * i, box.y + 20 + 62 * i); await page.waitForTimeout(45); }
    await page.mouse.up();
    await page.waitForTimeout(350);
    const sel = (await read()).filter((n) => n.sel).map((n) => n.t);
    check(sel.includes("IN-A") && sel.includes("IN-B"), "both notes under the marquee are selected", ` (${JSON.stringify(sel)})`);
    check(!sel.includes("FAR"), "and a note far outside it is not");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- the tab row is pinned
  console.log("\nthe 규칙 / 가드레일 tabs stay put while the decks scroll");
  {
    const { page, errors } = await boot(browser, { width: 1600, height: 1000 });
    await toBoard(page, "TAB");
    const top = () => page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "가드레일");
      return b ? Math.round(b.getBoundingClientRect().top) : -1;
    });
    const before = await top();
    const scrolled = await page.evaluate(() => {
      const sc = [...document.querySelectorAll("div")]
        .find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight + 50);
      if (!sc) return -1;
      sc.scrollTop = 1200;
      return sc.scrollTop;
    });
    await page.waitForTimeout(300);
    check(scrolled > 0, "the deck list scrolls", ` (scrollTop ${scrolled})`);
    check(before > 0 && before === (await top()), "and the tab row does not move", ` (${before} → ${await top()})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- old records get the new design
  // 기록에는 데이터만 들어 있고 모양은 앱이 준다 / a record holds data, never styling, so an
  // old board is redrawn by whatever the app looks like today. This pins that down, and
  // covers the awkward parts: geometry saved under the old sizes, and a card whose deck
  // no longer exists.
  console.log("\nan old record is redrawn in the current design");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 900 });
    await page.evaluate(() => localStorage.setItem("llm-guardrail-workshop-v4:OLDREC", JSON.stringify({
      savedAt: Date.now(), pid: "OLDREC", step: 2, lang: "ko", seq: 20, panelW: 566,
      rules: [{ id: "r0", cat: "a", title: "옛 규칙", desc: "…", sel: true }],
      cards: [
        { id: "c1", type: "act", title: "첫 학습", desc: "옛 설명", dia: null, x: 120, y: 120, w: 352, h: 50 },
        { id: "c2", type: "means", title: "AI 사용", desc: "옛 설명", dia: null, x: 120, y: 260, w: 168, h: 96 },
        { id: "c3", type: "rule", title: "번역은 직접", desc: "은퇴한 덱", dia: null, x: 120, y: 420, w: 168, h: 168 },
        { id: "c4", type: "con", title: "규칙 상기", desc: "규칙을 시스템에 표출시켜서 상기시킨다",
          dia: "h_remind", x: 520, y: 260, w: 168, h: 168 }
      ],
      notes: [{ id: "n1", x: 520, y: 120, text: "옛 메모" }], arrows: [], strokes: []
    })));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "OLDREC");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(1500);
    const objs = await page.evaluate(() => [...document.querySelectorAll('[data-obj="card"]')].map((c) => {
      const r = c.getBoundingClientRect(); const i = c.querySelector("input"); const bar = c.firstElementChild;
      return { t: i ? i.value : "?", h: Math.round(r.height),
               chip: !!(bar && getComputedStyle(bar).width === "9px"),
               badge: getComputedStyle(c).borderTopColor };
    }));
    const by = (t) => objs.find((o) => o.t === t);
    check(objs.length === 4, "every card in the old record is drawn", ` (${objs.length})`);
    // 저장된 높이는 50 이었다 / it was saved at the old 50px height and is redrawn at 62
    check(by("첫 학습") && by("첫 학습").h === 62, "the tag is redrawn at the current height",
      ` (${by("첫 학습") && by("첫 학습").h})`);
    check(by("AI 사용") && by("AI 사용").chip && by("AI 사용").h === 38,
      "the 수단 is redrawn as the chip, not the pill it was saved as");
    // 은퇴한 덱의 카드도 카드처럼 보여야 한다 / a card from a retired deck still looks like one
    check(!!by("번역은 직접"), "a card whose deck no longer exists still renders");
    check(errors.length === 0, "and nothing throws", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- a failing endpoint stays quiet
  // Apps Script 가 오류 페이지를 돌려주면 / when the endpoint answers with an HTML error page,
  // the injected JSONP script throws. Cross-origin that is an opaque "Script error." with no
  // file, and it surfaced as a banner on the board even though the request had already
  // timed out to null and the session was fine.
  console.log("\na failing sync endpoint does not look like a broken app");
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.route("**/macros/s/**", (r) => r.fulfill({
      status: 200, contentType: "text/html",
      body: "<!DOCTYPE html><html><body>Sorry, unable to open the file.</body></html>"
    }));
    await page.goto(APP, { waitUntil: "load", timeout: 120000 });
    await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await page.fill('input[placeholder="P0000"]', "JPX");
    await page.getByText("시작하기", { exact: false }).click();
    await page.waitForTimeout(2500);
    check(errors.length === 0, "the page reports no error", errors.length ? ` (${errors[0]})` : "");
    check(await page.evaluate(() => !!document.body.innerText.match(/무엇을 하나요/)),
      "and the board opens anyway");
    check((await page.evaluate(() => {
      const m = document.body.innerText.match(/오프라인|저장됨|저장 중|연결됨|불러오는 중/);
      return m ? m[0] : "?";
    })) === "오프라인", "with the indicator saying offline, not stuck on loading");
    await page.close();

    // 진짜 오류는 그대로 드러나야 한다 / a real error must still surface, or this is a gag
    const p2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const e2 = [];
    p2.on("pageerror", (e) => e2.push(e.message));
    await p2.route("**/macros/s/**", (r) => r.fulfill({ status: 200, body: "{}" }));
    await p2.goto(APP, { waitUntil: "load", timeout: 120000 });
    await p2.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
    await p2.evaluate(() => { setTimeout(() => { throw new Error("a real bug in the app"); }, 10); });
    await p2.waitForTimeout(600);
    check(e2.some((m) => m.includes("a real bug in the app")),
      "while a real error is still reported", ` (${e2.length})`);
    await p2.close();
  }

  // ------------------------------------------------- horizontal panning with a mouse
  // 마우스 휠에는 가로축이 없다 / a mouse wheel has no horizontal axis — only a trackpad sends
  // deltaX — so without this the board could only be panned up and down with a mouse.
  console.log("\nshift+wheel pans sideways, for a mouse with no horizontal axis");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 900 });
    await toStep1(page, "HSC");
    const box = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const pan = () => page.evaluate(() => {
      const layer = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const m = layer.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return m ? { x: +m[1], y: +m[2] } : null;
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    let a = await pan();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(200);
    let b = await pan();
    check(b.y !== a.y && b.x === a.x, "a plain wheel pans vertically only", ` (${JSON.stringify(b)})`);

    a = await pan();
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(200);
    b = await pan();
    check(b.x !== a.x && b.y === a.y, "shift+wheel pans horizontally only", ` (${JSON.stringify(b)})`);

    a = await pan();
    await page.mouse.wheel(150, 0);
    await page.waitForTimeout(200);
    b = await pan();
    check(b.x !== a.x && b.y === a.y, "a trackpad's sideways swipe is unaffected");

    // 브라우저가 이미 축을 바꿔 보내는 경우 / some browsers convert shift+wheel to deltaX
    // themselves; swapping again would cancel the two out
    a = await pan();
    await page.evaluate(() => {
      document.querySelector('div[style*="radial-gradient"]').dispatchEvent(
        new WheelEvent("wheel", { deltaX: 150, deltaY: 0, shiftKey: true, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    b = await pan();
    check(Math.abs((b.x - a.x) + 150) < 1, "and a browser that already swapped it is not swapped twice",
      ` (moved ${Math.round(b.x - a.x)})`);
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- drawing left of the origin
  console.log("\nink drawn left of the board origin is actually painted");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 900 });
    await toStep1(page, "NEG");
    const box = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    // 오른쪽으로 밀어 음수 좌표를 화면에 들인다 / pan right so negative board x is on screen
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 600, box.y + 300, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "펜", exact: true }).click();
    await page.waitForTimeout(250);
    await page.mouse.move(box.x + 40, box.y + 400);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + 40 + 18 * i, box.y + 400 + 10 * i); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const ink = await page.evaluate(() => {
      const l = document.querySelector("polyline");
      if (!l) return null;
      const xs = l.getAttribute("points").split(" ").map(Number).filter((_, i) => i % 2 === 0);
      const svg = l.closest("svg");
      const r = l.getBoundingClientRect();
      return { minX: Math.min(...xs), overflow: getComputedStyle(svg).overflow,
               onScreen: r.width > 0 && r.right > 0 && r.left < innerWidth };
    });
    check(ink && ink.minX < 0, "the stroke really is left of the origin", ink ? ` (minX ${ink.minX})` : "");
    // 이 검사가 핵심 / this is the check that matters: the stroke was in the DOM all along,
    // it was the layer's clip that made it invisible
    check(ink && ink.overflow === "visible", "the layer does not clip it away", ink ? ` (${ink.overflow})` : "");
    check(ink && ink.onScreen, "and it lands inside the viewport");
    // 픽셀로 확인한다 / prove it by pixels, not by the DOM. The polyline was in the DOM
    // all along while nothing was drawn, so presence proves nothing: shoot the region,
    // force the clip back on, shoot again, and require the two images to differ.
    const clip = { x: box.x + 20, y: box.y + 380, width: 200, height: 140 };
    const painted = await page.screenshot({ clip });
    await page.evaluate(() => { document.querySelector("polyline").closest("svg").style.overflow = "hidden"; });
    await page.waitForTimeout(120);
    const clipped = await page.screenshot({ clip });
    check(!painted.equals(clipped), "the ink is really on the pixels, not just in the DOM");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- the analysis layer's own tools
  // 관리자는 참여자와 같은 도구로 해석한다 / the admin analyses with the participant's own
  // tools. What this section pins down is the line between the two layers: the admin can
  // build freely, and none of it may touch or resemble the participant's own work.
  console.log("\nanalysis mode: the admin's own board on top of the participant's");
  {
    const EP = "https://script.google.com/macros/s/FAKE/exec";
    const board = {
      savedAt: Date.now(), pid: "P9", step: 2, lang: "ko", rules: [],
      cards: [{ id: "c1", type: "act", title: "P-STEP", desc: "", dia: null, collapsed: false, w: 352, x: 200, y: 200 },
              { id: "c2", type: "when", title: "P-B", desc: "b", dia: "w_during", collapsed: false, x: 200, y: 320 }],
      notes: [{ id: "n1", x: 200, y: 560, text: "참여자 메모" }], arrows: [], seq: 5, panelW: 566,
    };
    const posted = [];
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/macros/s/**", async (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") {
        try { posted.push(JSON.parse(route.request().postData() || "{}")); } catch (e) {}
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
    await page.waitForTimeout(1000);
    await page.getByText("P9", { exact: true }).first().click();
    await page.waitForTimeout(1400);

    const objs = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj]')].map((c) => {
        const r = c.getBoundingClientRect();
        return { obj: c.dataset.obj, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
      });
    });
    const notes = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="note"]')].map((c) => {
        const ta = c.querySelector("textarea");
        const r = c.getBoundingClientRect();
        return {
          bg: getComputedStyle(c).backgroundColor, ring: c.style.boxShadow,
          mono: ta ? /mono/.test(getComputedStyle(ta).fontFamily) : null,
          ov: ta ? getComputedStyle(ta).overflowY : null,
          grow: ta ? !ta.className.includes("nogrow") : null,
          sizer: !!c.querySelector('div[title*="크기"]'),
          w: Math.round(r.width), h: Math.round(r.height),
        };
      });
    });

    // 1. 참여자 것을 하나만 복제 / copy ONE participant object, not the whole board
    check(await page.evaluate(() => document.body.innerText.includes("학습 계획")),
      "the card panel is open in analysis mode");
    let o = await objs();
    check(o.length === 3, "the participant's board loaded", ` (${o.length})`);
    await page.mouse.click(o[1].x + o[1].w / 2, o[1].y + 8);   // the act tag
    await page.waitForTimeout(300);
    await page.getByText("선택 복제", { exact: true }).click();
    await page.waitForTimeout(700);
    o = await objs();
    check(o.length === 4, "one selected participant object can be copied on its own", ` (${o.length})`);

    // 2. 덱 접기 / the deck folds away and comes back, and the board takes the space
    const boardW = async () => (await (await page.$('div[style*="radial-gradient"]')).boundingBox()).width;
    const wOpen = await boardW();
    await page.getByText("덱 접기", { exact: true }).click();
    await page.waitForTimeout(400);
    check(!(await page.evaluate(() => document.body.innerText.includes("아이디에이션"))),
      "the deck folds away in analysis mode");
    check((await boardW()) > wOpen + 200, "and the board takes the width it left",
      ` (${Math.round(wOpen)} -> ${Math.round(await boardW())})`);
    await page.getByText("덱 펼치기", { exact: true }).click();
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.body.innerText.includes("아이디에이션")), "and comes back");

    // 3. 덱에서 새 카드 / a brand-new card dragged in during analysis
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    await dragTileToBoard(page, "학습 계획", 0.74, 0.30);
    o = await objs();
    check(o.length === 5, "and a new card can be dragged in from the deck", ` (${o.length})`);

    // 4. 전사 메모 / the transcription note is a different animal from the memo
    await page.getByText("✎ 전사", { exact: true }).click();
    await page.waitForTimeout(200);
    await page.mouse.click(cb.x + cb.width * 0.55, cb.y + cb.height * 0.62);
    await page.waitForTimeout(500);
    let ns = await notes();
    const tx = ns[ns.length - 1], own = ns[0];
    check(ns.length === 2, "a transcription note is created", ` (${ns.length})`);
    check(tx.bg === "rgb(238, 241, 246)", "it has its own ground, not the memo's", ` (${tx.bg})`);
    check(tx.bg !== own.bg, "and not the participant's either");
    check(/oklch\(0\.52/.test(tx.ring), "ringed in the transcript ink", ` (${tx.ring})`);
    check(tx.mono === true, "and set in mono, so transcript reads as quotation");
    check(tx.sizer === true, "an analysis note carries a resize grip");
    check(own.sizer === false, "a participant's note does not");

    // 5. 크기 조절 / resizing, and the scroll that has to come with it
    const before = { w: tx.w, h: tx.h };
    const box = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...L.querySelectorAll(':scope > [data-obj="note"]')].pop();
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.move(box.x + box.w - 5, box.y + box.h - 5);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.move(box.x + box.w + 120, box.y + box.h + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    ns = await notes();
    const sized = ns[ns.length - 1];
    check(sized.w > before.w + 60 && sized.h > before.h + 40,
      "it resizes in both directions", ` (${before.w}x${before.h} -> ${sized.w}x${sized.h})`);
    check(sized.ov === "auto", "and scrolls once it is sized rather than clipping");
    check(sized.grow === false, "the auto-grow is switched off, so the size sticks");

    // 6. 단계에 매단 메모 / a note hung off a step, and the line that says so
    await page.keyboard.down("Alt");
    await page.mouse.move(cb.x + cb.width * 0.6, cb.y + 60);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width * 0.6 - 520, cb.y + 60, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(400);
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button[title]")].filter((x) => /단계에 전사/.test(x.title));
      const vis = b.map((x) => x.getBoundingClientRect())
        .filter((r) => r.x > 0 && r.right < innerWidth && r.y > 0 && r.bottom < innerHeight);
      return { total: b.length, x: vis.length ? vis[0].x + vis[0].width / 2 : 0, y: vis.length ? vis[0].y + vis[0].height / 2 : 0, vis: vis.length };
    });
    check(btn.total === 2, "the note button is on both analysis tags", ` (${btn.total})`);
    check(await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const first = [...L.querySelectorAll(':scope > [data-obj="card"]')][0];
      return ![...first.querySelectorAll("button[title]")].some((x) => /단계에 전사/.test(x.title));
    }), "and never on the participant's own tag");
    await page.mouse.click(btn.x, btn.y);
    await page.waitForTimeout(600);
    const leader = () => page.evaluate(() => [...document.querySelectorAll("line")]
      .filter((l) => /oklch\(0\.52/.test(l.getAttribute("stroke") || ""))
      .map((l) => ({ x1: +l.getAttribute("x1"), y1: +l.getAttribute("y1"), x2: +l.getAttribute("x2"), y2: +l.getAttribute("y2") })));
    const l1 = await leader();
    check(l1.length === 1, "pressing it draws exactly one leader line", ` (${l1.length})`);

    // 선이 실제로 칠해지는지 픽셀로 / prove the line is painted, not merely in the DOM —
    // the SVG-clip bug taught that a present element proves nothing
    const clip = { x: Math.max(0, btn.x - 40), y: Math.max(0, btn.y - 40), width: 240, height: 120 };
    const withLine = await page.screenshot({ clip });
    await page.evaluate(() => { document.querySelectorAll("line").forEach((l) => { if (/oklch\(0\.52/.test(l.getAttribute("stroke") || "")) l.style.display = "none"; }); });
    await page.waitForTimeout(120);
    const withoutLine = await page.screenshot({ clip });
    check(!withLine.equals(withoutLine), "and the line is really on the pixels");
    await page.evaluate(() => { document.querySelectorAll("line").forEach((l) => { l.style.display = ""; }); });

    // 7. 붙는 자리가 메모 위치를 따라간다 / the tag-side end follows the note around
    const nb = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const el = [...L.querySelectorAll(':scope > [data-obj="note"]')].pop();
      const r = el.getBoundingClientRect();
      return { x: r.x + 4, y: r.y + r.height / 2 };
    });
    await page.mouse.move(nb.x, nb.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.move(nb.x - 620, nb.y + 40, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const l2 = await leader();
    check(l2.length === 1 && Math.abs(l2[0].x1 - l1[0].x1) > 100,
      "moving the note moves where the line leaves the tag",
      ` (${l1[0] && Math.round(l1[0].x1)} -> ${l2[0] && Math.round(l2[0].x1)})`);

    // 8. 서버에 남는다 / all of it belongs to the sm: record and nothing else
    await page.waitForTimeout(2400);
    const sm = posted.filter((b) => b.kind === "sensemaking");
    check(sm.length > 0 && sm.every((b) => b.participant === "sm:P9"),
      "every write goes to sm:P9", ` (${JSON.stringify(sm.map((b) => b.participant).slice(0, 3))})`);
    const state = sm[sm.length - 1].payload.state;
    const linked = state.notes.find((n) => n.link);
    check(!!linked, "the link is saved");
    check(linked && linked.kind === "tx", "as a transcription note");
    check(state.notes.some((n) => n.manual && n.w && n.h), "and the hand-set size is saved too");
    check(state.notes.every((n) => n.sm) && state.cards.every((c) => c.sm),
      "with nothing of the participant's mixed in");
    check(!state.notes.some((n) => n.text === "참여자 메모"), "their own note is not in the analysis record");
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
