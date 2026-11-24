# 32. V10 「1日1サイトサンプル → Instagram投稿」設計(2026-08-26 代表者指示)

> 代表者指示(原文要旨): 「1日1サイトサンプルを作成してインスタ投稿をしたい。サイト案は私がHPの画像を提供するので、それをもとにHTMLなどで作成し、サンプルと価格などを提案した投稿がしたい。」
> 本書は**設計案**。実装前に §9 の未確定事項について代表者の回答が必要。決定は DECISIONS.md D-19 に記録する。
>
> **改訂(2026-08-26 同日・代表者の追加指示)**: 「新たにエージェントを生成して、私がHPの画像を送るのでそれをもとにHTMLで**忠実に再現**してファイルを作成し、**同じドメインでいいのでデプロイ**して、インスタにサンプルとして投稿するのが夢」。これにより §9 の 1(画像=再現対象のデザイン画像)・4(公開ホスティング=採用)・6(新エージェント=採用)は確定。差分は §6.5(忠実再現)と §7.5(デプロイ)に記載。残る未確定は §9 参照。

## 0. 一言でいうと

代表者が「HPの画像(素材・参考イメージ)+短いブリーフ」を `/samples` に投入すると、AI Web制作部の新社員がHTML/CSSの**サンプルサイト**を1本組み、通常コードがPC/スマホのスクリーンショットを撮り、既存のインスタ制作パイプライン(角度→構成→コピー→レンダリング→QA→承認)に**「サンプル紹介+プラン提案(価格帯)」投稿**として流す。1日1本。既存の安全ガード(確定価格の禁止・権利・QA・代表者承認)は一切弱めない。

```
代表者: 画像+ブリーフ投入(/samples)            ← 素材の権利は代表者が attest
   ↓ company sample-intake
颯(新・Web制作担当): site_sample JSON(HTML/CSS)   ← Readのみ。ファイル書込は通常コード
   ↓ company sample-build  … 静的検査 → workspace書込 → Playwrightで撮影 → SHA-256刻印
紬: 画面の視覚QA(design_qa)  ← fail closed
   ↓
蓮(角度)→昊(構成)→琴葉(sample_copy) → render(tpl-sample: 撮影画像を埋め込み)
   ↓
紫苑: 内容QA+視覚QA(価格帯ガードは機械検査) → 承認キュー → 代表者承認 → 既存のexport/publish
```

## 1. 目的とKPI

- 目的: 「HPを持つとこう見える」を**具体物**で見せ、DM相談へつなげる(docs/03 §5.1 ファネルの「興味→信頼」を強化)。V9で最大の構造課題だった「許可済み実績0件 → 一般論化」を、**自社制作のサンプル(権利問題なし)**で埋める
- 柱: **⑤実績・技術紹介**(目標比率20%・現在0%)。サンプルは「実績」ではなく「技術紹介」として扱い、投稿内で必ず「サンプル(架空)」と明示する
- KPI(docs/15と同じ計測経路): 保存率・プロフィール遷移・DM相談数。サンプル投稿はA/B軸 `template=tpl-sample` で既存分析に載る

## 2. 前提と守る制約(既存決定との整合)

| 既存ルール | 本設計での扱い |
|---|---|
| AIは価格・納期・契約条件を確定しない(docs/01 §51) | 投稿に書けるのは **承認済みの価格帯表記のみ**(2026-07-28承認・2026-08-28に全て税別「+tax」表記へ統一: 梅45,000円〜 +tax/竹120,000円〜 +tax/松500,000円〜 +tax、保守 梅月7,000円〜 +tax/竹月12,000円〜 +tax/松応相談)。「このサンプルは梅プランの範囲で制作できる構成」のような**プラン適合の提案**は可。個別金額・値引き・納期は不可 |
| 竹の確定価格公開禁止(2026-07-13) | 継続。竹は「120,000円〜 +tax」表記のみ |
| 顧客素材・顧客名は許可記録がある場合のみ(docs/13 §3) | サンプルは**架空事業者**。実在の社名・電話・住所・URLを使わない(通常コードが検査)。代表者提供画像は**代表者が権利をattest**(§5.2)した場合のみ使用 |
| サブエージェントはReadのみ・CLIはオーケストレーター(P1指摘1) | HTML/CSSは**JSON成果物**として提出し、ファイル書込・撮影は通常コードが行う |
| AIレンダリングはSatoriが確実(D-18追記) | 投稿画像は**tpl-sample(Satori)**。スクリーンショットは通常コード(Playwright)で決定的に撮影。Canvaは使わない |
| 1日の新規投稿上限3本・通常1本 | サンプル投稿は`max_generated_posts`を消費(通常運用: 朝の通常投稿1本+サンプル1本=2本/日) |
| 効果保証・他社批判禁止 | 不変。「〜すれば集客できる」等はQAでfail |
| 外部への自動送信禁止 | 不変。サンプルの公開ホスティングも代表者の手動操作(§9) |

