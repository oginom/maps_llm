# 詳細パネルの実装・モック検証

追記（2026-09-20 21:44 JST、最大20試行への変更後）: 初期5件・追加5件・1検索最大20試行で、**詳細パネル18/18、取得制限12/12＋UI採取2/2成功、両スイート終了コード0**。12候補の初期表示は評価済み5・追加可能7。シナリオ4は追加1回後に評価済み9・失敗1・未取得2を区別（[phone](img/detail-panel/phone-fetch-partial.png)・[PC](img/detail-panel/desktop-fetch-partial.png)）し、さらに2件取得して評価済み11・失敗1・未取得0、追加ボタン消失を確認。失敗IDの再試行・分析はなく、分布は `[3,2,2,2,2]`。取得制限ケースは23候補中20試行で停止。ダミーキーの専用サーバー（port 3107、一時コピー）を使用し、外部通信試行・想定外API・ブラウザ例外はすべて0。JSON・ログ・画像は最新結果に更新した。以下の最大10試行、評価済み9・未取得2、旧分布の記述は変更前の検証履歴として保持する。

今回見つかった表示不具合（未修正）: `src/components/SearchPanel.tsx:150` の完了理由の分岐が `requestedDetails >= 10` のまま。12候補をすべて取得した場合も、最大20試行に未到達なのに「この検索の取得上限に達しました」と表示する。[phoneの最終状態](img/detail-panel/phone-fetch-complete.png)・[PC](img/detail-panel/desktop-fetch-complete.png)。期待は「取得可能な候補をすべて確認しました」。取得件数・ボタン・行状態の検証は成功しているが、完了理由の文言はスイートのassert対象外。依頼の範囲に従い `src/` は変更していない。

実施日: 2026-09-20。PC のサイドパネル、スマホの3段階シートへ検索・一覧・詳細・分布を集約した。詳細パネルの **18/18**、既存の取得制限 **12/12** が成功。地図上の吹き出しと分布の浮動パネルを撤去し、旧検証の画面外表示・警告／追加取得ボタンの遮蔽を解消した。

## 設計判断

- **PC は右400px、幅900px以上で切替。** 地図を左の主領域に置き、候補比較と詳細を右に揃える。幅を固定し、警告の有無でも入力位置を変えない。地図は残りの幅を使用する。
- **スマホは最小／半分／最大。** 最小は検索・状態・帰属表示の実測高＋ハンドル32px。警告と追加ボタンがある場合はその分だけ伸ばす。半分は画面の50%と「ヘッダー＋140px」の大きい方、最大は90%。どの高さでも地図の領域を最低64px確保する。最小では一覧・詳細・分布を畳む。入力フォーカス・店舗選択で最大へ展開する。
- **MUI Paper / Button と小さな独自シート。** Drawer のモーダル・背景遮蔽・フォーカストラップを使わず、地図を継続操作できるようにした。ハンドルは25px超の上下ドラッグで1段階、クリック／タップで順送り、矢印キーでも変更可能。追加依存なし。
- 地図とパネルは重ねず、実際の地図コンテナを縮める。パネルの占有分を fitBounds の隠れた余白として扱う必要がない。店舗選択と明示的なシート高さ変更で、リサイズ反映後に選択座標が範囲外なら panTo する。任意のウィンドウ／コンテナリサイズや個別の評価到着では移動しない。
- 検索→状態→警告→追加取得のヘッダーを固定し、一覧・詳細のみ内部スクロール。詳細表示中も約110pxの一覧を残して選択行を見せる。「一覧に戻る」は本文のスクロール外。分布は末尾の小さな固定ブロックで、警告に重ならない。
- `100dvh` フォールバック、`visualViewport.height / offsetTop`、safe area を使用。狭い可視高ではヘッダー自身をスクロール可能にする。入力にラベルを付け、IME変換中の Enter 送信を防止し、ページの言語を `ja` に変更した。

## 状態・データ

