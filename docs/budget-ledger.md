# 予算台帳（費用・呼び出し回数の永続的な制御）

作成: 2026-09-21。引き継ぎ項目 5「アプリ側の費用・呼出し制御」の設計と実装記録。実装は `src/lib/budget/`、route 連携は `src/lib/api-route.ts` と `src/lib/openai-route.ts`、ブラウザ側は `src/lib/session-ids.ts` と `src/app/page.tsx`。

**この文書の時点で実 Firestore / Google / OpenAI への接続は行っていない。** 単体テスト（メモリ・ファイル・fetch 差し替えの Firestore REST）、型検査、lint、webpack ビルドで確認した範囲と、本番前にリードが行うインフラ手順を分けて記す。

## 1. 目的と前提

- 通常利用の目標は約 $0.20 / セッション、約 $1 / 月（[引き継ぎ](handoff.md)）。ログインは導入しない。
- Cloud Run は最大 1・最小 0 インスタンスだが、同時リクエストと再起動があるためプロセスメモリのカウンターでは上限を守れない。永続かつアトミックな台帳（Firestore）を使う（[計画書 §8](ai-map-plan.md)）。
- Google の日次割当（Places New: 検索 20 回 / 詳細 100 回）と OpenAI 組織の月 $10 強制上限は、台帳の外側の最終防衛線として残す（[API 利用制限](api-limits.md)）。Cloud Run の予算による自動停止は導入しない。
- 台帳に到達できないときは有料呼び出しを開始しない（fail closed）。代替経路で失敗を隠さない。

## 2. 数え方と上限

| 種別              | 単位              | 予約額（呼び出し前）             | 精算額（呼び出し後）                                              |
| ----------------- | ----------------- | -------------------------------- | ----------------------------------------------------------------- |
| `places.search`   | 回数              | 1 回                             | 送信していれば 1 回（結果を問わない）。定価 $0.032 を参考値に加算 |
| `places.details`  | 回数              | 1 回                             | 同上。定価 $0.025                                                 |
| `openai.analyze`  | micro-USD（整数） | 2,800（8,000 入力 + 1,000 出力） | `usage` の実費。usage が無い失敗は予約額                          |
| `openai.examples` | micro-USD（整数） | 1,560（600 入力 + 1,200 出力）   | 同上                                                              |

OpenAI の単価は Luna の定価（入力 $0.20 / 1M トークン、出力 $1.20 / 1M トークン）。推論トークンは `completion_tokens` に含まれ、キャッシュ済み入力も満額で数える。`ceil(prompt × 0.2 + completion × 1.2)` micro-USD。設計メモの検索準備 $0.0017 はトークン数から計算すると $0.00156 になるので、計算値の 1,560 micro-USD を採用した。

上限（`src/lib/budget/config.ts` の `DEFAULT_BUDGET_CAPS`）:

| 範囲      | 定義                                               | OpenAI micro-USD | `places.search` | `places.details` |
| --------- | -------------------------------------------------- | ---------------: | --------------: | ---------------: |
| `month`   | UTC の暦月                                         | 750,000（$0.75） |              60 |              300 |
| `session` | ブラウザのタブ 1 つ（`sessionStorage` の UUID）    | 200,000（$0.20） |              10 |               60 |
| `run`     | 1 回の `handleSearch`（後続の「次の 5 件」を含む） |  50,000（$0.05） |               2 |               20 |

判定は各範囲で `settled + reserved + 予約額 <= 上限`。OpenAI 種別は金額、Google 種別は回数で判定する。定価の累計（`listPriceMicros`）は月文書に集計するだけで判定には使わない。月 → セッション → 実行の順に調べ、最初に超えた範囲を返す。

検証用に環境変数 `BUDGET_CAPS_JSON`（例 `{"run":{"places.details":3}}`）で一部を上書きできる。適用時は `[budget] BUDGET_CAPS_JSON override applied` を 1 回ログに出す。不正な JSON は起動時ではなく最初の予約時に例外になり、route は 500 を返す。

## 3. 識別子

ブラウザが `X-Session-Id`（タブごと、`sessionStorage` に保存）と `X-Run-Id`（検索ごとに生成、追加取得も同じ値）を 4 つの API すべてに付ける。どちらも UUID v4 で、`crypto.randomUUID` が使えない非セキュアコンテキストでは `getRandomValues` ベースの v4 を生成する。サーバーは zod で形式を検証し、欠落・不正は 400 `INVALID_ARGUMENT`（Google は呼ばない）。

これらは相関 ID であり認証ではない。タブを開き直せばセッション上限は新しく始まるが、月上限が全体を抑える。IP 別の制限と署名付き ID は今回は導入しない（§9）。

