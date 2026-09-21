import assert from "node:assert/strict";

export const serverErrorMessage =
  "場所検索サーバーに接続できません。しばらくしてから再検索してください。";
export const weekdayDescriptions = [
  "月曜日: 9時00分～18時00分",
  "火曜日: 9時00分～18時00分",
  "水曜日: 9時00分～18時00分",
  "木曜日: 9時00分～18時00分",
  "金曜日: 9時00分～20時00分",
  "土曜日: 10時00分～18時00分",
  "日曜日: 定休日",
];
const photoUri =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%2399bbdd"/%3E%3C/svg%3E';

// Both suites use real browser fetch, intercepted before the Next.js handlers.
export function placesRoutes(page, audit) {
  audit.searchRequests = [];
  audit.detailRequests = [];
  audit.analysisRequests ??= [];
  audit.headerRequests = [];
  audit.headerErrors = [];
  const runs = new Map();
  let currentRun;
  const candidateRuns = new Map();
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const candidates = new Map();
  return async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/places/") ||
      path === "/api/generate-examples" ||
      path === "/api/analyze-reviews"
    ) {
      const headers = await request.allHeaders();
      const sessionId = headers["x-session-id"];
      const runId = headers["x-run-id"];
      audit.headerRequests.push({ path, sessionId, runId });
      try {
        assert.match(sessionId ?? "", uuidV4, `${path}: session UUID v4`);
        assert.match(runId ?? "", uuidV4, `${path}: run UUID v4`);
        audit.sessionId ??= sessionId;
        assert.equal(
          sessionId,
          audit.sessionId,
          "Session must remain stable in this tab",
        );
        assert.equal(
          sessionId,
          await page.evaluate(() =>
            sessionStorage.getItem("maps-llm-session-id"),
          ),
        );
        if (path === "/api/generate-examples") {
          assert.ok(
            !runs.has(runId),
            "Every search must create a new run UUID",
          );
          runs.set(runId, request.postDataJSON().searchTerm);
          currentRun = runId;
        } else {
          assert.ok(
            runs.has(runId),
            `${path}: run must start with generate-examples`,
          );
          if (path === "/api/places/search") {
            assert.equal(
              runId,
              currentRun,
              "Search must reuse its generate-examples run",
            );
            assert.equal(request.postDataJSON().textQuery, runs.get(runId));
          } else {
            const id =
              path === "/api/analyze-reviews"
                ? request.postDataJSON().reviews.replace("REVIEW:", "")
                : decodeURIComponent(path.split("/").at(-1));
            assert.equal(
              runId,
              candidateRuns.get(id),
              `${id}: must reuse its search run, including extra batches`,
            );
          }
        }
      } catch (error) {
        audit.headerErrors.push(error.message);
        await route.abort();
        return true;
      }
    }
    if (!path.startsWith("/api/places/")) return false;
    const config = await page.evaluate(() => window.__mock.config);
    if (path === "/api/places/search") {
      assert.equal(request.method(), "POST");
      const body = request.postDataJSON();
      audit.searchRequests.push(body);
      assert.equal(typeof body.textQuery, "string");
      assert.ok(body.textQuery.length > 0);
      const { low, high } = body.rectangle;
      for (const point of [low, high]) {
        assert.ok(Number.isFinite(point.lat) && Math.abs(point.lat) <= 90);
        assert.ok(Number.isFinite(point.lng) && Math.abs(point.lng) <= 180);
      }
      assert.ok(low.lat < high.lat && low.lng < high.lng);
      if (body.openNow !== undefined)
        assert.equal(typeof body.openNow, "boolean");
      if (body.maxResultCount !== undefined)
        assert.ok(
          Number.isInteger(body.maxResultCount) &&
            body.maxResultCount >= 1 &&
            body.maxResultCount <= 20,
        );
      if (config.searchError) {
        await route.fulfill({
          status: config.searchError.status,
          json: { error: config.searchError.error },
        });
        return true;
      }
      const places = Array.from({ length: config.count }, (_, i) => ({
        placeId: `${body.textQuery}-${i + 1}`,
        name: `${body.textQuery} 店舗${i + 1}`,
        address: "東京都 モック区 検証町1-2-3",
        location: { lat: 35.7 + i * 0.001, lng: 139.7 + i * 0.001 },
        googleMapsUri: "https://example.invalid/mock-place",
      }));
      places.forEach((place) => {
        candidates.set(place.placeId, place);
        candidateRuns.set(place.placeId, request.headers()["x-run-id"]);
      });
      await page.evaluate((places) => {
        places.forEach((place, i) => {
          window.__mock.positions[
            `${place.location.lat},${place.location.lng}`
          ] = {
            ...place.location,
            id: place.placeId,
            x: 0.16 + (i % 4) * 0.22,
            y:
              0.17 +
              Math.floor(i / 4) *
                Math.min(
                  0.16,
                  0.64 / Math.max(1, Math.ceil(places.length / 4) - 1),
                ),
          };
        });
      }, places);
      await route.fulfill({ json: { places } });
    } else {
      assert.equal(request.method(), "GET");
      const id = decodeURIComponent(path.split("/").at(-1));
      audit.detailRequests.push(id);
      assert.ok(candidates.has(id), `Unknown candidate ${id}`);
      if (config.detailErrors?.[id]) {
        await route.fulfill({
          status: config.detailErrors[id].status,
          json: { error: config.detailErrors[id].error },
        });
      } else if (config.fail.includes(id)) {
        await route.fulfill({
          status: 429,
          json: {
            error: {
              code: "RESOURCE_EXHAUSTED",
              message:
                "Google Places の利用上限に達しました。時間をおいて再検索してください。",
            },
          },
        });
      } else {
        const n = Number(id.split("-").at(-1));
        await route.fulfill({
          json: {
            ...candidates.get(id),
            name: `${id} 詳細店舗`,
            ...(n === 5 ? {} : { rating: 4, userRatingCount: 42 + n }),
            openNow: n % 2 === 1,
            weekdayDescriptions,
            websiteUri: `https://example.invalid/site/${id}`,
            reviews: [
              {
                text: `REVIEW:${id}`,
                rating: 4,
                publishTime: "2026-09-14T03:00:00Z",
                relativePublishTimeDescription: "1週間前",
                author: {
                  name: `投稿者 ${id}`,
                  ...(n === 5
                    ? {}
                    : {
                        uri: `https://example.invalid/author/${id}`,
                        photoUri,
                      }),
                },
                googleMapsUri: `https://example.invalid/review/${id}`,
              },
            ],
          },
        });
      }
    }
    return true;
  };
}
