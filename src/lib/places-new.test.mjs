import assert from "node:assert/strict";
import test from "node:test";
import {
  PlacesApiError,
  SEARCH_FIELD_MASK,
  SEARCH_QUOTA_MESSAGE,
  mapSearchResponse,
  searchText,
  toPlacesApiError,
} from "./places-new.ts";

const rawPlace = {
  id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  displayName: { text: "カフェ A", languageCode: "ja" },
  formattedAddress: "東京都千代田区1-1",
  location: { latitude: 35.68, longitude: 139.76 },
  googleMapsUri: "https://maps.google.com/?cid=1",
  rating: 4.4,
  userRatingCount: 120,
  currentOpeningHours: { openNow: true },
  regularOpeningHours: { weekdayDescriptions: ["月曜日: 9時00分～18時00分"] },
  websiteUri: "https://example.com",
  reviews: [
    {
      name: "places/ChIJ/reviews/1",
      rating: 5,
      text: { text: "全席に電源があります。", languageCode: "ja" },
      publishTime: "2026-01-02T03:04:05Z",
      relativePublishTimeDescription: "1 か月前",
      authorAttribution: {
        displayName: "投稿者 A",
        uri: "https://www.google.com/maps/contrib/1",
        photoUri: "https://lh3.googleusercontent.com/a",
      },
      googleMapsUri: "https://www.google.com/maps/reviews/1",
      flagContentUri: "https://www.google.com/local/review/rap/report?1",
    },
    {
      rating: 3,
      text: { text: "普通です。", languageCode: "ja" },
      publishTime: "2025-12-01T00:00:00Z",
      relativePublishTimeDescription: "2 か月前",
      authorAttribution: { displayName: "投稿者 B" },
    },
    { rating: 4, relativePublishTimeDescription: "3 か月前" },
  ],
};

const rawSearchResponse = {
  places: [
    rawPlace,
    { id: "no-location" },
    { location: rawPlace.location },
    { id: "ChIJ-second", location: { latitude: 35.69, longitude: 139.77 } },
  ],
};

const searchInput = {
  textQuery: "電源 カフェ",
  rectangle: {
    low: { lat: 35.6, lng: 139.7 },
    high: { lat: 35.7, lng: 139.8 },
  },
  openNow: true,
  pageSize: 8,
};

test("maps bundled details and attribution, skipping places without id or location", () => {
  const places = mapSearchResponse(rawSearchResponse);
  assert.equal(places.length, 2);
  const [detail, minimal] = places;
  assert.deepEqual(mapSearchResponse({}), []);
  assert.deepEqual(detail, {
    placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    name: "カフェ A",
    address: "東京都千代田区1-1",
    location: { lat: 35.68, lng: 139.76 },
    googleMapsUri: "https://maps.google.com/?cid=1",
    rating: 4.4,
    userRatingCount: 120,
    openNow: true,
    weekdayDescriptions: ["月曜日: 9時00分～18時00分"],
    websiteUri: "https://example.com",
    reviews: [
      {
        text: "全席に電源があります。",
        rating: 5,
        publishTime: "2026-01-02T03:04:05Z",
        relativePublishTimeDescription: "1 か月前",
        author: {
          name: "投稿者 A",
          uri: "https://www.google.com/maps/contrib/1",
          photoUri: "https://lh3.googleusercontent.com/a",
        },
        googleMapsUri: "https://www.google.com/maps/reviews/1",
      },
      {
        text: "普通です。",
        rating: 3,
        publishTime: "2025-12-01T00:00:00Z",
        relativePublishTimeDescription: "2 か月前",
        author: { name: "投稿者 B" },
      },
    ],
  });
  assert.equal("flagContentUri" in detail.reviews[0], false);
  assert.deepEqual(minimal.reviews, []);
  assert.equal(minimal.rating, undefined);
  assert.equal(
    minimal.googleMapsUri,
    "https://www.google.com/maps/place/?q=place_id:ChIJ-second",
  );
});

test("converts Google error bodies: 429 quota, 403 permission, 400 argument", () => {
  const quota = toPlacesApiError(
    429,
    {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'Text Search requests'",
      },
    },
    SEARCH_QUOTA_MESSAGE,
  );
  assert.ok(quota instanceof PlacesApiError);
  assert.equal(quota.httpStatus, 429);
  assert.equal(quota.googleStatus, "RESOURCE_EXHAUSTED");
  assert.equal(quota.message, SEARCH_QUOTA_MESSAGE);

  const denied = toPlacesApiError(
    403,
    {
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        message: "Places API (New) has not been used in project 1 before",
      },
    },
    SEARCH_QUOTA_MESSAGE,
  );
  assert.equal(denied.httpStatus, 502);
  assert.equal(denied.googleStatus, "PERMISSION_DENIED");
  assert.match(denied.message, /PERMISSION_DENIED/);
  assert.match(denied.message, /has not been used/);

  const invalid = toPlacesApiError(
    400,
    {
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "Invalid FieldMask",
      },
    },
    SEARCH_QUOTA_MESSAGE,
  );
  assert.equal(invalid.httpStatus, 400);
  assert.equal(invalid.message, "Invalid FieldMask");

  // Non-JSON 5xx bodies still map without throwing.
  const outage = toPlacesApiError(503, undefined, SEARCH_QUOTA_MESSAGE);
  assert.equal(outage.httpStatus, 502);
  assert.equal(outage.googleStatus, "HTTP_503");
});

