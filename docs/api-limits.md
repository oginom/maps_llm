# AI Map の API 利用制限

2026-09-09 設定、2026-09-20 に Places Legacy を 40 → 100 回 / 日、アプリ内の最大取得数を 10 → 20 店に変更。2026-09-21 に Places New を Text Search 10 → 20 回 / 日、Place Details 30 → 100 回 / 日に変更し、`effectiveLimit` を確認。対象の Google Cloud プロジェクトとアカウントは git 管理外の `CLAUDE.local.md` に記載している。Cloud Run の自動停止はユーザーの希望により導入せず、最大インスタンス数 1 と既存の予算通知を維持する。

## Google 側の日次割当

| API / 処理                          | 日次上限 | 対象の quota metric                                   |
| ----------------------------------- | -------: | ----------------------------------------------------- |
| Maps JavaScript の 2D 地図表示      |    50 回 | `maps-backend.googleapis.com/billable_default`        |
| 旧 Places Legacy の検索・詳細合計   |   100 回 | `places-backend.googleapis.com/billable_default`      |
| Places New の Text Search           |    20 回 | `places.googleapis.com/SearchTextRequest`             |
| Places New の Place Details         |   100 回 | `places.googleapis.com/GetPlaceRequest`               |
| Routes の経路計算                   |    20 回 | `routes.googleapis.com/compute_routes_requests`       |
| Routes の比較                       |  30 要素 | `routes.googleapis.com/compute_route_matrix_elements` |

すべて `1/d/{project}` の割当。利用者・ブラウザ・API キー別ではなくプロジェクト共通。Routes の要素数は出発地数 × 目的地数なので、現在地から 5 店への比較は 5 要素。

適用後、6 項目それぞれの `effectiveLimit` が表の値になったことを Service Usage API で確認した。

**現行アプリは Places API (New) を使用する。** 検索 20 回 / 日と詳細 100 回 / 日は独立した枠。Legacy の 100 回は旧 API の共通枠で、New の使用可能回数には加算されない。Routes は事前に割当を設定したがアプリでは未使用。日次割当は月額料金や無料枠を保証しない。

## アプリの検索・評価

- 手動・チャットとも口コミ付き Text Search 1 回、最大 20 店。ページ送り・独立した Place Details・自動再試行はない。20 店返っても Google 側の消費は検索枠 1、詳細枠 0。
- 取得済みの口コミを使い、店舗別に同時数を制限して自動採点する。採点は OpenAI 予算を消費する。20 店の評価成功を保証しない。
- 新しい検索を開始したら、前の検索の遅延結果を表示しない。開始済みの Google 呼び出し自体は取り消せず、その使用量は残る。
- Google の割当超過は画面に表示する。上限到達中は追加取得や検索が失敗するため、割当のリセット後に再度利用する。

サーバー側の月次・セッション・実行ごとの予算は次節の台帳で強制する。チャットのモデル呼び出しは金額に加え、月 500 / セッション 100 / 実行 4 回まで。ツールで行う Places 検索も同じ台帳に計上する。

## アプリ側の予算（台帳）

設計と運用は [budget-ledger.md](budget-ledger.md)。有料の API route は外部呼び出し前に予約し、終了後に精算する。Google の日次割当と OpenAI 組織の月 $10 上限は独立して適用される。

| 範囲 | OpenAI（micro-USD） | Places 検索 |
| --- | ---: | ---: |
| 月（UTC の暦月） | 750,000（$0.75） | 60 回 |
| セッション（ブラウザのタブ） | 200,000（$0.20） | 10 回 |
| 実行（検索と後続の採点） | 50,000（$0.05） | 2 回 |

OpenAI は `usage` から算出した額（Luna: 入力 $0.20 / 1M、出力 $1.20 / 1M）を加算し、予約額は評価 $0.0028、検索準備 $0.00156。Google は `places.search` の回数で強制し、月の参考額に検索あたり $0.040 を加える。これは Text Search Enterprise + Atmosphere の最初の有料帯（$40 / 1,000 検索）による推計で、請求先で共有する無料枠・割引適用後の請求額ではない。詳細の台帳利用はない。

| 応答                          | 意味                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| 429 `BUDGET_MONTH_EXCEEDED`   | 月の上限。翌月まで新規の検索・評価不可                                   |
| 429 `BUDGET_SESSION_EXCEEDED` | セッションの上限。そのタブでは以後の検索・追加取得を停止                 |
| 429 `BUDGET_RUN_EXCEEDED`     | その検索の上限。新しい検索を開始する                                     |
| 503 `BUDGET_UNAVAILABLE`      | 台帳（Firestore）に到達できない。有料呼び出しを開始しない（fail closed） |
| 400 `INVALID_ARGUMENT`        | `X-Session-Id` / `X-Run-Id` が無い、または UUID v4 でない                |

Google / OpenAI 側の割当超過（`RESOURCE_EXHAUSTED`）とはコードで区別する。上限値は `src/lib/budget/config.ts` の定数で、検証時のみ環境変数 `BUDGET_CAPS_JSON` で一部を上書きできる（適用時にログ出力）。

## 確認と再適用

設定スクリプトは対象の API を有効化せず、指定した 6 項目だけを扱う。標準ライブラリと gcloud を使い、アクセストークンを出力・保存しない。

```sh
# 読み取りのみ: 現在の実効値と設定値を照合
python3 scripts/configure-maps-quotas.py --account=YOUR_ACCOUNT --project=YOUR_PROJECT

# 適用して実効値を検証（すでに設定済みなら変更しない）
python3 scripts/configure-maps-quotas.py --account=YOUR_ACCOUNT --project=YOUR_PROJECT --apply
```

既存の割当がより厳しい場合、スクリプトは勝手に引き上げず停止する。最近の使用量より低い割当への変更も既定では停止する。その制限による利用停止を受け入れて設定する場合のみ `--allow-below-usage` を付ける。 既存のより厳しい割当を引き上げる場合も既定では停止するので、意図して引き上げるときだけ `--allow-raise` を付ける（2026-09-20 の 40 → 100 回はこのオプションで適用し、`effectiveLimit` 100 を確認した）。今回の Places Legacy は最近の使用量 74 回に対して 40 回への変更なので、このオプションを使用した。

根拠: [Service Usage の consumer quota](https://docs.cloud.google.com/service-usage/docs/reference/rest/v1beta1/services.consumerQuotaMetrics/list)、[Places の割当](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)、[Routes の課金単位](https://developers.google.com/maps/documentation/routes/usage-and-billing)。

## OpenAI の別途確認済み設定

組織全体の月額 API 利用上限は $10、Enforce a hard limit は ON。到達すると新規リクエストが拒否されるが、反映遅延による少額の超過はあり得る。クレジット自動購入の月額上限は別設定で、前回確認時点の $20 から変更していない。これらは Google の日次割当とは独立している。
