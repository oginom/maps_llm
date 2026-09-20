# Phase 0 検証票: Google データの LLM 利用条件と AI SDK 最小検証

作成: 2026-09-20。ステータス: 調査結果。Google への照会は送っていない。実装変更は含まない。

この文書は [改善計画](ai-map-plan.md) §3.2 の 4 つの確認事項（外部 LLM への送信可否、独自スコア化の可否、保持範囲、必要な表示）に対する、公開規約の原文に基づく回答と、AI SDK の最小動作確認の記録である。各判断には「**規約原文で確認**」「**推定**（原文が直接には言及していない解釈）」「**未確認**（Google または OpenAI に確認が必要）」の区別を付けた。法的助言ではない。

参照した文書はすべて 2026-09-20 に取得した。ローカル取得物は `scratchpad/terms/*.txt`（セッション限りの一時領域）。

| 文書                                                                                                                                                            | 版                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)（以下 ToS）                                                               | Last modified August 26, 2026 |
| [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)（以下 SST）                                      | Last modified June 10, 2026   |
| [Places API (New) Policies and attributions](https://developers.google.com/maps/documentation/places/web-service/policies)                                      | 取得日時点                    |
| [Maps Grounding Lite 概要](https://developers.google.com/maps/ai/grounding-lite)                                                                                | 取得日時点                    |
| [Maps Grounding Lite text attribution guidelines](https://developers.google.com/maps/ai/grounding-lite/attribution)                                             | Last updated 2026-09-17       |
| [Grounding Lite `search_places` リファレンス](https://developers.google.com/maps/ai/grounding-lite/reference/mcp/search_places)                                 | 取得日時点                    |
| [Gemini API: Grounding with Google Maps](https://ai.google.dev/gemini-api/docs/maps-grounding)                                                                  | Last updated 2026-09-17       |
| [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)                                                                                | Effective March 23, 2026      |
| [Google Maps Platform 料金表](https://developers.google.com/maps/billing-and-pricing/pricing)、[Gemini API 料金](https://ai.google.dev/gemini-api/docs/pricing) | 取得日時点                    |
| [Legacy products and features](https://developers.google.com/maps/legacy)                                                                                       | 取得日時点                    |
| [OpenAI: Your data](https://developers.openai.com/api/docs/guides/your-data)                                                                                    | 取得日時点                    |

`developers.google.com/maps/documentation/places/web-service/legacy/policies` と JavaScript Places Library 用の旧ポリシー URL は 404 だった。Legacy Places に固有の公開ポリシー文書は見つからず、SST §14 が「Places API (Legacy and New)」として両方を対象にしている。

## 1. 候補データ経路の比較

現行アプリは Maps JavaScript API の `PlacesService.textSearch` / `getDetails`（Legacy）で `name, formatted_address, rating, reviews, url` を取得し、口コミ本文を OpenAI に送って 1〜5 の点数と抜粋を得ている。

| 観点                         | Places API Legacy（現行）                                                                                                                                                        | Places API (New)                                                                                                                                                                                             | Maps Grounding Lite                                                                                                                                                                                                                             | Gemini API Grounding with Google Maps                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 返るデータ                   | 店舗詳細、Google 評価、口コミ最大 5 件（原文）                                                                                                                                   | 店舗詳細、営業時間、Google 評価、口コミ最大 5 件（原文、投稿者帰属付き）、`reviewSummary`（Gemini 生成の要約）                                                                                               | `summary`（自然文の AI 要約）と、要約に登場した場所の `id`・`location`・`googleMapsLinks`・`attribution`。**口コミ原文は返らない**                                                                                                              | 自然文回答と `place_citation` 注釈（`name`, `url`）。内部で口コミ・写真・営業時間を参照するが、**口コミ原文は返らない**                                              |
| 第三者 LLM への送信          | 規約に明示の許可なし。ToS 3.2.3(a)(iii)「user reviews をコピー・保存しない」、(c)「Google Maps Content からコンテンツを作らない」が適用される（**推定: 不利**）                  | Legacy と同じ                                                                                                                                                                                                | **可**。SST 10.2.1 が「LLM を ground して Grounded Output を生成・表示」を限定例外として許可。ただし LLM 側が Google Maps Content を「キャッシュ・保存・改善に利用」しないことを顧客が保証（**規約原文で確認**）                                | Gemini 自身が処理する。回答を別の LLM に渡すことは「Grounded Result を改変・抽出しない」条項に照らし想定外（**推定**）                                               |
| 独自スコア・ランキングの生成 | ToS 3.2.3(c) の一般禁止に該当し得る。例示に「採点」はないが例外規定もない（**推定: 不可**）。3.2.3(g) 検索結果の改変禁止も並べ替えに影響し得る（**未確認**）                     | Legacy と同じ。`reviewSummary` は「Google Maps が提供する全文をそのまま読める」ことが必須で、要約の二次加工には使えない（**規約原文で確認**）                                                                | LLM の回答（Grounded Output）として条件への適合を述べさせ、出典付きで表示することは 10.2.1 の範囲内。Grounded Output から Google Maps Content を分離・改変することは 10.3.1 / 10.3.3 で禁止。**構造化フィールドをピン色に使ってよいかは未確認** | 回答をそのまま Google Maps Links 付きで表示するのみ。「改変・挿入禁止」（**規約原文で確認**）。独自スコア化は想定外（**推定**）                                      |
| キャッシュ・保持             | Place ID は無期限可（SST §3）。緯度経度は 30 日（SST 14.3）。その他は禁止（ToS 3.2.3(b)）                                                                                        | Legacy と同じ                                                                                                                                                                                                | Grounded Output を **30 日**、「表示の評価・最適化」目的のみ（SST 10.2.2）。Place ID は SST §3 により可                                                                                                                                         | Grounded Result を **90 日**（表示評価目的）または **6 か月**（そのユーザーのチャット履歴）。Google 側はプロンプト等を 30 日保存                                     |
| 必要な表示・帰属             | Google Map 上なら追加帰属不要。口コミは投稿者（アバター・名前・プロフィールリンク）と Google Maps への直接リンクが必須                                                           | Legacy と同じ。`reviewSummary` は見出し「Review summary」、`disclosureText`、`flagContentUri`、`reviewsUri`、「About this summary」リンクが必須                                                              | 各出典を「Google Maps」に帰属し、`attribution.title` をそのまま表示、`url`（または `placeUrl`）にリンク。出典は生成文の直後、1 操作以内で閲覧可能                                                                                               | 各 `place_citation` を「Google Maps」に帰属し、`name` を表示、`url` にリンク。出典は生成文の直後、1 操作以内で閲覧可能                                               |
| 料金 / 無料枠（月）          | Text Search: 5,000 件無料、以後 $32/1,000。Places Details: 5,000 件無料、$17/1,000。口コミは Atmosphere Data SKU が別途加算（無料枠 1,000 件、[計画書 §8](ai-map-plan.md) 記載） | Text Search Pro: 5,000 件、$32。Text Search Enterprise + Atmosphere: 1,000 件、$40。Place Details Pro: 5,000 件、$17。Place Details Enterprise + Atmosphere（口コミ・`reviewSummary` を含む）: 1,000 件、$25 | SKU `8CD0-1602-5324`: **10,000 リクエスト無料、以後 $7.00/1,000**。割当 300 QPM / プロジェクト                                                                                                                                                  | Gemini 3 系: 5,000 プロンプト/月無料（Gemini 3 共有）、以後 **$14/1,000 検索クエリ**。Gemini 3 では 1 プロンプトが複数クエリに課金され得る。モデルのトークン料金は別 |
| このアプリの機能適合         | 地図範囲内の検索: 可。詳細: 可。営業時間: 可。経路: 不可（Routes API 別途）。**Legacy 状態**（2025-03-01 から。既存プロジェクトは継続可、停止日は未定、12 か月前通知）           | 地図範囲内の検索: `locationRestriction`（矩形）で可。`openNow`、`includedType` あり。詳細・営業時間: 可。経路: Routes API 別途                                                                               | 地図範囲の**厳密な制限は不可**（`locationBias` の円のみ、半径 50 km 以内）。`languageCode: ja` 対応。経路は徒歩・車の距離と時間のみ。詳細フィールドは返らないので Places と併用する                                                             | **英語のプロンプト・回答のみ**（Limitations に明記）。位置は緯度経度 1 点。日本語アプリには現時点で不適                                                              |

## 2. 各経路の規約根拠（原文引用）

引用は取得した原文からの短い抜粋。段落番号は原文どおり。

### 2.1 全経路に共通する ToS の制限

ToS 3.2.3 "Restrictions Against Misusing the Services"（https://cloud.google.com/maps-platform/terms）:

- (a) No Scraping: "Customer will not export, extract, or otherwise scrape Google Maps Content for use outside the Services. For example, Customer will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps Content outside the services; ... (iii) copy and save business names, addresses, or user reviews; ..."
- (b) No Caching: "Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms."
- (c) No Creating Content From Google Maps Content: "Customer will not create content based on Google Maps Content. For example, Customer will not: ... (vii) use Google Maps Content to improve machine learning and artificial intelligence models, including to train, test, validate or fine-tune the models."
- (d) No Re-Creating Google Products or Features: "Customer's product or service must contain substantial, independent value and features beyond the Google products or services."
- (e) No Use With Non-Google Maps: "Customer will not (i) display or use Places content on a non-Google Map"
- (g) No Modifying Search Results Integrity: "Customer will not modify any of the Google Maps Core Services' search results."

定義（ToS §1）: "\"Google Maps Content\" means any content provided through the Services (whether created by Google or its third-party licensors), including map and terrain data, imagery, traffic data, and places data (including business listings)."

帰属（ToS 3.2.2(b)）: "Customer will display all attribution that (i) Google provides through the Services ...; or (ii) is specified in the Maps Service Specific Terms. Customer will not modify, obscure, or delete such attribution."

**曖昧な点と確認すべき質問:**

- (c) の例示に「口コミからの採点」は含まれない。一方で本文は "create content based on Google Maps Content" と一般的に書かれており、Grounding Lite（SST 10.2.1）と Gemini（Gemini 追加規約）だけが LLM 利用の「限定例外」として明示されている。例外が別途置かれていること自体が、Places の口コミを LLM に渡して独自コンテンツを作る行為が原則禁止に含まれる、という読み方を支持する（**推定**）。
  - 質問 1: 「Places API の口コミ本文を第三者 LLM に送信し、条件適合度（数値または区分）を生成して表示する」ことは 3.2.3(c) に該当するか。
- (g) は「検索結果の改変」を禁じる。独自スコアで候補を並べ替える・一部を非表示にすることが該当するかは原文からは判断できない。
  - 質問 2: Text Search の結果順を独自の適合度で並べ替える、または適合度で絞り込むことは 3.2.3(g) に該当するか。

### 2.2 Places API（Legacy と New）

SST §14 "Places API (Legacy and New)"（https://cloud.google.com/maps-platform/terms/maps-service-terms）:

- 14.1 "Customer may use Google Maps Content from the Places API in Customer Applications without a corresponding Google Map."
- 14.2 "Customer must not use Google Maps Content from the Places API in conjunction with a non-Google map."
- 14.3 "Customer may temporarily cache latitude and longitude values from the Places API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values."

SST §3 "Google ID Caching": "Customer may cache the Google ID values from the Services that return such field and allow caching, in accordance with its Documentation. For example, Customer may cache (a) place_id from Places API, ..."

Places API (New) ポリシー（https://developers.google.com/maps/documentation/places/web-service/policies）:

- キャッシュ: "Note that the place ID, used to uniquely identify a place, is exempt from the caching restrictions. You can therefore store place ID values indefinitely."
- 帰属: "You must follow Google Maps attribution requirements when displaying Content from Google Maps Platform APIs in your app or website. You don't need to add extra attribution if the Content is shown on a Google Map where the attribution is already visible." ロゴ高さ 16〜19dp、テキストは "Google Maps"（改変・折返し・翻訳禁止、`translate="no"`）。
- 口コミ: "You must always credit the author when displaying photos or reviews. Each photo and review includes an author attribution (author's avatar image, name, and profile link)." / "For reviews, If space is limited, the minimum requirement is to display the author's avatar." / "For each photo and review, end-users must always have access to view the individual source photo or review on Google Maps using the provided googleMapsUri." / "Include a clear notice that describes how reviews are being ordered and filtered including any search criteria applied."
- AI 要約（`reviewSummary` 等）: "End users must be able to read the full summary text as it is provided by Google Maps." / "always include the localized disclosure text (provided in the disclosureText field of the response body) immediately below the summary. Never modify or augment the disclosure text" / Review summary には見出し "Review summary"、"About this summary" リンク、`flagContentUri`、`reviewSummary.reviewsUri` が必須。

Places (New) の口コミ件数（Place リファレンス）: "List of reviews about this place, sorted by relevance. A maximum of 5 reviews can be returned." `reviews` と `reviewSummary` は Place Details Enterprise + Atmosphere SKU。

Legacy 状態（https://developers.google.com/maps/legacy）: "Legacy services are not available in new Cloud projects but remain fully supported for existing projects." / "While Legacy services will eventually be turned down, there's no set date, and a 12-month notice will be provided before decommissioning." 表では "Places API → March 1, 2025 → Places API (New)"、"JavaScript Places Service → March 1, 2025 → Place Class"。

**曖昧な点:** Places ポリシーは「口コミの抜粋・要約表示」を明示的に禁止も許可もしていない。投稿者帰属と Google Maps へのリンクの要件は「口コミを表示するとき」に必ず適用される。

- 質問 3: LLM が抽出した口コミの一部（抜粋）を表示する場合も、元の口コミの投稿者帰属・`googleMapsUri` の表示義務が同様に適用されるか（**推定: 適用される**）。

### 2.3 Maps Grounding Lite

SST §10 "Maps Grounding Lite API":

- 10.1 定義: "\"Grounded Output\" means output created when Google Maps Content is combined with the output of any LLM." / "\"Google Maps Content\" means the content originating from Google Maps provided in the Grounded Output, including any content found on the landing pages of source links within the Grounded Output."
- 10.2 Permitted Use: "Google Maps Content contained in Grounded Output remains subject to use restrictions applicable to Google Maps Content in the Agreement, including the prohibition on model training. As a limited exception:"
  - 10.2.1 "to the prohibition on using Google Maps Content to create content, Customer may use the Maps Grounding Lite API to ground a LLM to generate and display Grounded Output to End Users if (i) Customer complies with the Generative AI Prohibited Use Policy ... and (ii) Customer includes associated Google Maps source links with the Grounded Output;"
  - 10.2.2 "to the prohibition on caching or storing Google Maps Content, Customer may cache Grounded Output for up to thirty (30) consecutive days solely for the purpose of evaluating and optimizing the performance or display of the Grounded Output for the Customer Application."
- 10.3 Additional Restrictions: "10.3.1 attempt to extract or otherwise separate Google Maps Content from the Grounded Output; 10.3.2 use Grounded Output to train, develop, or improve any machine learning models or artificial intelligence systems; 10.3.3 modify or intersperse content with the Grounded Output, insert interstitial content, or redirect users away from or inhibit the full display of any destination page."
- 10.4 "Google is not responsible for the acts or omissions of any LLM provider. This includes ... (ii) excessive usage charges resulting from an LLM's automated request behavior."

Grounding Lite 概要ページ "Requirements for Compatible LLMs": "You may only use Maps Grounding Lite with an LLM that is compliant with the Google Maps Platform Terms of Service. For example, you are responsible for ensuring that Google Maps Content is not cached by, stored by, or used to improve the LLM that you choose to use. ... You must not use Maps Grounding Lite with any models that use the data input into the model for any model training or improvement."

同ページの帰属要件: "The Google Maps sources must immediately follow the generated content that the sources support." / "The Google Maps sources must be viewable within one user interaction." / "Link to the source using the places.googleMapsLinks.placeUrl from the response."

帰属ガイドライン（attribution ページ）: "Display the source title exactly as provided in the response." / "Link to the source using the url provided in the response." 音声 UI では履歴の表示と "AI generated content may include information from Google Maps." 等の能動的開示が必要。

`search_places` の入出力: 入力は `textQuery`（必須）、`languageCode`、`regionCode`、`locationBias.circle`（半径 50,000 m 以内）。出力は `summary`（"[0]" 形式の引用を含む自然文）と `places[]`（`place`, `id`, `location`, `googleMapsLinks`, `attribution{title,url}`）。ツール説明文に "The grounded output must be attributed to the source using the information from the attribution field when available." とある。

料金表: "Maps Grounding Lite 8CD0-1602-5324 | 10,000 | $7.00 | $5.95 | $4.90 | $3.85 | $2.80"（無料枠 10,000 件、以後 1,000 件あたりの段階単価）。

**曖昧な点と質問:**

- 質問 4: OpenAI API は「学習には使わない」が「不正利用監視ログを既定で最大 30 日保持」する（§5）。これが "Google Maps Content is not cached by, stored by ... the LLM" の要件を満たすか。Zero Data Retention または Modified Abuse Monitoring の承認が必要か。
- 質問 5: LLM の回答（Grounded Output）に「条件: 電源 → あり [0]」のような構造化された判定を含めさせ、その判定をピンの色や一覧の並び順に反映することは、10.2.1 の「生成・表示」の範囲か、10.3.1「Google Maps Content の分離」または 10.3.3「改変」に当たるか。
- 質問 6: 会話履歴として Grounded Output をブラウザ内（または端末内）に保持することは 10.2.2 の「30 日・表示評価目的」に含まれるか。Gemini 側の規約には「チャット履歴 6 か月」の明示があるが、SST §10 にはない。

### 2.4 Gemini API Grounding with Google Maps

Gemini API Additional Terms "Grounding with Google Maps":

- "You will only use Grounding with Google Maps in an application that is owned and operated by you and will only use Grounding with Google Maps to display the Google Maps Grounded Results with the associated Google Maps Links to the end user who initiated the prompt."
- "You will not modify the Google Maps Grounded Result or intersperse any other content with the Google Maps Grounded Result, place any interstitial content between the text of the Google Maps Grounded Result and the Google Maps Links ..."
- "cache or store Google Maps Grounded Results except that you may cache or store Google Maps Grounded Results: for up to ninety (90) days, only to evaluate and optimize the display of the Google Maps Grounded Results for your application; or, in the chat history of an end user in your application for up to six (6) months for the purpose of allowing that end user to view their chat history or to maintain prior conversation context"
- "scrape or export any Google Maps Data; train on any Google Maps Data"
- "it is reasonably necessary for Google to store prompts, contextual information that you may provide, and generated content for thirty (30) days for the purposes of creating Google Maps Grounded Results ... the stored information can be used for debugging and testing"
- Paid Services: "Google doesn't use your prompts ... or responses to improve our products" / "Google logs prompts and responses for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy"

Gemini ドキュメント（maps-grounding）: 出力は "text response with inline annotations linking to Google Maps sources"、`place_citation`（`name`, `url`）。表示要件は Grounding Lite と同じ（出典は生成文の直後、1 操作以内、"Google Maps" 帰属）。Limitations: "Grounding with Google Maps currently only supports English language prompts and responses." 料金: "5,000 prompts per month (free, shared across Gemini 3), then $14 / 1,000 search queries"。

**判断:** 英語限定のため、日本語で会話・日本の店舗を扱う本アプリでは現時点で採用しない（**規約・文書で確認**）。日本語対応が追加された場合に再評価する。

## 3. 現行設計（口コミ → OpenAI → 点数）の判定

| 条件                                                            | 現行の状態                                                                             | 判定                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Google Map 上に Places 結果を表示（ToS 3.2.3(e), SST 14.2）     | Google Map 上に表示                                                                    | **満たす**                                                                                                            |
| Place ID 以外を保存しない（ToS 3.2.3(a)(b), SST §3, 14.3）      | 口コミ・詳細は React state のみ。URL には検索語・条件・位置だけ。localStorage 保存なし | **満たす**（アプリ側）。ただし OpenAI 側の 30 日ログは下記                                                            |
| Google Maps Content を Services 外に保存・再ホストしない        | 口コミ本文を OpenAI API に送信。OpenAI は既定で不正利用監視ログを最大 30 日保持        | **満たさない可能性が高い**（推定）。規約は Places 口コミの第三者 LLM 送信を許可していない。ZDR でも「送信」自体は残る |
| Google Maps Content からコンテンツを作らない（ToS 3.2.3(c)）    | 口コミから 1〜5 点と抜粋を生成し、ピン色・ヒストグラムに使用                           | **満たさない**（推定、質問 1）。Places には Grounding Lite 10.2.1 のような例外がない                                  |
| 検索結果の改変禁止（ToS 3.2.3(g)）                              | 並べ替えはしていないが、点数による色分け・ヒストグラム                                 | **未確認**（質問 2）。色分け自体は結果の改変ではないと読めるが原文に基準がない                                        |
| 口コミ表示時の投稿者帰属・Google Maps リンク（Places ポリシー） | 抜粋 `related_review` を投稿者名・アバター・リンクなしで表示                           | **満たさない**                                                                                                        |
| Google Maps の帰属表示                                          | 地図上に表示しているため追加は不要                                                     | **満たす**。詳細パネルを地図外に出す場合は「Google Maps」ロゴ/テキストが必要になる                                    |
| Legacy API の利用                                               | `PlacesService`（Legacy、2025-03-01）                                                  | 既存プロジェクトでは利用継続可。停止日未定、12 か月前通知。新機能は New のみ                                          |

**結論:** 現行方式（Places の口コミ原文を OpenAI に送り、独自点数へ変換して色分け）は、規約原文に許可の根拠がなく、少なくとも投稿者帰属の要件を満たしていない。「独自採点の許諾確認済み」として次の設計に持ち越さない。

**適合させるための変更（推奨順）:**

1. 口コミ原文を第三者 LLM に送らない。Google Maps Content の LLM 利用は Maps Grounding Lite の `search_places` に限定し、出力を「出典付きの Grounded Output」として表示する。
2. 「点数」ではなく、Grounded Output の本文に条件ごとの記述（例:「電源: 窓際にコンセントありという言及 [0]」「静かさ: 情報なし」）を含めさせ、その直後に Google Maps 出典（`attribution.title`、`placeUrl`）を表示する。数値スコアや一覧の並べ替えは質問 2・5 の回答が得られるまで実装しない。ピン色を使う場合は、Grounded Output の判定ではなく、Google が提供する表示可能な値（営業中、Google 評価）か「評価済み / 未評価 / 取得失敗」の状態表示に限定する。
3. 口コミ本文を表示するときは Places API (New) の `reviews[]` を投稿者帰属（アバター・名前・プロフィールリンク）・`googleMapsUri`・並び順の説明付きで、改変せずに表示する。抜粋だけの表示はしない。
4. Google 生成の `reviewSummary` を詳細パネルで使う場合、見出し「Review summary」、`disclosureText`、`flagContentUri`、`reviewsUri`、「About this summary」リンクを付け、全文をそのまま表示する。要約を採点の入力にしない。
5. Grounded Output と会話履歴の保持は 30 日以内・表示評価目的に限り、サーバーに永続化しない。Place ID とユーザー自身の入力・メモだけを長期保持する。
6. OpenAI 組織で Zero Data Retention または Modified Abuse Monitoring を申請し、承認状況を記録する（§5）。承認前は Grounding Lite の「LLM が保存しない」要件を満たすと断言しない。
7. 詳細パネルを地図の外（サイドパネル、下部パネル）に置く場合は、Google Maps ロゴまたは "Google Maps" テキスト帰属をパネル内に置く。
8. Places Legacy から Places API (New) に移行する（`locationRestriction` 矩形、`openNow`、FieldMask）。

**Phase 1 の推奨データ経路:**

- 候補の検索・詳細・営業時間: **Places API (New)**（サーバー側アダプター、FieldMask で Pro 以下のフィールドを既定にし、口コミは選択店舗の表示時だけ Enterprise + Atmosphere を使う）。
- 会話からの場所調査と条件適合の説明: **Maps Grounding Lite `search_places`**（`languageCode: ja`、`locationBias` は地図中心と半径。返る `id` を Places New の Place ID と突き合わせて地図に載せる）。
- 経路・所要時間: Routes API（Grounding Lite の `compute_routes` は距離と時間のみ）。
- Gemini Maps grounding は英語限定のため採用しない。

理由: Grounding Lite は 4 経路の中で唯一、LLM 利用と出典付き表示を規約が明示的に許可している。無料枠 10,000 件/月と $7/1,000 は口コミ付き Place Details（1,000 件、$25/1,000）より安い。ただし口コミ原文・営業時間・厳密な範囲制限は返らないので、Places New との併用が必要。接続先 LLM の保持条件（質問 4）と構造化判定の扱い（質問 5）は Google への照会で確定する。

## 4. 表示・保存のチェックリスト（受け入れ条件）

### 表示しなければならないもの

- [ ] Google Map 上に Places の候補を表示する。非 Google 地図と併用しない。
- [ ] 地図の外にある Places 由来の内容（詳細パネル、一覧カード）には Google Maps ロゴ（高さ 16〜19dp）または "Google Maps" テキスト（12〜16sp、Roboto またはサンセリフ、`translate="no"`、改行・翻訳・大文字小文字変更なし）を、同じ視覚コンテナ内の上か下に置く。
- [ ] Google Maps 由来の内容と他の出典（公式サイト、Web 検索、ユーザーメモ）を、枠・背景・余白で視覚的に区別する。
- [ ] 口コミを表示する場合: 投稿者のアバター・名前・プロフィールリンク（省スペース時は最低アバター）、各口コミの `googleMapsUri` への導線、並び順・絞り込みの説明、相対投稿日（推奨）、翻訳表示の注記（推奨）、`flagContentUri`（推奨）。口コミ本文を改変・要約・抜粋のみで表示しない。
- [ ] `reviewSummary` を表示する場合: 見出し "Review summary"、全文、`disclosureText` を直下に改変なしで、「About this summary」リンク（https://support.google.com/local-listings/answer/9851099）、`flagContentUri`、`reviewsUri`。
- [ ] Grounding Lite の出力を表示する場合: 生成文の直後に Google Maps 出典（`attribution.title` をそのまま、`url` または `googleMapsLinks.placeUrl` へのリンク、"Google Maps" 帰属）を置き、1 操作以内で見られるようにする。出典と生成文の間に他の内容を挟まない。出典先ページへの遷移を妨げない。
- [ ] 「Google 評価（星）」と「条件への適合の説明」を別ラベルで表示し、後者の根拠が Google Maps 出典であることを示す。
- [ ] 未評価・評価中・根拠不足・取得失敗を別状態として表示し、失敗を低評価の色にしない。

### 保存してよいもの

| 対象                                                                  | 可否と期間                                                   | 根拠                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| Place ID                                                              | 無期限                                                       | SST §3、Places ポリシー      |
| 緯度・経度（Places 由来）                                             | 最長 30 日、以後削除                                         | SST 14.3                     |
| 店舗名・住所・営業時間・Google 評価・口コミ（Places 由来）            | 保存不可（表示のための一時的な処理のみ）                     | ToS 3.2.3(a)(b)              |
| Grounding Lite の Grounded Output                                     | 最長 30 日、表示の評価・最適化目的のみ                       | SST 10.2.2                   |
| Gemini Maps Grounded Result（採用しない）                             | 90 日（表示評価）または 6 か月（当該ユーザーのチャット履歴） | Gemini 追加規約              |
| ユーザー自身の入力（検索語、条件、質問）、メモ、お気に入りの Place ID | アプリの判断で保存可                                         | Google Maps Content ではない |
| 運用ログ（実行 ID、API 名、SKU、件数、tokens、所要時間、費用）        | 保存可。口コミ本文・住所・正確な現在地は記録しない           | 計画書 §8                    |

- [ ] Google Maps Content（Grounded Output を含む）を、モデル学習・評価データセット・ベクトル DB・長期キャッシュに入れない（ToS 3.2.3(c)(vii)、SST 10.3.2）。
- [ ] 会話履歴をサーバーに永続化する設計にしない。端末内保持も Grounded Output は 30 日以内に消す仕組みを持つ。
- [ ] Grounded Output から場所名・住所・評価だけを抜き出して別の構造化データとして保存しない（SST 10.3.1）。

## 5. OpenAI 側の保持

引き継ぎで確認済みの事項: 入出力等の共有は Disabled、API call logging は Enabled per call。ZDR 契約は未確認。

OpenAI の公開文書（Your data）で確認した事項（**文書原文で確認**）:

- "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)."
- "By default, abuse monitoring logs are generated for all API feature usage and retained for up to 30 days, unless longer retention is required by law, or is reasonably necessary to protect our services or any third party from harm."
- "Eligible customers may have their customer content excluded from these abuse monitoring logs ... by getting approved for the Zero Data Retention or Modified Abuse Monitoring controls. Currently, these controls are subject to prior approval by OpenAI"
- "Zero Data Retention changes some endpoint behavior: the store parameter for /v1/responses and v1/chat/completions will always be treated as false, even if the request attempts to set the value to true."
- 表: `/v1/chat/completions` と `/v1/responses` はどちらも "Data used for training: No / Abuse monitoring retention: 30 days / Application state retention: None, see below for exceptions / Zero Data Retention eligible: Yes, see below for limitations"。
- "Project-level controls: For each project, select default to inherit the organization-level setting, explicitly pick Zero Data Retention or Modified Abuse Monitoring, or select None"

これから確認する項目:

- [ ] OpenAI 組織・`Maps LLM` プロジェクトの Data controls で ZDR または Modified Abuse Monitoring が承認・有効になっているか。未承認なら申請するか、Grounding Lite の接続先を変えるかを決める。
- [ ] `gpt-5.6-luna` が当該アカウントで ZDR 対象か（文書は「特定顧客・特定モデルを対象外にできる」と留保している）。
- [ ] 「API call logging: Enabled per call」がダッシュボードの Logs 機能（アプリケーション状態としてのリクエスト・レスポンス保存）を指すか。指す場合、`store: false` をすべての呼び出しに付けても、この設定がログを残すかを実機で確認する。
- [ ] Responses API の `reasoning.encrypted_content` や prompt cache（`promptCacheRetention: "in_memory" | "24h"`）が Google Maps Content を含む場合の扱い。既定（in_memory）の保持時間を文書で確認する。
- [ ] `store=false` は「アプリケーション状態を保存しない」指定であり、不正利用監視ログ 30 日は別。ZDR 承認まで「無保持」とは書かない。

## 6. AI SDK 最小検証

実施場所: セッションの scratchpad `ai-sdk-spike/`（プロジェクトの `package.json` は変更していない）。Node 24.20.0、npm でインストール。実モデル呼び出しは 3 回（ツールループ 2 回、構造化出力 1 回）。Google API は呼んでいない。

| パッケージ               | インストールされた版 |
| ------------------------ | -------------------- |
| `ai`                     | 7.0.107              |
| `@ai-sdk/openai`         | 4.0.71               |
| `@ai-sdk/react`          | 4.0.110              |
| `@ai-sdk/provider`       | 4.0.17               |
| `zod`                    | 4.6.5                |
| `react` / `@types/react` | 19.3.0               |
| `typescript`（検証用）   | 7.0.2                |
| `tsx`（検証用）          | 4.23.14              |

### (a) ToolLoopAgent とツールループ

- `ToolLoopAgent` はその名前で `ai` から export されている（`Experimental_Agent` は同じクラスの別名）。`new ToolLoopAgent({ model, instructions, tools, stopWhen, providerOptions })` で生成し、`generate()` / `stream()` を持つ。`stopWhen: stepCountIs(3)` でループ上限を指定できる。
- `tool({ description, inputSchema: z.object(...), execute })` で `search_places` を定義した。`execute` の戻り値型がそのまま UI 側の `part.output` の型になる（`InferAgentUIMessage<typeof agent>`）。
- 実行結果（`agent-loop.ts`）: モデルは 1 ステップ目で `search_places` を `{"textQuery":"カフェ","viewport":{...},"openNow":true,"maxResults":3}` と型どおりに呼び、2 ステップ目で合成データ 2 件を日本語で要約して `finishReason: "stop"` で終了した。

ファイル:

- `scratchpad/ai-sdk-spike/search-places-tool.ts`: 合成データを返す型付きツール
- `scratchpad/ai-sdk-spike/agent-loop.ts`: `ToolLoopAgent` + `createAgentUIStream` の実行とイベント記録
- `scratchpad/ai-sdk-spike/structured-output.ts`: `generateText` + `Output.object` の構造化出力とリクエスト本文の確認
- `scratchpad/ai-sdk-spike/client-chat.tsx`: `useChat` の型検証用（実行はしていない）
- `scratchpad/ai-sdk-spike/server-route.ts`: `createAgentUIStreamResponse` を返す Route Handler の形（型検証のみ）
- 実行ログ: `agent-loop.output.txt`、`structured-output.output.txt`

scratchpad はセッション限りの領域なので、Phase 2 の着手時にはこのファイルの内容をプロジェクト内に写して使う。

### (b) UI 向けのストリームイベント

`createAgentUIStream({ agent, uiMessages })` が返す `UIMessageChunk` の `type` を実行時に記録した順序（連続する同種は 1 つにまとめた）:

```text
start > start-step > tool-input-start > tool-input-delta > tool-input-available
> tool-output-available > finish-step > start-step > text-start > text-delta > text-end
> finish-step > finish
```

`ai` 7.0.107 の `UIMessageChunk` 型が持つ種類: `text-start / text-delta / text-end`、`reasoning-start / reasoning-delta / reasoning-end`、`tool-input-start / tool-input-delta / tool-input-available / tool-input-error`、`tool-output-available / tool-output-error / tool-output-denied`、`tool-approval-request / tool-approval-response`、`source-url / source-document`、`file / reasoning-file`、`data-*`（`DataUIMessageChunk`、アプリ独自イベント用）、`start-step / finish-step`、`start / finish`、`error`、`custom`、`abort`、`message-metadata`。

計画書 §6 の `places-found / place-evaluated / route-ready / budget-exceeded` のような独自イベントは `data-*` チャンクで送る。ツールの入力・出力は `tool-*` チャンクで自動的に届く。

UI 側: `@ai-sdk/react` 4.0.110 の `useChat<InferAgentUIMessage<typeof agent>>({ transport: new DefaultChatTransport({ api: "/api/chat" }) })` が `messages / sendMessage / status / stop / error / addToolOutput / addToolApprovalResponse / regenerate / resumeStream / clearError / setMessages` を返す。各メッセージの `parts` に `type: "tool-search_places"` の部分が入り、`state` は `input-streaming | input-available | approval-requested | approval-responded | output-available | output-error | output-denied`。`output-available` のとき `part.output.places` がツールの戻り値型で参照できることを `tsc` で確認した。サーバーは `createAgentUIStreamResponse({ agent, uiMessages: messages, abortSignal: req.signal })` を返すだけでよい。`abortSignal` を渡せるので、UI の停止をサーバー経由でモデル呼び出しの中断に伝える経路がある（実際の課金停止までは未検証）。

### (c) OpenAI provider と `gpt-5.6-luna`

- `@ai-sdk/openai` 4.0.71 の `OpenAIResponsesModelId` と `OpenAIChatModelId` の両方に `'gpt-5.6-luna'`（および `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`）が列挙されている。`openai("gpt-5.6-luna")` の既定は Responses API。Chat Completions が必要なら `openai.chat("gpt-5.6-luna")`。
- `providerOptions.openai` に `reasoningEffort: "none"`、`store: false`、`strictJsonSchema: true` を指定できる。Responses 用の型は `reasoningEffort?: string | null`、Chat 用の型は `"low" | "medium" | "high" | "xhigh" | "max" | "none" | "minimal"`。
- 構造化出力（`structured-output.ts`）で送信されたリクエスト本文を `include: { requestBody: true }` で確認した:

```json
{
  "model": "gpt-5.6-luna",
  "reasoning": { "effort": "none" },
  "store": false,
  "text": {
    "format": {
      "type": "json_schema",
      "strict": true,
      "name": "response",
      "schema": { "...": "zod から生成、additionalProperties: false" }
    }
  },
  "max_output_tokens": 300
}
```

`temperature` は送られていない（現行 route と同じ条件）。応答は `{"value":4,"related_review":"窓際の席にコンセントがあって助かった。"}`、`finishReason: "stop"`、usage は入力 110 / 出力 31 tokens、`reasoningTokens: 0`、警告なし。zod の `min(1).max(5)` は JSON Schema の `minimum` / `maximum` として送られ、strict モードでエラーにならなかった。

### 非互換・注意点

- 互換性の問題は見つからなかった。`ToolLoopAgent`、`createAgentUIStream`、`useChat`、`gpt-5.6-luna` + `reasoning.effort: none` + strict JSON schema がすべて動作した。
- 検証は npm でインストールした。プロジェクトは pnpm 9.7.0 指定なので、依存追加時に pnpm でのインストールと Next.js 16.3.4 / React 19.2 との peer 依存解決を別途確認する。
- 型検証に使った TypeScript は 7.0.2（npm の最新）。プロジェクトの TypeScript 版での再検証が必要。
- `client-chat.tsx` は `@types/react` がないと JSX の型エラーになる。プロジェクトには React 型定義があるので問題にならない見込み。
- ツールループ 1 往復で会話モデルを 2 回呼ぶ。計画書 §8 の「30 回/利用」の試算はこの前提と整合する。
- `stopWhen` はステップ数の上限であり、ツールが行う外部リクエストの上限ではない。予算制御は計画書どおりツール側・台帳側で行う。

## 7. 未確認事項の一覧

Google Maps Platform に照会する質問（送信は未実施）:

1. Places API の口コミ本文を第三者 LLM に送信し、条件適合度を生成・表示することは ToS 3.2.3(c) に該当するか。
2. Text Search の結果を独自の適合度で並べ替える・絞り込むことは ToS 3.2.3(g) に該当するか。
3. LLM が抽出した口コミの抜粋を表示する場合も、投稿者帰属と `googleMapsUri` の表示義務が適用されるか。
4. Maps Grounding Lite の接続先 LLM として、学習には使わないが不正利用監視ログを 30 日保持する OpenAI API（ZDR 未承認）は "not cached by, stored by" の要件を満たすか。
5. Grounded Output に含めた構造化された判定（条件ごとの supported / unknown）をピン色や並び順に使うことは、SST 10.2.1 の範囲か、10.3.1 / 10.3.3 に当たるか。
6. Grounded Output を端末内の会話履歴として保持することは SST 10.2.2 の「30 日・表示評価目的」に含まれるか。

OpenAI に確認する事項は §5 のチェックリスト。

この文書で検証していないこと: Maps Grounding Lite の実呼び出し（日本語の要約品質、店舗同定精度、速度、実請求）、Places API (New) の実呼び出し、EEA 向け規約（請求先住所が日本のため対象外と判断）、Google Maps Platform の契約上の個別条件。