`page.tsx` は検索・取得・分析・検索セッション・URL状態の所有者として維持。`PlaceDetailBatch` と2つのAPIルートは無変更。初期5件、追加5件、失敗も含む最大10試行、旧結果破棄・fetch中断は従来のまま。

`markers` の独立stateを廃止し、`searchResults` から一覧とピンを描画するよう二重管理を統合した。点数と色の計算は `src/lib/place-result.ts` にそのまま移し、1〜5点を維持。番号を一覧とピンで共有し、選択時はピンの太い輪郭・一覧の背景／左線で示す。未取得、取得・評価中、評価済み、取得・評価失敗をテキストで区別し、口コミなしも未評価として表示する。Google評価は独自点数と別ラベル。表示用の `analysisError` と検索時の評価条件のスナップショットを追加し、入力欄を書き換えても過去の点数の条件を変えない。

UIの分割先:

- `src/components/SearchPanel.tsx`: 入力、状態・警告・追加取得、内容の構成
- `BottomSheet.tsx`: PC／スマホの配置と高さ操作
- `ResultsList.tsx`: 候補と選択行のスクロール
- `PlaceDetails.tsx`: 詳細・抜粋・投稿者・リンク
- `Histogram.tsx`: 5段階分布

抜粋本文はLLMの出力を省略・改変せず表示する。NFKC正規化と空白・句読点・記号を除いた照合、および長い共通部分文字列で元の口コミを一意に特定できる場合、その `author_name`・`profile_photo_url`・`author_url` を表示。特定できない場合は、**「参照した口コミの投稿者（抜粋との対応は特定できません）」** として元口コミの全投稿者を表示する。APIは投稿者IDを返さないため、非一致の抜粋に特定の著者を推測で割り当てない。店舗URLは Places の `url` を優先。Google Maps 帰属は最小シートでも見えるヘッダーに常設。口コミはReact stateのみで、保存処理は追加していない。

## シナリオ × 画面

Chromium 149.0.7827.55 / Playwright、Node 24.6.0、Next.js webpack dev。スマホ390×844、PC1280×800。表示矩形と中心点のヒットテストも利用し、単なるDOM存在確認にしない。ドラッグはマウスポインターによる再現。

| シナリオ                | スマホ                                                                                                                                                 | PC                                                             | 確認内容                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. 12候補・初期5評価    | [OK](img/detail-panel/phone-initial.png)                                                                                                               | [OK](img/detail-panel/desktop-initial.png)                     | 12行、5件着色、7件未取得、追加可能5・失敗0                                                    |
| 2. 上段右端のピン       | [OK](img/detail-panel/phone-edge-details.png)                                                                                                          | [OK](img/detail-panel/desktop-edge-details.png)                | 詳細・リンクがパネル内、選択行へスクロール、ピン強調                                          |
| 3. 画面外候補の行       | [OK](img/detail-panel/phone-offscreen-row.png)                                                                                                         | [OK](img/detail-panel/desktop-offscreen-row.png)               | 12店目の行から panTo、選択・詳細更新                                                          |
| 4. 追加取得・割当エラー | [OK](img/detail-panel/phone-fetch-complete.png)                                                                                                        | [OK](img/detail-panel/desktop-fetch-complete.png)              | 取得中5行→評価済9、失敗1、未取得2。失敗行と未取得行を区別                                     |
| 4a. 警告と追加ボタン    | [最小](img/detail-panel/phone-warning-collapsed.png)・[半分](img/detail-panel/phone-warning-half.png)・[最大](img/detail-panel/phone-warning-full.png) | [OK](img/detail-panel/desktop-warning-full.png)                | 全高さで画面内、重なりなし、中心点が操作対象に到達                                            |
| 5. 分布                 | [OK](img/detail-panel/phone-histogram.png)                                                                                                             | [OK](img/detail-panel/desktop-histogram.png)                   | 1〜5点の件数 `[2,1,2,2,2]`、警告を遮蔽しない                                                  |
| 6. シート／配置         | [OK](img/detail-panel/phone-sheet-map.png)                                                                                                             | [OK](img/detail-panel/desktop-sheet-map.png)                   | スマホのドラッグ上下・ハンドルクリックで3段階、最小で地図ピンを操作。両画面で横スクロールなし |
| 7. 帰属・評価条件       | [OK](img/detail-panel/phone-attribution.png)                                                                                                           | [OK](img/detail-panel/desktop-attribution.png)                 | 著者名、画像読込、プロフィールhref、店舗URL、Google Maps帰属。入力編集後も検索時条件を維持    |
| 8. 取得制限の6シナリオ  | [6/6](img/detail-panel/fetch-limits/phone-stale-results.png)                                                                                           | [6/6](img/detail-panel/fetch-limits/desktop-stale-results.png) | 初期取得・上限／部分バッチ・連打・失敗・旧結果破棄・fetch中断。追加のUI採取も2/2成功          |

