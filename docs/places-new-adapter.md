# Places API (New): 口コミを含む一括検索

**1 検索 = Google への Text Search 1 回、最大 20 店。** 手動フォームは `POST /api/places/search`、チャットは `search_places` から共通の[サーバーアダプター](../src/lib/places-new.ts)を呼ぶ。どちらも初回から口コミを要求する。店舗を選んでも追加通信は不要で、独立した Place Details ルートはない。

## 入力と応答

- `POST /v1/places:searchText` に検索語、送信時の地図の矩形（`locationRestriction.rectangle`）、件数（最大 20）、言語 `ja`・地域 `JP`、指定時のみ営業中条件を渡す。地名が検索語に含まれても矩形は変えない。ページ送りはしない。
- サーバー固定の FieldMask で ID、名前、住所、座標、Google Maps リンクのほか、評価・件数、営業時間、サイト、口コミと投稿者帰属を一緒に要求する。Google が情報を持たない項目は欠けることがある。ブラウザには表示・評価に使う項目を[アプリの型](../src/lib/place-dto.ts)に変換して渡す。
- 地図・一覧は採点完了を待たずに表示する。本文のある口コミ（Google が返すのは 1 店最大 5 件）を使い、`/api/analyze-reviews` で条件への適合度を店舗別に採点する。重複を除き最大 20 店、同時処理数を制限する。チャットの会話モデルに口コミ原文は渡さない。
- ブラウザキーは Maps JavaScript API（地図用）、`GOOGLE_MAPS_SERVER_API_KEY` はサーバーの Places API (New) 用。割当超過は 429、権限・キー制限などの上流障害は 502、入力不正は 400。失敗時に別 SKU の API で検索し直さない。

## なぜ店舗数分の料金にならないか

`places.reviews` を要求するため、結果に実際に口コミがあるかにかかわらず **Text Search Enterprise + Atmosphere** が対象。SKU は要求フィールドの最高区分で決まり、単位は返された店舗ではなく検索リクエスト。旧方式は Text Search Pro の後に各店の Place Details を呼んでいた。

[Google のグローバル料金表](https://developers.google.com/maps/billing-and-pricing/pricing)では、この SKU の月間無料枠は 1,000 回、最初の有料帯は **$40 / 1,000 検索（$0.040 / 検索）**。無料枠は請求先で共有される。たとえば 20 店取得しても Google 検索の定価参考額は $0.040。店舗ごとの OpenAI 採点と地図表示は別料金。[FieldMask と SKU](https://developers.google.com/maps/billing-and-pricing/sku-details/places)／[日次割当とアプリ上限](api-limits.md)

[旧採点方式での実 API 確認](verification-bundled-search.md)で一括検索の応答に口コミが含まれることを確認した。現行方式では根拠となる口コミ 1〜3 件を番号で選択し、原文と投稿者は同じ検索応答から取得する。判断材料がなければスコアは付けない。現行方式の完了時間、実請求額は未確認。
