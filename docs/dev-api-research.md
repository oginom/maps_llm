# 「Dev」AI API 調査: TypeSafe AI「Jev」のスコアリング工程への適用可否

調査日: 2026-09-20
調査対象: 「Dev」と伝え聞いた「文章を返さず、分類・ラベル・スコアだけを返す安くて速い LLM 風モデル」

各記述には根拠の種類を付す。

- 公式資料: TypeSafe AI / OpenAI の公式サイト・ドキュメント
- 第三者評価: 独立した開発者・メディアの検証や記事
- 推定: 本調査での計算・推測。裏付けが無いものは「未確認」と明記

## 0. 結論(先に要点)

- 「Dev」は **TypeSafe AI の「Jev」** (ジェヴ、Apollo 11 の月着陸船にちなむ名) とみて間違いない。2026-09-15 に発表された「System One Model」で、説明の全項目(テキスト生成をしない、分類・スコア・確率だけを返す、安い、速い)に一致する。他に一致する候補は見つからなかった。「Dev」は「Jev」の聞き間違いと思われる(推定)。
- 本アプリのスコアリング工程(`/api/analyze-reviews`)は **`value` の 1〜5 評価は Jev の Score プリミティブでほぼそのまま置き換え可能**。一方 **`related_review`(関連レビューの抜粋)は Jev では生成できず、レビューを文単位に分割して「最も関連する文を選ばせる」設計変更が必要**。
- **コスト面での採用理由は無い**。現在の gpt-5.6-luna によるスコアリングは 1 セッション(10 店舗)あたり約 $0.005 で、セッション目標 $0.20 の 2〜3% に過ぎない。Jev に替えても約 $0.0008〜0.0015 になるだけで、節約額は 1 セッションあたり 0.5 円未満(推定)。
- 採用する場合の利点は **レイテンシ(公式 70〜500 ms、日本からの実測で往復約 1.1 秒)と、JSON パース失敗が構造的に起きないこと**。欠点は **日本語精度が公式に「英語と同等ではない」とされ本タスクでの実測が無いこと、早期アクセス(ウェイトリスト)段階でレート制限や SLA が固まっていないこと**。
- 推奨: **今は採用しない。ただし低優先度のスパイク(小規模検証)に値する**。スパイクの目的はコスト削減ではなく、レイテンシ短縮と応答の安定化が本当に得られるか、日本語レビューの 1〜5 評価と抜粋選択の一致率が gpt-5.6-luna と比べてどうかを実測すること。

## 1. 概要

| 項目         | 内容                                                                                                                                                                                                                                                                                                                    | 根拠                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 正式名称     | Jev(モデル ID: `jev-1.13.0`、エイリアス `jev-latest`、`jev-preview`)                                                                                                                                                                                                                                                    | 公式資料 [S2]                            |
| 提供元       | TypeSafe AI(米国、創業者 Diogo Almeida、元 OpenAI で ChatGPT の instruction-following 研究に従事)                                                                                                                                                                                                                       | 第三者評価 [S10][S11]                    |
| 発表日       | 2026-09-15(公式ブログ「Introducing System One Models & Jev」)                                                                                                                                                                                                                                                           | 公式資料 [S1]                            |
| カテゴリ     | 「System One Model」。Kahneman の System 1(速い直観的判断)にちなんだ、TypeSafe が提唱する新カテゴリ。「非構造化な状態(state)を入力し、型付きの確率的判断を出力する frontier-intelligence 関数呼び出し」                                                                                                                 | 公式資料 [S1]                            |
| 返すもの     | 3 種類のプリミティブに対する答えのみ。(1) **Choice**: 最大 255 個の選択肢から 1 つ選び、全選択肢の確率分布と confidence(0〜1)を返す。(2) **Score**: 2〜10 段階の順序付きルーブリックに対し、各段階の確率分布、確率加重平均の連続値 `score`、confidence を返す。(3) **Noul**: Yes/No 質問に対する Yes の確率(0〜1)を返す | 公式資料 [S3][S4][S5][S6]                |
| 返さないもの | 自由テキスト、コード、説明文、要約、抜粋。「文字列を一切生成しない」。画像・音声・動画入力も非対応(テキストと JSON のみ)                                                                                                                                                                                                | 公式資料 [S1][S2][S7]                    |
| 入力         | `state`(文字列、JSON オブジェクト、または配列)と `questions`(複数の型付き質問)。複数質問は同じ state に対して並列に 1 パスで評価される                                                                                                                                                                                  | 公式資料 [S6][S8]                        |
| コンテキスト | 1 リクエスト 64k トークン(state は 32k + 最長の質問)                                                                                                                                                                                                                                                                    | 公式資料 [S2]                            |
| 学習方法     | RLCD(Reinforcement Learning for Calibrated Decisions)。確率がキャリブレーションされる(80% と言ったら 80% 当たる)ことを目標に訓練。アーキテクチャ、パラメータ数、学習データ、モデルカードは未公開                                                                                                                        | 公式資料 [S1]、第三者評価 [S11]          |
| 提供状態     | 早期アクセス(ウェイトリスト経由で API キー発行)。OpenRouter(ベータ)、Cloudflare Workers AI、Vercel AI Gateway 経由でも提供                                                                                                                                                                                              | 公式資料 [S1][S9][S18]、第三者評価 [S19] |

