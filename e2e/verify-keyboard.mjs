import assert from "node:assert/strict";
import { input, runSuite, send } from "./root-fixture.mjs";

const geometry = (page) =>
  page.evaluate(() => ({
    bounds: window.__mock.map.getBounds().toJSON(),
    center: window.__mock.map.getCenter().toJSON(),
    pans: window.__mock.pans.length,
    fits: window.__mock.fits.length,
    map: window.__mock.map.getDiv().getBoundingClientRect().toJSON(),
  }));

async function viewport(page, height, top) {
  await page.evaluate(
    async ({ height, top }) => {
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: height },
        offsetTop: { configurable: true, value: top },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
      window.visualViewport.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    },
    { height, top },
  );
}

await runSuite({
  async "focus, animated keyboard, visual scroll and dismissal"({
    page,
    view,
    calls,
  }) {
    await send(page, "電源があるカフェ");
    await page.locator('[data-fetch-state="unknown"]').waitFor();
    const composer = input(page);
    const handle = page.locator("[data-sheet-handle]");
    const sheet = page.locator("aside");
    if (view === "phone") {
      await handle.press("ArrowDown");
      await page.locator('aside[data-sheet-height="collapsed"]').waitFor();
    }
    const fullHeight = await page.evaluate(() => visualViewport.height);
    await viewport(page, fullHeight, 0);
    const before = await geometry(page);
    const initialSheet = await sheet.boundingBox();
    const requestCount = calls.length;
    await composer.focus();
    assert.ok(
      await composer.evaluate(
        (el) => parseFloat(getComputedStyle(el).fontSize) >= 16,
      ),
    );
    assert.deepEqual(await sheet.boundingBox(), initialSheet);
    if (view === "desktop") return;
    for (const [height, top] of [
      [580, 0],
      [360, 40],
      [310, 105],
      [310, 52],
    ]) {
      await viewport(page, height, top);
      const box = await composer.boundingBox();
      const panel = await sheet.boundingBox();
      assert.ok(box.y >= top && box.y + box.height <= height + top);
      assert.ok(
        panel.y >= top && Math.abs(panel.y + panel.height - (height + top)) < 1,
      );
      assert.deepEqual(await geometry(page), before);
    }
    assert.ok(
      await page.locator("[data-panel-body]").evaluate((body) => {
        const scroll = [...body.querySelectorAll("*")].find(
          (el) =>
            getComputedStyle(el).overflowY === "auto" &&
            el.scrollHeight > el.clientHeight,
        );
        if (!scroll || scroll.clientHeight < 48) return false;
        scroll.scrollTop = 40;
        return scroll.scrollTop > 0;
      }),
      "thread scrolls above the composer on a short viewport",
    );
    // A mobile keyboard can dismiss without blurring the field.
    await viewport(page, fullHeight, 0);
    assert.deepEqual(await sheet.boundingBox(), initialSheet);
    assert.equal(await sheet.getAttribute("data-sheet-height"), "collapsed");
    assert.deepEqual(await geometry(page), before);
    assert.equal(calls.length, requestCount);
    await handle.press("ArrowUp");
    await page.locator('aside[data-sheet-height="half"]').waitFor();
  },
});