## 3. 登場人物(組織)

- **AI Web制作部(dept_web)を「限定解放」**: 従来の解放条件「受注月2件超」は未達だが、代表者の直接指示による解放(D-16と同型)。役割は「制作進行管理・素材収集支援」から**「サンプルサイト制作」**へ拡張
- **新社員 颯(はやて)** `emp_hayate` / Web制作担当 / dept_web / modelProfile: standard(HTMLは長文になるためheavy昇格を許可。日次上限は既存の`max_heavy_escalations`に従う)
  - 入力: sample_request(ブリーフ・業種・ペルソナ)、素材一覧(パス・寸法)、蓮のangle brief(訴求軸)、デザイン制約(§6)
  - 出力: `site_sample` JSON(§6.2)。**コード外の一切(CLI/ファイル書込/外部取得)はしない**
  - 禁止: 実在企業の情報、外部URL・CDN・Webフォント・JS、価格の記載、素材以外の画像参照
- 既存社員の役割追加: 蓮=サンプルの訴求軸(どのペルソナ・どのプランに寄せるか)/ 紬=画面の視覚QA(design_qa)/ 昊=構成 / 琴葉=`sample_copy` / 紫苑=最終QA / 桔梗=intake滞留の検知(昼シフト) / 湊=サンプル投稿の効果計測(既存)
- 代表者: 素材投入・権利attest・承認・(任意)公開ホスティング

## 4. 1日の流れ(勤務モデルdocs/30への組み込み)

| 時刻 | シフト | 追加される作業 |
|---|---|---|
| 前日〜 | 代表者 | `/samples` で素材+ブリーフを投入(1件以上ストックしておく) |
| 9:00 /kickoff | 朝 | 従来どおり通常投稿1本。**サンプル制作は行わない**(朝の負荷を増やさない) |
| 13:00 /noon-run | 昼 | **新: サンプル制作ブロック**。intake待ちが1件以上あれば: 颯→sample-build→紬design_qa→蓮→昊→琴葉→render→紫苑QA→承認キュー。0件なら正直にスキップ(空タスクは作らない) |
| 17:30 /evening-run | 夕 | 美月のまとめに「サンプル投稿の承認待ち」「intake残数」を追加 |

- 1日1本の上限: `config/limits.yaml` に `max_site_samples: 1` を追加(超過は自動停止)
- intakeが尽きたら美月が代表者へ「素材の追加依頼」を出す(evening-run)

## 5. 代表者の入力(intake)

### 5.1 ダッシュボード `/samples`(新規ページ)
- フォーム: 架空の屋号(任意・空なら颯が命名。「(サンプル)」を自動付与)/ 業種(P1製造・建設/P2店舗/P3一人親方・士業・教室から選択+自由記述)/ 狙うプラン(梅/竹/松/おまかせ)/ ページ構成(梅の標準7ページ: TOP・サービス・料金・実績・会社概要・お問い合わせ・お知らせ を初期値。サンプルは**TOP必須+最大2ページ**)/ 参考メモ(自由記述)
- 画像アップロード(1〜10枚、png/jpg/webp、各20MB・5,000万px以下=`portfolio-media.ts`の制限を流用): 種別を1枚ずつ指定 — `hero`(メイン)/`logo`/`photo`(店舗・製品)/`reference`(参考にする他サイトのスクショ=**画面には出さない、雰囲気の参考にのみ使う**)
- **権利のattest(必須チェック)**: 「これらの画像は私(Bloom-L)が権利を持つ、または商用利用可能なライセンスで取得したもので、実在の第三者の写真・ロゴ・著作物を含みません」→ `audit_log` にowner操作として記録。`reference`は投稿に出ないが同じチェックを課す(他社サイトのスクショを画面に出す事故を構造的に防ぐ)
- 保存先: `data/workspace/02_site-samples/<requestId>/input/`(StoragePort経由。D-10の論理パス)

