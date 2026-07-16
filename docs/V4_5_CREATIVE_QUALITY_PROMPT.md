# Bloom-L AI Company — Claude Code V4.5 投稿デザイン品質改善プロンプト

V4の実装・レビュー修正が完了した後、新しいClaude Codeセッションで以下のコードブロックをそのまま貼り付ける。
推奨モデルはFable。上限到達時はOpusを使用する。

````text
あなたは、Instagramのアートディレクション、情報デザイン、日本語タイポグラフィ、ブランド設計、Satori+Sharp、Next.js、TypeScript strict、アクセシビリティに精通した主席デザインエンジニアです。

Bloom-L AI CompanyのV4完了後に、投稿画像を機能検証用プロトタイプから「Bloom-L公式Instagramで実際に公開できる品質」へ引き上げるV4.5を実装してください。

これは色や角丸を少し変える作業ではありません。現在の承認キューにある画像は、文字中心で視覚的に弱く、情報階層、視線誘導、内容に合う図解、ブランド独自性が不足しています。現状画像を合格基準にせず、投稿クリエイティブの仕組みを再設計してください。

V4で完成したexport、published記録、metrics、reports、meetings、settings、backup、E2Eを壊さないでください。V5、Meta API、自動投稿、クラウド化、DM支援へは進まないでください。

V4.5の対象はInstagram投稿クリエイティブと、その品質ゲート・代表者確認画面です。オフィス全体のレイアウト、AI社員アバター、人物ビジュアル、社内風景の本格的な再設計はV4.6で行うため、このフェーズでは着手しないでください。投稿制作工程を実イベントで表示するための最小限の状態表示だけは許可します。

## 0. 安全条件

- 作業開始時に `git status` と直近のV4完了報告を確認する。
- 代表者と他エージェントの既存変更を保持する。
- `git reset --hard`、`git checkout -- .`、`git clean`、既存変更の破棄を禁止する。
- コミット・pushは明示指示があるまで行わない。
- DB変更は既存migration方式に従う。既存投稿、承認履歴、export記録、metricsを失わない。
- V4再監査で追加されたmigration #5、一意制約、owner操作境界、CLIのowner自動昇格禁止、`backup-v2`のDB/workspace復元を維持する。
- 実DBをunit/integration/E2Eテストで変更しない。
- 有料API、Canva Pro、外部画像生成サービスを必須にしない。ローカル環境だけで完成画像を生成可能にする。

## 1. 最初に行う監査

次を読み、コードと突合してから実装方針を短く報告してください。

1. `docs/DECISIONS.md`
2. `docs/IMPLEMENTATION_HANDOFF.md`
3. `docs/10-pixel-office-ui-ux.md`
4. `docs/11-content-generation-pipeline.md`
5. `docs/13-security-privacy-and-rights.md`
6. `docs/16-testing-strategy.md`
7. `docs/20-acceptance-criteria.md`
8. V4で作成・更新された運用文書
9. `src/core/templates/`
10. `src/adapters/render/`
11. `src/core/guards.ts`
12. `config/qa-rules.yaml`
13. `.claude/agents/shion.md`
14. brand manifest、実ロゴ、フォント、素材ライセンス記録

現在の3テンプレート、承認キュー内の実画像、固定fixtureを実際にレンダリングし、次の5軸で問題を分類してください。

- 第一印象とブランド独自性
- 情報階層と2秒以内の理解
- スマートフォンでの可読性
- ページ間・投稿間の一貫性
- 内容と視覚表現の関連性

監査結果は `docs/22-instagram-creative-audit.md` に、重大度P0/P1/P2、対象画像、原因、修正方針を記録してください。

## 2. 公開停止ガードを先に実装

V4.5のデザインが代表者に承認されるまで、現在のV3/V4テンプレート画像を新規公開しない構造にしてください。

- テンプレートIDだけでなくversionとfingerprintを管理する。
- テンプレート版の初期状態は `draft`。ownerだけが `approved/rejected/revision_requested` を記録できる。
- 内容が承認済みでも、テンプレート版未承認、fingerprint不一致、旧画像、デザインQA失敗ならexportをcore/use-case層で拒否する。
- UI、CLI、APIのどこから呼んでも回避できないようにする。
- 既存のexport済み・published済み記録は改変しない。
- 操作理由、actor、対象version、fingerprint、時刻をaudit_logへ記録する。
- 代表者が明示的に承認するまで、自動的にテンプレートをapprovedにしない。