[詳細パネル結果JSON](../e2e/detail-panel-results.json)・[実行ログ](../e2e/detail-panel-run.log)、[取得制限結果JSON](../e2e/results.json)・[実行ログ](../e2e/run.log)、[再実行手順](../e2e/README.md)。旧不具合の画像 `img/fetch-limits/` は変更前の証拠として保存し、回帰検証画像は上表の別ディレクトリへ出力した。

## レビュー指摘への対応

1. **検索範囲とfitBounds**: スマホの検索送信でシートを半分にする。`src/lib/map-layout.ts` の一時的なResizeObserverで通知を受け、その後2回のrequestAnimationFrameでサイズが安定したことを確認する。固定時間待ちは使用しない。検索準備後のbounds参照と候補表示後のfitBoundsの前にも確認する。検索中のハンドル操作・入力フォーカスによる再拡大は抑止し、Plain EnterとIMEガードは維持した。
2. **選択ピンへのパン**: 常設のリサイズ監視を撤去。店舗選択または明示的なシート高さ変更に限り、一時的な監視終了後に範囲を判定する。同じ高さへのフォーカス、任意のウィンドウ変更ではパンしない。古い操作はAbortControllerで取消し、検索開始・詳細を閉じる・アンマウント時も監視を解除する。
3. **投稿者照合**: `src/lib/review-match.ts`へ分離。Unicodeの句読点・記号（日本語括弧、引用符、省略記号を含む）を除去して完全な部分一致を優先する。一致しなければ最長共通部分文字列が20文字以上、または抜粋の60%以上かつ8文字以上の候補を探す。短い一般語での誤帰属を避けるため8文字の下限を設けた。複数一致・一致なしは従来の全投稿者＋注記へ戻す。本文表示は無改変。単体テスト6件で完全一致、引用／省略記号、助詞の欠落、60%条件、不一致、複数一致を確認した。近似照合は意味的な著者判定の保証ではない。
4. **アクセシビリティ**: ハンドルの固定aria-labelを外し、表示中の「広げる／さらに広げる／地図を見る」を名前にする。aria-expandedを付与。候補は `ul > li > button` に修正し、行スクロールの位置計算も対応。状態欄は検索／取得中に `aria-live="off"`・`aria-busy="true"`、完了後にpoliteへ戻す。E2EでDOM構造・名前・展開状態・live属性を確認した（実スクリーンリーダーは未検証）。

モックはResizeObserverの次のフレームで適用サイズを更新し、そのサイズとzoomからboundsを算出する。fitBoundsも候補の座標幅と適用済みのコンテナ寸法からzoomを計算する。これによりリサイズ反映前のbounds参照と薄い地図でのfitBoundsを検出できる。

| 追加シナリオ                    | スマホ                                              | PC                                                    | 観測                                                                                                                   |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 8. 入力フォーカス→Enter検索     | [OK](img/detail-panel/phone-search-map-size.png)    | [OK](img/detail-panel/desktop-search-map-size.png)    | スマホは全高時の地図84pxから半分の422pxへ。textSearchのboundsとfitBoundsが422pxを使用し、zoomは10→10。PCは800px、11→11 |
| 9. 明示操作だけで選択位置へパン | [OK](img/detail-panel/phone-explicit-selection.png) | [OK](img/detail-panel/desktop-explicit-selection.png) | 選択後に画面外へ移動した状態を作り、ウィンドウ高を80px変更してもパン0回。ハンドルの明示操作／店舗の再選択では1回パン   |

