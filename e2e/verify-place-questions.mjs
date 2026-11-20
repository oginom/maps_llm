import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { placesRoutes } from "./places-routes.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3107";
const origin = new URL(baseURL).origin;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname));
const root = fileURLToPath(new URL("../", import.meta.url));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.E2E_CHROMIUM_PATH,
});
try {
  for (const [view, viewport] of Object.entries({
    phone: { width: 390, height: 844 },
    desktop: { width: 1280, height: 800 },
  })) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const audit = {
      external: [],
      unexpected: [],
      errors: [],
      questions: [],
      chats: 0,
    };
    page.on("pageerror", (error) => audit.errors.push(error.message));
    const places = placesRoutes(page, audit);
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== origin) {
        audit.external.push(url.href);
        return route.abort();
      }
      if (url.pathname === "/api/chat") audit.chats++;
      if (url.pathname === "/api/place-question") {
        const body = req.postDataJSON();
        audit.questions.push(body);
        return route.fulfill({
          json: body.question.includes("静か")
            ? { answer: "口コミからは分かりません。", reviewNumbers: [] }
            : {
                answer: "電源についての回答です。",
                reviewNumbers: body.placeId === "quota-3" ? [3, 1] : [1],
              },
        });
      }
      if (await places(route)) return;
      if (url.pathname === "/api/generate-examples")
        return route.fulfill({
          json: {
            examples: "1:低、5:高",
            searchQuery: req.postDataJSON().searchTerm,
          },
        });
      if (url.pathname === "/api/analyze-reviews") {
        audit.analysisRequests.push(req.postDataJSON().reviews[0]);
        return route.fulfill({ json: { value: 4, reviewNumbers: [1] } });
      }
      if (url.pathname.startsWith("/api/")) {
        audit.unexpected.push(url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript({ path: `${root}e2e/maps-mock.js` });
    await page.goto(`${baseURL}/?lat=35.7&lng=139.7&zoom=10`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="search"]:enabled'),
    );
    await page.getByPlaceholder("Enter search term").fill("quota");
    await page.getByRole("button", { name: "search", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-result-id][data-fetch-state="evaluated"]',
        ).length === 12,
    );
    const before = {
      searches: audit.searchRequests.length,
      analyses: audit.analysisRequests.length,
    };
    await page.locator('[data-result-id="quota-3"]').click();
    const detail = page.locator("[data-place-details]");
    const input = detail.getByLabel("この店舗に質問");
    await input.waitFor();
    assert.equal(
      await page.getByPlaceholder("Enter search term").isVisible(),
      false,
    );
    assert.match(
      await detail.locator("form").textContent(),
      /質問先: quota-3 詳細店舗/,
    );
    assert.equal(await input.getAttribute("maxlength"), "300");
    await input.fill("あ".repeat(301));
    assert.equal((await input.inputValue()).length, 300);
    await input.fill("変換中");
    await input.dispatchEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
    });
    assert.equal(audit.questions.length, 0);
    await detail.getByRole("button", { name: "電源はありますか？" }).click();
    await detail.getByText("電源についての回答です。").waitFor();
    assert.equal(audit.questions[0].placeId, "quota-3");
    assert.equal(audit.questions[0].question, "電源はありますか？");
    assert.deepEqual(audit.questions[0].history, []);
    const turn = detail.locator("[data-question-turn]").first();
    await turn.getByRole("button", { name: /根拠の口コミ 2件/ }).click();
    assert.match(
      await turn.textContent(),
      /根拠 3: quota-3[\s\S]*投稿者 quota-3\/3[\s\S]*REVIEW:quota-3[\s\S]*投稿者 quota-3/,
    );
    assert.equal(
      await turn
        .locator('a[href="https://example.invalid/review/quota-3/3"]')
        .count(),
      1,
    );
    assert.equal(
      await turn
        .locator('a[href="https://example.invalid/author/quota-3"]')
        .count(),
      1,
    );
    await detail.getByRole("button", { name: "静かに過ごせますか？" }).click();
    await detail.getByText("口コミからは分かりません。").waitFor();
    assert.equal(
      await detail
        .locator("[data-question-turn]")
        .nth(1)
        .getByRole("button", { name: /根拠/ })
        .count(),
      0,
    );
    assert.equal(audit.questions[1].history.length, 1);
    await detail.getByRole("button", { name: "一覧に戻る" }).click();
    assert.equal(await page.locator("[data-result-id]").count(), 12);
    await page.locator('[data-result-id="quota-1"]').click();
    assert.equal(await detail.locator("[data-question-turn]").count(), 0);
    await detail.getByRole("button", { name: "電源はありますか？" }).click();
    await detail.getByText("電源についての回答です。").waitFor();
    assert.equal(audit.questions[2].placeId, "quota-1");
    assert.deepEqual(audit.questions[2].history, []);
    await detail.getByRole("button", { name: "一覧に戻る" }).click();
    await page.locator('[data-result-id="quota-3"]').click();
    assert.equal(await detail.locator("[data-question-turn]").count(), 2);
    assert.equal(audit.searchRequests.length, before.searches);
    assert.equal(audit.analysisRequests.length, before.analyses);
    assert.equal(audit.detailRequests.length, 0);
    assert.equal(audit.chats, 0);
    assert.equal(await page.locator("[data-map-region]").isVisible(), true);
    if (view === "desktop")
      assert.equal(
        Math.round((await page.locator("aside").boundingBox()).width),
        400,
      );
    else assert.ok(await page.locator("[data-sheet-handle]").isVisible());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(audit.external, []);
    assert.deepEqual(audit.unexpected, []);
    assert.deepEqual(audit.errors, []);
    console.log(`${view}: selected-store questions OK`);
    await context.close();
  }
} finally {
  await browser.close();
}
