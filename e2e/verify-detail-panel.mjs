import assert from "node:assert/strict";
import { analysisPath, button, input, row, runSuite } from "./root-fixture.mjs";
import {
  registerPlaces,
  serverErrorMessage,
  weekdayDescriptions,
} from "./places-routes.mjs";

const manual = (page) => page.locator("[data-manual-search-form]");
async function openManual(page, config) {
  const toggle = page.getByText("手動で検索", { exact: true });
  await toggle.click();
  config.handlers["/api/generate-examples"] = (route, body) =>
    route.fulfill({
      json: {
        examples: "1 ... なし, 5 ... あり",
        searchQuery: body.searchTerm,
      },
    });
  await manual(page).getByLabel("検索ワード").fill("quota");
  await manual(page).getByLabel("評価条件").fill("電源");
}
await runSuite({
  async "manual search, fit bounds, pins, detail attribution and sheet"({
    page,
    view,
    config,
    requests,
  }) {
    await openManual(page, config);
    config.handlers["/api/places/search"] = async (route, body) =>
      route.fulfill({
        json: { places: await registerPlaces(page, body.textQuery, 5) },
      });
    const handle = page.locator("[data-sheet-handle]");
    if (view === "phone") {
      // Focusing an input no longer changes the map. Expand explicitly to
      // exercise the transition from a full sheet to the search viewport.
      await handle.press("ArrowUp");
      await page.waitForFunction(
        () => window.__mock.map.appliedSize.height < 100,
      );
    }
    await manual(page)
      .getByRole("button", { name: "検索", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-fetch-state="evaluated"]').length ===
        4,
    );
    const state = await page.evaluate(() => ({
      request: window.__mock.searchRequests.at(-1),
      fit: window.__mock.fits.at(-1),
      points: window.__mock.map.bounds.points,
    }));
    assert.equal(state.request.query, "quota");
    assert.deepEqual(
      state.points,
      Array.from({ length: 5 }, (_, i) => ({
        lat: 35.7 + i * 0.001,
        lng: 139.7 + i * 0.001,
      })),
    );
    assert.equal(state.fit.height, state.request.viewSize.height);
    assert.ok(state.fit.height >= 350);
    const { bounds, zoom, viewSize } = state.request;
    assert.ok(
      Math.abs(
        (bounds.north - bounds.south) * 20000 * 2 ** (zoom - 10) -
          viewSize.height,
      ) < 0.001,
    );
    const run = requests("/api/generate-examples")[0].run;
    assert.equal(requests("/api/places/search")[0].run, run);
    assert.ok(requests(analysisPath).every((call) => call.run === run));
    assert.equal(
      await page
        .locator('[data-place-id="quota-3"]')
        .getAttribute("data-color"),
      "#45494c",
    );
    assert.notEqual(
      await page
        .locator('[data-place-id="quota-1"]')
        .getAttribute("data-color"),
      "#45494c",
    );
    if (view === "phone") {
      assert.equal(
        await page.locator("aside").getAttribute("data-sheet-height"),
        "half",
      );
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2 + 100,
        { steps: 8 },
      );
      await page.mouse.up();
      await page.locator('aside[data-sheet-height="collapsed"]').waitFor();
      assert.ok(await input(page).isVisible());
      await handle.press("ArrowUp");
      await page.locator('aside[data-sheet-height="half"]').waitFor();
    }
    await button(page, "mock pin quota-1").click();
    const detail = page.locator("[data-place-details]");
    await detail.getByRole("heading", { name: /quota-1/ }).waitFor();
    assert.match(await detail.innerText(), /Google 評価 4/);
    await detail.getByText(/評価の根拠となる口コミ/).click();
    assert.ok(
      await detail.getByText("REVIEW:quota-1", { exact: true }).isVisible(),
    );
    assert.equal(
      await detail
        .getByRole("link", { name: "投稿者 quota-1" })
        .getAttribute("href"),
      "https://example.invalid/author/quota-1",
    );
    assert.equal(
      await detail
        .getByRole("link", { name: "公式サイト" })
        .getAttribute("href"),
      "https://example.invalid/site/quota-1",
    );
    assert.equal(
      await detail
        .getByRole("link", { name: "Google マップで開く" })
        .getAttribute("href"),
      "https://example.invalid/mock-place",
    );
    await detail.getByText("営業時間", { exact: true }).click();
    for (const line of weekdayDescriptions)
      assert.ok(await detail.getByText(line, { exact: true }).isVisible());
    await button(page, /候補一覧へ/).click();
    await page.evaluate(() => {
      window.__mock.positions[`${35.7 + 0.004},${139.7 + 0.004}`].x = 1.5;
    });
    await row(page, "quota-5").click();
    await page.waitForFunction(() => window.__mock.pans.includes("quota-5"));
    await detail.getByText(/評価の根拠となる口コミ/).click();
    assert.ok(
      await detail.getByText("投稿者 quota-5", { exact: true }).isVisible(),
    );
    assert.equal(
      await detail.getByRole("link", { name: "投稿者 quota-5" }).count(),
      0,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // After an explicit selection the user may pan away; a viewport resize
    // alone must not move the map back to the selected branch.
    const pans = await page.evaluate(() => {
      window.__mock.positions[`${35.7 + 0.004},${139.7 + 0.004}`].x = 1.5;
      return window.__mock.pans.length;
    });
    const viewport = page.viewportSize();
    await page.setViewportSize({ ...viewport, height: viewport.height - 80 });
    await page.waitForFunction(
      () =>
        window.__mock.map.appliedSize.height ===
        window.__mock.map.div.clientHeight,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(await page.evaluate(() => window.__mock.pans.length), pans);
  },
  async "manual search quota, upstream error and session refusal"({
    page,
    config,
    requests,
  }) {
    await openManual(page, config);
    for (const [status, code, message, expected] of [
      [
        429,
        "RESOURCE_EXHAUSTED",
        "sentinel",
        "Google Places の検索上限に達しました。時間をおいて再検索してください。",
      ],
      [502, "PLACES_UPSTREAM_ERROR", serverErrorMessage, serverErrorMessage],
      [
        429,
        "BUDGET_SESSION_EXCEEDED",
        "このセッションの検索上限です。",
        "このセッションの検索上限です。",
      ],
    ]) {
      config.handlers["/api/places/search"] = (route) =>
        route.fulfill({ status, json: { error: { code, message } } });
      await manual(page)
        .getByRole("button", { name: "検索", exact: true })
        .click();
      const alert = page.getByRole("alert").filter({ hasText: expected });
      await alert.waitFor();
      assert.equal(await alert.innerText(), expected);
    }
    assert.ok(
      await manual(page)
        .getByRole("button", { name: "検索", exact: true })
        .isDisabled(),
    );
    assert.equal(requests(analysisPath).length, 0);
    assert.equal(
      new Set(requests("/api/places/search").map((c) => c.run)).size,
      3,
    );
  },
});
