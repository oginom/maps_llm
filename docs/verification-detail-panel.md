# 詳細パネルの実装・モック検証

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
