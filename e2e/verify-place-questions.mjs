import assert from "node:assert/strict";
import {
  analysisPath,
  button,
  input,
  questionPath,
  ranked,
  row,
  runSuite,
  send,
} from "./root-fixture.mjs";

await runSuite({
  async "single composer, isolated branch questions and cited sources"({
    page,
    config,
    requests,
  }) {
    config.handlers[questionPath] = (route, body) =>
      route.fulfill({
        json: body.question.includes("静か")
          ? { answer: "口コミからは分かりません。", reviewNumbers: [] }
          : {
              answer: "電源についての回答です。",
              reviewNumbers: body.placeId === "quota-3" ? [3, 1] : [1],
            },
      });
    await send(page, "電源があるカフェを探して");
    await page.locator('[data-fetch-state="unknown"]').waitFor();
    const ids = await ranked(page);
    const back = button(page, /候補一覧へ/);
    await row(page, "quota-3").click();
    const composer = input(page);
    assert.match(
      await composer.locator("xpath=ancestor::form").innerText(),
      /送信先[\s\S]*quota-3/,
    );
    assert.equal(await composer.getAttribute("maxlength"), "300");
    await composer.fill("あ".repeat(301));
    assert.equal((await composer.inputValue()).length, 300);
    await composer.dispatchEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
    });
    assert.equal(requests(questionPath).length, 0);
    await send(page, "電源はありますか？");
    const turns = page.locator("[data-question-turn]");
    await turns.first().getByText("電源についての回答です。").waitFor();
    const first = requests(questionPath)[0].body;
    assert.equal(first.placeId, "quota-3");
    assert.deepEqual(first.history, []);
    assert.deepEqual(first.reviews, [
      "REVIEW:quota-3",
      "根拠 2: quota-3",
      "根拠 3: quota-3",
    ]);
    await turns.first().getByText("根拠の口コミ 2件").click();
    assert.match(
      await turns.first().innerText(),
      /根拠 3: quota-3[\s\S]*投稿者 quota-3\/3[\s\S]*REVIEW:quota-3[\s\S]*投稿者 quota-3/,
    );
    assert.ok(
      await turns
        .first()
        .locator('a[href="https://example.invalid/review/quota-3/3"]')
        .isVisible(),
    );
    await send(page, "静かですか？");
    await turns.nth(1).getByText("口コミからは分かりません。").waitFor();
    assert.equal(await turns.nth(1).locator("summary").count(), 0);
    assert.deepEqual(requests(questionPath)[1].body.history, [
      { question: first.question, answer: "電源についての回答です。" },
    ]);
    await back.click();
    assert.deepEqual(await ranked(page), ids);
    await row(page, "quota-1").click();
    assert.equal(await turns.count(), 0);
    await button(page, "電源はありますか？").click();
    await turns.first().getByText("電源についての回答です。").waitFor();
    assert.deepEqual(requests(questionPath)[2].body.history, []);
    assert.equal(requests(questionPath)[2].body.question, "電源はありますか？");
    assert.deepEqual(requests(questionPath)[2].body.reviews, [
      "REVIEW:quota-1",
    ]);
    await back.click();
    await row(page, "quota-3").click();
    assert.equal(await turns.count(), 2);
    assert.equal(
      new Set(requests(questionPath).map((call) => call.run)).size,
      3,
    );
    assert.equal(requests("/api/chat").length, 1);
    assert.equal(requests(analysisPath).length, 3);
  },
});