### 5.2 CLI(オーケストレーター用)
```
company sample-list [--status new|building|qa|posted|declined]   intake一覧(AIには権利attest済みの素材パスのみ返す)
company sample-intake --dir <dir> --json '<brief>' --actor owner  UIを使わない投入(owner専用。attestは--attest必須)
```

## 6. サンプルサイト制作

### 6.1 制作の制約(通常コードが検査・違反は差し戻し)
- 静的HTML/CSSのみ。**JSなし**(フォーム送信・アニメーションはCSSのみ)。外部リソース(`http(s)://`・CDN・Webフォント・iframe)禁止。フォントはシステムフォント指定+Satori用と同じNoto Sans JPをローカル同梱
- 画像参照は `./assets/<attest済みファイル名>` のみ。`reference`種別の画像は**参照禁止**
- 実在情報の禁止: 電話番号・郵便番号・住所・メール・URL・実在社名は**プレースホルダー形式**(`000-0000-0000`, `〒000-0000 大阪府泉州市サンプル1-2-3`, `info@example.com`)。QA機械検査で`example.com`以外のドメイン・`0[5-9]0-`以外の電話番号形式をfail
- 価格を画面に書かない(料金ページも「料金は個別にご案内」表記)。サンプルに価格を載せると投稿の価格帯ガードと二重管理になるため
- サイズ上限: HTML 200KB / CSS 100KB / ページ数 ≤3
- スマホ対応必須(`viewport` meta+`max-width`ブレークポイント)。撮影はPC 1440×900・スマホ 390×844(iPhone相当)の両方
- 必ず「サンプルサイト(架空)」の帯をフッターに入れる(通常コードが注入。颯は書かない)

### 6.2 成果物スキーマ `site_sample`(Zod・strict)
```json
{
  "kind": "site_sample",
  "requestId": "<id>",
  "concept": "<120字以内: 誰向け・何を一番見せるか>",
  "pages": [
    {"path": "index.html", "title": "<屋号(サンプル)>", "html": "<!doctype html>..." }
  ],
  "css": "…",
  "assetsUsed": ["hero.jpg", "logo.png"],
  "planFit": "ume" | "take" | "matsu",
  "planFitReason": "<200字以内: なぜこのプランの範囲か(ページ数・CMS要否・独自デザイン要否)>",
  "notes": ["<制作上の注意・省略した要素>"]
}
```
- `planFit`は**颯の提案**。投稿での最終表現は琴葉が価格帯表記で書き、紫苑がガードで検査する

### 6.3 ビルド `company sample-build --request <id> --file runs/<date>/site-sample.json --actor hayate`
1. スキーマ検証 → §6.1の静的検査(外部URL・JS・実在情報・素材参照) → 違反はエラー(颯へ差し戻し。最大2回=既存retry)
2. `data/workspace/02_site-samples/<requestId>/v<n>/` にHTML/CSS/assetsを書き出し(通常コードがフッター帯を注入)
3. **Playwright(Chromium・既にdevDependency)**でローカルファイルを開き撮影: `pc-fold.png`(1440×900 ファーストビュー)、`pc-full.png`(全画面)、`sp-fold.png`(390×844)、`sp-full.png`。ネットワークは**遮断**(`route → abort`)して外部取得を構造的に不可能にする
4. 各PNGのSHA-256とHTMLのSHA-256を `site_samples` に刻印(実績のscreenshotと同じ差し替え検知の考え方 docs/13 §3)
5. `sample_requests.status = qa`。紬の design_qa タスクを自動生成(render と同型)

### 6.4 紬の視覚QA(design_qa・fail closed)
- 撮影4枚を実際に開き、「文字切れ・画像の歪み・スマホでの崩れ・空白過多・コントラスト・素材以外の画像混入・実在情報の混入・サンプル帯の存在」を検査。failなら颯へ修正指示(1回まで)。それでもfailなら当日は投稿を作らず報告

