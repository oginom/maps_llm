# 取得制限のブラウザ検証（全 API モック）

実際の Next.js / React UI を Chromium で動かし、390×844 と 1280×800 で検索・追加取得・連打・失敗・旧結果破棄・fetch 中断を確認する。アプリコード、設定、ルートの実装は変更しない。

## ファイル

- `maps-mock.js`: ページのスクリプトより先に `google.maps` を注入。Map / PlacesService / Marker / OverlayView を置換し、既定で合成の候補12店を返す（上限シナリオは23店、部分バッチは7店に上書き）。実 Maps JS のダウンロードは発生しない。
- `verify-fetch-limits.mjs`: Playwright のルーティングで `/api/generate-examples` と `/api/analyze-reviews` を応答し、他の API と外部 origin を遮断する。service worker も無効化する。
- `results.json`: 最後の実行の検証値・通信監査・UI 座標。
- `run.log`: 提出時のコンソール出力。再実行時は任意でリダイレクトして更新する。
- `../docs/img/detail-panel/fetch-limits/*.png`: パネル化後の回帰検証の証跡。旧 `img/fetch-limits/` の画像は初回の不具合記録として保持する。最新の判定は [詳細パネル検証報告](../docs/verification-detail-panel.md)。

## 実行

リポジトリルートから、ターミナル1で専用ローカルサーバーを起動する。環境変数は `.env` の実キーを上書きするダミー値。

```sh
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=e2e-fake-key \
NEXT_PUBLIC_GOOGLE_MAPS_ID=e2e-fake-map \
OPENAI_API_KEY=e2e-fake-key \
mise exec node@24.6.0 -- node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3107
```

ターミナル2で実行する。必要なツールは **Playwright と Chromium**。今回、既存キャッシュを利用したため、新規インストールも package.json / lockfile の変更もしていない。

```sh
PLAYWRIGHT_MODULE=/Users/ogino/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs \
E2E_CHROMIUM_PATH=/Users/ogino/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
mise exec node@24.6.0 -- node e2e/verify-fetch-limits.mjs > e2e/run.log
```

別環境では、既存の `playwright/index.mjs` を `PLAYWRIGHT_MODULE` に指定する。ローカルで `playwright` を import できる場合は省略可能。対応する Chromium が標準キャッシュにあれば `E2E_CHROMIUM_PATH` も省略可能。

どちらもない場合は、アプリの依存を変えず `e2e/` 内だけに導入できる（ネットワークダウンロードが必要）。テストのための追加ツールであり、アプリの実行には不要。

```sh
npm install --prefix e2e --no-save --package-lock=false playwright
node e2e/node_modules/playwright/cli.js install chromium
mise exec node@24.6.0 -- node e2e/verify-fetch-limits.mjs
```

`E2E_BASE_URL` でポートを変更できるが、接続先は `localhost` / `127.0.0.1` のみ許可する。通常ブラウザで実キーのサーバーを開く手順は不要。テスト終了後はターミナル1を Ctrl-C で停止する。

実キーのサーバー（port 3000）が同じディレクトリで起動中の場合、Next.js の開発ロックが競合する。今回の再検証では `/private/tmp` の一時ディレクトリへ `src/`、`public/` と `package.json`、`next.config.js`、`tsconfig.json`、`next-env.d.ts`、`postcss.config.mjs`、`tailwind.config.ts` をコピーし、`node_modules` だけ元リポジトリへのシンボリックリンクにした（`.env*` はコピーしない）。上記の起動コマンドの `next dev` の直後にその一時ディレクトリを渡し、同じダミーキー・port 3107で実行する。テスト自体は元リポジトリから実行し、実キーのport 3000は使用・停止しない。

この環境ではローカルポート作成と Chromium 起動にサンドボックス外実行の承認が必要だった。Next.js が開発起動時に CLAUDE.md へ自動追記する場合がある。今回の実行で増えた自動生成ブロックのみ、サーバー停止後に除去した。