const withKey = async (run) => {
  const previous = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    else process.env.GOOGLE_MAPS_SERVER_API_KEY = previous;
  }
};

test("searchText sends the fixed mask, key, viewport and page size", async () => {
  await withKey(async () => {
    const calls = [];
    const fetchImplementation = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(rawSearchResponse), { status: 200 });
    };
    const controller = new AbortController();
    const places = await searchText(searchInput, {
      signal: controller.signal,
      fetchImplementation,
    });
    assert.equal(places.length, 2);
    assert.equal(places[0].reviews[0].author.name, "投稿者 A");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://places.googleapis.com/v1/places:searchText",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.signal, controller.signal);
    assert.equal(calls[0].init.headers["X-Goog-Api-Key"], "test-key");
    assert.equal(calls[0].init.headers["X-Goog-FieldMask"], SEARCH_FIELD_MASK);
    assert.deepEqual(
      SEARCH_FIELD_MASK.split(",").sort(),
      [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "googleMapsUri",
        "rating",
        "userRatingCount",
        "currentOpeningHours.openNow",
        "regularOpeningHours.weekdayDescriptions",
        "websiteUri",
        "reviews.text",
        "reviews.rating",
        "reviews.publishTime",
        "reviews.relativePublishTimeDescription",
        "reviews.authorAttribution",
        "reviews.googleMapsUri",
      ]
        .map((field) => `places.${field}`)
        .sort(),
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      textQuery: "電源 カフェ",
      locationRestriction: {
        rectangle: {
          low: { latitude: 35.6, longitude: 139.7 },
          high: { latitude: 35.7, longitude: 139.8 },
        },
      },
      pageSize: 8,
      languageCode: "ja",
      regionCode: "JP",
      openNow: true,
    });
  });
});

test("searchText maps quota and non-JSON HTTP failures", async () => {
  await withKey(async () => {
    const quota = async () =>
      new Response(
        JSON.stringify({
          error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "x" },
        }),
        { status: 429 },
      );
    await assert.rejects(
      searchText(searchInput, { fetchImplementation: quota }),
      { httpStatus: 429, message: SEARCH_QUOTA_MESSAGE },
    );

    const html = async () =>
      new Response("<html>Bad Gateway</html>", { status: 502 });
    await assert.rejects(
      searchText(searchInput, { fetchImplementation: html }),
      { httpStatus: 502, googleStatus: "HTTP_502" },
    );
  });
});

test("fails clearly when the server key is missing", async () => {
  const previous = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  try {
    await assert.rejects(
      searchText(searchInput, {
        fetchImplementation: async () => {
          throw new Error("must not be called");
        },
      }),
      { httpStatus: 500, googleStatus: "MISSING_API_KEY" },
    );
  } finally {
    if (previous !== undefined)
      process.env.GOOGLE_MAPS_SERVER_API_KEY = previous;
  }
});

test("onRequestSent fires only once the Google request is sent", async () => {
  const previous = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  try {
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    let sent = 0;
    await assert.rejects(
      searchText(searchInput, {
        fetchImplementation: async () => new Response("{}", { status: 200 }),
        onRequestSent: () => {
          sent += 1;
        },
      }),
      (error) =>
        error instanceof PlacesApiError &&
        error.googleStatus === "MISSING_API_KEY",
    );
    assert.equal(sent, 0, "no request is sent without a key");

    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    await assert.rejects(
      searchText(searchInput, {
        fetchImplementation: async () =>
          new Response(
            JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }),
            {
              status: 429,
            },
          ),
        onRequestSent: () => {
          sent += 1;
        },
      }),
      (error) => error instanceof PlacesApiError && error.httpStatus === 429,
    );
    assert.equal(sent, 1, "a failed request still counts as sent");

    const controller = new AbortController();
    controller.abort();
    let fetched = 0;
    await assert.rejects(
      searchText(searchInput, {
        signal: controller.signal,
        fetchImplementation: async () => {
          fetched += 1;
          return new Response("{}", { status: 200 });
        },
        onRequestSent: () => {
          sent += 1;
        },
      }),
      (error) => error?.name === "AbortError",
    );
    assert.equal(sent, 1, "an already-aborted request is not sent");
    assert.equal(fetched, 0);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    else process.env.GOOGLE_MAPS_SERVER_API_KEY = previous;
  }
});
