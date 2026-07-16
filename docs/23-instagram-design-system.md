# 23. Bloom-L Instagram デザインシステム(V4.5)

投稿クリエイティブのデザイン判断とトークン一覧。実装は `src/core/templates/design-system.ts`(トークン)と `src/core/templates/components.ts`(再利用component)。brand manifest と実ロゴを唯一のブランド情報源とする。通常コードで決定的にレンダリング(AI不使用)。

## 原則

- **青と白が主役**。primary(ロイヤルブルー `#0b46b8`)と白/極薄ブルーグレーを基調に、アンバー(accent `#e8a13a`)は「見解」「次の一歩」など最小限の強調にのみ使う。緑をメインにしない。
- **実ロゴを使う**。`data/workspace/01_brand/logo.png`(+@2x)を data URI で埋め込み、縦横比(約2.6:1)を固定。文字「Bloom-L」での代用はしない(ロゴ未検出時のみフォールバックし、doctorが警告)。白背景ロゴは白/薄色ヘッダーに置き、青地では白カードで縁取る。
- **1080×1350(4:5)**。8pxグリッド。セーフエリア72px。
- **1枚1メッセージ**。表紙・本文・まとめ・CTAは専用layoutを持ち、全ページを同じ「見出し+本文」にしない。
- **空白を作らない**。紙面は情報カード・番号・図解・比較・チェックで意図的に満たす。「長文を置いただけ」「広すぎる空白」「安価なチラシ風」「内容と無関係な装飾」を禁止。
- **WCAG AA相当のコントラスト**。薄すぎるグレー文字を使わない(本文は ink `#16233f` / inkMuted `#566180`)。

## トークン

| 分類 | トークン | 値 |
|---|---|---|
| キャンバス | CANVAS / SAFE / CONTENT_WIDTH | 1080×1350 / 72 / 936 |
| 余白(8pxグリッド) | SPACE.xs..xxxl | 8 / 16 / 24 / 32 / 48 / 64 / 88 |
| 角丸 | RADIUS.sm..pill | 12 / 20 / 28 / 40 / 999 |
| 罫線 | STROKE.hair/base/bold | 2 / 3 / 5 |
| 色(brand manifest) | primary / primaryDark / accent | #0b46b8 / #083a97 / #e8a13a |
| | surface / surfaceDark / ink / inkMuted | #ffffff / #eef2f9 / #16233f / #566180 |
| 派生色 | primarySoft / line / accentSoft | #eaf1fc / #d7e0ee / #fbedd6 |

### 日本語 type scale(Noto Sans JP, SIL OFL 1.1。weight 400/500/700/800/900)

| トークン | size / 行高 / weight | 用途 |
|---|---|---|
| display | 92 / 1.18 / 800 | ヒーロー語 |
| h1 | 64 / 1.24 / 800 | 表紙・ステップ見出し・CTA |
| h2 | 46 / 1.30 / 700 | セクション見出し |
| h3 | 38 / 1.34 / 700 | カード見出し |
| lead | 40 / 1.50 / 500 | 表紙サブ・ステップ本文 |
| body | 34 / 1.60 / 400 | 本文 |
| caption | 27 / 1.50 / 400 | 注釈・出典本文 |
| kicker | 28 / 1.20 / 800(letterspaced) | ヘッダー右ラベル |
| label | 25 / 1.20 / 700 | カードラベル |
| stat | 132 / 1.00 / 900 | 強調数値 |

行長・最大行数は各テンプレートの `enumerateSlots` が幅×maxLinesで定義し、`renderer.measureSlotOverflows`(Satori実測)であふれを検出する。あふれは琴葉への短縮タスクを自動生成。

## 再利用component(`components.ts`)

`page`(背景バリアント white/soft/primary)、`header`(実ロゴ+kicker)、`footer`(ページドット+CTAチップ)、`body`、`tag`、`barHeading`、`numberBadge`、`stepCard`、`checkItem` / `checkMark` / `crossMark`、`statBlock`、`quoteCard`(見解・引用)、`sourceCard`(出典)、`comparisonTable`(比較表)、`deviceMock`(端末モック)、`techTags`、`contentsCard`(表紙の内容予告)。

## アイコン(フォント記号に依存しない)

チェック・バツ・矢印・注意は `components.ts` の `iconCheck`/`iconCross`/`iconArrow`/`iconWarn`(SVG data URI)で描画する。フォントの「✓」「⚠」等の記号は使わない(豆腐文字・環境差を避けるため)。

## fingerprint(公開停止ガードの根拠。V4.5 v2 で強化)

テンプレート版のfingerprint = SHA-256(**レンダリング実装コードのハッシュ**[design-system.ts / components.ts / index.ts / family-util.ts / 対象 tpl-*.ts] + 登録variant一覧 + DESIGN_SYSTEM_VERSION + CAROUSEL_SCHEMA_VERSION + 全トークン + 色 + ロゴのSHA-256 + templateId + version)。`src/adapters/render/fingerprint.ts`。material収集(`collectFingerprintMaterial`, fs依存・読込失敗はfail closed)と digest(`computeFingerprintFromMaterial`, 純関数)を分離。**レイアウト・component・variant集合が変わると、DESIGN_SYSTEM_VERSIONの手動更新に頼らず必ずfingerprintが変わる。**現行: `ds-v1` / `carousel-v2`。