2026-09-20 の最大20試行対応後の実行結果: 取得制限12/12＋UI採取2/2、詳細パネル18/18成功（両方終了コード0）。外部通信試行・想定外API・ブラウザ例外はいずれも0。

## 判定とモックの範囲

- 6シナリオ×2サイズをそれぞれ独立した BrowserContext で検証する。追加で各サイズの UI 座標と画像を採取する。`ui-observations` の `OK` は採取成功を意味し、UI の正常判定ではない。
- 初期・追加の place ID と実呼び出し配列を照合し、DOM 化した Marker の `icon.fillColor` を検証する。23候補で初期5→10→15→20試行、未取得3店を残して停止し、追加ボタン消失と「20 件 / 最大20件」を確認する。候補7店の場合の 5→追加2 も確認する。
- 二重操作は Playwright のネイティブ `mouse.dblclick` と同一イベントループ内の `button.click()` 2回で検証する。
- 詳細取得の失敗は `OVER_QUERY_LIMIT`。失敗後の追加取得まで含め、同じ ID が再要求されないことを確認する。完了後の追加観測時間は250ms。
- 旧 Places `getDetails` コールバックを保留し、新検索完了後に返す。別の検索では旧分析の JSON 解決を保留し、AbortSignal 発火後にも意図的に解決させ、遅延結果破棄を検証する。
- 中断シナリオは本物のブラウザ `fetch` を使用。分析応答をルーティング層で保留し、新検索での `abort` イベント・`AbortError`・`requestfailed: net::ERR_ABORTED` をすべて確認する。
- 外部リクエストの試行、未定義 API、ブラウザ例外も失敗扱い。NG があれば終了コード1、通常は0。起動そのものに失敗した場合は既存 `results.json` が残るので、実行日時と終了コードを必ず確認する。
- 地図・投影・マーカーは簡略化したモック。投影は地図中心を原点とする draggable pane をモデル化し、画面端の吹き出しを自動補正しない。実 Google Maps のパン・ズーム・タイルやスマホ実機のキーボードは再現しない。

補助の既存単体テスト:

```sh
mise exec node@24.6.0 -- node --test src/lib/place-detail-batch.test.mjs
```

## 詳細パネルの検証

同じダミーキーのサーバー、Playwright / Chromium の環境変数で、次を実行する。

```sh
PLAYWRIGHT_MODULE=/Users/ogino/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs \
E2E_CHROMIUM_PATH=/Users/ogino/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
mise exec node@24.6.0 -- node e2e/verify-detail-panel.mjs > e2e/detail-panel-run.log
```

9シナリオ×2画面。結果は `detail-panel-results.json`、スクリーンショットは `docs/img/detail-panel/`。
初期5件・追加5件・検索ごと最大20試行（失敗も含む）を前提にする。シナリオ4は12候補で、追加1回後の評価済み9・失敗1・未取得2を区別し、さらに2件取得後の評価済み11・失敗1・未取得0とボタン消失を確認する。分布は `[3,2,2,2,2]`。
一覧の取得状態、選択・スクロール、画面外選択の panTo、各高さでの警告・追加ボタンの矩形とヒットテスト、分布、投稿者情報を確認する。
モックは地図サイズ変更の次のフレームで適用済み寸法を更新し、getBounds / fitBounds の範囲・zoomを寸法から計算する。入力フォーカス後の検索で半分の地図寸法を使うこと、および任意のリサイズで選択ピンへ戻らないことも確認する。bounds.contains と panTo は簡略モデルであり、実 Google の投影検証ではない。
`verify-fetch-limits.mjs` の6シナリオはそのまま残し、電話サイズのピン操作前にシートを縮小、旧分布メニューの採取を常設ヒストグラムの採取へ変更した。

抜粋と投稿者の照合の単体テスト:

```sh
mise exec node@24.6.0 -- node --test src/lib/place-detail-batch.test.mjs src/lib/review-match.test.mjs
```
