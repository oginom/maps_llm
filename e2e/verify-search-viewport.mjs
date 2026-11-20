import assert from "node:assert/strict";
import { button, input, row, runSuite, send } from "./root-fixture.mjs";

async function startInA({ page, view, requests }, pending = false) {
  await send(page, "電源があるカフェ");
  await row(page, "quota-1").waitFor();
  await page.waitForFunction(
    () =>
      window.__mock.fits.length === 1 &&
      document.querySelector('[data-fetch-state="unknown"]'),
  );
  if (view === "phone") {
    await page.locator("[data-sheet-handle]").press("ArrowUp");
    await page.waitForFunction(
      () => window.__mock.map.appliedSize.height < 100,
    );
  }
  await page.evaluate((pending) => {
    const map = window.__mock.map;
    map.beginCameraGesture({ lat: 43, lng: 141 }, map.getZoom() + 2);
    if (!pending) map.finishCameraGesture();
  }, pending);
  await button(page, "地図に切替").click();
  assert.match(
    await input(page).locator("xpath=ancestor::form").innerText(),
    /表示中の地図/,
  );
  return requests("/api/chat")[0].body.viewport;
}

// Read the camera in the click's capture phase; move again after React's
// submit handler returns, before any layout wait or query preparation ends.
async function submitAndMove(page, control) {
  await control.evaluate((element) => {
    element.addEventListener(
      "click",
      () => {
        window.__mock.submitted = window.__mock.map.getBounds().toJSON();
        setTimeout(() => {
          const map = window.__mock.map;
          map.setCenter(new google.maps.LatLng(33, 130));
          map.setZoom(11);
        }, 0);
      },
      { capture: true, once: true },
    );
  });
  await control.click();
  await page.waitForFunction(() => window.__mock.map.getCenter().lat() === 33);
  return page.evaluate(() => window.__mock.submitted);
}

await runSuite({
  async "map-scoped send waits for B when Maps still reports A"(fixture) {
    const { page, requests, config } = fixture;
    const first = await startInA(fixture, true);
    config.prefix = "second";
    await send(page, "パン屋を探して");
    // Allow the previous layout-based implementation to finish its two-frame
    // wait while Google's camera has deliberately not confirmed B yet.
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    });
    const submitted = await page.evaluate(() =>
      window.__mock.map.finishCameraGesture(),
    );
    await row(page, "second-1").waitFor();
    assert.ok(submitted.south > first.north);
    assert.deepEqual(requests("/api/chat")[1].body.viewport, submitted);
  },
  async "switching back to candidates cancels a pending map send"(fixture) {
    const { page, requests } = fixture;
    await startInA(fixture, true);
    await send(page, "パン屋を探して");
    await button(page, "候補に切替").click();
    await page.evaluate(() => window.__mock.map.finishCameraGesture());
    // The next successful send acts as a barrier for the released waiter.
    await button(page, "地図に切替").click();
    fixture.config.prefix = "replacement";
    await send(page, "花屋を探して");
    await row(page, "replacement-1").waitFor();
    assert.equal(requests("/api/chat").length, 2);
    assert.doesNotMatch(
      JSON.stringify(requests("/api/chat")[1].body.messages),
      /パン屋/,
    );
  },
  async "second chat search posts the camera at submit"(fixture) {
    const { page, config, requests } = fixture;
    const first = await startInA(fixture);
    config.prefix = "second";
    await input(page).fill("パン屋を探して");
    const submitted = await submitAndMove(page, button(page, "送信"));
    assert.ok(submitted.south > first.north);
    await row(page, "second-1").waitFor();
    assert.deepEqual(requests("/api/chat")[1].body.viewport, submitted);
  },
  async "manual Places rectangle survives camera changes during preparation"(
    fixture,
  ) {
    const { page, config, requests, view } = fixture;
    const first = await startInA(fixture);
    await page.getByText("手動で検索", { exact: true }).click();
    const form = page.locator("[data-manual-search-form]");
    await form.getByLabel("検索ワード").fill("パン屋");
    await form.getByLabel("評価条件").fill("静かさ");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    config.handlers["/api/generate-examples"] = async (route) => {
      await held;
      await route.fulfill({
        json: { examples: "1 ... なし, 5 ... あり", searchQuery: "パン屋" },
      });
    };
    config.handlers["/api/places/search"] = (route) =>
      route.fulfill({ json: { places: [] } });
    const prepared = page.waitForRequest("**/api/generate-examples");
    const submitted = await submitAndMove(
      page,
      form.getByRole("button", { name: "検索", exact: true }),
    );
    await prepared;
    if (view === "phone") {
      await page.locator("[data-sheet-handle]").press("ArrowDown");
    }
    const searched = page.waitForRequest("**/api/places/search");
    release();
    const request = await searched;
    assert.ok(submitted.south > first.north);
    assert.equal(requests("/api/chat").length, 1);
    assert.deepEqual(request.postDataJSON().rectangle, {
      low: { lat: submitted.south, lng: submitted.west },
      high: { lat: submitted.north, lng: submitted.east },
    });
  },
});
