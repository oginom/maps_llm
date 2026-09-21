import assert from "node:assert/strict";

const refusal = (code, message, status = 429) => ({
  status,
  error: { code, message },
});
const searchButton = (page) =>
  page.getByRole("button", { name: "search", exact: true });
const moreButton = (page) =>
  page.getByRole("button", { name: /次の.*件を評価/ });
const observationMs = 1000;

export async function verifyBudgetHeaders(page, audit) {
  assert.deepEqual(audit.headerErrors, []);
  assert.ok(audit.headerRequests.length > 0);
  assert.equal(
    audit.sessionId,
    await page.evaluate(() => sessionStorage.getItem("maps-llm-session-id")),
  );
  assert.equal(
    audit.headerRequests.filter((r) => r.path === "/api/places/search").length,
    audit.searchRequests.length,
  );
  assert.equal(
    audit.headerRequests.filter(
      (r) =>
        r.path.startsWith("/api/places/") && r.path !== "/api/places/search",
    ).length,
    audit.detailRequests.length,
  );
  assert.equal(
    audit.headerRequests.filter((r) => r.path === "/api/analyze-reviews")
      .length,
    audit.analysisRequests.length,
  );
}

async function start(page, name, config = {}) {
  await page.evaluate(
    (config) => Object.assign(window.__mock.config, config),
    config,
  );
  await page.getByPlaceholder("Enter search term").fill(name);
  const before = await page.evaluate(() => window.__mock.searches.length);
  await searchButton(page).click();
  await page.waitForFunction(
    ({ name, before }) =>
      window.__mock.searches.length > before &&
      window.__mock.searches.at(-1) === name,
    { name, before },
  );
}

async function screenBox(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2,
    );
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      viewport: [innerWidth, innerHeight],
      hit: el === hit || el.contains(hit),
      disabled: el.disabled === true,
      pointerEvents: getComputedStyle(el).pointerEvents,
    };
  });
  assert.ok(
    box.width > 0 &&
      box.height > 0 &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.right <= box.viewport[0] + 1 &&
      box.bottom <= box.viewport[1] + 1 &&
      (box.hit || (box.disabled && box.pointerEvents === "none")),
    JSON.stringify(box),
  );
  return box;
}