## 4系統×2variant(`tpl-*.ts`)

| 系統 | templateId | variant | 構成の違い |
|---|---|---|---|
| education/howto | tpl-howto | steps / guide | steps=表紙(内容予告)+左右交互のステップパネル。guide=表紙(HP基本情報の設計図)+進行バー付き縦タイムライン |
| news/insight | tpl-news | report / insight | report=構成予告カバー。insight=検索/AI回答の抽象画面モックカバー。共通: 事実カード→見解(accent枠+注記で事実と分離)→影響→出典カード→CTA |
| portfolio/case-study | tpl-portfolio | showcase / story | showcase=許可済み実スクリーンショットを主役にした端末表示+注釈。story=画像許可なしでも使える課題→判断→設計→実装→確認のプロセス型 |
| comparison/checklist | tpl-compare | table / diagnosis | table=比較表(✕/✓)。diagnosis=Before→Afterカード+表紙にBefore/After。共通: 導入→比較→セルフ診断→結論→CTA |

各系統6ページ(5〜7の範囲)。表紙に「全N枚で解説 スワイプ→」のカルーセル導線。CTAは内容に応じて「保存」「プロフィール確認」「DMで相談」を決定的に選ぶ(`family-util.ctaHint`)。画像内CTAは押せるボタンには見せず、文章でも行動を明示する。

## QAの3分離 + 代表者承認(公開停止ガード)

1. **content QA**(通常コード): 禁止語 + 無根拠な成果断定(`scanUnsupportedClaims`。増えた/減った/改善した等は許可済みtestimonial・metric・出典がなければfail)。
2. **mechanical design QA**(通常コード, `design-qa.ts`): 1080×1350・ページ数・連番・ロゴ・fingerprint・variant。
3. **紫苑 visual QA**(全PNGを目視, `visualQaArtifactSchema`): result/criticalIssues/minorIssues/revisionInstructions/pageFindings。criticalが1件でもあればpass不可(fail closed)。
4. **代表者のtemplate version承認**: 全variantのpreview・上記3QA・fingerprint一致・権利が揃って初めて `assertTemplateApprovable` を通過(UI/API/CLIで回避不能)。exportは承認済み版+視覚QA合格の投稿のみ許可。

## V4.5 v3(2026-07-15): variant差分の構造保証 + 余白解消

v2の「表紙だけ違い本文02〜06が同一」を是正。

- **layoutId**: 各ページに`layoutId`を持たせ(`RenderedPage`)、preview meta と `template_variant_qa`(migration #8)へ記録。
- **差分の構造強制**(`src/core/templates/distinctness.ts`): 承認候補の2variantは 01〜05のうち最低3ページで「layoutIdが異なり かつ 画像ハッシュも異なる」必要。表紙のみ差分・本文同一・layoutId名だけ変更(hash同一)は承認不可(`templateApprovability`で core 強制)。CTA(最終ページ)は family 内共通可。
- **本文の実質的分離**: news report(事実整理)↔insight(分析・画面図・左右分割・影響+アクション)、portfolio showcase(注釈付きモック)↔story(課題→判断→設計→実装→確認のプロセス図)、compare table(比較表)↔diagnosis(YES/NO判断フロー・スコアカード・結果別アクション)。各本文は「情報モジュール2つ以上」または「主役の情報ビジュアル1つ」。単一小カード+大余白を禁止。
- **図解component追加**: changeFlow / impactList / actionList / splitTwo / processFlow / scoreCard / annotatedMock / exampleBox / miniChecklist / screenMock。矢印・チェックは全てSVGベクター(フォント記号非依存)。
- **visual QA厳格化**: `result=pass` は criticalIssues=0 **かつ revisionInstructions=0**(未解決の設計課題が残っていればpass不可)。
- **meta ↔ DB整合**: `template-visual-qa` がDBとmeta.jsonの両方へvisual QAを反映(`reconcileVisualQaInMeta`)。整合性テストあり。
- v1・v2 は保持し、v3(version=3, draft)として生成。自己承認しない。

## V4.5 最終追補(2026-07-15): 実績スクリーンショットの安全な描画

- 素材は `data/workspace/04_portfolio-assets/<portfolioItemId>/` へUIからアップロードする。PNG/JPEG/WebP・20MB以下のみ。SVG・絶対パス・path traversal・ルート外symlink・壊れた画像・巨大画像を通常コードで拒否する。
- `scope.screenshot=true`、approved、証跡実在、期限内のときだけ実画像をレンダラーへ渡す。AIへ無許可画像や任意パスを渡さない。
- `showcase` は実画像必須。許可画像がない場合は生成を拒否する。`story` は `abstract` モードで画像なしでも利用できる。
- DBの `carousel_spec` には画像本体を保存せず、相対パス・元画像SHA-256・MIME・寸法を記録する。画像本体はレンダリング中だけ正規化PNG data URIとして使用する。
- QA・代表者承認・export時に、現在の許可範囲と元画像SHA-256を再検査する。差し替え・取り消し・期限切れは再レンダリング+再QAで止める。
- 出力PNGはSharpで白背景へflattenし、alpha除去・sRGB・3ch・完全不透明をmechanical QAで強制する。