必要なmigrationは1トランザクション、再実行可能、foreign_key_check合格、失敗時は部分適用ゼロとしてください。

## 3. Bloom-L Instagramデザインシステム

brand manifestと実ロゴを唯一のブランド情報源として、Instagram用デザイントークンを構築してください。

- Bloom-Lの青と白を主役にする。
- 補助色、背景色、文字色、状態色、グラデーション、余白、角丸、罫線、影、アイコン線幅を少数のtokenへ集約する。
- 実ロゴがある場合、文字の「Bloom-L」で代用しない。縦横比を崩さず、最小サイズとセーフエリアを守る。
- 日本語の見出し、本文、注釈、数値、出典のtype scale、行長、行間、最大行数を定義する。
- 1080×1350の4:5を基本とし、Instagram上の縮小表示でも見出しと重要語を読めるようにする。
- 8pxグリッドを基本とし、整列と余白のリズムを揃える。
- WCAG AA相当のコントラストを目安にし、薄すぎるグレー文字を使わない。
- 装飾だけのAI人物、内容と無関係な写真、読めない疑似文字、安価なチラシ風、広すぎる空白、長文を置いただけの紙面を禁止する。

デザイン判断とtoken一覧を `docs/23-instagram-design-system.md` に記録してください。

## 4. プロ品質のテンプレート4系統

最低4系統を実装してください。すべてに表紙、本文、まとめ、CTAの専用layoutを持たせ、全ページを同じ「見出し+本文」にしないでください。

### A. education/howto

- HP未保有の泉州事業者向け課題解決
- ステップ図、チェックリスト、失敗/改善、要点カードを内容に応じて選択
- 1枚1メッセージで、保存したくなる実用性を持たせる

### B. news/insight

- IT・AIニュースと発見
- 「確認できた事実」「Bloom-Lの解説」「泉州事業者への影響」「今できる行動」「出典」を明確に分離
- ニュースの煽り、根拠のない未来予測、出典の読めない表示を禁止

### C. portfolio/case-study

- 許可済み実績だけを使う
- 画面モックアップ、課題→設計→実装→変化、担当範囲、使用技術を視覚化
- 顧客名、URL、画面、推薦文の個別許可scopeを通常コードで再検査

### D. comparison/checklist

- HP導入前後、よくある失敗、セルフ診断、比較表
- 小さすぎる表を避け、比較項目を1枚に詰め込みすぎない
- 読者が次の行動を判断できる結論を持たせる

共通要件:

- 表紙は、具体的な見出し、読者ベネフィット、内容に合う視覚要素を持つ。
- 図解、番号、引用、比較、端末モックアップ、アイコン、強調数値、タイムラインなどを再利用可能なSatori componentにする。
- CTAは投稿内容に応じて「保存」「プロフィール確認」「DMで相談」を選ぶ。毎回同じCTAにしない。
- 同じ構成が連続しないよう、系統内に2〜3の承認可能なlayout variantを持つ。ただし無制限なAI自由配置にはしない。
- 決定的レンダリングとschema validationを維持する。
- 既存成果物を読める後方互換を保つ。必要ならschemaVersionを上げる。
- 外部素材は無料・商用利用可能で権利確認できるものだけを使用し、`docs/assets-license.md` に記録する。

## 5. 内容QAとデザインQAを分離

現在のQAを壊さず、`content QA` と `design QA` を明確に分けてください。

通常コードで拒否する項目:

- 1080×1350以外の寸法
- ページ数、画像順、欠損画像
- 文字あふれ、最大行数、最小文字サイズ違反
- セーフエリア違反、必須slot欠落
- 未登録色やブランドtoken逸脱
- ロゴの欠損、変形、必要な余白不足
- 権利scope違反
- 未承認テンプレート版、version/fingerprint不一致

紫苑の視覚QA:

- レンダリング済みの全PNGを実際に見て評価する
- 情報階層、可読性、整列、余白、コントラスト、ブランド準拠、内容との関連性、CTA、ページ間一貫性をチェックする
- `result`, `criticalIssues`, `minorIssues`, `revisionInstructions`, `pageFindings` を構造化JSONで返す
- 内容と無関係な図、過度に一般的なコピー、視覚的な空疎さ、同じlayoutの連続も失敗理由にする
- 重大問題が1件でもあれば承認キューへ進めず、琴葉または紬の修正タスクを作る
- 修正後はartifact versionを上げて、再レンダリングと再QAを行う
- Claude Codeセッション内で全PNGを目視できない、視覚QAを実行できない、または結果JSONが不正な場合はfail closedとし、design QAを合格扱いにしない