async function stopCheck({ page, audit, shot }, message, hasCandidates, name) {
  const stop = page.locator("[data-budget-stop]");
  assert.equal(await stop.textContent(), message);
  assert.equal(await searchButton(page).isDisabled(), true);
  if (hasCandidates) assert.equal(await moreButton(page).isDisabled(), true);
  else {
    assert.equal(await moreButton(page).count(), 0);
    assert.equal(await page.locator("[data-result-id]").count(), 0);
  }
  const boxes = {
    stop: await screenBox(stop),
    search: await screenBox(searchButton(page)),
  };
  if (hasCandidates) boxes.more = await screenBox(moreButton(page));
  const before = audit.headerRequests.length;
  await page.locator("aside form").evaluate((form) => {
    form.querySelector('button[type="submit"]').click();
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  if (hasCandidates)
    await moreButton(page).evaluate((button) => button.click());
  await page.waitForTimeout(observationMs);
  assert.equal(
    audit.headerRequests.length,
    before,
    "Stopped controls must not send any API requests",
  );
  await stop.scrollIntoViewIfNeeded();
  return {
    message,
    fetchMore: hasCandidates ? "disabled" : "absent (no candidates)",
    boxes,
    observationMs,
    callsAfterStop: 0,
    screenshot: await shot(name),
  };
}

export const budgetScenarios = [
  [
    "budget-run-detail",
    async ({ page, audit, done, shot }) => {
      const name = "budget-run",
        failed = `${name}-2`;
      const message =
        "この検索の予算上限に達しました。別の検索を開始してください。";
      await start(page, name, {
        detailErrors: { [failed]: refusal("BUDGET_RUN_EXCEEDED", message) },
      });
      await done(page);
      assert.equal(
        await page.locator("aside").getByRole("alert").textContent(),
        message,
      );
      assert.equal(
        await page
          .locator(`[data-result-id="${failed}"]`)
          .getAttribute("data-fetch-state"),
        "failed",
      );
      assert.equal(
        await page.locator('[data-fetch-state="evaluated"]').count(),
        4,
      );
      assert.equal(await page.locator("[data-budget-stop]").count(), 0);
      assert.equal(await searchButton(page).isEnabled(), true);
      assert.equal(await moreButton(page).isEnabled(), true);
      await screenBox(page.locator("aside").getByRole("alert"));
      const screenshot = await shot("budget-run-detail");
      await moreButton(page).click();
      await done(page);
      assert.equal(
        await page.locator('[data-fetch-state="evaluated"]').count(),
        9,
      );
      assert.equal(
        audit.detailRequests.filter((id) => id === failed).length,
        1,
      );
      assert.equal(audit.analysisRequests.includes(failed), false);
      // Same search text is still a new run; exercises identity beyond query strings.
      const previousRun = audit.headerRequests.at(-1).runId;
      await page.evaluate(() => {
        window.__mock.config.detailErrors = {};
      });
      await start(page, name);
      await done(page);
      assert.notEqual(audit.headerRequests.at(-1).runId, previousRun);
      return {
        message,
        failedPlace: failed,
        evaluatedAfterExtraBatch: 9,
        newRunOnRepeatedQuery: true,
        screenshot,
      };
    },
  ],
  [
    "budget-unavailable-analysis",
    async ({ page, audit, done, shot }) => {
      const name = "budget-unavailable";
      const message =
        "予算台帳に接続できません。しばらくしてからお試しください。";
      const before = audit.analysisRequests.length;
      await start(page, name, {
        analysisError: refusal("BUDGET_UNAVAILABLE", message, 503),
      });
      await done(page);
      assert.equal(
        await page.locator("aside").getByRole("alert").textContent(),
        message,
      );
      assert.equal(
        await page.locator('[data-fetch-state="failed"]').count(),
        5,
      );
      assert.equal(await searchButton(page).isEnabled(), true);
      assert.equal(await page.locator("[data-budget-stop]").count(), 0);
      await page.waitForTimeout(observationMs);
      const calls = audit.analysisRequests.slice(before);
      assert.deepEqual(
        calls.slice().sort(),
        Array.from({ length: 5 }, (_, i) => `${name}-${i + 1}`).sort(),
      );
      await screenBox(page.locator("aside").getByRole("alert"));
      return {
        message,
        analysisCalls: calls.length,
        callsPerPlace: 1,
        observationMs,
        screenshot: await shot("budget-unavailable-analysis"),
      };
    },
  ],
  [
    "quota-fixed-wording",
    async ({ page, audit, done, shot }) => {
      const before = [
        audit.detailRequests.length,
        audit.analysisRequests.length,
      ];
      await start(page, "quota-wording", {
        searchError: refusal(
          "RESOURCE_EXHAUSTED",
          "QUOTA_SENTINEL_FROM_SERVER",
        ),
      });
      await done(page);
      const message =
        "Google Places の検索上限に達しました。時間をおいて再検索してください。";
      assert.equal(
        await page.locator("aside").getByRole("alert").textContent(),
        message,
      );
      assert.equal(await page.locator("[data-budget-stop]").count(), 0);
      assert.deepEqual(
        [audit.detailRequests.length, audit.analysisRequests.length],
        before,
      );
      await screenBox(page.locator("aside").getByRole("alert"));
      return { message, screenshot: await shot("quota-fixed-wording") };
    },
  ],
  [
    "budget-session-search",
    async (env) => {
      const { page, audit, done } = env;
      const message =
        "このセッションの予算上限に達しました。検索を停止しました。";
      const before = [
        audit.detailRequests.length,
        audit.analysisRequests.length,
      ];
      await start(page, "budget-session-search", {
        searchError: refusal("BUDGET_SESSION_EXCEEDED", message),
      });
      await done(page);
      assert.deepEqual(
        [audit.detailRequests.length, audit.analysisRequests.length],
        before,
      );
      return stopCheck(env, message, false, "budget-session-search");
    },
  ],
  ...["SESSION", "MONTH"].map((scope) => [
    `budget-${scope.toLowerCase()}-details`,
    async (env) => {
      const { page, done } = env;
      const name = `budget-${scope.toLowerCase()}`;
      const message =
        scope === "SESSION"
          ? "このセッションの予算上限に達しました。追加取得を停止しました。"
          : "今月の予算上限に達しました。来月まで検索と追加取得を停止します。";
      await start(page, name, {
        detailErrors: {
          [`${name}-2`]: refusal(`BUDGET_${scope}_EXCEEDED`, message),
        },
      });
      await done(page);
      assert.equal(
        await page.locator('[data-fetch-state="failed"]').count(),
        1,
      );
      return stopCheck(
        env,
        message,
        true,
        `budget-${scope.toLowerCase()}-details`,
      );
    },
  ]),
];
