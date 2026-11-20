import assert from "node:assert/strict";
import {
  analysisPath,
  button,
  input,
  row,
  runSuite,
  send,
} from "./root-fixture.mjs";
import { serverErrorMessage, weekdayDescriptions } from "./places-routes.mjs";

await runSuite({
  async "chat search, fit bounds, pins, detail attribution and sheet"({
    page,
    view,
    config,
    requests,
  }) {
    config.count = 5;
    const handle = page.locator("[data-sheet-handle]");
    if (view === "phone") {
      // Submit with the full sheet; fitting results uses the half sheet later.
      await handle.press("ArrowUp");
      await page.waitForFunction(
        () => window.__mock.map.appliedSize.height < 100,
      );
    }
    const submitted = await page.evaluate(() =>
      window.__mock.map.getBounds().toJSON(),
    );
    await send(page, "電源があるカフェ");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-fetch-state="evaluated"]').length ===
        4,
    );
    const state = await page.evaluate(() => ({
      fit: window.__mock.fits.at(-1),
      points: window.__mock.map.bounds.points,
    }));
    assert.deepEqual(
      state.points,
      Array.from({ length: 5 }, (_, i) => ({
        lat: 35.7 + i * 0.001,
        lng: 139.7 + i * 0.001,
      })),
    );
    const [chat] = requests("/api/chat");
    assert.deepEqual(chat.body.viewport, submitted);
    assert.ok(state.fit.height >= 350);
    assert.equal(requests(analysisPath).length, 5);
    assert.ok(requests(analysisPath).every((call) => call.run === chat.run));
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
  async "chat Places tool errors and pre-stream session refusal"({
    page,
    config,
    requests,
  }) {
    for (const [code, message] of [
      [
        "RESOURCE_EXHAUSTED",
        "Google Places の検索上限に達しました。時間をおいて再検索してください。",
      ],
      ["PLACES_UPSTREAM_ERROR", serverErrorMessage],
      ["BUDGET_SESSION_EXCEEDED", "このセッションの検索上限です。"],
    ]) {
      if (code === "BUDGET_SESSION_EXCEEDED") {
        config.handlers["/api/chat"] = (route) =>
          route.fulfill({ status: 429, json: { error: { code, message } } });
      } else {
        config.toolError = { code, message };
      }
      await send(page, "カフェを探して");
      const alert = page.getByRole("alert").filter({ hasText: message });
      await alert.waitFor();
      assert.equal(await alert.innerText(), message);
    }
    await input(page).fill("別の場所を探して");
    assert.ok(await button(page, "送信").isDisabled());
    await input(page).press("Enter");
    assert.equal(requests("/api/chat").length, 3);
    assert.equal(requests(analysisPath).length, 0);
    assert.equal(new Set(requests("/api/chat").map((c) => c.run)).size, 3);
  },
});