## 4. 文書

Firestore（Native モード、`(default)` データベース）に 2 つのコレクションを持つ。

`budget_months/{YYYY-MM}`

```
counts         { "places.search": n, "places.details": n, "openai.analyze": n, "openai.examples": n }
reservedCounts { 同上 }
settledMicros  整数（OpenAI 実費の累計）
reservedMicros 整数（未精算の予約額）
listPriceMicros 整数（Google 定価の累計、参考値）
updatedAt      timestamp
```

`budget_sessions/{sessionId}`

```
createdAt, expiresAt   timestamp（expiresAt = createdAt + 2 日。TTL ポリシー対象）
counts, reservedCounts, settledMicros, reservedMicros   月文書と同じ形
run           { runId, counts, reservedCounts, settledMicros, reservedMicros }
previousRunId  直前の実行の runId（遅延到着した旧実行の要求を見分ける）
pending       { reservationId: { type, count, micros, month, runId, at } }
```

`expiresAt` はセッション文書を書くたびに `now + 2 日` へ更新するので、使い続けているタブが途中で TTL 削除されることはない。`pending` の `runId` と `previousRunId` は設計メモに無い追加項目で、古い実行の予約を掃除するとき新しい実行のカウンターに混ぜないために使う。値の型は integerValue / stringValue / mapValue / timestampValue / booleanValue / nullValue のみ。既存文書に項目が無ければ 0 として読む（旧リビジョンの文書で予約が止まらないようにする）。

## 5. プロトコル

すべての操作は「読む → 計算 → 前提条件付きで書く」を 1 単位にし、プロセス内では非同期ミューテックスで 1 件ずつ実行する（Cloud Run は最大 1 インスタンスなので、通常は衝突が起きない）。前提条件の衝突（`FAILED_PRECONDITION` / `ABORTED` / `ALREADY_EXISTS` / HTTP 409、および `commit` 時の `NOT_FOUND`）は複数インスタンスやリビジョン交代時の安全網で、読み直して最大 15 回（ジッター付き）やり直す。すべて衝突した場合は `LedgerUnavailableError` → 503。

`reserveBudget(context, type)`（外部呼び出しの前）

1. `request.signal` がすでに中断済みなら予約せず 499 を返す。
2. セッション文書と当月文書を `batchGet` で読む。
3. `pending` のうち 5 分以上前のものを、予約額のまま精算済みへ移す（クラッシュ復旧）。その予約の月が当月と違えばその月文書も読んで更新する。`runId` が現在の実行と同じときだけ実行カウンターにも反映する。
4. `run.runId` が `X-Run-Id` と違い、かつ `previousRunId` とも違えば新しい実行として実行カウンターを初期化し、旧 runId を `previousRunId` に残す。`X-Run-Id` が `previousRunId` と同じなら「新しい検索の開始後に届いた旧実行の要求」なので、実行カウンターは触らず、実行範囲の判定も行わず、セッションと月だけに計上する（警告ログ）。
5. 月・セッション・実行の順に上限を判定し、超えていれば `BudgetExceededError { scope, type }`。
6. 3 範囲の `reserved` に加算し、`pending[reservationId]` を追加して `commit`（既存文書は `updateTime`、新規は `exists: false` を前提条件にする）。

`settleReservation(reservation, outcome)`（`finally` で必ず await する）

- Google: `onRequestSent` が呼ばれた（HTTP 要求を送った）なら結果にかかわらず 1 回を精算し、`listPriceMicros` に定価を足す。送る前に失敗した場合（`GOOGLE_MAPS_SERVER_API_KEY` 未設定、送信直前にすでに中断済み）は予約を解放するだけ。
- OpenAI: `openai.chat.completions.create` を呼んだ時点から「送信済み」。呼ぶ直前に中断済みなら呼ばず 499 で解放する。応答の `usage` から実費を精算し、usage の無い失敗（接続エラー、中断、429）は予約額で精算する。
- `reserved` から引き、`counts` / `settledMicros` に足し、`pending` から消す。すでに `pending` に無ければ（掃除済み・二重精算）何もしない。
- 精算の失敗はログに残すだけで応答は変えない。未精算の予約は次回の予約時に掃除で回収される。

route 側の順序: ヘッダー検証 → 本文検証 → 中断確認 → 予約 → 外部呼び出し → 応答生成、`finally` で精算。応答は精算の完了後に返る。

## 6. エラーと HTTP 応答