### 6.5 「画像からの忠実再現」モード(2026-08-26 追加指示で主モードに)
- **入力**: 代表者が作ったHPの**デザイン画像**(PC版必須・スマホ版任意。png/jpg。Canva/Figma等の書き出しや手描きモックでもよい)+ そのデザインに使った**個別素材**(写真・ロゴ)。個別素材が無い部分は颯がCSSの色面・グラデーションで置き換える(切り抜きはしない=画像の勝手な加工を避ける)
- **権利の前提(重要)**: 再現対象は**代表者自身が権利を持つデザイン**に限る。他社サイトのスクリーンショットを「忠実に再現」することは著作権・意匠の侵害になり得るため**構造的に禁止**: intakeの種別 `design`(再現対象)にも §5.1 のattestを課し、さらに「このデザインは自分(Bloom-L)が作成したもの」の宣言を必須にする。`reference`種別(他サイト)は再現対象に**指定できない**
- **颯の作業**: 画像をReadで開き、(1) レイアウト(グリッド・余白・セクション順)、(2) 配色(画像から読み取ったHEX近似)、(3) タイポグラフィ(見出し/本文の階層・サイズ比)、(4) **画像内の文字は一字一句そのまま転記**(捏造・要約禁止。判読不能な箇所は `notes` に列挙し、プレースホルダーにする)、(5) 個別素材の配置、をHTML/CSSで再現。実在情報(電話・住所・URL)が画像に写っていても §6.1 の規則でプレースホルダーに置換する
- **忠実度の判定(紬・design_qa)**: 撮影PNGと元デザイン画像を**並べて**開き、「セクション構成の一致/配色の一致/文字の逐語一致/素材の位置/スマホ崩れ」を評価し `fidelity`(high/medium/low)を報告。**lowはfail**(颯へ差し戻し1回)。medium以上で投稿工程へ
- **文字数・寸法の機械検査**: 画像内の文字転記は琴葉の校正対象外(デザイン側の文言)だが、`findSampleIntegrityViolations` の実在情報・価格・外部URL検査は同じく適用

## 7. 投稿の制作(既存パイプラインへの接続)

- `company create-post --json '{"pillar":"5","format":"carousel","templateId":"tpl-sample","sampleId":"<id>",…}'`。`posts.sample_id` を追加(portfolio_item_id と同型)。tpl-sample は `sampleId` 必須、tpl-portfolio は従来どおり許可済み実績必須
- 蓮(angle): 「このサンプルを誰の困りごとに当てるか」「プラン提案の型(梅で十分/竹で自分で更新/松で攻める)」「CTA型」。V9原則(場面起点・HP必要性起点禁止)は**サンプル投稿でも適用**: 表紙は「こういう会社が、こう見えるようになる」の場面から入る
- 昊(plan): tpl-sampleの構成 = 表紙(サンプルのPC画面+一言)/ 場面(誰の・何の困りごと)/ 画面1(スマホ表示)/ 画面2(ポイント解説)/ 制作の裏側(なぜこの構成にしたか=題材の型「制作の裏側」)/ プラン提案(価格帯)/ CTA
- 琴葉: `sample_copy`(新スキーマ)
```json
{
  "kind": "sample_copy",
  "headline": "…", "body": "…", "cta": "…", "hashtags": ["#…"],
  "slides": {
    "cover":   {"title": "≤26字", "subtitle": "≤36字"},
    "scene":   {"heading": "≤20字", "body": "≤90字"},
    "screens": [{"caption": "≤40字"}, {"caption": "≤40字"}],
    "behind":  {"heading": "≤20字", "body": "≤90字"},
    "plan":    {"planId": "ume|take|matsu", "note": "≤60字(ページ数・更新方法など適合理由。金額は書かない)"},
    "ctaMessage": "≤60字"
  }
}
```
  - **価格は琴葉が書かない**。`plan.planId` から通常コードが `config/pricing.yaml`(§8.1)の**承認済み価格帯表記**を注入する(出典スライドの注入と同じ思想=AIが価格を書かない)
- render(tpl-sample・Satori): 撮影PNGを `portfolio-media.ts` と同じ経路で埋め込み(sharpで縮小・端末フレーム風の枠は通常コード)。ページ数7(表紙/場面/画面SP/画面PC+解説/裏側/プラン/CTA)。テンプレート版は `/templates` の承認ゲート対象(既存どおり)
- 紫苑QA: 既存項目+**新規機械検査**(§8.2)。visual_qaで撮影画像の実在情報・他社ロゴ混入を再確認
- 承認キュー→代表者承認→export/publish: **変更なし**

