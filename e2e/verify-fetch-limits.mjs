import { budgetScenarios, verifyBudgetHeaders } from "./budget-scenarios.mjs";
import {
  analysisFailure,
  placesRoutes,
  serverErrorMessage,
} from "./places-routes.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Use an existing Playwright installation without changing the app's manifest.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3107";
const origin = new URL(baseURL).origin;
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname),
  "Local server only",
);
const root = fileURLToPath(new URL("../", import.meta.url));
const evidenceDir = `${root}docs/img/detail-panel/fetch-limits`;
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.E2E_CHROMIUM_PATH,
});
const browserVersion = browser.version();
const results = [];
const audits = [];
const viewports = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};
const ids = (name, n = 5) =>
  Array.from({ length: n }, (_, i) => `${name}-${i + 1}`);

async function setup(viewport) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const audit = {
    externalBlocked: [],
    unexpectedAPI: [],
    analysisRequests: [],
    failedRequests: [],
    pageErrors: [],
    holds: [],
  };
  audits.push(audit);
  page.on("pageerror", (e) => audit.pageErrors.push(e.message));
  page.on("requestfailed", (req) => {
    if (new URL(req.url()).pathname === "/api/analyze-reviews") {
      audit.failedRequests.push({
        id: req.postDataJSON().reviews[0].replace("REVIEW:", ""),
        error: req.failure()?.errorText,
      });
    }
  });
  const handlePlaces = placesRoutes(page, audit);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.externalBlocked.push(`${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (await handlePlaces(route)) return;
    if (url.pathname === "/api/generate-examples") {
      const body = request.postDataJSON();
      return route.fulfill({
        json: { examples: "1: 不適合、5: 適合", searchQuery: body.searchTerm },
      });
    }
    if (url.pathname === "/api/analyze-reviews") {
      const id = request.postDataJSON().reviews[0].replace("REVIEW:", "");
      audit.analysisRequests.push(id);
      const config = await page.evaluate(() => window.__mock.config);
      const failure = analysisFailure(config, id);
      if (failure)
        return route.fulfill({
          status: failure.status,
          json: { error: failure.error },
        });
      const fulfill = () =>
        route.fulfill({
          json: {
            value: 5,
            reviewNumbers: [1],
          },
        });
      if (audit.holdAnalysis) {
        audit.holds.push(fulfill);
        return;
      }
      return fulfill();
    }
    if (url.pathname.startsWith("/api/")) {
      audit.unexpectedAPI.push(url.pathname);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await context.addInitScript({ path: `${root}e2e/maps-mock.js` });
  await page.goto(`${baseURL}/?lat=35.7&lng=139.7&zoom=10`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="search"]:enabled'),
  );
  return { context, page, audit };
}
async function search(page, name) {
  await page.getByPlaceholder("Enter search term").fill(name);
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page.waitForFunction(
    (name) => window.__mock.searches.includes(name),
    name,
  );
}
async function done(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="status"]');
    return (
      el &&
      /評価試行/.test(el.textContent) &&
      !/評価中|検索中/.test(el.textContent)
    );
  });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const m = window.__mock;
    return {
      searches: m.searches,
      details: m.details,
      analyses: m.analyses,
      aborts: m.aborts,
      fetchErrors: m.fetchErrors,
      jsonWaiting: m.jsonWaiting,
      jsonDelivered: m.jsonDelivered,
      pins: [...document.querySelectorAll("[data-place-id]")].map((el) => ({
        id: el.dataset.placeId,
        color: el.dataset.color,
      })),
      status: document.querySelector('[role="status"]')?.textContent,
      alert: document.querySelector('[role="alert"]')?.textContent || null,
    };
  });
}
async function pinCounts(page, colored, white) {
  await page.waitForFunction(
    ({ colored, white }) => {
      const pins = [...document.querySelectorAll("[data-place-id]")];
      return (
        pins.filter((p) => p.dataset.color !== "#ffffff").length === colored &&
        pins.filter((p) => p.dataset.color === "#ffffff").length === white
      );
    },
    { colored, white },
  );
}
async function shot(page, name) {
  await page.screenshot({ path: `${evidenceDir}/${name}.png` });
  return `docs/img/detail-panel/fetch-limits/${name}.png`;
}
async function check(view, scenario, run) {
  const env = await setup(viewports[view]);
  try {
    const evidence = await run(env);
    assert.deepEqual(
      env.audit.externalBlocked,
      [],
      "Unexpected external browser request (blocked)",
    );
    await verifyBudgetHeaders(env.page, env.audit);
    assert.deepEqual(env.audit.unexpectedAPI, []);
    assert.deepEqual(env.audit.pageErrors, []);
    assert.deepEqual(
      env.audit.searchRequests.map((body) => body.textQuery),
      await env.page.evaluate(() => window.__mock.searches),
    );
    assert.deepEqual(
      env.audit.detailRequests.slice().sort(),
      await env.page.evaluate(() => window.__mock.details.slice().sort()),
    );
    assert.deepEqual(
      env.audit.analysisRequests.slice().sort(),
      await env.page.evaluate(() => window.__mock.analyses.slice().sort()),
    );
    const result = { viewport: view, scenario, result: "OK", ...evidence };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = {
      viewport: view,
      scenario,
      result: "NG",
      error: error.message,
      state: await snapshot(env.page),
      screenshot: await shot(env.page, `${view}-${scenario}-failure`),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    await env.context.unrouteAll({ behavior: "wait" });
    await env.context.close();
  }
}

try {
  for (const view of Object.keys(viewports)) {
    for (const [name, scenario] of budgetScenarios) {
      await check(view, name, async ({ page, audit }) =>
        scenario({
          page,
          audit,
          done,
          shot: (name) => shot(page, `${view}-${name}`),
        }),
      );
    }
    await check(view, "1-initial", async ({ page }) => {
      await search(page, "initial");
      await done(page);
      await pinCounts(page, 12, 0);
      const state = await snapshot(page);
      assert.deepEqual(state.details, []);
      assert.deepEqual(
        state.analyses.slice().sort(),
        ids("initial", 12).sort(),
      );
      assert.match(state.status, /12 件 \/ 最大20件/);
      assert.equal(
        await page.getByRole("button", { name: /次の.*件を評価/ }).count(),
        0,
      );
      return { state, screenshot: await shot(page, `${view}-initial`) };
    });
    await check(view, "chat-automatic-evaluation", async ({ page }) => {
      await page.locator("[data-chat-input]").fill("電源があるカフェ");
      await page.locator("[data-chat-send]").click();
      await pinCounts(page, 20, 0);
      await done(page);
      const state = await snapshot(page);
      assert.deepEqual(state.details, []);
      assert.deepEqual(state.analyses.slice().sort(), ids("chat", 20).sort());
      assert.equal(
        await page.getByRole("button", { name: /次の.*件を評価/ }).count(),
        0,
      );
    });
    await check(view, "2-cap", async ({ page }) => {
      await page.evaluate(() => {
        window.__mock.config.count = 23;
      });
      await search(page, "cap");
      await done(page);
      await pinCounts(page, 20, 3);
      await page.waitForTimeout(250); // No automatic fetching past the cap.
      const state = await snapshot(page);
      assert.deepEqual(state.details, []);
      assert.deepEqual(state.analyses.slice().sort(), ids("cap", 20).sort());
      assert.equal(state.pins.length, 23);
      assert.equal(
        await page.locator('[data-fetch-state="unevaluated"]').count(),
        3,
      );
      assert.equal(
        await page.getByRole("button", { name: /次の.*件を評価/ }).count(),
        0,
      );
      assert.match(state.status, /20 件 \/ 最大20件/);
      const screenshot = await shot(page, `${view}-cap`);
      // Seven bundled places, one without reviews: six analyses and seven pins.
      await page.evaluate(() => {
        window.__mock.config.count = 7;
        window.__mock.config.noReviews = ["partial-7"];
      });
      await search(page, "partial");
      await done(page);
      await pinCounts(page, 6, 1);
      assert.equal(
        await page.locator('[data-fetch-state="no-reviews"]').count(),
        1,
      );
      const partial = await snapshot(page);
      assert.deepEqual(
        partial.analyses.filter((id) => id.startsWith("partial")),
        ids("partial", 6),
      );
      assert.equal(
        await page.getByRole("button", { name: /次の.*件を評価/ }).count(),
        0,
      );
      return { state, partialAttempts: 6, screenshot };
    });
    await check(view, "3-bounded-concurrency", async ({ page }) => {
      await page.evaluate(() => {
        window.__mock.config.gateJson = true;
      });
      await search(page, "bounded");
      await page.waitForFunction(() => window.__mock.jsonWaiting.length === 5);
      assert.deepEqual((await snapshot(page)).analyses, ids("bounded"));
      await page.locator('[data-result-id="bounded-7"]').click();
      const details = page.locator("[data-place-details]");
      assert.match(await details.textContent(), /Google 評価: 4\/5/);
      assert.equal(
        await details
          .getByRole("link", { name: "公式サイト" })
          .getAttribute("href"),
        "https://example.invalid/site/bounded-7",
      );
      assert.deepEqual((await snapshot(page)).details, []);
      await page.evaluate(() => {
        window.__mock.config.gateJson = false;
        window.__mock.releaseJson();
      });
      await done(page);
      await pinCounts(page, 12, 0);
      assert.deepEqual((await snapshot(page)).analyses, ids("bounded", 12));
    });
    await check(view, "4-quota-failure", async ({ page }) => {
      await page.evaluate(() => {
        window.__mock.config.fail = ["failure-2"];
      });
      await search(page, "failure");
      await done(page);
      await pinCounts(page, 11, 1);
      const initial = await snapshot(page);
      assert.match(initial.alert, /レビュー分析の利用上限/);
      assert.equal(initial.analyses.includes("failure-2"), true);
      const screenshot = await shot(page, `${view}-quota-error`);
      await page.waitForTimeout(250); // Bounded observation window for unwanted retries.
      const state = await snapshot(page);
      assert.deepEqual(state.details, []);
      assert.equal(state.analyses.filter((id) => id === "failure-2").length, 1);
      assert.equal(
        state.pins.find((p) => p.id === "failure-2").color,
        "#ffffff",
      );
      assert.equal(state.analyses.length, 12);
      assert.match(state.status, /12 件 \/ 最大20件/);
      return { initial, state, screenshot };
    });
    await check(view, "5-stale-results", async ({ page }) => {
      // Exercise a late analysis response independently of fetch cancellation.
      await page.evaluate(() => {
        window.__mock.config.gateJson = true;
      });
      await search(page, "old-json");
      await page.waitForFunction(() => window.__mock.jsonWaiting.length === 5);
      await page.evaluate(() => {
        window.__mock.config.gateJson = false;
      });
      await search(page, "new-json");
      await done(page);
      await pinCounts(page, 12, 0);
      await page.evaluate(() => window.__mock.releaseJson());
      await page.waitForFunction(
        () => window.__mock.jsonDelivered.length === 5,
      );
      await page.waitForTimeout(100);
      const state = await snapshot(page);
      assert.deepEqual(
        state.analyses.filter((id) => id.startsWith("old-json")),
        ids("old-json"),
      );
      assert.ok(state.pins.every((p) => p.id.startsWith("new-json")));
      assert.match(state.status, /12 件 \/ 最大20件/);
      assert.equal(state.alert, null);
      if (view === "phone") {
        while (
          (await page.locator("aside").getAttribute("data-sheet-height")) !==
          "collapsed"
        )
          await page.locator("[data-sheet-handle]").click();
      }
      await page
        .getByRole("button", { name: "mock pin new-json-1", exact: true })
        .click();
      assert.equal(
        await page.getByText("REVIEW:new-json-1", { exact: true }).count(),
        1,
      );
      assert.equal(
        await page.getByText("REVIEW:old-json", { exact: false }).count(),
        0,
      );
      return {
        state,
        screenshot: await shot(page, `${view}-stale-results`),
      };
    });
    await check(view, "6-abort", async ({ page, audit }) => {
      audit.holdAnalysis = true;
      await search(page, "abort-old");
      await page.waitForFunction(() => window.__mock.analyses.length === 5);
      for (let n = 0; audit.holds.length < 5 && n < 100; n++)
        await page.waitForTimeout(20);
      assert.equal(audit.holds.length, 5);
      audit.holdAnalysis = false;
      await search(page, "abort-new");
      await page.waitForFunction(() => window.__mock.fetchErrors.length === 5);
      await done(page);
      await pinCounts(page, 12, 0);
      const state = await snapshot(page);
      assert.deepEqual(state.aborts.slice().sort(), ids("abort-old").sort());
      assert.ok(state.fetchErrors.every((e) => e.name === "AbortError"));
      for (let n = 0; audit.failedRequests.length < 5 && n < 100; n++)
        await page.waitForTimeout(20);
      assert.deepEqual(
        audit.failedRequests.map((e) => e.id).sort(),
        ids("abort-old").sort(),
      );
      assert.ok(state.pins.every((p) => p.id.startsWith("abort-new")));
      assert.match(state.status, /12 件 \/ 最大20件/);
      // Release mock server responses only after cancellation was observed.
      await Promise.allSettled(audit.holds.map((fn) => fn()));
      return {
        state,
        failedRequests: audit.failedRequests,
        screenshot: await shot(page, `${view}-abort`),
      };
    });
    await check(view, "7-server-error", async ({ page, audit }) => {
      await page.evaluate((message) => {
        window.__mock.config.searchError = {
          status: 502,
          error: { code: "UPSTREAM_ERROR", message },
        };
      }, serverErrorMessage);
      await search(page, "server-error");
      await page
        .getByRole("alert")
        .getByText(serverErrorMessage, { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("aside").getByRole("alert").textContent(),
        serverErrorMessage,
      );
      assert.equal(audit.searchRequests.length, 1);
      assert.equal(audit.detailRequests.length, 0);
      assert.equal(audit.analysisRequests.length, 0);
      return { screenshot: await shot(page, `${view}-server-error`) };
    });
    await check(view, "ui-observations", async ({ page }) => {
      await page.evaluate(() => {
        window.__mock.config.fail = ["ux-2"];
      });
      await search(page, "ux");
      await done(page);
      const boxes = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          alert: box(document.querySelector('[role="alert"]')),
          status: box(document.querySelector('[role="status"]')),
          search: box(document.querySelector('[aria-label="search"]')),
          histogram: box(document.querySelector("[data-histogram]")),
          input: box(
            document.querySelector('[placeholder="Enter search term"]'),
          ),
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      if (view === "phone") {
        while (
          (await page.locator("aside").getAttribute("data-sheet-height")) !==
          "collapsed"
        )
          await page.locator("[data-sheet-handle]").click();
      }
      await page
        .getByRole("button", { name: "mock pin ux-4", exact: true })
        .click();
      const overlay = await page
        .locator("[data-place-details]")
        .evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          };
        });
      const screenshot = await shot(page, `${view}-overlay`);
      assert.equal(await page.locator("[data-histogram]").count(), 1);
      return {
        boxes,
        overlay,
        screenshot,
        distributionScreenshot: await shot(page, `${view}-distribution`),
      };
    });
  }
} finally {
  await browser.close();
  const report = {
    generatedAt: new Date().toISOString(),
    browser: `Chromium ${browserVersion} (Playwright)`,
    viewports,
    results,
    network: audits.map((audit) => {
      const saved = { ...audit };
      delete saved.holds;
      return saved;
    }),
  };
  await writeFile(
    `${root}e2e/results.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (results.some((r) => r.result === "NG")) process.exitCode = 1;
