# ドキュメント案内

次のセッションでは **[引き継ぎ](handoff.md)** から読む。

| 文書                                                         | 用途                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [handoff.md](handoff.md)                                     | 全体像、ユーザーの決定事項、実装済み / 未実装、次の着手順、開発環境と検証の限界                            |
| [ai-map-plan.md](ai-map-plan.md)                             | データ源・agent framework・UIUX・ツール構成・費用の試算・段階的な実装計画                                  |
| [api-limits.md](api-limits.md)                               | 適用済みの日次割当、現行 Places の共通枠、再確認用スクリプト、OpenAI の強制上限                            |
| [phase0-verification.md](phase0-verification.md)             | Google データの LLM 利用条件（規約原文）、現行採点方式の判定、AI SDK の最小検証                            |
| [verification-fetch-limits.md](verification-fetch-limits.md) | 口コミ取得制限のモックブラウザ検証（12 件 OK）、見つかった UI 不具合、`e2e/` の実行手順                    |
| [dev-api-research.md](dev-api-research.md)                   | TypeSafe AI「Jev」（通称 Dev）の調査。スコアリング工程への適用可否、価格比較、スパイク手順                 |
| [verification-detail-panel.md](verification-detail-panel.md) | PC サイドパネル / スマホ下部シートの設計判断、モック検証（18 件 OK）、レビュー指摘への対応                 |
| [places-new-adapter.md](places-new-adapter.md)               | Places API (New) サーバーアダプターの設計、FieldMask と SKU、DTO、エラー変換、入力検証、実キーでの確認手順 |
| [budget-ledger.md](budget-ledger.md)                         | アプリ側の予算台帳（月 / セッション / 実行の上限、予約と精算、Firestore 文書、障害時の挙動、インフラ手順） |
| [cost-audit-2026-09-07.md](cost-audit-2026-09-07.md)         | 当時の請求・使用量・インフラ設定の調査記録。最新の設定値とは分けて読む                                     |

費用の「目標」「試算」「実績」「設定上限」は別の値。最新の決定と進捗は引き継ぎ、具体的な割当値は API 利用制限を優先し、古い調査記録を現在値として使わない。
