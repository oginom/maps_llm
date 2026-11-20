# 一括検索と自動評価のブラウザ検証

Chromium で実際の検索画面を操作し、スマホ（390×844）と PC（1280×800）で確認する。Google Maps、Places、OpenAI、Firestore には接続しない。

- `maps-mock.js` は地図・マーカー・位置・リサイズを再現し、分析応答の JSON を意図的に遅らせることもできる。
- `places-routes.mjs` は手動検索に口コミ・投稿者・営業時間等を含む候補を返す。チャットにも同じ候補形式を tool result としてストリームで返す。個店詳細へのリクエストは遮断し、両スイートで件数ゼロを検証する。
- `verify-fetch-limits.mjs` は手動検索で23候補中20件、チャットで20候補中20件の自動評価を検証する。口コミなしの候補は表示して分析をスキップする。同時5件、失敗時の個別表示・再試行なし、検索切り替え時の中断・遅延結果の破棄も確認する。
- `verify-detail-panel.mjs` は評価点とGoogle評価、抜粋の投稿者、営業時間・公式サイト・Googleマップへのリンク、画面外ピン、検索時の地図範囲、シートの操作を確認する。
- `verify-place-questions.mjs` は店舗ごとの質問・履歴、候補の即時送信、口コミの出典、一覧の保持、追加検索がないことをスマホと PC で検証する。
- `budget-scenarios.mjs` はセッション／実行IDと上限の扱いを検証する。検索や分析で返された `BUDGET_*` を表示し、待機中の評価を開始しない。月／セッション上限では新規検索も無効にする。

## 実行

リポジトリルートから、ターミナル1で専用ローカルサーバーを起動する。port 3000 の実キーの開発サーバーには触れず、毎回新しい一時コピーと台帳パスを使う。`.env*` はコピーしない。次のダミーキー4個と `LEDGER_BACKEND=file` / `LEDGER_FILE` を明示する。

```sh
E2E_PROJECT_DIR=$(mktemp -d /private/tmp/maps-e2e-task5-XXXXXX)
cp -R src public "$E2E_PROJECT_DIR/"
cp package.json next.config.js tsconfig.json next-env.d.ts postcss.config.mjs tailwind.config.ts "$E2E_PROJECT_DIR/"
ln -s "$PWD/node_modules" "$E2E_PROJECT_DIR/node_modules"
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=e2e-fake-key \
NEXT_PUBLIC_GOOGLE_MAPS_ID=e2e-fake-map \
GOOGLE_MAPS_SERVER_API_KEY=e2e-fake-key \
OPENAI_API_KEY=e2e-fake-key \
LEDGER_BACKEND=file \
LEDGER_FILE="$E2E_PROJECT_DIR/ledger.json" \
NEXT_TELEMETRY_DISABLED=1 \
mise exec node@24.20.0 -- node node_modules/next/dist/bin/next dev "$E2E_PROJECT_DIR" --webpack --hostname 127.0.0.1 --port 3107
```

全APIをブラウザでモックするため、台帳ファイルは通常作成されない。実台帳の予約・精算や短い上限の検証は単体テスト側の範囲で、ここでは `BUDGET_CAPS_JSON` は不要。

ターミナル2で実行する。必要なツールは **Playwright と Chromium**。今回、既存キャッシュを利用したため、新規インストールも package.json / lockfile の変更もしていない。

```sh
PLAYWRIGHT_MODULE=/Users/ogino/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs \
E2E_CHROMIUM_PATH=/Users/ogino/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
mise exec node@24.20.0 -- node e2e/verify-fetch-limits.mjs > e2e/run.log
```

別環境では、既存の `playwright/index.mjs` を `PLAYWRIGHT_MODULE` に指定する。ローカルで `playwright` を import できる場合は省略可能。対応する Chromium が標準キャッシュにあれば `E2E_CHROMIUM_PATH` も省略可能。

どちらもない場合は、アプリの依存を変えず `e2e/` 内だけに導入できる（ネットワークダウンロードが必要）。テストのための追加ツールであり、アプリの実行には不要。

```sh
npm install --prefix e2e --no-save --package-lock=false playwright
node e2e/node_modules/playwright/cli.js install chromium
mise exec node@24.20.0 -- node e2e/verify-fetch-limits.mjs
```

`E2E_BASE_URL` でポートを変更できるが、接続先は `localhost` / `127.0.0.1` のみ許可する。通常ブラウザで実キーのサーバーを開く手順は不要。テスト終了後はターミナル1を Ctrl-C で停止する。

同じ環境変数で `node e2e/verify-detail-panel.mjs` を実行すると詳細パネルも検証できる。Node.js は `.mise.toml` の指定に合わせる。両スイートは `e2e/*results.json` と `docs/img/detail-panel/` に証跡を書く。過去の検証結果は [詳細パネル検証報告](../docs/verification-detail-panel.md) を参照。

同じ環境変数で `node e2e/verify-place-questions.mjs` を実行すると、選択店舗への質問を検証できる。
