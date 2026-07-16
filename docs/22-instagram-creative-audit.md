# 22. Instagram投稿クリエイティブ監査(V4.5)

対象: V4完了時点の投稿カルーセル生成(`src/core/templates/`・`src/adapters/render/`)。
方法: 現行3テンプレート(tpl-howto / tpl-news / tpl-portfolio)を固定fixtureで実レンダリングし、全PNGを目視。以下の5軸で分類した。合格基準は「現状画像」ではなく「Bloom-L公式Instagramで代表者が実際に公開したい品質」。

対象レンダリング: `pnpm exec tsx tmp-audit-render.ts`(監査用の一時スクリプト。恒久化しない)。
実データ・実DBは変更していない(fixture+一時ディレクトリのみ)。

## 監査サマリ

現行テンプレートは「文字あふれ検査・決定的レンダリング・ブランドトークン注入」という**土台は正しい**が、クリエイティブとしては未完成で、そのまま公開すると信用を損なう。共通の弱点:

- **実ロゴを使っていない**(青い角丸四角+文字「Bloom-L」で代用)。`data/workspace/01_brand/logo.png` が存在するのに未使用。→ V4.5 §3・§5違反の直接原因。
- **1枚1メッセージだが紙面の40〜70%が空白**。情報が上下中央に細く置かれ、視線の起点・強調・図解がない(「長文を置いただけ」「広すぎる空白」)。
- **全ページが同じ「見出し+本文」**。表紙・本文・まとめ・CTAのlayoutが分離されておらず、系統内variantもない。
- **内容に対応する視覚要素がない**(ステップ図・チェック・比較・端末モック・強調数値・タイムライン・出典カードが存在しない)。
- **CTAが弱い/固定**。最終ページが本文と同じ体裁で、行動喚起の設計がない。

## 5軸評価

| 軸 | 現状 | 主な問題 |
|---|---|---|
| 第一印象・ブランド独自性 | 弱 | 実ロゴ未使用。汎用的な白地に黒文字で、どの事業者でも作れる見た目。青の主役化が不足 |
| 情報階層・2秒理解 | 弱 | 表紙に内容を示す視覚要素がなく、見出しだけ。本文ページは要点が一文で、図解・番号カード・強調がない |
| スマホ可読性 | 中 | 本文サイズは概ね確保。ただし余白過多で「読む情報が少ない」印象。注釈・出典の階層が未定義 |
| ページ間・投稿間一貫性 | 中 | フレーム/ドットは共通だが、レイアウトの型が1種類しかなく単調。系統ごとの個性がない |
| 内容と視覚の関連性 | 弱 | howtoにステップ図なし、newsに事実/見解の視覚的分離が弱く出典カードなし、portfolioに端末モック・課題→成果の可視化なし、比較/チェック系統が存在しない |

## 重大度つき所見

| ID | 重大度 | 対象 | 原因 | 修正方針(V4.5) |
|---|---|---|---|---|
| CR-01 | **P0** | 全テンプレート表紙・全ページ | 実ロゴ未使用、文字「Bloom-L」で代用(§3明確違反) | brand manifestの実ロゴをSatoriに埋め込み(data URI)。縦横比固定・最小サイズ・セーフエリア厳守。文字代用を禁止 |
| CR-02 | **P0** | 全ページ | 紙面の大半が空白で情報密度・視線誘導がない | 表紙/本文/まとめ/CTAの専用layoutを新設。8pxグリッド、ヘッダー/本文/フッター帯の構造化。内容に応じた図解componentで密度を持たせる |
| CR-03 | **P0** | 品質ゲート | content QAとdesign QAが未分離。AI自己申告passでexport可能 | design QA(通常コードの寸法/セーフエリア/token/ロゴ/version検査)+ 紫苑の全PNG視覚QA + 代表者のtemplate version承認を分離・必須化。未承認版・fingerprint不一致・design QA失敗はexport不可 |
| CR-04 | **P1** | tpl-howto | ステップ/チェック/失敗改善の図解がなく実用性・保存価値が低い | education/howto系統をstep・checklist・point-cardのlayout variantで再設計。番号カード・アイコン・強調 |
| CR-05 | **P1** | tpl-news | 事実/見解/影響/出典の分離が視覚的に弱い。出典が読みにくい | news/insight系統でfact-list・opinionカード・impactカード・**出典カード**をcomponent化。煽り・未確認断定を構造で排除 |
| CR-06 | **P1** | tpl-portfolio | 端末モック・課題→設計→実装→変化の可視化がなく実績が伝わらない | portfolio/case-study系統で端末モックcomponent・before/after・技術タグを実装。許可scopeを通常コードで再検査(既存維持) |
| CR-07 | **P1** | 系統不足 | comparison/checklist系統が存在しない | comparison/checklist系統(比較表・セルフ診断・HP導入前後)を新規実装。詰め込みすぎない結論つき |
| CR-08 | **P1** | 系統内単調さ | layout variantがなく同一構成が連続 | 各系統に2〜3の承認可能variant。無制限なAI自由配置はしない(決定的選択) |
| CR-09 | **P2** | CTA | 最終ページが本文と同体裁で行動喚起が弱い・固定 | CTA専用layout。内容に応じ「保存」「プロフィール確認」「DMで相談」を決定的に選択 |
| CR-10 | **P2** | タイポグラフィ | type scale/行長/最大行数/数値強調が未定義 | 日本語type scale・行長・行間・最大行数・数値強調styleをdesign systemに定義(docs/23) |
| CR-11 | **P2** | 後方互換 | 新schemaで旧成果物が読めなくなる懸念 | carousel specにschemaVersionを導入。旧成果物は読み取り互換を維持。exportは新版承認テンプレートのみ許可 |