## 2. 評判

### 2.1 提供元の主張(公式資料)[S1][S16]

- 「フロンティア LLM より 40〜200 倍速く、40〜400 倍安い」。トップページの「193.6 倍速く 444.6 倍安い」は「実世界の上限寄りの値」と自ら注記。
- 「型エラーを出すことが数学的に不可能」「ハルシネーションしない」。
- 公式ベンチマーク(4 ワークフロー、711 件): Jev 67.8% / $0.0004 / 0.4 秒、GPT-5.6 Terra 67.9% / $0.0304 / 10.1 秒、GPT-5.6 Sol 74.1% / $0.0836 / 23.3 秒、Claude Opus 5 73.1% / $0.1761 / 37.8 秒。
- 正解ラベルは「GPT-6 Astra と Claude Fable 5.1(いずれも high thinking)の回答の平均」で作成。人手ラベルではない。

### 2.2 独立した評価(第三者評価)

- **Hacker News**(2026-09-15 投稿、2026-09-20 時点で 1,917 ポイント、503 コメント)[S10]: 賛: 大量分類・ルーティング・Home Assistant 連携などで有用。否: 「ハルシネーションしない」は「不正な型を出さない」だけで「正しい値を返す」ではない、速度比較は自己回帰生成と制約付き判定を比べており不公平、オープンモデルの logit を直接読めば同等のことができる、ウェイトリストで試せない。CEO は「アーキテクチャは当面非公開、論文を予定」「評価の詳細は順次公開」と回答。
- **Kingy AI レビュー**(2026-09-15)[S11]: ベンチマークは「モデル一致度テストであり検証済み正解ではない」、キャリブレーション指標未公開、レート制限・SLA・p95/p99 未開示、と指摘。結論「大量判断には使え。文章や AGI には使うな。評価は自分でやれ」。
- **Every(Mike Taylor、2026-09-15)**[S12]: 37 文書 × 21 問 = 777 判断を 0.7 秒未満、推定 0.25 セント。12 文の小規模比較で Jev は 7 個の意図的欠陥のうち 6 個を検出、Claude Fable 5.1 は 7 個すべて検出。Jev は中央値 0.35 秒、Fable 8.83 秒(約 25 倍速)、約 580 倍安い。「本番投入前にもっと徹底した精度確認が必要」。
- **Arize AI(Laurie Voss、2026-09)**[S13]: LLM-as-judge を「部分的に」置き換え可能。説明を返せないのが欠点。スパム判定で Jev はゼロショット 98.3%、14,800 通で学習した TF-IDF 分類器と統計的に同等。0.1 未満のスコアの実スパム率 0.1%、0.9 以上で 99.9% とキャリブレーションは良好。
- **jev-benchmark(themsquared、2026-09-17)**[S14]: エージェントのツール呼び出しリスク分類 60 件で 91.7%(明確 100%、曖昧 71.4%、敵対的 91.7%)。中央値 421.6 ms、p95 542 ms(米国ポートランドから)。「誤答はすべて confidence が低めだった」。n=60 で小さすぎる、と自ら注記。
- **Jev-Calibration(AnthusAI)**[S15]: 感情分類 8,801 件。Jev(Noul)精度 0.872。Llama 3.1-8B との 1,000 件比較で AUROC 0.828 対 0.719、生の ECE 0.073 対 0.169。isotonic 回帰で ECE 0.117 → 0.008。「confidence が高いほど本当に正解率が高い」(95% 以上で 2,104/2,104 正解)。一方で信頼度曲線は非シグモイド。
- **jev-hanko(2026-09-19)**[S20]: 英文契約 500 ページ × 41 条項 = 20,500 判定、弁護士ラベルが正解。Jev は最速(0.40 秒/ページ)だが F1 0.519 で、Qwen 3.7 Flash(F1 0.623、コストは Jev の半分)、Claude Sonnet 5(0.622)に劣る。「精度は課題とデータに強く依存」。
- **Zenn「TypeSafeのJevを正しく驚く」(nwn、2026-09-17)**[S21]: Gemma3 270M の logit 読み出しで JSON 生成比 77 倍高速化を再現。Mario ハーネスでは Jev 276 ms / 1,226 点、Llama 3.1 8B 356 ms / 1,138 点。読者コメントの独立検証で「隠したサイコロの目」を 400 件すべて「1」と平均 83% の確信度で答えた例が報告され、キャリブレーション主張への懐疑が出た。著者は「Jev の価値は確率を返す API を製品化した点」と評価。
- **innovatopia(2026-09-20)**[S22]: 「判断を小さな質問に分解する設計」が Claude / GPT-5.6 / Jev のいずれでも精度を上げた。「構造化は常に優る」。

