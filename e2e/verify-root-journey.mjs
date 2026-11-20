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

    const center = await page.evaluate(() =>
      window.__mock.map.getCenter().toJSON(),
    );
    await button(page, /徒歩時間を比べる/).click();
    const compare = button(page, /選んだ2店を比較/);
    assert.ok(await compare.isDisabled());
    await row(page, ids[1]).click();
    assert.ok(await compare.isDisabled());
    // Moving the map after comparison starts must not silently change origin.
    await page.evaluate(() => {
      window.__mock.map.setCenter(new google.maps.LatLng(36, 140));
    });
    await row(page, ids[0]).click();
    await row(page, ids[2]).click();
    assert.equal(await row(page, ids[2]).getAttribute("aria-pressed"), "false");
    assert.equal(requests(walkingPath).length, 0);
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
    await compare.click();
    await page
      .getByRole("alert")
      .filter({ hasText: "徒歩経路を取得できません。" })
      .waitFor();
    config.handlers[walkingPath] = (route, body) =>
      route.fulfill({
        json: {
          routes: body.placeIds.map((placeId, i) => ({
            placeId,
            durationSeconds: i ? null : 421,
          })),
        },
      });
    await compare.click();
    const duration = page.getByText(/約\s*8\s*分/);
    await duration.waitFor();
    assert.match(await duration.locator("..").innerText(), /quota-2/);
    assert.match(
      await page
        .getByText("取得できませんでした", { exact: true })
        .locator("..")
        .innerText(),
      /quota-1/,
    );
    assert.deepEqual(
      requests(walkingPath).map((c) => c.body),
      Array(2).fill({ origin: center, placeIds: [ids[1], ids[0]] }),
    );
    assert.notEqual(requests(walkingPath)[0].run, requests(walkingPath)[1].run);
    // Change the pair through the map as well as the ranked list. The second
    // comparison now has two known times, returned in reverse order by ID.
    await row(page, ids[0]).click();
    await button(page, `mock pin ${ids[2]}`).click();
    config.handlers[walkingPath] = (route) =>
      route.fulfill({
        json: {
          routes: [
            { placeId: ids[2], durationSeconds: 600 },
            { placeId: ids[1], durationSeconds: 300 },
          ],
        },
      });
    await compare.click();
    const ten = page.getByText(/約\s*10\s*分/);
    await ten.waitFor();
    assert.match(await ten.locator("..").innerText(), /quota-3/);
    assert.match(
      await page
        .getByText(/約\s*5\s*分/)
        .locator("..")
        .innerText(),
      /quota-2/,
    );
    assert.deepEqual(requests(walkingPath)[2].body, {
      origin: center,
      placeIds: [ids[1], ids[2]],
    });
    await button(page, "比較を閉じる").click();
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
  },
});
