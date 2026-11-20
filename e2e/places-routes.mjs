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

export async function registerPlaces(page, textQuery, count, noReviews = []) {
  const places = Array.from({ length: count }, (_, i) => {
    const n = i + 1,
      id = `${textQuery}-${n}`;
    return {
      placeId: id,
      address: "東京都 モック区 検証町1-2-3",
      location: { lat: 35.7 + i * 0.001, lng: 139.7 + i * 0.001 },
      googleMapsUri: "https://example.invalid/mock-place",
      name: `${id} 詳細店舗`,
      ...(n === 5 ? {} : { rating: 4, userRatingCount: 42 + n }),
      openNow: n % 2 === 1,
      weekdayDescriptions,
      websiteUri: `https://example.invalid/site/${id}`,
      reviews: noReviews.includes(id)
        ? []
        : [
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
            ...(id === "quota-3"
              ? [2, 3].map((number) => ({
                  text: `根拠 ${number}: ${id}`,
                  rating: number,
                  publishTime: "2026-10-14T03:00:00Z",
                  relativePublishTimeDescription: "1か月前",
                  author: {
                    name: `投稿者 ${id}/${number}`,
                    uri: `https://example.invalid/author/${id}/${number}`,
                  },
                  googleMapsUri: `https://example.invalid/review/${id}/${number}`,
                }))
              : []),
          ],
    };
  });
  await page.evaluate((places) => {
    places.forEach((place, i) => {
      window.__mock.positions[`${place.location.lat},${place.location.lng}`] = {
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
  return places;
}