AIの自己申告passだけで公開可能にしないでください。通常コードの検査、AI視覚QA、代表者のテンプレート版承認のすべてを必要条件にしてください。

## 6. ゴールデンプレビューと代表者確認

実運用に近い固定fixtureで、4系統それぞれ最低1投稿、各5〜7枚を生成してください。

- CLI: `pnpm company template-preview --all`
- 出力先: `data/workspace/06_template-previews/<templateId>/<version>/`
- 出力内容:
  - 全ページPNG
  - 投稿ごとのcontact sheet
  - 4系統を横断比較できるoverview contact sheet
  - template ID/version/fingerprint
  - content QA結果
  - design QA結果
  - 使用tokenと素材権利の概要
- 承認画面または設定画面から、代表者が拡大表示、ページ送り、承認、却下、修正依頼できるようにする。
- スマートフォン相当の縮小プレビューも表示する。

ここが計画的な停止点です。4系統の実画像、保存先、UI確認URL、代表者に見てほしい点を報告し、テンプレートを自分で承認せず停止してください。代表者が承認または修正指示を返した後にのみ、運用統合と最終検証を続行してください。

## 7. 運用統合

代表者承認後、次を完成させてください。

- `/kickoff` が承認済みのtemplate versionだけを選ぶ。
- 投稿内容から4系統とlayout variantを決定的に選択する。
- content QA→render→通常コードvisual checks→AI design QA→代表者の投稿承認、の順序を強制する。
- 既存承認待ち投稿を新しい承認済みtemplateで再レンダリングできるowner専用操作を作る。元artifactと履歴は削除しない。
- 再レンダリング後は以前の投稿承認を引き継がず、改めて代表者確認を求める。
- V4のexport guardへtemplate approvalを統合する。
- オフィス画面では、琴葉/紬/紫苑の現在工程と修正理由を実イベントから表示する。架空の進捗率は表示しない。

## 8. 必須テスト

最低限、次を自動テストしてください。

- 4系統の固定fixtureが全ページ生成される
- 同一入力+同一versionは決定的な出力になる
- 文字あふれ、最小文字、セーフエリア、ロゴ、token違反を検出する
- 未承認版、旧版、fingerprint不一致、content QA失敗、design QA失敗、権利失効のexport拒否
- AIがpassでも通常コード違反があれば拒否
- 通常コード合格でも代表者未承認templateなら拒否
- 代表者承認済みtemplateで再レンダリングした投稿だけ承認キューへ進む
- 旧artifactと監査履歴が保存される
- V4のexport/published/metrics/reports/backupが後退しない
- 375px、768px、1440pxでプレビュー・承認操作が可能
- キーボードだけでテンプレート確認と承認操作が可能
- reduced-motionでも情報が失われない

固定fixtureの全PNGとcontact sheetを実際に目視し、コード上のpassだけで完了としないでください。

## 9. 最終検証

リポジトリに存在する正式なコマンド名を監査してから、最低限次を実行してください。

```bash
pnpm sync-agents
pnpm test
pnpm typecheck
pnpm build
pnpm e2e
pnpm check:secrets
pnpm company doctor
pnpm company template-preview --all
git diff --check
```

一時DBと一時workspaceを使用するテストが、実DBと既存生成物を変更していないことを確認してください。

## 10. 完了報告

V5へ進まず、次を日本語で報告して停止してください。

1. 現状デザインの監査結果と改善内容
2. 実装した4系統とlayout variants
3. デザイントークンと再利用component
4. content QA / design QA / owner approvalの強制方法
5. migrationと既存データ保全結果
6. ゴールデンプレビュー保存先とUI確認URL
7. template ID/version/fingerprintと代表者承認状態
8. unit/integration/E2E/a11y/typecheck/build/doctorの結果
9. 既存V4機能の回帰結果
10. 代表者がローカルで確認する具体的手順
11. 残っているデザイン上の判断事項
12. コミット・pushを行っていないこと

V4.5の合格条件は「画像が生成できること」ではありません。Bloom-Lの信用を損なわず、代表者が実際に公開したいと思える4系統の見本が揃い、未承認または低品質の画像が構造的にexportできないことです。
````
