# AI Map の費用・設定確認

確認日: 2026-09-07（JST）。対象は Google Cloud `ogidata` の `mapsllm` と OpenAI の `Maps LLM` プロジェクト。管理画面、Cloud Run API、Monitoring API、Artifact Registry CLI を読み取り、ユーザーの依頼に基づき Cloud Run の最大インスタンス数のみ変更した。API キー、予算、自動チャージ、データ共有、API の有効化は変更していない。

## 費用の現状

| 対象             | 確認結果                                         | 集計範囲・注意                                                                                                              |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| OpenAI Maps LLM  | $0.03、167 リクエスト、Total tokens 表示 160,065 | Usage の Month to date、グラフは 9/1〜9/6。表示額は丸め値。個々の検索回数や会話数ではない                                   |
| Google Cloud Run | 使用費 ¥3、割引等 −¥3、純額 ¥0                   | Billing の ogidata フィルター、9 月指定。計上済みの表示範囲は 9/1〜9/5。サービス分類なので他の Cloud Run サービスも含み得る |
| Google Maps      | 計上済みレポートに課金行なし                     | 未計上分を含めた月末の請求ゼロや SKU 無料枠残量を保証しない                                                                 |
| ogidata 全体     | 約 ¥710                                          | 主に別用途の Gemini API（¥704）。本アプリの費用と混同しない                                                                 |

Cloud Monitoring の `mapsllm` の集計（UTC）:

- 8/1〜9/1: HTTP リクエスト 1、課金対象インスタンス時間 2.6 秒。
- 9/1〜9/7 約 01:46: HTTP リクエスト 2,207、課金対象インスタンス時間 約 127.6 秒。
- 同じ 9 月期間のプロジェクト API 指標は Maps 5、Places Legacy 121 リクエスト。HTTP/API リクエスト数を会話数・検索数・SKU 請求単位に置き換えない。

今後のチャットはまだ未実装のため、この実績から 20 往復の費用を直接算出できない。[設計計画の試算](ai-map-plan.md)では、Luna 中心・累計 20 店評価・Web 検索 2 回・Maps 等の無料枠内という条件で約 $0.074 / 利用、5 利用で約 $0.37 / 月（インフラ等を除く）。月 $1 は目標として現実的だが、現行設定による強制上限ではない。

## 現在の上限

| 設定                    | 実際の値                                       | 意味                                                                           |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| OpenAI プロジェクト     | No spend limit set                             | Maps LLM 個別の予算未設定                                                      |
| OpenAI 組織             | 月 $100、通知 50% / 90% / 100%                 | 画面にも実費が設定額を超える可能性の表示あり。月 $1 のアプリ上限として使えない |
| OpenAI 自動チャージ     | 残高 $5 で $10 まで補充、月の自動補充上限 $20  | 自動補充の上限は API 消費額の上限とは異なる                                    |
| Google Cloud `cost_all` | 月 ¥500、通知 50% / 90% / 100%、使用額 ¥710.24 | ogidata 等を対象にした共有予算。「支出上限」は該当なし。通知のみで停止しない   |
| アプリ内の予算台帳      | 未実装                                         | 月 $1 / セッション $0.20 の制御には実装が必要                                  |

Google Cloud の予算通知は自動停止ではない。[公式説明](https://docs.cloud.google.com/billing/docs/how-to/budgets)

ogidata には別用途の費用があるため、プロジェクト全体を月 $1 で停止する設計にはしない。本アプリの外部呼び出し前に費用を予約・精算し、月次・セッション予算を越える有料処理を開始しない設計を採る。Maps のブラウザ呼び出しやインフラは別に利用枠・余裕額を設ける。

## Cloud Run の変更と保管費

- `mapsllm` / `asia-northeast1` のサービス全体の最大数とリビジョン最大数を、ともに **1** に変更済み。以前はサービス全体の指定なし、リビジョン最大数 100。
- 変更後のリビジョン `mapsllm-00021-x5g` へのトラフィック 100% と、API の両設定値を確認した。後続デプロイでも維持するよう `deploy.sh` に `--max 1` / `--max-instances 1` を追加。
- 1 vCPU / 512 MiB、concurrency 80、request-based（`cpuIdle=true`）、最小数未指定（既定 0）。最大数 1 は同時リクエスト数 1 や金額上限を意味しない。
- `docker` リポジトリは 398,021,983 bytes（約 0.371 GiB）、パッケージは `mapsllm`。同一リージョンの `cloud-run-source-deploy` は約 1.420 GiB。これらの cleanup policy は未設定。
- Artifact Registry の無料保存枠は請求先で共有する 0.5 GiB。無料枠消費済みなら、本アプリの現容量分は $0.10 / GiB-month で約 $0.037 / 月相当。実請求のアプリ別配賦ではなく、保存量一定での概算。別アプリのイメージは削除していない。

料金根拠: [Cloud Run](https://cloud.google.com/run/pricing)、[Artifact Registry](https://cloud.google.com/artifact-registry/pricing)。最小数の既定値: [Cloud Run min instances](https://docs.cloud.google.com/run/docs/configuring/min-instances)。

## 移行に関わる設定

- Google Maps と Places Legacy は有効。Places API (New)、Routes API、Maps Grounding Lite のサービスは確認時点の有効サービス一覧になかった。動作検証前に対象を決める。
- OpenAI の既定サービス階層は Standard。組織のモデル上限一覧に Luna / Terra が掲載されているが、採用予定ツール・構造化出力を含む API 動作は未検証。
- OpenAI のフィードバック、評価・ファインチューニング、API 入出力の共有は、すべて Disabled。
- API call logging は Enabled per call。管理画面には Responses API の保存を無効にするには `store=false` を使う旨の説明がある。ZDR 契約は未確認であり、共有無効や `store=false` を保持なしと解釈しない。[データ保持仕様](https://developers.openai.com/api/docs/guides/your-data)

次の費用検証では、アプリ内予算台帳、少数店舗での実呼び出し計測、Maps SKU 別無料枠の共有状況、履歴を含めたチャット tokens を確認する。Google データの利用条件については計画の Phase 0 を継続する。