## 保全対象(V4/再監査の成果、壊さない)

- migration #1〜#5(特に#5の post_metrics / meetings 一意制約)。V4.5は **migration #6以降**を追加する。
- owner操作境界: `apps/dashboard/lib/owner-request.ts`(same-origin+確認ヘッダー)、CLIの owner 自動昇格禁止、exportPost の `actor !== "owner"` 拒否。
- export guard(`store.exportPost`)の整合性・QA・権利・atomic rename・補償削除。既存 export済み/published済み記録。
- backup-v2(DB+workspace復元)、metrics/reports/meetings/settings、E2E+axe。

## 次アクション(実装順は §2ガード→§3デザインシステム→§4テンプレート→§5 QA分離→§6ゴールデンプレビュー→**代表者承認待ちで停止**)

---

## V4.5 v2 再監査(2026-07-15)。v3の起点

代表者レビューを実ファイル(SHA-256)・DB・コードで再確認した結果:

| 系統 | variant比較 | 実測(v2画像) |
|---|---|---|
| tpl-howto | steps vs guide | 01〜05 differ・06(CTA)同一 → **本文も差分あり(可)** |
| tpl-news | report vs insight | 01のみdiffer・**02〜06完全同一** → 実質「表紙だけ違う」 |
| tpl-portfolio | showcase vs story | 01のみdiffer・**02〜06完全同一** → 実質「表紙だけ違う」 |
| tpl-compare | table vs diagnosis | 01・03 differ・**02/04/05/06同一** → 差分不足 |

- **原因**: v2の各family buildPagesは news/portfolio/compare で表紙のみvariant分岐し、本文02〜06を共通実装にしていた(howtoのみ本文も分岐)。
- **visual QAの見逃し**: v2のvisual QAは上記の重複を検出せずpassにしていた(視覚QAの合否基準が甘い)。
- **meta.json ↔ DB不一致**: 生成時のmeta.jsonに`visualQa`キーが無い(contentQa/designQaのみ)一方、DBの`template_variant_qa`はvisual QA=pass。表示不一致。
- **余白**: 単一の小さな文章カードを中央に置き大部分が余白のページが多い(news見解/影響、portfolio課題/対応/成果、compare導入/結論、howto guideのタイムライン)。

### v3で構造的に是正すること
1. 各ページに`layoutId`を持たせ、承認候補の2variantは **01〜05のうち最低3ページが異なるlayoutId かつ 画像ハッシュも相違** を通常コード+テストで強制(CTAのみ共通可)。
2. 本文ページは「情報モジュール2つ以上」または「主役の情報ビジュアル1つ」を必須にし、単一小カード+大余白を禁止。
3. visual QAの pass 条件を厳格化(criticalIssues=0 かつ revisionInstructions=0)。
4. 生成後にvisual QAをmeta.jsonへ反映し、DBとmeta.jsonの不一致は承認不可+整合性テスト。
5. v1・v2は保持し、v3(version=3, draft)として生成。自己承認しない。