| 例外                             | HTTP | `error.code`              | メッセージ（日本語）                                                         |
| -------------------------------- | ---- | ------------------------- | ---------------------------------------------------------------------------- |
| `BudgetExceededError`（month）   | 429  | `BUDGET_MONTH_EXCEEDED`   | 「今月のアプリ利用予算（{種別}）の上限に達しました。来月まで…」              |
| `BudgetExceededError`（session） | 429  | `BUDGET_SESSION_EXCEEDED` | 「このセッションの利用上限（{種別}）に達しました。…」                        |
| `BudgetExceededError`（run）     | 429  | `BUDGET_RUN_EXCEEDED`     | 「この検索の利用上限（{種別}）に達しました。新しい検索を開始してください。」 |
| `LedgerUnavailableError`         | 503  | `BUDGET_UNAVAILABLE`      | 「利用状況の台帳に接続できないため、処理を開始できません。…」                |
| ヘッダー不正                     | 400  | `INVALID_ARGUMENT`        | 「入力が不正です: X-Session-Id: …」                                          |

種別のラベルは「場所の検索」「口コミの取得」「AI 評価」「検索の準備」。Google / OpenAI 側の割当超過は従来どおり 429 `RESOURCE_EXHAUSTED` で、コードで区別できる。

ブラウザ（`page.tsx`）の扱い:

- 429 で `error.code` が `BUDGET_` で始まる場合はサーバーのメッセージを表示する（従来の固定文言は Google / OpenAI の 429 だけ）。
- `BUDGET_MONTH_EXCEEDED` / `BUDGET_SESSION_EXCEEDED` は `budgetStop` 状態に入れ、検索ボタンと「次の N 件を評価」を無効化し、パネルに赤字の説明行（`data-budget-stop`）を出す。この状態は再読み込みまで解除されない。
- `BUDGET_RUN_EXCEEDED` はその検索の警告として表示するだけで、新しい検索は可能。
- 503 `BUDGET_UNAVAILABLE` はメッセージを表示し、自動再試行しない。

## 7. バックエンドと設定

`LEDGER_BACKEND` で選ぶ（`src/lib/budget/ledger.ts`）。