要約すると、速度とコストの主張は第三者でも概ね再現されている。精度は「中位 LLM 並み」で、タスクにより大きくばらつく。キャリブレーションは概ね良好という報告と、不適切な質問には自信過剰になる報告の両方がある。

## 3. 性能

| 指標                                                     | 値                                                                                                                                                                                                                                                                                                                                                                                        | 根拠                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| レイテンシ(公式)                                         | 70〜500 ms(end-to-end)                                                                                                                                                                                                                                                                                                                                                                    | 公式資料 [S1]                   |
| レイテンシ(第三者、米国内)                               | 中央値 76 ms(ユーザー報告集計)、中央値 421.6 ms / p95 542 ms(jev-benchmark)                                                                                                                                                                                                                                                                                                               | 第三者評価 [S14][S23]           |
| レイテンシ(第三者、日本から)                             | 60 判断で処理 357 ms / 往復 1,167 ms、42 判断で 278 ms / 1,073 ms(ai-native.jp)                                                                                                                                                                                                                                                                                                           | 第三者評価 [S24]                |
| コンテキスト                                             | 64k / リクエスト(state 32k)                                                                                                                                                                                                                                                                                                                                                               | 公式資料 [S2]                   |
| 精度(公式 4 ワークフロー)                                | 67.8%(顧客サポート 76.0%、請求書処理 61.8%)                                                                                                                                                                                                                                                                                                                                               | 公式資料 [S16]                  |
| 精度(第三者)                                             | 上記 2.2 を参照。60〜98% とタスク依存                                                                                                                                                                                                                                                                                                                                                     | 第三者評価                      |
| 構造化出力エラー率                                       | 0%(公式)                                                                                                                                                                                                                                                                                                                                                                                  | 公式資料 [S16]                  |
| 言語                                                     | 「英語が主要な学習言語で精度が最も高い。CJK を含む他言語も扱えるが同等ではない。非英語ワークロードで頼る前に自分のコンテンツでテストせよ」                                                                                                                                                                                                                                                | 公式資料 [S2]                   |
| 日本語の実測                                             | ai-native.jp: 日本語問い合わせ 12 件の部署分類 12/12、緊急度 12/12、Score による具体性判定 10/12。hanatane: 日本語記事 82 本のタグ判定で明確な話題は precision 1.00 / recall 0.91〜1.00、技術系 0.89 / 0.78、アイコン一致 84%、関係種別分類は 48% で「使い物にならない」。kun432: 日本語サポートチケットで緊急度 0.97、部署 technical 0.91 と妥当。ku_suke(X): 日本語の質問に対応していた | 第三者評価 [S24][S25][S26][S27] |
| 本アプリ類似タスク(日本語レビューの 1〜5 段階評価)の実測 | **未確認**。該当する公開検証は見つからなかった                                                                                                                                                                                                                                                                                                                                            | 推定                            |
| 公式に列挙された弱点(jev-1.13 jaggedness)                | (1) 字義通りの読み取り、(2) 数値計算と数え上げ、(3) 日付・時刻の比較、(4) 間接参照、(5) 無関係な情報だらけの大きな state、(6) 敵対的入力、(7) 矛盾した指示と基準、(8) 常識的な構造不変量(Noul と Choice の結果は算術的に比較できない)、(9) 生成                                                                                                                                           | 公式資料 [S7]                   |

本アプリとの関係で特に重要なのは (5)「無関係な情報だらけの大きな state は精度を大きく落とす」で、5 件のレビューを連結した文字列は条件に無関係な記述が大半を占める。公式の対策は「先にフィルタし、質問に必要なものだけ送る」。

## 4. コスト

### 4.1 価格

