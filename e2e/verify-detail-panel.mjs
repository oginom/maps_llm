import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3107";
const origin = new URL(baseURL).origin;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname));
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = `${root}docs/img/detail-panel`;
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.E2E_CHROMIUM_PATH,
});
const results = [];
const audits = [];
const viewports = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};
async function visibleInside(page, selector) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2,
        cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        width: r.width,
        height: r.height,
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        viewport: [innerWidth, innerHeight],
        hit: el === hit || el.contains(hit),
      };
    }),
  );
  assert.ok(boxes.length);
  for (const b of boxes) {
    assert.ok(
      b.width > 0 &&
        b.height > 0 &&
        b.x >= 0 &&
        b.y >= 0 &&
        b.right <= b.viewport[0] + 1 &&
        b.bottom <= b.viewport[1] + 1,
      JSON.stringify(b),
    );
    assert.ok(b.hit, `Covered: ${selector} ${JSON.stringify(b)}`);
  }
}
async function done(page) {
  await page.waitForFunction(
    () =>
      /口コミ取得対象/.test(
        document.querySelector('[role="status"]').textContent,
      ) &&
      !/評価中|検索中/.test(
        document.querySelector('[role="status"]').textContent,
      ),
  );
}
async function height(page, name) {
  for (let i = 0; i < 3; i++) {
    if (
      (await page.locator("aside").getAttribute("data-sheet-height")) === name
    )
      return;
    await page.locator("[data-sheet-handle]").click();
  }
  assert.equal(
    await page.locator("aside").getAttribute("data-sheet-height"),
    name,
  );
}
async function drag(page, delta) {
  const b = await page.locator("[data-sheet-handle]").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + delta, {
    steps: 8,
  });
  await page.mouse.up();
}
try {
  for (const [view, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const audit = { view, external: [], unexpectedAPI: [], errors: [] };
    audits.push(audit);
    page.on("pageerror", (e) => audit.errors.push(e.message));
    await context.route("**/*", (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== origin) {
        audit.external.push(url.href);
        return route.abort();
      }
      if (url.pathname === "/api/generate-examples")
        return route.fulfill({
          json: {
            examples: "1:低、5:高",
            searchQuery: req.postDataJSON().searchTerm,
          },
        });
      if (url.pathname === "/api/analyze-reviews") {
        const review = req.postDataJSON().reviews;
        const n = Number(review.split("-").at(-1));
        return route.fulfill({
          json: { value: ((n - 1) % 5) + 1, related_review: review },
        });
      }
      if (url.pathname.startsWith("/api/")) {
        audit.unexpectedAPI.push(url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript({ path: `${root}e2e/maps-mock.js` });
    await page.goto(`${baseURL}/?lat=35.7&lng=139.7&zoom=10`);
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="search"]')?.disabled,
    );
    const shot = async (name) => {
      const path = `${view}-${name}.png`;
      await page.screenshot({ path: `${evidence}/${path}` });
      return `docs/img/detail-panel/${path}`;
    };
    const check = async (scenario, fn) => {
      try {
        const extra = await fn();
        results.push({ view, scenario, result: "OK", ...extra });
      } catch (error) {
        results.push({
          view,
          scenario,
          result: "NG",
          error: error.message,
          screenshot: await shot(`${scenario}-failure`),
        });
      }
      console.log(JSON.stringify(results.at(-1)));
    };
    await page.getByPlaceholder("Enter search term").fill("panel");
    await page.getByRole("button", { name: "search", exact: true }).click();
    await page.waitForFunction(() => window.__mock.details.length === 5);
    await done(page);
    await check("1-initial", async () => {
      assert.equal(await page.locator("[data-result-id]").count(), 12);
      assert.equal(
        await page.locator('ul[aria-label="候補一覧"] > li > button').count(),
        12,
      );
      assert.equal(
        await page.getByRole("status").getAttribute("aria-live"),
        "polite",
      );
      assert.equal(
        await page.locator('[data-fetch-state="evaluated"]').count(),
        5,
      );
      assert.equal(
        await page.locator('[data-fetch-state="unfetched"]').count(),
        7,
      );
      assert.match(
        await page.getByRole("status").textContent(),
        /評価済み 5 件.*追加可能 7 件.*失敗 0 件.*口コミ取得対象 5 件 \/ 最大20件/,
      );
      assert.equal(
        await page
          .locator('[data-place-id]:not([data-color="#ffffff"])')
          .count(),
        5,
      );
      return { screenshot: await shot("initial") };
    });
    await check("2-edge-pin", async () => {
      if (view === "phone") await height(page, "collapsed");
      await page.evaluate(() => {
        const m = window.__mock.markers.find(
          (m) => m.options.position.id === "panel-4",
        );
        m.options.position.x = 0.95;
        m.options.position.y = 0.25;
        m.render();
      });
      await page
        .getByRole("button", { name: "mock pin panel-4", exact: true })
        .click();
      await visibleInside(page, "[data-place-details]");
      await visibleInside(page, '[data-result-id="panel-4"]');
      assert.equal(
        await page
          .locator('[data-result-id="panel-4"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page
          .locator('[data-place-id="panel-4"]')
          .getAttribute("data-selected"),
        "true",
      );
      await page
        .locator("[data-detail-scroll]")
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      await visibleInside(page, "[data-place-details] a");
      return { screenshot: await shot("edge-details") };
    });
    await check("3-offscreen-row", async () => {
      await page.getByRole("button", { name: "一覧に戻る" }).click();
      await page.evaluate(() => {
        const m = window.__mock.markers.find(
          (m) => m.options.position.id === "panel-12",
        );
        m.options.position.x = 1.5;
        m.render();
      });
      await page.locator('[data-result-id="panel-12"]').click();
      await page.waitForFunction(() => window.__mock.pans.includes("panel-12"));
      assert.deepEqual(await page.evaluate(() => window.__mock.pans), [
        "panel-12",
      ]);
      assert.equal(
        await page
          .locator('[data-place-id="panel-12"]')
          .getAttribute("data-selected"),
        "true",
      );
      assert.match(
        await page.locator("[data-place-details]").textContent(),
        /panel 店舗12/,
      );
      return { screenshot: await shot("offscreen-row") };
    });
    await check("4-fetch-and-failure", async () => {
      await page.evaluate(() => (window.__mock.config.fail = ["quota-2"]));
      await page.getByPlaceholder("Enter search term").fill("quota");
      await page.getByRole("button", { name: "search", exact: true }).click();
      await page.waitForFunction(() =>
        window.__mock.details.includes("quota-5"),
      );
      await done(page);
      assert.equal(
        await page
          .locator('[data-result-id="quota-2"]')
          .getAttribute("data-fetch-state"),
        "failed",
      );
      assert.equal(
        await page
          .locator('[data-result-id="quota-12"]')
          .getAttribute("data-fetch-state"),
        "unfetched",
      );
      const screenshots = [];
      for (const size of view === "phone"
        ? ["collapsed", "half", "full"]
        : ["full"]) {
        if (view === "phone") await height(page, size);
        await visibleInside(page, 'aside [role="alert"]');
        await visibleInside(page, 'button:has-text("次の5件を評価")');
        screenshots.push(await shot(`warning-${size}`));
      }
      await page.evaluate(() => (window.__mock.config.holdDetails = true));
      await page.getByRole("button", { name: "次の5件を評価" }).click();
      await page.waitForFunction(() =>
        window.__mock.details.includes("quota-10"),
      );
      assert.equal(
        await page.locator('[data-fetch-state="fetching"]').count(),
        5,
      );
      assert.equal(
        await page.getByRole("status").getAttribute("aria-live"),
        "off",
      );
      await page.evaluate(() => window.__mock.releaseDetails());
      await done(page);
      assert.equal(
        await page.locator('[data-fetch-state="evaluated"]').count(),
        9,
      );
      assert.equal(
        await page.locator('[data-fetch-state="unfetched"]').count(),
        2,
      );
      assert.match(
        await page.getByRole("status").textContent(),
        /評価済み 9 件.*追加可能 2 件.*失敗 1 件.*口コミ取得対象 10 件 \/ 最大20件/,
      );
      assert.equal(
        await page.locator('[data-fetch-state="failed"]').count(),
        1,
      );
      assert.equal(
        await page
          .locator('[data-result-id="quota-2"]')
          .getAttribute("data-fetch-state"),
        "failed",
      );
      assert.equal(
        await page
          .locator('[data-result-id="quota-12"]')
          .getAttribute("data-fetch-state"),
        "unfetched",
      );
      screenshots.push(await shot("fetch-partial"));
      await page.evaluate(() => (window.__mock.config.holdDetails = false));
      await page.getByRole("button", { name: "次の2件を評価" }).click();
      await done(page);
      assert.equal(
        await page.locator('[data-fetch-state="evaluated"]').count(),
        11,
      );
      assert.equal(
        await page.locator('[data-fetch-state="failed"]').count(),
        1,
      );
      assert.equal(
        await page.locator('[data-fetch-state="unfetched"]').count(),
        0,
      );
      assert.equal(
        await page
          .locator('[data-result-id="quota-2"]')
          .getAttribute("data-fetch-state"),
        "failed",
      );
      assert.equal(
        await page
          .locator('[data-result-id="quota-12"]')
          .getAttribute("data-fetch-state"),
        "evaluated",
      );
      assert.equal(
        await page.getByRole("button", { name: /次の.*件を評価/ }).count(),
        0,
      );
      assert.match(
        await page.getByRole("status").textContent(),
        /評価済み 11 件.*追加可能 0 件.*失敗 1 件.*口コミ取得対象 12 件 \/ 最大20件/,
      );
      const attempts = await page.evaluate(() =>
        window.__mock.details.filter((id) => id.startsWith("quota-")),
      );
      assert.deepEqual(
        attempts,
        Array.from({ length: 12 }, (_, i) => `quota-${i + 1}`),
      );
      const analyses = await page.evaluate(() =>
        window.__mock.analyses.filter((id) => id.startsWith("quota-")),
      );
      assert.deepEqual(
        analyses.slice().sort(),
        attempts.filter((id) => id !== "quota-2").sort(),
      );
      return {
        attempts,
        analyses,
        screenshots,
        screenshot: await shot("fetch-complete"),
      };
    });
    await check("5-histogram", async () => {
      const bins = await page
        .locator("[data-bin]")
        .evaluateAll((els) => els.map((el) => Number(el.dataset.count)));
      assert.deepEqual(bins, [3, 2, 2, 2, 2]);
      await visibleInside(page, "[data-histogram]");
      await visibleInside(page, 'aside [role="alert"]');
      return { bins, screenshot: await shot("histogram") };
    });
    await check("6-sheet", async () => {
      if (view === "phone") {
        await height(page, "collapsed");
        await drag(page, -90);
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "half",
        );
        await drag(page, -90);
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "full",
        );
        await drag(page, 90);
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "half",
        );
        await drag(page, 90);
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "collapsed",
        );
        await page
          .getByRole("button", { name: "mock pin quota-1", exact: true })
          .click();
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "full",
        );
        await page.getByRole("button", { name: "一覧に戻る" }).click();
        await height(page, "collapsed");
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await visibleInside(page, "[data-map-region]");
      return { screenshot: await shot("sheet-map") };
    });
    await check("7-attribution", async () => {
      if (view === "phone") await height(page, "full");
      await page.locator('[data-result-id="quota-1"]').click();
      await page.getByPlaceholder("Enter evaluation").fill("編集後の条件");
      const detail = page.locator("[data-place-details]");
      assert.match(await detail.textContent(), /条件「電源がある」/);
      assert.equal(
        await detail.getByText("REVIEW:quota-1", { exact: true }).textContent(),
        "REVIEW:quota-1",
      );
      assert.equal(
        await detail
          .getByRole("link", { name: "投稿者 quota-1", exact: true })
          .getAttribute("href"),
        "https://example.invalid/author/quota-1",
      );
      assert.equal(
        await detail
          .getByRole("link", { name: "Google マップで開く" })
          .getAttribute("href"),
        "https://example.invalid/mock-place",
      );
      assert.equal(
        await detail
          .getByRole("img", { name: "投稿者 quota-1", exact: true })
          .evaluate((el) => el.complete && el.naturalWidth > 0),
        true,
      );
      await visibleInside(page, "[data-attribution]");
      await detail
        .locator("[data-detail-scroll]")
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      return { screenshot: await shot("attribution") };
    });
    await check("8-search-map-size", async () => {
      await page.evaluate(() => {
        window.__mock.config.holdDetails = false;
        window.__mock.config.fail = [];
      });
      if (view === "phone") await height(page, "half");
      const before = await page.evaluate(() => window.__mock.map.getZoom());
      await page.getByPlaceholder("Enter search term").fill("resize");
      if (view === "phone") {
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "full",
        );
        await page.waitForFunction(
          () => window.__mock.map.appliedSize.height < 100,
        );
      }
      const fullBounds = await page.evaluate(() =>
        window.__mock.map.getBounds().toJSON(),
      );
      // Exercise the accepted plain-Enter path, including focus expansion.
      await page.getByPlaceholder("Enter search term").press("Enter");
      await page.waitForFunction(() =>
        window.__mock.details.includes("resize-5"),
      );
      await done(page);
      const measured = await page.evaluate(() => ({
        request: window.__mock.searchRequests.at(-1),
        fit: window.__mock.fits.at(-1),
        after: window.__mock.map.getZoom(),
        actualHeight: window.__mock.map.getDiv().clientHeight,
      }));
      assert.equal(measured.request.query, "resize");
      assert.ok(
        measured.after >= before,
        JSON.stringify({ before, ...measured }),
      );
      if (view === "phone") {
        assert.equal(
          await page.locator("aside").getAttribute("data-sheet-height"),
          "half",
        );
        assert.ok(
          measured.request.viewSize.height >= 350,
          JSON.stringify(measured),
        );
        assert.ok(measured.fit.height >= 350, JSON.stringify(measured));
        assert.ok(
          measured.request.bounds.north - measured.request.bounds.south >
            3 * (fullBounds.north - fullBounds.south),
        );
        assert.equal(
          await page
            .getByRole("button", { name: "さらに広げる", exact: true })
            .getAttribute("aria-expanded"),
          "true",
        );
      }
      return {
        before,
        fullBounds,
        ...measured,
        screenshot: await shot("search-map-size"),
      };
    });
    await check("9-explicit-selection-only", async () => {
      await page.locator('[data-result-id="resize-1"]').click();
      // Let the explicit selection settle before simulating a deliberate pan away.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
          ),
      );
      const before = await page.evaluate(() => {
        const marker = window.__mock.markers.find(
          (m) => m.options.position.id === "resize-1",
        );
        marker.options.position.x = 1.5;
        marker.render();
        return {
          pans: window.__mock.pans.length,
          resizes: window.__mock.resizes.length,
        };
      });
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height - 80,
      });
      await page.waitForFunction(
        (count) => window.__mock.resizes.length > count,
        before.resizes,
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page.evaluate(() => window.__mock.pans.length),
        before.pans,
        "window resize must not undo a deliberate pan",
      );
      // An explicit handle action (phone) or new selection (PC) may recenter.
      if (view === "phone") await height(page, "collapsed");
      else await page.locator('[data-result-id="resize-1"]').click();
      await page.waitForFunction(
        (count) => window.__mock.pans.length === count + 1,
        before.pans,
      );
      if (view === "phone")
        assert.equal(
          await page
            .getByRole("button", { name: "広げる", exact: true })
            .getAttribute("aria-expanded"),
          "false",
        );
      await page.setViewportSize(viewport);
      return { screenshot: await shot("explicit-selection") };
    });
    assert.deepEqual(audit.external, []);
    assert.deepEqual(audit.unexpectedAPI, []);
    assert.deepEqual(audit.errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    `${root}e2e/detail-panel-results.json`,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), results, audits },
      null,
      2,
    ) + "\n",
  );
}
if (results.some((r) => r.result === "NG")) process.exitCode = 1;