| 値          | 実装                 | 用途                                                                                                                                                                                                     |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firestore` | `firestore-store.ts` | 本番。`LEDGER_PROJECT_ID` 必須。REST API（`documents:batchGet` / `documents:commit`）を `google-auth-library` の `GoogleAuth`（scope `datastore`）で呼ぶ。ローカルは ADC、Cloud Run はメタデータサーバー |
| `file`      | `file-store.ts`      | 開発。`LEDGER_FILE`（既定 `.ledger/ledger.json`、gitignore 済み）に 1 ファイル。プロセス内ミューテックスと temp + rename。`NODE_ENV=production` では起動を拒否                                           |
| 未設定      | —                    | 本番: 有料 route はすべて 503 `BUDGET_UNAVAILABLE` とし、設定すべき変数をログに出す。開発: `file` を使い、その旨を 1 行ログに出す                                                                        |
| その他      | —                    | 503 と非対応のログ                                                                                                                                                                                       |

Firestore ストアの再試行: 5xx・ネットワークエラー・3 秒タイムアウトは最大 5 回（ジッター付き）。401 / 403 / 400、および `batchGet` の 404 は再試行せず `LedgerUnavailableError`。トークン取得の失敗、値のデコード失敗も同様（503 になる）。衝突（`commit` の 409 / `ABORTED` / `FAILED_PRECONDITION` / `ALREADY_EXISTS` / `NOT_FOUND`）は再試行せず `LedgerConflictError` として台帳側の読み直しに任せる。`commit` の `NOT_FOUND` は読んだ後に TTL で消えたセッション文書で起き、読み直すと `exists: false` で作り直す。

`deploy.sh` は `LEDGER_BACKEND=firestore,LEDGER_PROJECT_ID=${PROJECT_ID}` を Cloud Run に設定する（`PROJECT_ID` は既存の `.env` / GitHub Secret）。`.env.example` はローカル向けに `LEDGER_BACKEND=file`。

## 8. 障害時の挙動

| 事象                                   | 挙動                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore に 3 秒以内に応答が無い      | 再試行後 503。有料呼び出しは始めない                                                                                                                                                           |
| 予約後にプロセスが落ちる               | `pending` に残り、5 分後にそのセッションの次の予約で予約額のまま精算される。セッションが戻らなければ予約額が月の `reserved` に残る（月末で消える）                                             |
| 精算の commit が失敗する               | ログのみ。上と同じ掃除で回収                                                                                                                                                                   |
| 同時に予約が来る                       | プロセス内ミューテックスで直列化。別インスタンスとの競合は前提条件の衝突で片方が読み直す。単体テストで cap 5 に対する 10 並列予約が（ミューテックス有無の両方で）正確に 5 件成功することを確認 |
| 新しい検索の開始後に旧実行の要求が届く | `previousRunId` と一致するのでセッション・月だけに計上し、実行カウンターは初期化しない                                                                                                         |
| TTL で消えたセッション文書に書く       | `commit` が `NOT_FOUND` → 読み直して新規作成                                                                                                                                                   |
| ブラウザが中断する                     | 送信済みなら精算（OpenAI は予約額）。送信前なら解放                                                                                                                                            |
| 月をまたぐ                             | 予約は予約時の月文書に紐づき、精算も同じ文書に入る。新しい予約は新しい月文書で数える                                                                                                           |
| `BUDGET_CAPS_JSON` が不正              | 最初の予約で例外 → 500 `INTERNAL`。ログに理由                                                                                                                                                  |

## 9. 今回導入しないもの

- IP 別の上限・レート制限（無認証のため意図的に見送り。月上限が全体の天井）。
- 署名付き・サーバー発行のセッション ID（現在はブラウザ生成の UUID を信頼する）。
- 利用状況の表示・レポート画面（`listPriceMicros` と月文書は集計済みで、Cloud Console から参照できる）。
- 日次の範囲（Google の日次割当が担う）。

## 10. リードが行うインフラ手順（本番前）

1. Firestore を Native モードで作成する（`(default)`、リージョンは `asia-northeast1` を推奨）。GCP プロジェクトは `LEDGER_PROJECT_ID`（= `PROJECT_ID`）。
2. Cloud Run の実行サービスアカウント `140997559372-compute@developer.gserviceaccount.com` に `roles/datastore.user` を付与する。
3. `budget_sessions` コレクションの `expiresAt` に TTL ポリシーを設定する（`gcloud firestore fields ttls update expiresAt --collection-group=budget_sessions --enable-ttl`）。月文書は消さない。
4. デプロイ後、Cloud Run のログに `[budget] ledger backend: firestore (project …)` が出ること、1 回の検索で `budget_months/{当月}` と `budget_sessions/{id}` が作られ、`pending` が精算後に空になることを確認する。
5. ローカルで Firestore を試す場合は `gcloud auth application-default login` の後に `LEDGER_BACKEND=firestore LEDGER_PROJECT_ID=…` で起動する。通常のローカル開発は `LEDGER_BACKEND=file` でよい。

## 11. e2e モックが再現すべき形

- 4 つの API 呼び出しには `X-Session-Id` と `X-Run-Id`（UUID v4）が付く。同じ検索の `generate-examples` / `places/search` / `places/{id}` / `analyze-reviews` は同じ `X-Run-Id`、同じタブは同じ `X-Session-Id`。モック側でこれを検査できる。
- 予算超過の応答: HTTP 429、本文 `{ "error": { "code": "BUDGET_RUN_EXCEEDED" | "BUDGET_SESSION_EXCEEDED" | "BUDGET_MONTH_EXCEEDED", "message": "…" } }`。UI は `message` を表示し、SESSION / MONTH では検索ボタンと「次の N 件を評価」が無効になり `[data-budget-stop]` が現れる。
- 台帳障害の応答: HTTP 503、`{ "error": { "code": "BUDGET_UNAVAILABLE", "message": "…" } }`。UI はメッセージを表示し、再試行しない。
- 従来の 429 `RESOURCE_EXHAUSTED` の固定文言は変更なし。
- 実サーバーを使う e2e（`next dev`）では `LEDGER_BACKEND=file` と実行ごとに新しい `LEDGER_FILE` を指定すると、前回の回数を引き継がない。回数上限を短時間で再現するには `BUDGET_CAPS_JSON` を使う。

## 12. 検証済みの範囲

- `node --test src/lib/budget/*.test.mjs`: 上限の範囲別判定、10 並列予約（ミューテックス有 / 無）、予約と精算の同時実行、旧実行の遅延要求、`expiresAt` の更新、予約額未満の精算、5 分後の掃除、月またぎ、実行 ID の切り替え、解放、Firestore の値エンコード往復、`batchGet` の欠落文書、`commit` の前提条件、衝突と 5xx の扱い、`commit` の `NOT_FOUND`、デコード失敗、再試行枯渇、トークン注入、タイムアウト、ファイルストアの永続化と前提条件、ヘッダー検証。
- 実 Firestore への接続、Cloud Run 上のメタデータサーバー認証、TTL の動作、実ブラウザでの停止表示は未検証。
