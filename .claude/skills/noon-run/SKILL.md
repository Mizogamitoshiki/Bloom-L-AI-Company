---
name: noon-run
description: Bloom-L AI Companyの昼シフト(V8勤務モデル)。桔梗(進行管理)・凛(ネタ収集)・椿(ストーリー制作)を稼働させ、朝のkickoffと夕のevening-runの間を埋める。runは締めない。
allowed-tools: Bash(pnpm company *) Bash(pnpm --silent company *) Bash(curl *) Read Write Agent
---

# /noon-run — 昼シフト(docs/30 勤務モデル)

あなたは葵(AI社長補佐)としてオーケストレーションを行う。**DB書き込みは必ず `pnpm company` CLI経由**。
サブエージェントはReadのみでJSONを返す係(凛はWebSearch/WebFetch可、椿はCanvaツール可)。
**このシフトではrunを締めない**(daily-report/backup/run-finishは/evening-runの担当)。

## 手順

### 0. run再開
```bash
pnpm --silent company run-start   # 同日2回目以降はresumedExisting=trueで再開
pnpm --silent company status
```
- `generationPause`が非nullなら生成系(手順3)をスキップし理由を報告

### 1. 桔梗(PM) — 進行管理レポート(毎日)
```bash
pnpm company create-task --json '{"type":"report","title":"進行管理: 停滞・滞留チェック","assigneeId":"emp_kikyou","stepKey":"noon-pm","priority":4}'
pnpm company start --task <id> --actor kikyou
```
- サブエージェント`kikyou`に `company status` のJSON(全文)と本日のタスク一覧を渡し、note JSON(`{"kind":"note","title":"進行管理レポート <日付>","body":"停滞タスク・長時間未着手・失敗の一覧と推奨アクション(なければ『停滞なし』)"}`)を受け取る
- `runs/<date>/noon-pm.json` にWriteして `pnpm company submit --task <id> --file ... --actor kikyou`

### 2. 凛(リサーチ) — 投稿ネタ収集(毎日・見える化必須)
```bash
pnpm company create-task --json '{"type":"research","title":"ネタ収集: IT/AI・泉州動向","assigneeId":"emp_rin","stepKey":"noon-research","priority":4}'
pnpm company start --task <id> --actor rin
```
- サブエージェント`rin`に「明日以降の投稿ネタ候補3件(柱の偏りはdocs/03 §5.2を考慮)を出典付きで」依頼し、note JSONを受け取る → `runs/<date>/noon-research.json` にWriteしてsubmit
- ニュース性の高いネタは`source-add`で登録しておく(翌朝のkickoffで使える)

### 3. 椿(Canvaデザイナー) — ストーリー1本(平日)
```bash
pnpm company create-task --json '{"type":"design","title":"ストーリー制作","assigneeId":"emp_tsubaki","stepKey":"noon-story","priority":3}'
pnpm company start --task <id> --actor tsubaki
```
- 当日の投稿テーマ・凛のネタから、`story_spec`(hook≤30字/sub≤24字/cta≤20字/合計≤60字)を葵が構成し:
```bash
pnpm company story-render --json '<story_spec>' --output <slug>
```
- 出力PNGをReadで開いて確認 → note JSON(タイトル・ファイルパス・狙い)をsubmit。/storiesページに自動表示される
- 種別はdocs/28の型から回す(質問スタンプ用/二択投票用/新着告知)。同じ型を3日連続で使わない

