import assert from "node:assert/strict";
import { runSuite, send, button, row } from "./root-fixture.mjs";
await runSuite({
  async "distribution, markers and input sizing"({ page, view }) {
    assert.equal(await page.locator('img[alt="まちのコンパス"]').count(), 1);
    await page.locator("[data-manual-search-toggle] summary").click();
    for (const input of await page
      .locator("[data-manual-search-form] input")
      .all())
      assert.ok(
        parseFloat(
          await input.evaluate((el) => getComputedStyle(el).fontSize),
        ) >= 16,
      );
    await page.locator("[data-manual-search-toggle] summary").click();
    await send(page, "電源があるカフェを探して");
    await page.locator('[data-fetch-state="unknown"]').waitFor();
    const distribution = page.locator("[data-histogram]");
    assert.equal(await distribution.locator("[data-bin]").count(), 6);
    assert.equal(
      await distribution
        .locator('[data-bin="unscored"]')
        .getAttribute("data-count"),
      "1",
    );
    assert.equal(
      await distribution
        .locator("[data-bin]")
        .evaluateAll((els) =>
          els.reduce((sum, el) => sum + Number(el.dataset.count), 0),
        ),
      3,
    );
    assert.equal(await page.locator("[data-place-id]").count(), 3);
    if (view === "phone")
      await page
        .locator("[data-panel-body]")
        .evaluate((el) => el.scrollIntoView());
    await distribution.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/maps-ui-${view}.png` });
    await button(page, /徒歩時間を比べる/).click();
    await row(page, "quota-1").click();
    assert.equal(
      await row(page, "quota-1").getAttribute("aria-pressed"),
      "true",
    );
  },
});
