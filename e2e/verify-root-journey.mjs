import assert from "node:assert/strict";
import {
  analysisPath,
  button,
  input,
  pins,
  ranked,
  row,
  runSuite,
  send,
  walkingPath,
} from "./root-fixture.mjs";

await runSuite({
  async "search → rerank → walk → switch search scope"({
    page,
    config,
    requests,
    calls,
  }) {
    const ids = ["quota-1", "quota-2", "quota-3"];
    await send(page, "この地図で電源があるカフェを探して");
    await page.locator('[data-fetch-state="unknown"]').waitFor();
    assert.deepEqual(await ranked(page), ids);
    assert.equal(await page.locator("[data-manual-search-toggle]").count(), 0);
    const original = await pins(page);
    assert.deepEqual(
      original,
      Object.fromEntries(ids.map((id, index) => [id, String(index + 1)])),
    );
    assert.deepEqual(
      requests(analysisPath).map((c) => c.run),
      Array(3).fill(requests("/api/chat")[0].run),
    );

    // An ambiguous condition asks for a scope; it must not buy a search.
    const count = calls.length;
    await send(page, "静かさ");
    const clarify = button(page, "今の候補を評価し直す");
    await clarify.waitFor();
    assert.equal(calls.length, count);
    await clarify.click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-result-id]")?.dataset.resultId ===
          "quota-2" && document.querySelector('[data-fetch-state="unknown"]'),
    );
    assert.deepEqual(await ranked(page), ["quota-2", "quota-1", "quota-3"]);
    assert.deepEqual(await pins(page), original);
    const reranks = requests(analysisPath).slice(3);
    assert.deepEqual(
      reranks.map((c) => c.body.reviews[0]).sort(),
      ids.map((id) => `REVIEW:${id}`),
    );
    assert.ok(
      reranks.every(
        (c) => c.body.metric.includes("静かさ") && c.run === reranks[0].run,
      ),
    );
    assert.notEqual(reranks[0].run, requests("/api/chat")[0].run);
    assert.equal(requests("/api/chat").length, 1);

    await row(page, ids[1]).click();
    await button(page, /候補一覧へ/).click();
    await button(page, "地図に切替").click();
    await button(page, "候補に切替").click();
    assert.equal(requests(walkingPath).length, 0);
    const beforeWalking = calls.length;
    const center = await page.evaluate(() =>
      window.__mock.map.getCenter().toJSON(),
    );
    const walkingPrompt = "この中で徒歩が近い順に";
    const release = Promise.withResolvers();
    const routes = [
      { placeId: ids[1], durationSeconds: null },
      { placeId: ids[2], durationSeconds: 421 },
      { placeId: ids[0], durationSeconds: 299 },
    ];
    config.handlers[walkingPath] = async (route) => {
      await release.promise;
      await route.fulfill({ json: { routes } });
    };
    await Promise.all([
      page.waitForRequest((req) => req.url().endsWith(walkingPath)),
      send(page, walkingPrompt),
    ]);
    await page.evaluate(() => {
      window.__mock.map.setCenter(new google.maps.LatLng(36, 140));
    });
    release.resolve();
    const five = page.getByText(/約\s*5\s*分/);
    const eight = page.getByText(/約\s*8\s*分/);
    const unknown = page.getByText("時間を取得できませんでした", {
      exact: true,
    });
    await five.waitFor();
    for (const [duration, id] of [
      [five, ids[0]],
      [eight, ids[2]],
      [unknown, ids[1]],
    ]) {
      assert.match(await duration.locator("..").innerText(), new RegExp(id));
    }
    assert.deepEqual(await ranked(page), [ids[0], ids[2], ids[1]]);
    assert.equal(requests(walkingPath).length, 1);
    assert.deepEqual(requests(walkingPath)[0].body.origin, center);

    config.handlers[walkingPath] = (route) =>
      route.fulfill({
        status: 502,
        json: {
          error: {
            code: "ROUTES_UPSTREAM_ERROR",
            message: "徒歩経路を取得できません。",
          },
        },
      });
    await send(page, walkingPrompt);
    await page
      .getByRole("alert")
      .filter({ hasText: "徒歩経路を取得できません。" })
      .waitFor();
    assert.equal(
      await five.count(),
      0,
      "discard the previous result on failure",
    );
    await input(page).fill(walkingPrompt);
    assert.equal(requests(walkingPath).length, 2, "no retry before submission");
    config.handlers[walkingPath] = (route) =>
      route.fulfill({
        json: {
          routes: routes.map((r) => ({ ...r, durationSeconds: 600 })),
        },
      });
    await send(page, walkingPrompt);
    const ten = page.getByText(/約\s*10\s*分/);
    await ten.nth(2).waitFor();
    const comparisons = calls.slice(beforeWalking);
    assert.deepEqual(
      comparisons.map((c) => c.path),
      Array(3).fill(walkingPath),
    );
    for (const call of comparisons) {
      assert.deepEqual([...call.body.placeIds].sort(), ids);
    }
    for (const call of comparisons.slice(1))
      assert.deepEqual(call.body.origin, { lat: 36, lng: 140 });
    assert.equal(
      new Set([
        requests("/api/chat")[0].run,
        reranks[0].run,
        ...comparisons.map((c) => c.run),
      ]).size,
      5,
    );
    await button(page, "徒歩比較を閉じる").click();
    assert.deepEqual(await pins(page), original);
    await button(page, /電源で評価し直す/).click();
    await page.waitForFunction(
      () =>
        window.__mock.analyses.length === 9 &&
        document.querySelector('[data-fetch-state="unknown"]'),
    );
    assert.deepEqual(
      requests(analysisPath)
        .slice(6)
        .map((call) => call.body.metric),
      Array(3).fill("電源が使いやすい"),
    );
    assert.equal(requests("/api/chat").length, 1);
    await button(page, "地図に切替").click();
    assert.equal(await page.locator("[data-manual-search-toggle]").count(), 0);
    assert.match(
      await input(page).locator("xpath=ancestor::form").innerText(),
      /表示中の地図/,
    );
    await button(page, "候補に切替").click();
    assert.match(
      await input(page).locator("xpath=ancestor::form").innerText(),
      /今の候補/,
    );
    await button(page, "地図に切替").click();
    config.prefix = "new";
    await send(page, "パン屋を探して");
    await row(page, "new-1").waitFor();
    assert.equal(requests("/api/chat").length, 2);
    assert.notEqual(requests("/api/chat")[0].run, requests("/api/chat")[1].run);
    assert.equal(await row(page, "quota-1").count(), 0);
    assert.equal(await ten.count(), 0);
    assert.equal(requests(walkingPath).length, 3);
  },
  async "one matrix for 20 candidates, discarded by replacement search"({
    page,
    config,
    requests,
    calls,
  }) {
    const ids = Array.from({ length: 20 }, (_, i) => `quota-${i + 1}`);
    config.count = ids.length;
    config.noReviews = ids;
    await send(page, "カフェを探して");
    await row(page, ids.at(-1)).waitFor();
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/api/chat"],
    );
    config.handlers[walkingPath] = (route) =>
      route.fulfill({
        json: {
          routes: ids.map((placeId, i) => ({
            placeId,
            durationSeconds: (20 - i) * 60,
          })),
        },
      });
    await send(page, "この中で徒歩が近い順に");
    await row(page, ids.at(-1))
      .getByText(/約\s*1\s*分/)
      .waitFor();
    assert.deepEqual(await ranked(page), [...ids].reverse());
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/api/chat", walkingPath],
    );
    assert.deepEqual(
      [...requests(walkingPath)[0].body.placeIds].sort(),
      [...ids].sort(),
    );
    await button(page, "地図に切替").click();
    config.prefix = "bakery";
    config.count = 1;
    config.noReviews = ["bakery-1"];
    await send(page, "パン屋を探して");
    await row(page, "bakery-1").waitFor();
    assert.deepEqual(await ranked(page), ["bakery-1"]);
    assert.equal(await page.getByText(/約\s*\d+\s*分/).count(), 0);
    assert.equal(requests(walkingPath).length, 1);
  },
});