| モデル          | 入力 / 1M トークン | キャッシュ入力 | 出力 / 1M トークン               | 根拠              |
| --------------- | ------------------ | -------------- | -------------------------------- | ----------------- |
| Jev(jev-1.13.0) | $0.042             | 記載なし       | $0(無料、「too cheap to meter」) | 公式資料 [S1][S2] |
| gpt-5.6-luna    | $0.20              | $0.02          | $1.20                            | 公式資料 [S17]    |

補足: gpt-5.6-luna は 2026-07-30 に 80% 値下げされて現在の価格になった(第三者評価 [S28])。Jev の無料枠は公式には見当たらない。kun432 のスクラップに「月約 $5 相当のクレジット」との記述があるが未確認(第三者評価 [S26])。

レート制限(公式、docs/models): 250,000 トークン/秒、1,200 リクエスト/分。ただし「早期アクセス中は動的に変わるアカウント制限」(第三者評価が公式記述を引用 [S19])。SLA なし。

### 4.2 本アプリのワークロードでの試算(推定)

前提: 1 店舗あたり入力 1,500 トークン(日本語レビュー)+ 300 トークン(指示)= 1,800 トークン。gpt-5.6-luna の出力は `{ value, related_review }` の JSON で約 100 トークンと仮定(`reasoning_effort: "none"` なので推論トークンは無し)。1 セッション = 10 店舗。

| 項目                              | gpt-5.6-luna                  | Jev(評価のみ)                    | Jev(評価 + 抜粋選択の 2 リクエスト) |
| --------------------------------- | ----------------------------- | -------------------------------- | ----------------------------------- |
| 1 店舗の入力コスト                | 1,800 × $0.20 / 1M = $0.00036 | 1,800 × $0.042 / 1M = $0.0000756 | 3,600 × $0.042 / 1M = $0.000151     |
| 1 店舗の出力コスト                | 100 × $1.20 / 1M = $0.00012   | $0                               | $0                                  |
| 1 店舗 合計                       | **$0.00048**                  | **$0.000076**                    | **$0.00015**                        |
| 1 セッション(10 店舗)             | **$0.0048**                   | **$0.00076**                     | **$0.0015**                         |
| セッション目標 $0.20 に対する比率 | 2.4%                          | 0.4%                             | 0.8%                                |
| 節約額 / セッション               | –                             | $0.004                           | $0.003                              |

注意点:

- Jev のトークナイザは非公開で、日本語 1 文字あたりのトークン数は未確認。上記は OpenAI と同じトークン数と仮定した。
- 抜粋選択のために文リストを state に含める場合、入力は 2 倍近くになる(右列)。1 リクエストに Score と Choice の両質問を同居させれば 1 回で済む可能性もある(公式資料 [S6] は複数質問の並列評価をサポート)が、Choice の選択肢として文を列挙する分のトークンは増える。
- いずれにせよ、**スコアリング工程は現時点でセッションコストの 2〜3% に過ぎず、Jev に替えても 1 セッションあたり 1 円未満の差**。コスト目標の達成手段としては意味が無い。

## 5. 使い方と API

### 5.1 認証・エンドポイント(公式資料 [S8][S29])

- API キー: `https://console.typesafe.ai/keys` で発行(早期アクセス承認後)。
- エンドポイント: `POST https://api.typesafe.ai/v1/systemone`
- ヘッダ: `Authorization: Bearer <API_KEY>`、`Content-Type: application/json`
- リクエスト: `{ state, model: "jev-latest", questions: { <id>: { type, instructions, criteria } } }`
- レスポンス: `{ model, answers: { <id>: {...} }, usage: { input_tokens, output_tokens } }`
- エラー: 401(キー不正)、422(バリデーション失敗)、429(レート制限)、529(過負荷)。429 / 529 は指数バックオフで再試行、と案内。

### 5.2 SDK(公式資料 [S30][S31])

- Node/TypeScript: `npm install @typesafe-ai/sdk`(Node.js 20 以上、ESM / CommonJS / 型定義同梱、MIT)。環境変数 `TYPESAFE_API_KEY`。`choice()`, `score()`, `noul()` ヘルパーと `client.systemOne()`。答えの型は質問から推論される。
- Python: `pip install typesafe-sdk`(Python 3.10 以上)。
- Vercel AI SDK 7.0.105 以降: `experimental_evaluate({ model: 'typesafe-ai/jev', state, questions })`。AI Gateway 経由で `zeroDataRetention: true` を指定可能(公式資料 [S18])。
- Cloudflare Workers AI: モデル ID `typesafe/jev`、コンテキスト 32k(公式資料 [S9])。
- OpenRouter: `typesafe/jev-1.13` としてベータ提供(第三者評価 [S32])。