### 3b. V10: サンプルサイト制作ブロック(1日1本・intakeがある日だけ。docs/32・D-19)
代表者が /samples に投入した「自作のHPデザイン画像+素材」を、颯がHTML/CSSで**忠実に再現**し、撮影→紬の忠実度QA→tpl-sample投稿へ流す。
```bash
pnpm --silent company sample-list --status new        # 未着手の依頼(0件なら正直にスキップ。空タスクは作らない)
pnpm --silent company sample-list --status building   # 紬QAで差し戻された依頼(作り直し。1回まで)
```
1. **颯(hayate)の制作タスク**(依頼1件につき1つ。`request`=依頼ID):
```bash
pnpm company create-task --json '{"type":"build_site","title":"サンプル制作: <slug>","assigneeId":"emp_hayate","stepKey":"build-<requestId>","priority":4}'
pnpm company start --task <id> --actor hayate
```
   - サブエージェント`hayate`に渡す: `sample-show --request <id>` の依頼内容と素材一覧(パス。`kind=design`が再現対象、`reference`は画面に出せない)、制約(静的HTML/CSS・JS/外部URL禁止・素材は `./assets/<ファイル名>` のみ・実在情報はプレースホルダー・価格は書かない・viewport必須)。颯は画像をReadで開いて再現し、`site_sample` JSONだけを返す
   - `runs/<date>/site-sample-<slug>.json` にWriteして:
```bash
pnpm company sample-build --task <id> --file runs/<date>/site-sample-<slug>.json --actor hayate
```
   - 静的検査NG(外部URL・script・実在情報・価格・素材参照)や撮影失敗はエラーで返る → 指摘を颯に渡して修正・再提出(最大2回)。成功すると `sampleId` と紬のQAタスクID(`designQaTaskId`)が返る
2. **紬(tsumugi)の忠実度QA**:
```bash
pnpm company start --task <designQaTaskId> --actor tsumugi
```
   - 紬に渡す: 撮影PNG4枚(`data/workspace/02_site-samples/<requestId>/v<n>/shots/{pc-fold,pc-full,sp-fold,sp-full}.png`)と元デザイン画像(`kind=design`)のパス。**両方を実際に開いて**並べて判定させ、`visual_qa`(fidelity付き。passなら`revisionInstructions`は空配列)を受け取る
   - `runs/<date>/sample-visual-qa-<slug>.json` にWriteして:
```bash
pnpm company sample-visual-qa --sample <sampleId> --task <designQaTaskId> --file runs/<date>/sample-visual-qa-<slug>.json --actor tsumugi
```
   - fail(fidelity low/critical)なら依頼は`building`に戻る。颯に差分を渡して作り直し(1回まで)。それでもfailならその日は投稿を作らず報告
3. **投稿(passのときだけ)**: kickoffと同じ分業(蓮→昊→琴葉→render→紫苑QA)で **tpl-sample** の投稿を1本作る。V9原則(場面起点)はサンプル投稿でも適用
```bash
pnpm company create-post --json '{"pillar":"5","format":"carousel","templateId":"tpl-sample","sampleId":"<sampleId>","title":"サンプル: <slug>","plannedDate":"<YYYY-MM-DD>"}'
```
   - 琴葉には`sample_copy`スキーマ(cover/scene/screens×2/behind/plan{planId,note}/ctaMessage)で書かせる。**価格は書かせない**(通常コードが承認済み価格帯を注入し、それ以外の「円」表記はQAで拒否される)。「サンプル(架空)」の明記は必須
   - `pnpm company render --post <postId>`(Satori)→ 紫苑の視覚QA+内容QA → 承認キュー。tpl-sampleのテンプレート版が未承認なら書き出しがブロックされるので、サマリーで代表者に/templates承認を依頼する
4. サマリーに「サンプル制作の結果(sampleId・忠実度・投稿の状態)」「intake残数」「素材追加の依頼」を含める。1日の上限は1本(`max_site_samples`)。デプロイ(V10.3)は代表者操作で、AIは行わない

### 4. サマリー(締めない)
- 実施内容・停滞の有無・代表者への依頼(あれば)を日本語で報告
- **daily-report/backup/run-finishは実行しない**(/evening-runが行う)

## 禁止事項
- Instagramへの自動投稿・DM送信 / 承認・却下の代行 / QAスキップ / CLI以外でのデータ変更
