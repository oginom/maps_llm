import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { registerPlaces } from "./places-routes.mjs";

const base = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3107");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
assert.ok(base.port && base.port !== "3000", "Use an isolated test server");
const uuid =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export const analysisPath = "/api/analyze-reviews";
export const questionPath = "/api/place-question";
export const walkingPath = "/api/walking-comparison";

// Exercise the actual Next page, UI message stream and browser fetch/abort
// implementation. No API request (including an unrecognized one) goes through.
export async function runSuite(scenarios) {
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  );
  const browser = await chromium.launch({
    executablePath: process.env.E2E_CHROMIUM_PATH,
  });
  try {
    for (const [view, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 },
      phone: { width: 390, height: 844 },
    })) {
      for (const [name, scenario] of Object.entries(scenarios)) {
        const context = await browser.newContext({
          viewport,
          serviceWorkers: "block",
          hasTouch: view === "phone",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [],
          calls = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const config = {
          prefix: "quota",
          count: 3,
          noReviews: [],
          handlers: {},
        };
        const requests = (path) => calls.filter((call) => call.path === path);
        await context.addInitScript({
          path: fileURLToPath(new URL("maps-mock.js", import.meta.url)),
        });
        await context.route("**/*", async (route) => {
          const req = route.request(),
            url = new URL(req.url()),
            path = url.pathname;
          try {
            assert.equal(
              url.origin,
              base.origin,
              `External request blocked: ${url.origin}${path}`,
            );
            if (!path.startsWith("/api/")) return await route.continue();
            assert.equal(req.method(), "POST");
            const body = req.postDataJSON(),
              headers = await req.allHeaders();
            const run = headers["x-run-id"],
              session = headers["x-session-id"];
            assert.match(run ?? "", uuid, path);
            assert.match(session ?? "", uuid, path);
            if (calls.length)
              assert.equal(session, calls[0].session, "stable tab session");
            calls.push({ path, body, run, session });
            if (config.handlers[path])
              return await config.handlers[path](route, body);
            if (path === "/api/chat") {
              const { north, south, east, west } = body.viewport;
              assert.ok(north > south && east > west, "chat uses map bounds");
              assert.doesNotMatch(
                JSON.stringify(body.messages),
                /REVIEW:|example\.invalid\/author/,
              );
              const places = await registerPlaces(
                page,
                config.prefix,
                config.count,
                config.noReviews,
              );
              const input = {
                textQuery: "カフェ",
                evaluation: "電源",
                examples: "1 ... なし, 5 ... あり",
              };
              const chunks = [
                { type: "start", messageId: `answer-${run}` },
                { type: "start-step" },
                {
                  type: "tool-input-available",
                  toolCallId: run,
                  toolName: "search_places",
                  input,
                },
                {
                  type: "tool-output-available",
                  toolCallId: run,
                  output: { ...input, searchId: run, places },
                },
                { type: "finish-step" },
                { type: "finish", finishReason: "stop" },
              ];
              return await route.fulfill({
                contentType: "text/event-stream",
                body:
                  chunks
                    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                    .join("") + "data: [DONE]\n\n",
              });
            }
            if (path === analysisPath) {
              const n = Number(body.reviews[0].split("-").at(-1));
              const value =
                n === 3
                  ? null
                  : body.metric === "電源"
                    ? n === 1
                      ? 5
                      : 2
                    : n === 1
                      ? 2
                      : 5;
              return await route.fulfill({
                json: { value, reviewNumbers: value === null ? [] : [1] },
              });
            }
            throw new Error(`Unexpected API: ${path}`);
          } catch (error) {
            errors.push(error.message);
            await route.abort().catch(() => {});
          }
        });
        try {
          await page.goto(new URL("/?lat=35.7&lng=139.7&zoom=10", base).href, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await page.waitForFunction(() => Boolean(window.__mock.map));
          await scenario({ page, view, config, calls, requests });
          assert.deepEqual(errors, []);
          console.log(`PASS ${view}: ${name}`);
        } catch (cause) {
          throw new Error(
            `${view}: ${name}\n${errors.join("\n")}\nCalls: ${calls.map((c) => c.path).join(", ")}\n${(await page.locator("body").innerText()).slice(-2200)}`,
            { cause },
          );
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}

export const input = (page) => page.getByRole("textbox");
export async function send(page, text) {
  assert.equal(await input(page).count(), 1, "one visible composer");
  await input(page).fill(text);
  await page.getByRole("button", { name: "送信", exact: true }).click();
}
export const row = (page, id) => page.locator(`[data-result-id="${id}"]`);
export const button = (page, name) => page.getByRole("button", { name });
export const ranked = (page) =>
  page
    .locator("[data-result-id]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.resultId));
export const pins = (page) =>
  page
    .locator("[data-place-id]")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [node.dataset.placeId, node.textContent]),
      ),
    );