### 5.3 分類スキームの定義方法(公式資料 [S3][S4][S7]、第三者評価 [S33])

- ラベルは `criteria` で定義する。Choice は `{ option: "説明" | null | { what, not_for, examples } }`、Score は段階の配列(低 → 高の順、2〜10 段階、各段階を「程度の形容詞ではなく具体的な状況」で記述する)。
- few-shot 相当は `criteria` 内の `examples` フィールドで与える。公式は「隣接段階で確率が割れるなら examples を足せ」と案内。
- ファインチューニングは提供されていない。「同じ重みが全アカウントに使われ、ドメイン適応は state と criteria の書き方で行う」(第三者評価が公式記述を引用 [S33])。
- 公式の設計原則: 「カードを当てさせるのではなく、デッキからカードを引かせる」。候補はコード側で作り、Jev は選ぶだけ。

### 5.4 1〜5 評価と抜粋の両方を返せるか(推定、公式パターンに基づく)

- **1〜5 評価**: Score プリミティブで 5 段階の状況説明を `criteria` に並べれば、段階 0〜4 の確率分布と加重平均 `score` が返る。`1 + argmax` または `1 + round(score)` で 1〜5 に写像する。現在 `/api/generate-examples` が生成している評価尺度の例文が、そのまま各段階の説明に流用できる可能性が高い。
- **抜粋**: Jev は文字列を生成しないので、「レビューを文単位に分割し、各文に ID を振って Choice の選択肢にし、『条件に最も関係する文はどれか』を選ばせる(該当なし の選択肢付き)」というパターンになる。これは公式クックブックの「Pre-parsed value extraction」(正規表現で候補を出し Jev に選ばせ、返り値は候補の完全一致コピー)[S34] と、第三者の jeveryword(文を先に選ばせてからトークン範囲を選ぶ、実験段階でベンチマーク無し)[S35] と同じ考え方。選択肢上限は 255 個。
- 現在のフロントエンドはレビューを連結した 1 本の文字列を送っているため、配列で送るか、ルートハンドラ側で「。」等で分割する変更が必要。LLM が行っている「文の途中を切り出す」抜粋はできず、文単位の粒度になる。

### 5.5 Next.js ルートハンドラでの最小例(公式ドキュメントの例を基に構成。未実行、推定)

```typescript
// src/app/api/analyze-reviews/route.ts の置き換え案(スパイク用の骨子)
import { NextResponse } from "next/server";
import { TypeSafeClient, score, choice } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // TYPESAFE_API_KEY を環境変数から読む

export async function POST(request: Request) {
  const { reviews, metric, levels } = (await request.json()) as {
    reviews: string[]; // 店舗のレビュー本文(最大 5 件)
    metric: string; // 例: "電源がある"
    levels: string[]; // 5 段階の状況説明(低 → 高)。generate-examples の出力を流用
  };

  // レビューを文に分割し、ID を振る(候補はコード側で作る)
  const sentences = reviews
    .flatMap((review) => review.split(/(?<=[。！？!?])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 254); // Choice の上限 255 から none 用の 1 枠を引く

  const sentenceOptions = Object.fromEntries(
    sentences.map((sentence, index) => [`s${index}`, sentence]),
  );

  const response = await client.systemOne({
    model: "jev-latest",
    state: { metric, sentences: sentenceOptions },
    questions: {
      value: score(
        `レビュー全体から、この店が「${metric}」をどの程度満たすかを評価してください。`,
        levels, // 5 要素 → 段階 0〜4
      ),
      relatedSentence: choice(
        `「${metric}」の評価に最も関係する文はどれですか。`,
        { ...sentenceOptions, none: "該当する文が無い" },
      ),
    },
  });

  const valueAnswer = response.answers.value; // { score, probabilities, confidence }
  const sentenceAnswer = response.answers.relatedSentence; // { choice, probabilities, confidence }

  return NextResponse.json({
    value: 1 + Math.round(valueAnswer.score),
    related_review:
      sentenceAnswer.choice === "none"
        ? ""
        : sentenceOptions[sentenceAnswer.choice],
    confidence: valueAnswer.confidence,
    usage: response.usage,
  });
}
```

補足: 公式の Score 例では `instructions` が英語だが、日本語の指示と基準でも動作した報告が複数ある(第三者評価 [S24][S26][S27])。1 リクエストに Score と Choice を同居させる形は公式の「複数質問の並列評価」に沿うが、本アプリの入力で実際に成立するかは未確認。

## 6. データ保持・規約

