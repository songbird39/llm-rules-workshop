// 스위트 2/3 / middle third of the browser suite. Run it through e2e.js, not directly.
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
      // 저장된 해석 기록을 그대로 돌려준다 / hand the saved analysis record back, so the
      // section can reload into it and check what actually survives a round trip
      if (who && who.indexOf("sm:") === 0) {
        const last = posted.filter((b) => b.kind === "sensemaking").pop();
        return reply({ ok: true, state: last ? last.payload.state : null });
      }
      return reply({ ok: true, rows: 0 });
    });
    const login = async () => {
      await page.goto(APP + "?sync=" + encodeURIComponent(EP), { waitUntil: "load", timeout: 120000 });
      await page.waitForSelector('input[placeholder="P0000"]', { timeout: 120000 });
      await page.fill('input[placeholder="P0000"]', "admin");
      await page.getByText("시작하기", { exact: false }).click();
      await page.waitForTimeout(1000);
      await page.getByText("P9", { exact: true }).first().click();
      await page.waitForTimeout(1500);
    };
    await login();

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
    // 뒤로 가는 길은 하나 / one way back, top left. There used to be two, and the second
    // sat in a row of export buttons where nothing else navigated anywhere.
    const backs = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((x) => /← 목록/.test(x.textContent)).map((x) => Math.round(x.getBoundingClientRect().x)));
    check(backs.length === 1, "there is exactly one way back to the list", ` (${backs.length})`);
    check(backs[0] < 120, "and it is the top-left button", ` (x=${backs[0]})`);
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
    // 접기는 덱 자기 탭에 붙어 있다 / the fold is on the deck's own tab row, not adrift in
    // the toolbar, and folding leaves a spine where the panel was
    const foldBtn = () => page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.title === "덱 접기");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const f = await foldBtn();
    check(f !== null, "the fold control sits on the deck's tab row");
    const tabs = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.title === "덱 접기");
      return [...b.parentElement.querySelectorAll("button")].map((x) => x.textContent.trim());
    });
    check(tabs.length === 3 && tabs[0] === "규칙" && tabs[1] === "가드레일",
      "beside the two deck tabs", ` (${JSON.stringify(tabs)})`);
    await page.mouse.click(f.x, f.y);
    await page.waitForTimeout(400);
    check(!(await page.evaluate(() => document.body.innerText.includes("아이디에이션"))),
      "pressing it folds the deck away");
    check((await boardW()) > wOpen + 200, "and the board takes the width it left",
      ` (${Math.round(wOpen)} -> ${Math.round(await boardW())})`);
    const spine = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.title === "덱 펼치기");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
    });
    check(spine !== null && spine.w < 40, "a narrow spine is left where the panel was",
      spine ? ` (${Math.round(spine.w)}px)` : "");
    await page.mouse.click(spine.x, spine.y);
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.body.innerText.includes("아이디에이션")), "and it brings the deck back");

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
    // 메모가 태그 위에 생기므로 선도 위쪽에 있다 / the note lands ABOVE the tag now, so the
    // line is above the button too — clip around the line's own midpoint instead
    const mid = { x: (l1[0].x1 + l1[0].x2) / 2, y: (l1[0].y1 + l1[0].y2) / 2 };
    const box0 = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const scale = await page.evaluate(() => {
      const r = document.querySelector("div[style*='zoom']");
      return r ? parseFloat(getComputedStyle(r).zoom) : 1;
    });
    const layerOrigin = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const r = L.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const sx = layerOrigin.x + mid.x * scale, sy = layerOrigin.y + mid.y * scale;
    const clip = { x: Math.max(0, sx - 60), y: Math.max(0, sy - 60), width: 120, height: 120 };
    void box0;
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
    // 기본은 태그 위 → 아래로 끌어내리면 선이 반대쪽 모서리에서 나가야 한다
    // It starts above the tag, so drag it well BELOW: the line must then leave from the
    // other edge entirely, which is the whole point of computing the anchor each frame.
    check(l1[0].y1 > l1[0].y2, "the line starts by leaving the tag's top edge",
      ` (y1 ${Math.round(l1[0].y1)} > y2 ${Math.round(l1[0].y2)})`);
    await page.mouse.move(nb.x + 120, nb.y + 430, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const l2 = await leader();
    check(l2.length === 1 && l2[0].y1 < l2[0].y2,
      "dragging it below flips the anchor to the bottom edge",
      ` (y1 ${l2[0] && Math.round(l2[0].y1)} vs y2 ${l2[0] && Math.round(l2[0].y2)})`);
    check(l2.length === 1 && Math.abs(l2[0].y1 - l1[0].y1) > 30,
      "so the line leaves from somewhere new", ` (${Math.round(l1[0].y1)} -> ${l2[0] && Math.round(l2[0].y1)})`);

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

    // 9. 펜 자국도 저장된다 / the ink is saved too. It was not: the pen has been on offer in
    // this layer the whole time while pushSense wrote no strokes at all, so it was the one
    // thing on the board that did not survive a reload.
    await page.getByRole("button", { name: "펜", exact: true }).click();
    await page.waitForTimeout(200);
    await page.mouse.move(cb.x + 120, cb.y + cb.height * 0.8);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(cb.x + 120 + i * 26, cb.y + cb.height * 0.8 + i * 9); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.getByRole("button", { name: "펜", exact: true }).click();
    await page.waitForTimeout(2600);
    const withInk = posted.filter((b) => b.kind === "sensemaking").pop().payload.state;
    check((withInk.strokes || []).length === 1, "a pen stroke reaches the record",
      ` (${(withInk.strokes || []).length})`);
    check((withInk.strokes || []).every((k) => k.sm), "flagged as analysis ink");

    // 10. 다시 열면 전부 돌아온다 / everything comes back on the next visit
    const shape = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const ns = [...L.querySelectorAll(':scope > [data-obj="note"]')];
      return {
        cards: [...L.querySelectorAll(':scope > [data-obj="card"]')].length,
        notes: ns.length,
        ink: document.querySelectorAll("polyline").length,
        leaders: [...document.querySelectorAll("line")].filter((l) => /oklch\(0\.52/.test(l.getAttribute("stroke") || "")).length,
        italic: [...L.querySelectorAll('[data-obj="card"] input, [data-obj="card"] textarea')]
          .filter((e) => getComputedStyle(e).fontStyle === "italic").length,
        mono: [...L.querySelectorAll(':scope > [data-obj="note"] textarea')]
          .filter((t) => /mono/.test(getComputedStyle(t).fontFamily)).length,
        widest: Math.max(...ns.map((n) => Math.round(n.getBoundingClientRect().width))),
      };
    });
    const beforeReload = await shape();
    await login();
    const afterReload = await shape();
    check(JSON.stringify(afterReload) === JSON.stringify(beforeReload),
      "the board comes back exactly as it was left",
      ` (${JSON.stringify(beforeReload)} vs ${JSON.stringify(afterReload)})`);
    check(afterReload.ink === beforeReload.ink && afterReload.ink > 0, "including the ink");
    check(afterReload.leaders === 1, "including the leader line");
    check(afterReload.widest > 250, "and the hand-set note size");

    // 11. 한도를 넘으면 조용히 실패하지 않는다 / past the cell ceiling it must SAY so. The POST
    // is no-cors, so nothing else would ever tell the admin their transcript stopped
    // being saved.
    const nPosts = posted.filter((b) => b.kind === "sensemaking").length;
    await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const ta = [...L.querySelectorAll(':scope > [data-obj="note"] textarea')].pop();
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(ta, "가".repeat(60000));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(2600);
    check(posted.filter((b) => b.kind === "sensemaking").length === nPosts,
      "an oversized record is not posted at all",
      ` (${posted.filter((b) => b.kind === "sensemaking").length - nPosts} extra)`);
    check(await page.evaluate(() => document.body.innerText.includes("저장되지 않았습니다")),
      "and the admin is told so, in a banner they cannot miss");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

  // ------------------------------------------------- dragging one note among several
  // 집어 올리면 순서가 바뀐다 / picking an object up raises it to the end of the list. The
  // engine re-uses the DOM nodes in place, so the inline heights autoGrow wrote stay
  // behind on whatever node is now showing a different note — and componentDidUpdate used
  // to skip autoGrow for the whole drag, so every note on the board wore somebody else's
  // height until you let go.
  console.log("\ndragging one note does not resize the others");
  {
    const { page, errors } = await boot(browser, { width: 1500, height: 950 });
    await toStep1(page, "NDR");
    const cb = await (await page.$('div[style*="radial-gradient"]')).boundingBox();
    const mk = async (fx, fy, text) => {
      await page.getByRole("button", { name: /메모/ }).first().click();
      await page.waitForTimeout(150);
      await page.mouse.click(cb.x + cb.width * fx, cb.y + cb.height * fy);
      await page.waitForTimeout(350);
      // autoFocus 를 믿지 않는다 / do not trust autoFocus here: it leaves the caret nowhere
      // and the typing goes to the document, which is how this check first "passed" with
      // three empty notes
      await page.evaluate(() => {
        const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
        [...L.querySelectorAll(':scope > [data-obj="note"]')].pop().querySelector("textarea").focus();
      });
      await page.keyboard.type(text);
      await page.waitForTimeout(300);
    };
    await mk(0.12, 0.55, "짧은 메모");
    await mk(0.42, 0.55, "아주 긴 메모입니다.\n두 번째 줄\n세 번째 줄\n네 번째 줄");
    await mk(0.70, 0.55, "가운데 메모");

    const snap = () => page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      return [...L.querySelectorAll(':scope > [data-obj="note"]')].map((n) => ({
        lines: (n.querySelector("textarea").value.match(/\n/g) || []).length + 1,
        h: Math.round(n.getBoundingClientRect().height),
      }));
    });
    const before = await snap();
    check(before.length === 3, "three notes on the board", ` (${before.length})`);
    const tall = before.find((n) => n.lines === 4), small = before.find((n) => n.lines === 1);
    check(tall && small && tall.h > small.h + 15, "the four-line note is visibly taller",
      ` (${small && small.h} vs ${tall && tall.h})`);

    // 첫 번째 메모를 왼쪽 여백으로 잡는다 / grab the first note by its left padding strip
    const grab = await page.evaluate(() => {
      const L = [...document.querySelectorAll("div")].find((d) => d.style.width === "5000px");
      const r = [...L.querySelectorAll(':scope > [data-obj="note"]')][0].getBoundingClientRect();
      return { x: r.x + 3, y: r.y + r.height / 2 };
    });
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    const bad = [];
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(grab.x + i * 26, grab.y + i * 12);
      await page.waitForTimeout(70);
      // 줄 수와 높이가 프레임마다 맞아야 한다 / every frame, each note's height must still
      // match its OWN text: one line short, four lines tall
      const f = await snap();
      if (f.some((n) => (n.lines === 4) !== (n.h > small.h + 15))) bad.push(f.map((n) => `${n.lines}:${n.h}`));
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    check(bad.length === 0, "no note takes another's height mid-drag",
      bad.length ? ` (${JSON.stringify(bad[0])})` : "");
    const after = await snap();
    check(after.every((n) => (n.lines === 4) === (n.h > small.h + 15)), "and they are right when it ends");
    check(errors.length === 0, "no console errors", errors.length ? ` (${errors[0]})` : "");
    await page.close();
  }

};