既存の取得制限スイートは全6シナリオを維持。完了待ちが「検索中」も除外するよう修正し、検索後の半分シートからピン操作前に最小へ切り替えるよう更新した。

## チェック結果

```text
mise exec node@24.6.0 -- pnpm lint
  exit 0 / 0 errors, 3 warnings（既存のURL復元・effect依存・宣言順）
node node_modules/typescript/bin/tsc --noEmit
  exit 0
node --test src/lib/place-detail-batch.test.mjs
  pass 3 / fail 0（Nodeのmodule type警告のみ）
node --test src/lib/review-match.test.mjs
  pass 6 / fail 0（合計9件成功）
node e2e/verify-detail-panel.mjs
  18/18 OK / exit 0
node e2e/verify-fetch-limits.mjs
  12/12 OK + UI採取2/2 OK / exit 0
```

各Nodeコマンドも `mise exec node@24.6.0 --` で実行。サーバーはREADME指定のダミーキー3個で起動。ブラウザで2つのAPIを置換し、外部originと想定外APIは遮断。両スイートの外部通信試行・想定外API・ブラウザ例外はいずれも0。実 Google Maps / Places / OpenAI の呼出しなし。新規依存、next.config.js・package.json scripts・APIルートの変更、commit / pushなし。

## 制限・未検証

- 実 Google の投影・タイル・panTo／fitBounds・コンテナサイズ変更のタイミングは未検証。モックは寸法に応じたbounds／zoomの簡略計算と再配置のみ。全高のスマホでは地図領域が小さく、近いピンは重なるため、地図を見る操作で縮小して選択できる。
- 実機のタッチ／ソフトウェアキーボード／safe area、Safari・Firefox、320px幅・横向きは未検証。可視高が小さい場合はヘッダー内部をスクロールして操作する設計で、常に全操作を同時表示する保証はない。
- 実口コミの長文・著者情報欠落・複数口コミを組み合わせた抜粋の画面確認は未実施。非一致時の全投稿者表示には上記の対応付け制限がある。
- 元のURL復元・位置情報と実カメラの同期の問題は今回の対象外として維持。チャット、停止／再試行、並び替えなど改善計画の将来機能は追加していない。
- 本番ビルド・デプロイは未実施。画像の左下の「N」はNext.js開発インジケーター。

## Places New 移行後の再検証

2026-09-21（JST）。PlacesService のモックを撤去し、検索・詳細は共有の Playwright route モックから新DTOを返すよう更新した。既存の遅延応答破棄・fetch中断・二重操作・地図寸法・最大20試行を維持し、両スイートに各画面1件ずつ HTTP 502 のメッセージ表示を追加した。

- 取得制限 **14/14成功＋UI採取2/2成功**（既存12件＋502の2件）、詳細パネル **20/20成功**（既存18件＋502の2件）。両コマンドの終了コード0。
- 詳細パネルの既存シナリオに、営業中／営業時間外、7曜日の営業時間、公式サイト、口コミリンク、投稿者URL／写真の有無、ratingの有無を追加。一覧の未取得「Google ★ —」と評価済み「Google ★ 4」も確認。詳細のリンクはスクロール後にそれぞれ矩形・ヒットテストを検証した。
- 通信監査: 取得制限は検索28・詳細194・分析180、詳細パネルは検索8・詳細44・分析42。すべてモックへの要求。外部origin試行・想定外API・ブラウザ例外は両スイートとも0。実 Google Maps / Places / OpenAI API 呼び出しなし。
- port 3000 はそのまま、一時コピー `/private/tmp/maps-e2e-task4-hpb22ywc` とダミーキー4個で port 3107 を使用。`.env*` はコピーせず、この作業では src/・依存・Gitのindex／ブランチ／commitを変更していない。並行作業のソース更新を検知したため、一時コピーを更新して両スイートを再実行した。再実行手順は [e2e/README.md](../e2e/README.md)。

