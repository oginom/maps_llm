import assert from "node:assert/strict";
import {
  runSuite,
  send,
  button,
  row,
  input,
  walkingPath,
} from "./root-fixture.mjs";
await runSuite({
  async "single chat composer, distribution and markers"({
    page,
    view,
    requests,
  }) {
    assert.equal(await page.locator('img[alt="まちのコンパス"]').count(), 1);
    assert.equal(
      await page.getByText("手動で検索", { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator("[data-manual-search-form]").count(), 0);
    assert.equal(await page.locator("form").count(), 1);
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
    await row(page, "quota-1").click();
    assert.match(
      await input(page).locator("xpath=ancestor::form").innerText(),
      /送信先[\s\S]*quota-1/,
    );
    await button(page, /候補一覧へ/).click();
    assert.equal(requests(walkingPath).length, 0);
  },
});
