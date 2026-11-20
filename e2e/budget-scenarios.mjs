import assert from "node:assert/strict";
import { analysisPath, button, input, send } from "./root-fixture.mjs";

export const budgetScenarios = Object.fromEntries(
  [
    "BUDGET_RUN_EXCEEDED",
    "BUDGET_SESSION_EXCEEDED",
    "BUDGET_MONTH_EXCEEDED",
    "BUDGET_UNAVAILABLE",
  ].map((code) => [
    code,
    async ({ page, config, requests }) => {
      config.count = 12;
      const message = `検証用の予算エラー: ${code}`;
      config.handlers[analysisPath] = (route, body) =>
        body.reviews[0] === "REVIEW:quota-2"
          ? route.fulfill({
              status: code === "BUDGET_UNAVAILABLE" ? 503 : 429,
              json: { error: { code, message } },
            })
          : route.fulfill({ json: { value: 4, reviewNumbers: [1] } });
      await send(page, "カフェを探して");
      await page.getByRole("alert").filter({ hasText: message }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-fetch-state="evaluated"]').length ===
            4 && !document.querySelector('[data-fetch-state="analyzing"]'),
      );
      assert.equal(
        requests(analysisPath).length,
        5,
        "budget refusal stops subsequent batches",
      );
      assert.equal(
        await page.locator('[data-fetch-state="failed"]').count(),
        1,
      );
      const firstRun = requests("/api/chat")[0].run;
      await button(page, "地図に切替").click();
      await input(page).fill("カフェを探して");
      if (["BUDGET_RUN_EXCEEDED", "BUDGET_UNAVAILABLE"].includes(code)) {
        delete config.handlers[analysisPath];
        await button(page, "送信").click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[data-fetch-state="evaluated"]')
              .length === 11,
        );
        assert.notEqual(requests("/api/chat")[1].run, firstRun);
      } else {
        assert.ok(await button(page, "送信").isDisabled());
        await input(page).press("Enter");
        assert.equal(requests("/api/chat").length, 1);
      }
    },
  ]),
);