| 証跡                               | スマホ                                                 | PC                                                       |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| 営業中・曜日別営業時間・公式サイト | [画像](img/detail-panel/phone-places-new-1-hours.png)  | [画像](img/detail-panel/desktop-places-new-1-hours.png)  |
| 営業時間外                         | [画像](img/detail-panel/phone-places-new-4-hours.png)  | [画像](img/detail-panel/desktop-places-new-4-hours.png)  |
| 投稿者・口コミのGoogleマップリンク | [画像](img/detail-panel/phone-places-new-1-review.png) | [画像](img/detail-panel/desktop-places-new-1-review.png) |
| Google評価なし                     | [画像](img/detail-panel/phone-places-new-5-hours.png)  | [画像](img/detail-panel/desktop-places-new-5-hours.png)  |
| 投稿者URL／写真なし                | [画像](img/detail-panel/phone-places-new-5-review.png) | [画像](img/detail-panel/desktop-places-new-5-review.png) |
| 502のサーバーメッセージ            | [画像](img/detail-panel/phone-server-error.png)        | [画像](img/detail-panel/desktop-server-error.png)        |

**発見したアプリ不具合1件（未修正）:** HTTP 429でも本文に `error.message` があると固定の割当文言を表示しない。`src/app/page.tsx` の `readErrorMessage` が本文を優先するため、検索ルートが `{ error: { code: "RESOURCE_EXHAUSTED", message: "QUOTA_SENTINEL_FROM_SERVER" } }` を429で返す別診断では、スマホ・PCとも `QUOTA_SENTINEL_FROM_SERVER` が表示された。期待は「Google Places の検索上限に達しました。時間をおいて再検索してください。」。この追加診断は **0/2成功（同一不具合を2画面で再現）** で、上記の回帰成功数とは別。[診断JSON](../e2e/quota-wording-results.json)、[スマホ](img/detail-panel/phone-quota-wording-bug.png)、[PC](img/detail-panel/desktop-quota-wording-bug.png)。既存の詳細割当シナリオはサーバー自身が標準文言を返すため成功する。src/変更禁止の指示に従い、修正は行っていない。 その後、`readErrorMessage` が 429 では本文を読まずに固定文言を返すよう修正した（コミット時点。診断スクリプトの再実行は未実施）。

画面画像は営業時間部分と口コミ部分をそれぞれスクロールして採取し、スマホ・PCで目視確認した。モックによる画面と呼出し制御の検証であり、実アダプターの外部接続・課金・Googleの応答内容は検証していない。

## 予算台帳導入後の再検証

2026-09-21（JST）。全4ルートの共有ヘッダー検証と `budget-scenarios.mjs` を追加し、390×844 / 1280×800で実行した。取得制限 **26/26成功＋UI採取2/2成功**、詳細パネル **32/32成功**、両コマンドの終了コード0。変更したE2Eの4ファイルはESLintも終了コード0。各スイートの既存シナリオを維持し、6シナリオ×2画面を追加した。