| 項目                                                  | 内容                                                                                                                                                                                                            | 根拠                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 学習利用                                              | 「お客様のプロンプトやその他の Input で AI / ML モデルを学習・ファインチューニングしない」(プライバシーポリシー、最終更新 2025-11-19)。docs/models にも「Jev is not trained on customer requests or responses」 | 公式資料 [S2][S36]   |
| 第三者提供                                            | 「サービスプロバイダ以外の第三者に Input を開示しない」                                                                                                                                                         | 公式資料 [S36]       |
| 保持期間                                              | 「サービス提供、または事業目的に合理的に必要な期間」。具体的日数は非公開。DPA(最終更新 2026-04-24)も「処理目的に照らして必要な期間」                                                                            | 公式資料 [S36][S37]  |
| ゼロデータ保持                                        | Vercel AI Gateway 経由では `zeroDataRetention: true` オプションあり。TypeSafe 直販ではエンタープライズ向けと案内されるが、標準アカウントでの可否は未確認                                                        | 公式資料 [S18]、推定 |
| ホスティング地域                                      | 米国                                                                                                                                                                                                            | 公式資料 [S36]       |
| 準拠法                                                | デラウェア州法(利用規約、最終更新 2026-09-19)                                                                                                                                                                   | 公式資料 [S38]       |
| サブプロセッサ                                        | `https://trust.typesafe.ai/subprocessors` に掲載(本調査では取得できず、未確認)                                                                                                                                  | 公式資料 [S37]       |
| 第三者(Google Places)のレビュー本文を送ることについて | TypeSafe 側の規約には Input の内容に関する特段の制限は見当たらない。Google 側の Places API 利用規約(レビューデータの第三者サービスへの送信・保存)は本調査の範囲外で未確認。現状 OpenAI に送っているのと同じ論点 | 推定                 |

## 7. このアプリへの適合性

### 7.1 判定表

| 観点                   | 判定                         | 説明                                                                                                                                                                                                       | 根拠                                 |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `value`(1〜5 評価)     | **可能**                     | Score プリミティブ(2〜10 段階)で 5 段階の状況説明を与える。確率分布と confidence も付いてくるので「自信の無い評価」をグレー表示するなどの UI 改善余地もある                                                | 公式資料 [S4]                        |
| `related_review`(抜粋) | **条件付きで可能**           | 文字列は生成できない。レビューを文分割して Choice で選ばせる設計変更が必要。文の途中の切り出しは不可。フロントエンドの送信形式(連結文字列 → 配列)も変更                                                    | 公式資料 [S3][S34]、推定             |
| 日本語                 | **要検証**                   | 公式は「扱えるが英語と同等ではない。自分のコンテンツで試せ」。日本語の分類・ルーティングでは良好な報告が複数あるが、日本語レビューの 5 段階評価という本タスクの実測は無い                                  | 公式資料 [S2]、第三者評価 [S24][S25] |
| コスト                 | **削減効果は無視できる規模** | 1 セッションあたり $0.0048 → $0.0008〜0.0015。節約額 $0.003〜0.004 / セッション。セッション目標 $0.20 の主因はスコアリング工程ではない                                                                     | 推定(4.2)                            |
| レイテンシ             | **改善が見込めるが未計測**   | 公式 70〜500 ms、日本からの往復実測 約 1.1 秒。gpt-5.6-luna(`reasoning_effort: "none"`)の現在の応答時間は本調査では未計測のため、差分は不明                                                                | 公式資料 [S1]、第三者評価 [S24]      |
| 統合工数               | **中**                       | ウェイトリスト登録と API キー取得、新 SDK 追加、ルートハンドラ書き換え、フロントエンドの送信形式変更、`generate-examples` の出力を段階説明に整形、環境変数と deploy.sh / GitHub Actions のシークレット追加 | 推定                                 |
| 安定性・運用リスク     | **高め**                     | 早期アクセス段階。レート制限は「動的に変わる」、SLA 無し、p95/p99 未公開、アーキテクチャ非公開。ベンダーが新しく、サービス継続性は未知                                                                     | 第三者評価 [S11][S19]                |
| 品質リスク             | **中〜高**                   | 公式の弱点「無関係な情報だらけの大きな state」に本アプリの入力(条件と無関係な記述が大半のレビュー連結)は該当する。「説明を返せない」ので誤判定の原因が追えない。キャリブレーションはタスク次第             | 公式資料 [S7]、第三者評価 [S15][S21] |
| データ保持             | **現状(OpenAI)と同程度**     | 学習利用なし、米国ホスティング、保持期間は非公開                                                                                                                                                           | 公式資料 [S36]                       |

### 7.2 推奨

