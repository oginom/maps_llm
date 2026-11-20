import assert from "node:assert/strict";
import { budgetScenarios } from "./budget-scenarios.mjs";
import {
  analysisPath,
  button,
  ranked,
  row,
  runSuite,
  send,
} from "./root-fixture.mjs";

await runSuite({
  async "bounded batch, candidate cap, no reviews and per-place failure"({
    page,
    config,
    requests,
  }) {
    config.count = 23;
    config.noReviews = ["quota-8"];
    await page.evaluate(() => {
      window.__mock.config.gateJson = true;
    });
    config.handlers[analysisPath] = (route, body) =>
      body.reviews[0] === "REVIEW:quota-7"
        ? route.fulfill({
            status: 429,
            json: { error: { code: "RESOURCE_EXHAUSTED", message: "上限" } },
          })
        : route.fulfill({ json: { value: 4, reviewNumbers: [1] } });
    await send(page, "カフェを探して");
    await page.waitForFunction(() => window.__mock.jsonWaiting.length === 5);
    assert.equal(requests(analysisPath).length, 5);
    assert.equal((await ranked(page)).length, 23);
    await page.evaluate(() => {
      window.__mock.config.gateJson = false;
      window.__mock.releaseJson();
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-fetch-state="evaluated"]').length ===
        18,
    );
    assert.equal(
      await row(page, "quota-7").getAttribute("data-fetch-state"),
      "failed",
    );
    assert.equal(
      await row(page, "quota-8").getAttribute("data-fetch-state"),
      "no-reviews",
    );
    assert.equal(
      await page.locator('[data-fetch-state="unevaluated"]').count(),
      3,
    );
    const analyses = requests(analysisPath);
    assert.equal(analyses.length, 19);
    assert.equal(new Set(analyses.map((c) => c.body.reviews[0])).size, 19);
    assert.ok(analyses.every((c) => c.run === requests("/api/chat")[0].run));
  },
  async "replacement search aborts an in-flight batch and ignores delayed scores"({
    page,
    config,
    requests,
  }) {
    config.count = 12;
    await page.evaluate(() => {
      window.__mock.config.gateJson = true;
    });
    await send(page, "カフェを探して");
    await page.waitForFunction(() => window.__mock.jsonWaiting.length === 5);
    config.prefix = "new";
    config.count = 2;
    await page.evaluate(() => {
      window.__mock.config.gateJson = false;
    });
    await button(page, "地図に切替").click();
    await send(page, "パン屋を探して");
    await page.waitForFunction(() =>
      document.querySelector(
        '[data-result-id="new-1"][data-fetch-state="evaluated"]',
      ),
    );
    assert.equal(await page.evaluate(() => window.__mock.aborts.length), 5);
    await page.evaluate(() => window.__mock.releaseJson());
    await page.waitForFunction(() => window.__mock.jsonDelivered.length === 5);
    assert.deepEqual(await ranked(page), ["new-1", "new-2"]);
    assert.equal(requests(analysisPath).length, 7);
    assert.notEqual(requests("/api/chat")[0].run, requests("/api/chat")[1].run);
  },
  async "replacement aborts network fetches before JSON exists"({
    page,
    config,
    requests,
  }) {
    const held = [];
    config.count = 12;
    config.handlers[analysisPath] = (route) => {
      held.push(route);
    };
    await send(page, "電源があるカフェを探して");
    await page.waitForFunction(() => window.__mock.analyses.length === 5);
    await button(page, "地図に切替").click();
    // Wait for interception, not just for the synchronous fetch invocation.
    for (let i = 0; i < 100 && held.length < 5; i++)
      await page.waitForTimeout(20);
    assert.equal(held.length, 5);
    delete config.handlers[analysisPath];
    config.prefix = "new";
    config.count = 1;
    await send(page, "別の店を探して");
    await page.waitForFunction(() => window.__mock.fetchErrors.length === 5);
    for (const route of held)
      await route.fulfill({ json: { value: 1, reviewNumbers: [1] } });
    await page
      .locator('[data-result-id="new-1"][data-fetch-state="evaluated"]')
      .waitFor();
    assert.equal(requests(analysisPath).length, 6);
    assert.deepEqual(await ranked(page), ["new-1"]);
  },
  ...budgetScenarios,
});