- 全API要求の `X-Session-Id` / `X-Run-Id` がUUID v4であること、sessionStorageの `maps-llm-session-id` と一致することを検証。同じタブのsessionはページ再読み込み後も維持し、同じ検索の4ルートと追加バッチはrunを共有する。次の検索は、同じ検索語であっても新しいrunになる。従来の古い応答破棄・fetch中断でもヘッダーを検証した。
- 詳細1店の429 `BUDGET_RUN_EXCEEDED` はサーバー文言を表示し、その店だけ失敗、他4店は評価を完了。追加バッチ後は評価済み9件になり、失敗IDを再取得しない。次の検索も開始できる。
- 分析の503 `BUDGET_UNAVAILABLE` は文言を表示し、5店とも失敗。完了後1,000msを観測し、分析要求は各店1回、合計5回のままで自動再試行なし。
- 検索の429 `BUDGET_SESSION_EXCEEDED` は `[data-budget-stop]` と検索ボタン無効を確認。検索開始時に候補がクリアされる実装のため、追加ボタンは無効表示ではなく**非表示**になる。残り候補を持つ詳細のSESSION / MONTH拒否も追加し、検索と「次の5件を評価」の両方が無効になることを確認した。無効ボタンのclickとフォームsubmitを試しても、完了後1,000ms以内の追加API要求は0回。
- `RESOURCE_EXHAUSTED` に `QUOTA_SENTINEL_FROM_SERVER` を返す追加シナリオは両画面・両スイートで成功。Google割当の固定文言を表示し、上記Places New移行時の不一致は解消を確認した。

| 追加証跡                            | スマホ                                                         | PC                                                               |
| ----------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| RUN拒否・他店の継続                 | [画像](img/detail-panel/phone-budget-run-detail.png)           | [画像](img/detail-panel/desktop-budget-run-detail.png)           |
| 台帳障害503                         | [画像](img/detail-panel/phone-budget-unavailable-analysis.png) | [画像](img/detail-panel/desktop-budget-unavailable-analysis.png) |
| 検索のSESSION停止                   | [画像](img/detail-panel/phone-budget-session-search.png)       | [画像](img/detail-panel/desktop-budget-session-search.png)       |
| 候補ありのSESSION停止・両ボタン無効 | [画像](img/detail-panel/phone-budget-session-details.png)      | [画像](img/detail-panel/desktop-budget-session-details.png)      |
| 候補ありのMONTH停止・両ボタン無効   | [画像](img/detail-panel/phone-budget-month-details.png)        | [画像](img/detail-panel/desktop-budget-month-details.png)        |
| Google割当の固定文言                | [画像](img/detail-panel/phone-quota-fixed-wording.png)         | [画像](img/detail-panel/desktop-quota-fixed-wording.png)         |

停止文言とボタンの矩形が画面内に収まることを検証し、文言にはヒットテストを実施。MUIの無効ボタンは `pointer-events: none` のため、disabled属性・表示矩形・要求抑止を確認した。停止画面は両サイズで目視確認した。取得制限側の同シナリオ画像は `img/detail-panel/fetch-limits/` に保存した。

通信監査は取得制限が準備42・検索42・詳細254・分析234（計572要求）、詳細パネルが準備22・検索22・詳細104・分析96（計244要求）。全要求をモックで処理し、ヘッダー不一致・外部origin試行・想定外API・ブラウザ例外はいずれも0。実 Google / OpenAI / Firestore 呼び出しなし。

サーバーは `.env*` を含まない `/private/tmp/maps-e2e-task5-vuuj4et_` のコピー、ダミーキー4個、port 3107、`LEDGER_BACKEND=file` / `LEDGER_FILE=/private/tmp/maps-e2e-task5-vuuj4et_/ledger.json` で実行。APIをブラウザで置換するため台帳ファイルは作成されず、実台帳の予約・精算は今回のE2Eの対象外。検証後にport 3107のサーバーを停止し、一時コピーのCLAUDE.mdにNext.jsが追加したagent-rules参照を除去した。port 3000には触れていない。この作業ではsrc/・依存・Gitのindex／ブランチ／commitを変更していない。並行作業によるサーバー側ソースの更新を検知したが、検証対象のpage・components・session-idsは実行時コピーと一致している。

**新たなアプリ不具合は検出しなかった。** 検索拒否で追加ボタンが非表示になる点は上記のとおり記録した。再試行なしの確認は1,000msの観測範囲。実サービスの課金・台帳の永続化・実機キーボードは検証していない。[取得制限JSON](../e2e/results.json)・[ログ](../e2e/run.log)、[詳細パネルJSON](../e2e/detail-panel-results.json)・[ログ](../e2e/detail-panel-run.log)、[再実行手順](../e2e/README.md)。