### 7.5 デプロイ(同一ドメインでの公開・2026-08-26 追加指示で採用)
- **方針**: サンプルは Bloom-L 自社ドメインの配下で公開する。URL形は代表者の回答待ち(§9-4): 例 `https://<自社ドメイン>/samples/<slug>/`(パス方式)または `https://samples.<自社ドメイン>/<slug>/`(サブドメイン方式)。**推奨: サブドメイン方式**(本サイトのビルド・SEOと分離でき、noindexを一括設定できる)
- **実行主体と順序(自動送信禁止ルールとの整合)**: デプロイは外部への公開行為なので、**代表者が承認画面で投稿を承認した後に、代表者の明示操作**(`/samples` の「公開する」ボタン=`company sample-deploy --sample <id> --actor owner`)で行う。AI社員・葵は実行できない(CLIはowner専用)。順序: 紫苑QA pass → 代表者が投稿承認 → 代表者がデプロイ → URL到達確認(通常コードがHTTP 200+本文hash一致を検査) → 投稿を export/publish
- **配信物**: `02_site-samples/<requestId>/v<n>/` の静的ファイル一式(HTML/CSS/attest済み素材)+ 通常コードが注入する `robots: noindex,nofollow` メタ・「サンプルサイト(架空)」帯・`<link rel="canonical">`なし。JSなし・外部リソースなしは §6.1 のまま
- **ホスティング実装(候補・代表者の環境で確定)**: (A) 自社サイトがVercelなら、静的サンプル専用のVercelプロジェクト(`bloom-l-samples`)を作り、本サイト側は `rewrites` か サブドメインのDNSで接続。デプロイは Vercel CLI/REST をownerトークンで実行(トークンは `.env.local`・docs/13 §1の秘密管理)。(B) 自社サイトが他社サーバー(さくら・Xserver等)なら、SFTP/rsyncで `samples/` 配下にアップロード。(C) Vercel Blob(既存 `vercel-blob.ts`)は画像配信向けでHTMLの公開には不向きのため不採用
- **取り下げ**: `company sample-undeploy --sample <id> --actor owner`。投稿が却下・削除された場合は美月が取り下げを提案(自動では消さない)
- **URLの投稿への載せ方**: Instagramキャプション内URLはリンクにならないため、**プロフィールリンク(またはリンク集ページ)に最新サンプルURLを置く**運用。キャプションには「プロフィールのリンクから実物を見られます」と書く(URL文字列そのものは載せない=変更時の不整合を避ける)
- **計測**: サンプルURLにアクセスログ(Vercel Analytics等)を付ければ「投稿→サンプル閲覧」の到達を湊が読める(V10.3)

## 8. 新しいガード(通常コード)

### 8.1 `config/pricing.yaml`(owner専用・CLIからは編集不可)
```yaml
# 2026-07-28 代表者承認の価格帯表記。ここにある文字列だけが投稿に出てよい
approved_public_price_bands:
  ume:   {label: "梅プラン", build: "45,000円〜 +tax",  maintenance: "月7,000円〜 +tax"}
  take:  {label: "竹プラン", build: "120,000円〜 +tax", maintenance: "月12,000円〜 +tax"}
  matsu: {label: "松プラン", build: "500,000円〜 +tax", maintenance: "応相談"}
disclaimer: "価格は税別(+tax)の目安です。内容により個別にお見積もりします。"
```
### 8.2 `findPriceViolations(text, pricing)`(guards.ts)
- 投稿の全公開テキスト(キャプション・全スライド)から `円` を含む表現を抽出し、`approved_public_price_bands` の完全一致以外は**fail**(「45,000円」の「〜」抜き・「+tax」抜き、「4.5万円」、値引き、「納期○日」も不可)
- 既存 `scanForbidden` に「必ず集客」「効果保証」等は入っているので併用
### 8.3 `findSampleIntegrityViolations(sample)`
- HTML内の外部URL・JS・実在情報・未attest素材参照・価格・「サンプル帯」欠落を検出(§6.1)。ビルド時とQA時の両方で実行(実績の `findCustomerDataViolations` と同型)
### 8.4 差し替え検知
- 撮影PNGのSHA-256を spec に刻印し、QA・承認・export時に再計算(既存のcontent hash経路をそのまま使う)

## 9. 未確定事項(代表者の回答が必要)