**今は採用しない。低優先度のスパイクに値する。**

理由:

1. 本アプリで Jev に替える動機になり得るのはレイテンシと応答の安定性であり、コストではない。コスト目標に対する寄与は 1 セッションあたり 1 円未満で、判断材料にならない。
2. `related_review` の抜粋は設計変更(文分割 + Choice)で代替できるが、LLM が返す柔軟な抜粋より粒度が粗くなる。ユーザー体験上それで十分かは実物で見る必要がある。
3. 日本語レビューの 5 段階評価という本タスクでの精度は公開情報が無く、公式も非英語は自前検証を求めている。
4. 早期アクセス段階でレート制限や提供継続性が固まっていない。個人用途で 1 日数十リクエストなら制限には当たらないが、ベンダー依存を増やす価値があるかは慎重に判断すべき。

スパイクを行う場合の手順(今回はコード変更しない):

1. `https://typesafe.ai` のウェイトリストに登録し API キーを得る。待てない場合は OpenRouter(ベータ)または Cloudflare Workers AI 経由で試す(ウェイトリスト不要かは未確認)。
2. 実際の検索 20〜30 店舗分のレビュー(各 5 件)と条件(「電源がある」「静か」など 3 条件程度)を収集し、人手で 1〜5 と関連文を付ける。
3. 同じ入力を gpt-5.6-luna(現行ルート)と Jev(5.5 の骨子)の両方に投げ、(a) 1〜5 の一致率と ±1 以内率、(b) 関連文の一致率、(c) asia-northeast1 相当の地点からの往復時間の中央値と p95、(d) 実際の `usage.input_tokens` から算出したコスト、(e) Jev の confidence と正誤の関係、を記録する。
4. 指示と段階説明を「日本語のまま」「英語に翻訳」の 2 条件で比べる(note.com の アレイ 氏が提案する検証手順に沿う [S39])。
5. レビュー連結をそのまま state に入れる場合と、条件に関係しそうな文だけを先に絞ってから入れる場合(公式の弱点 (5) への対策)を比べる。
6. 一致率が gpt-5.6-luna と同等かつ p95 レイテンシが明確に短い場合に限り、採用を再検討する。

## 8. 出典一覧(アクセス日: いずれも 2026-09-20)

公式資料(TypeSafe AI / OpenAI)

- [S1] TypeSafe AI Blog「Introducing System One Models & Jev」 https://typesafe.ai/blog/introducing-system-one-models-and-jev
- [S2] TypeSafe AI Docs「Models」 https://docs.typesafe.ai/models
- [S3] TypeSafe AI Docs「Choice」 https://docs.typesafe.ai/primitives/choice
- [S4] TypeSafe AI Docs「Score」 https://docs.typesafe.ai/primitives/score
- [S5] TypeSafe AI Docs「Noul」 https://docs.typesafe.ai/primitives/noul
- [S6] TypeSafe AI Docs「System One」 https://docs.typesafe.ai/concepts/system-one
- [S7] TypeSafe AI Docs「Jev 1.13 jaggedness」 https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
- [S8] TypeSafe AI Docs「HTTP API reference」 https://docs.typesafe.ai/api.md
- [S9] Cloudflare AI Docs「Jev (typesafe)」 https://developers.cloudflare.com/ai/models/typesafe/jev/
- [S16] TypeSafe AI「Workflow evals」 https://evals.typesafe.ai/
- [S17] OpenAI API Docs「GPT-5.6 Luna」 https://developers.openai.com/api/docs/models/gpt-5.6-luna
- [S18] Vercel Knowledge Base「How to classify, route, and score with Jev and AI SDK」 https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk
- [S29] TypeSafe AI Docs「Quick start」 https://docs.typesafe.ai/introduction/quickstart
- [S30] GitHub typesafe-ai/typesafe-sdk-js https://github.com/typesafe-ai/typesafe-sdk-js
- [S31] TypeSafe AI Docs「JavaScript SDK」 https://docs.typesafe.ai/sdk/javascript.md
- [S34] TypeSafe AI Docs Cookbook「Pre-parsed value extraction」 https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md
- [S36] TypeSafe AI「Privacy policy」 https://typesafe.ai/legal/privacy-policy
- [S37] TypeSafe AI「Data processing addendum」 https://typesafe.ai/legal/data-processing
- [S38] TypeSafe AI「Terms」 https://typesafe.ai/legal/terms

第三者評価

