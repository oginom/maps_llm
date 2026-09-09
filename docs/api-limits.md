# AI Map の API 利用制限

2026-09-09 設定。Google Cloud プロジェクト `ogidata` が対象。Cloud Run の自動停止はユーザーの希望により導入せず、最大インスタンス数 1 と既存の予算通知を維持する。

## Google 側の日次割当

| API / 処理                          | 日次上限 | 対象の quota metric                                   |
| ----------------------------------- | -------: | ----------------------------------------------------- |
| Maps JavaScript の 2D 地図表示      |    50 回 | `maps-backend.googleapis.com/billable_default`        |
| 現行 Places Legacy の検索・詳細合計 |    40 回 | `places-backend.googleapis.com/billable_default`      |
| Places New の Text Search           |    10 回 | `places.googleapis.com/SearchTextRequest`             |
| Places New の Place Details         |    30 回 | `places.googleapis.com/GetPlaceRequest`               |
| Routes の経路計算                   |    20 回 | `routes.googleapis.com/compute_routes_requests`       |
| Routes の比較                       |  30 要素 | `routes.googleapis.com/compute_route_matrix_elements` |

すべて `1/d/{project}` の割当。利用者・ブラウザ・API キー別ではなくプロジェクト共通。Routes の要素数は出発地数 × 目的地数なので、現在地から 5 店への比較は 5 要素。

適用後、6 項目それぞれの `effectiveLimit` が表の値になったことを Service Usage API で確認した。

**現行 Places Legacy では、検索 10 回 / 詳細 30 回を個別には強制できない。** 実際の API が公開する共通枠を合計 40 回に制限する。40 回の内訳次第で詳細取得が 30 回を超えることはある。個別の日次枠が必要な場合は Places New への移行時に上の 10 / 30 の割当を使う。ブラウザの localStorage をプロジェクト全体の上限として扱う実装はしていない。

Places New と Routes は確認時点で無効のまま。今回は割当を事前設定するだけで API の有効化や機能追加は行わない。Nearby Search、写真、3D 地図等はこのアプリでは未使用で、上表の制限対象に含めていない。導入時には別の割当を確認する。

回数制限は月額費用の保証ではない。SKU ごとの料金、請求先で共有する無料枠、他アプリの使用量を別途確認する。特に現行の詳細取得を最大限に使った場合は「30 × 31 = 930 回」という試算をそのまま適用できない。

## アプリの検索・評価

- 1 回の検索操作は Text Search 1 回。ページ送り・自動再試行は行わない。
- すべての候補を地図に表示し、初期の口コミ取得・AI 評価は先頭 5 店だけ行う。
- 「次の 5 件を評価」で追加取得し、同じ検索では最大 10 店まで。少ない結果の場合は残り件数だけ取得する。
- 取得対象を同期的に予約してから通信し、二重クリックや失敗による上限超過を防ぐ。失敗も 1 回として消費し、自動で再試行しない。
- 新しい検索を開始したら、前の検索の遅延結果を表示しない。開始済みの Google 呼び出し自体は取り消せず、その使用量は残る。
- Google の割当超過は画面に表示する。上限到達中は追加取得や検索が失敗するため、割当のリセット後に再度利用する。

これは個人利用の誤操作・過剰取得を抑える変更であり、サーバー側の月次予算台帳は未実装。Routes の「現在地 × 最大 5 店／比較」やチャットのツール回数制御は、機能の実装時に追加する。

## 確認と再適用

設定スクリプトは対象の API を有効化せず、指定した 6 項目だけを扱う。標準ライブラリと gcloud を使い、アクセストークンを出力・保存しない。

```sh
# 読み取りのみ: 現在の実効値と設定値を照合
python3 scripts/configure-maps-quotas.py --account=YOUR_ACCOUNT --project=ogidata

# 適用して実効値を検証（すでに設定済みなら変更しない）
python3 scripts/configure-maps-quotas.py --account=YOUR_ACCOUNT --project=ogidata --apply
```

既存の割当がより厳しい場合、スクリプトは勝手に引き上げず停止する。最近の使用量より低い割当への変更も既定では停止する。その制限による利用停止を受け入れて設定する場合のみ `--allow-below-usage` を付ける。今回の Places Legacy は最近の使用量 74 回に対して 40 回への変更なので、このオプションを使用した。

根拠: [Service Usage の consumer quota](https://docs.cloud.google.com/service-usage/docs/reference/rest/v1beta1/services.consumerQuotaMetrics/list)、[Places の割当](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)、[Routes の課金単位](https://developers.google.com/maps/documentation/routes/usage-and-billing)。

## OpenAI の別途確認済み設定

組織全体の月額 API 利用上限は $10、Enforce a hard limit は ON。到達すると新規リクエストが拒否されるが、反映遅延による少額の超過はあり得る。クレジット自動購入の月額上限は別設定で、前回確認時点の $20 から変更していない。これらは Google の日次割当とは独立している。