| # | 問い | 選択肢と葵の推奨 |
|---|---|---|
| 1 | 「HPの画像」の正体 | **確定(2026-08-26)**: 代表者が作った**HPのデザイン画像**を忠実に再現する(§6.5)。個別素材(写真・ロゴ)は別添。他社サイトのスクショは再現対象にできない(権利) |
| 2 | サンプルの事業者 | 架空(推奨・権利問題なし)か、実在の見込み客向け「提案サンプル」か。**実在向けは投稿不可**(名指し営業・許可なし)。DM営業資料としての利用は別途 |
| 3 | 価格の出し方 | 価格帯+プラン適合のみ(推奨・既存承認内)。確定価格や「このサイトなら○万円」は新たな代表者決定が必要 |
| 4 | 公開ホスティング | **採用が確定(2026-08-26)**。残る未確定: 自社ドメイン名と現在のホスティング(Vercel/レンタルサーバー等)、URL形(パス `/samples/<slug>` かサブドメイン `samples.<domain>`。**推奨: サブドメイン**)、デプロイ用トークン/認証情報の所在(§7.5) |
| 5 | 制作頻度 | 平日1本(推奨。intakeが無い日はスキップ)か、毎日か |
| 6 | 颯の追加 | **確定(2026-08-26)**: 新エージェント「颯(はやて)」を追加する |
| 7 | サンプル投稿と通常投稿の比率 | 週5本中2本をサンプル(⑤20%目標に近い・推奨)か、毎日サンプル |
| 8 | 実装の着手 | 設計承認後に V10.0(intake・颯・ビルド・撮影・ガード)→ V10.1(投稿)→ V10.2(UI)→ **V10.3(デプロイ)** の順で実装。デプロイは代表者の環境情報(§9-4)が揃ってから |

## 10. データモデル(追加分)

```
sample_requests(id, slug, industry, persona(P1|P2|P3), plan_target, brief_json, status(new|building|qa|ready|posted|declined), attested_at, attested_by, created_at)
sample_assets(id, request_id, kind(hero|logo|photo|reference), path, sha256, width, height, bytes, created_at)
site_samples(id, request_id, version, concept, plan_fit, html_sha256, dir_path, screenshots_json[{name,path,sha256,w,h}], builder_task_id, design_qa_status, created_at)
posts.sample_id  (nullable, FK site_samples)            -- migration 18
audit_log: sample_attest / sample_declined は owner 操作として append-only
```
- 保持: `02_site-samples/` はバックアップ対象(workspace同梱)。14世代の既存方針
- PostgreSQL版(docs/26)にも同じDDLを追加(V5.4のexport/importに載せる)

## 11. ダッシュボード(追加)
- `/samples`: intake一覧(new/building/qa/ready/posted)・新規投入フォーム(§5.1)・各サンプルのPC/SP撮影プレビュー・HTMLのローカルプレビュー(`file://`ではなくAPI経由で配信し、外部リソース遮断を維持)・declineボタン(owner専用)
- `/approvals`: tpl-sample投稿は「撮影4枚+サンプルHTMLプレビュー」を承認画面に併記(実績の許可状態表示と同型)
- `/pipeline`・オフィス画面: 颯の稼働表示(既存の display 派生に乗る)

## 12. 実装フェーズと受け入れ基準

| フェーズ | 内容 | 受け入れ基準 |
|---|---|---|
| V10.0 基盤 | migration 18・スキーマ(`site_sample`/`sample_copy`)・`sample-intake/list/build`・Playwright撮影・ガード8.2/8.3・`config/pricing.yaml`・颯の追加(personas/org/sync-agents)・limits | 手投入したサンプルがビルド→撮影→design_qaまで通る。外部URL/JS/実在情報/未承認価格を含む入力が**必ず**拒否されるテスト |
| V10.1 投稿 | tpl-sample(Satori)+テンプレ承認・昊/琴葉/紫苑のペルソナ更新・noon-run手順・evening-run追記 | サンプル投稿1本が紫苑QA pass→承認キューに入る。価格帯以外の円表記でfailするテスト |
| V10.2 UI | `/samples`・承認画面の併記・オフィス表示 | 代表者がUIだけで投入→承認まで完了 |
| V10.3 任意 | 公開ホスティング(§9-4)・サンプルの再利用(同じ素材で別プラン版) | 代表者決定後 |

- テスト: 既存371+件に、ガード(価格・外部URL・実在情報)/ビルド(撮影の決定性・ネットワーク遮断)/レンダリング(枚数・寸法・hash)/CLI境界(颯はCLI不可)を追加
- ロールバック: `posts.sample_id` はnullable・tpl-sampleを使わなければ既存動作に影響なし

## 13. リスクと対策