- [S10] Hacker News「Introducing System One Models and Jev」(2026-09-15) https://news.ycombinator.com/item?id=49717558
- [S11] Kingy AI「TypeSafe Jev Review: The AI Model That Doesn't Generate Text」(Curtis Pyke、2026-09-15) https://kingy.ai/blog/typesafe-jev-review-the-ai-model-that-doesnt-generate-text/
- [S12] Every「Mini-Vibe Check: TypeSafe's Jev Judged Everything I've Written in 0.7 Seconds」(Mike Taylor、2026-09-15) https://every.to/also-true-for-humans/mini-vibe-check-typesafe-s-jev-judged-everything-i-ve-written-in-0-7-seconds
- [S13] Arize AI「TypeSafe Jev: Can Decision Models Replace LLM Judges?」(Laurie Voss、2026-09) https://arize.com/blog/typesafe-jev-llm-judge/
- [S14] GitHub themsquared/jev-benchmark(2026-09-17) https://github.com/themsquared/jev-benchmark
- [S15] GitHub AnthusAI/Jev-Calibration https://github.com/AnthusAI/Jev-Calibration
- [S19] Developers Digest「TypeSafe Jev: the First Decision-Only Model Class, Benchmarked and Priced」 https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026
- [S20] GitHub matu79go/jev-hanko(2026-09-19) https://github.com/matu79go/jev-hanko
- [S21] Zenn「TypeSafeのJevを正しく驚く、それってLLMでできませんか？」(nwn、2026-09-17、更新 2026-09-19) https://zenn.dev/nwn/articles/824026c76116e0
- [S22] innovatopia「【解説】TypeSafe「Jev」｜速さより効いたのは判断の分解」(2026-09-20) https://innovatopia.jp/ai/ai-news/118050/
- [S23] DataCamp「Jev: TypeSafe's System One Model That Never Hallucinates」(Matt Crabtree、2026-09-16。ユーザー報告のレイテンシ集計は検索結果の要約に基づく) https://www.datacamp.com/blog/system-one-models-jev
- [S24] AI Native「TypeSafe Jev徹底解説｜テキストを生成しないAI「System Oneモデル」を実装して検証した」(田中慎、2026-09-18) https://www.ai-native.jp/blog/typesafe-jev-system-one-model-guide
- [S25] GitHub mtane0412/hanatane PR #50「Jev の日本語精度を既存のタグ・icon・関係で測る評価スクリプトを追加」(2026-09-20) https://github.com/mtane0412/hanatane/pull/50
- [S26] Zenn スクラップ「メモ: System One Model / Jev（typesafe.ai）」(kun432) https://zenn.dev/kun432/scraps/7d699847974237
- [S27] X(Yusuke Kawabata、ku_suke)日本語の質問に対応した旨の投稿 https://x.com/ku_suke/status/2100392430805856469
- [S28] CloudZero「GPT-5.6 pricing: Sol, Terra, and Luna costs」(2026-07-30 の値下げに言及) https://www.cloudzero.com/blog/gpt-5-6-pricing/
- [S32] OpenRouter「Jev 1.13 - API Pricing & Providers」(本調査では直接取得できず、検索結果と OpenRouter の X 投稿に基づく) https://openrouter.ai/typesafe/jev-1.13 、 https://x.com/OpenRouter/status/2100744709589316009
- [S33] flaviocopes.com「A deep dive into Jev, TypeSafe's System One model」(2026-09-18) https://flaviocopes.com/jev/
- [S35] GitHub jkrup/jeveryword(Jev による正確な引用の抽出、実験段階) https://github.com/jkrup/jeveryword
- [S39] note「文章を書かないAI「Jev」を公式数値から再評価する ― 200倍速・400倍安の実態と、日本語で使う前の検証手順」(アレイ、2026-09-20) https://note.com/allay0224/n/nbb47ec7a4772

その他参照(本文で直接引用していない補助資料)

- DevelopersIO「I read OpenJev and thought of an alternative solution using non-generative AI」(森茂洋、2026-09-18) https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/
- Qiita「LLMの代わりになる？ 文章を生成しないAI「Jev」を日本語で試してみた」(harupython、2026-09-18) https://qiita.com/harupython/items/fbe98be6d136d5b9d14a
- GitHub uesgugikouhei-oss/jev-ja-eval(日本語問い合わせ 150 件の比較キット。Jev の結果は未掲載) https://github.com/uesgugikouhei-oss/jev-ja-eval
- MindStudio「Jev AI Tested」(2026-09-18) https://www.mindstudio.ai/blog/jev-system-one-model-classification
- explainx.ai「Jev by TypeSafe AI: 200x Faster Structured-Output Model」(2026-09-16) https://www.explainx.ai/blog/typesafe-ai-jev-system-one-models-launch-2026