- **他社サイトの模倣・著作権**: `reference`画像は画面に出さない構造+紬・紫苑が「参考画像と酷似していないか」を目視。文章はすべて架空
- **価格の一人歩き**: 価格はAIが書かず通常コードが注入。SNSの価格帯表記は2026-07-28承認の範囲のみ
- **Playwrightの環境依存**: `pnpm e2e:install` でChromium同梱済み。launchd自動実行時はヘッドレス。失敗時はサンプル制作だけスキップし通常投稿は影響なし
- **HTML生成の品質ばらつき**: 静的検査+紬のQA+2回までの修正。それでも不合格ならその日は作らない(妥協した候補を採用しない=D-18の原則)
- **負荷**: 昼シフトに颯・紬・蓮・昊・琴葉・紫苑の6起動が増える。`max_agent_launches` 40の範囲内(本日実績19)

## 14. 実装状況(2026-08-27 時点)

| フェーズ | 状態 | 主な実装 |
|---|---|---|
| V10.0 基盤 | **実装済み** | migration 18(`sample_requests`/`sample_assets`/`site_samples`/`posts.sample_id`、`dept_web`限定解放、`emp_hayate`追加)、`src/core/schemas.ts`(`site_sample`/`sample_copy`/`tpl-sample` spec/`pricing`)、`src/core/sample-guards.ts`(`findSampleIntegrityViolations`/`findPriceViolations`)、`src/adapters/db/samples.ts`、`src/adapters/render/sample-media.ts`、`src/adapters/samples/screenshot.ts`(Playwright・ネット遮断)、`src/adapters/samples/build.ts`、`config/pricing.yaml`、`config/limits.yaml`(`max_site_samples: 1`)、CLI `sample-intake / sample-asset-add / sample-list / sample-show / sample-build / sample-visual-qa / sample-decline`、`create-post --json '{"templateId":"tpl-sample","sampleId":…}'`、颯のペルソナ(`.claude/agents/hayate.md`) |
| V10.1 投稿 | **実装済み** | `src/core/templates/tpl-sample.ts`(showcase 7枚 / story 6枚)、`render-post.ts`のtpl-sample分岐(価格帯注入・撮影画像hash照合)、`design-qa.ts`の`sample-media`検査、`assertPublicTextSafety`の価格帯ガード(QA提出・承認・export共通)、テンプレート版 v1(draft)を `template-preview --template tpl-sample --version 1` で登録済み → **紫苑の視覚QAと代表者の/templates承認が必要** |
| V10.2 UI | **実装済み** | `/samples`(intake・素材アップロード・権利宣言チェック必須・撮影プレビュー・「サンプルを開く」・見送り)、`/api/samples`(GET/POST)・`/api/samples/[id]/assets`(multipart)・`/api/samples/[id]/decline`・`/api/samples/file/[...slug]`(02_site-samples配下のみ。html/cssはv<n>/配下限定・CSP/noindex/SAMEORIGIN付き)、ナビ「サイトサンプル」 |
| V10.3 デプロイ | 未着手 | 代表者回答: 自社サイトはVercel。`sample-deploy`(owner専用)は次段で実装 |
| テスト | `tests/v10-site-samples.test.ts`(10件: ガード純粋関数・intake権限・違反時のfail・撮影4枚+hash・紬QAゲート・上限・tpl-sampleレンダリング・価格帯注入・RightsError) |

実装で確定した細部(設計からの差分):
- 撮影は PC 1440×900(DPR1)/スマホ 390×844(DPR2=780×1688)の4枚。全画面は高さ6,000px上限
- 通常コードがHTMLへ注入する固定要素: `<meta name="robots" content="noindex,nofollow">`・`<link rel="stylesheet" href="./style.css">`・フッター帯「サンプルサイト(架空)— Bloom-L制作サンプル」
- 紬の視覚QAは既存 `visual_qa` に `fidelity`(high/medium/low)を追加。`low`はpassと両立不可(スキーマで拒否)。`sample-visual-qa` は `--task` を付けると紬のタスク成果物としても記録される
- 出典スライドと同じ思想で、価格帯は `priceBand` としてspecに刻印(琴葉は `plan.planId` と適合理由だけ書く)

## 15. 参照
- docs/01 §価格・§AIの境界 / docs/03 §2〜5 / docs/13 §3(許可・素材分離) / docs/30(勤務モデル) / DECISIONS D-10, D-16, D-18(価格帯追記 2026-07-28) / `src/adapters/render/portfolio-media.ts` / `src/core/guards.ts`
