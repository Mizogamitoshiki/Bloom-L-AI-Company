# 21. ローカル運用手順書(V4)

代表者がBloom-L AI Companyを毎日安全に運用するための実務手順。所要は1日約30分。
このアプリはローカル完結・APIキー不要・追加費用0円。Instagramへの投稿は必ず人間が手で行う。

---

## 0. 前提と用語

- **代表者(owner)**: 承認・却下・書き出し・投稿済み記録・設定変更・生成停止解除を行える唯一の主体。
- **AI社員 / オーケストレーター**: 企画・制作・QAの下書きまで。DBへは `company` CLI 経由でのみ書き込み、承認や公開は行えない。
- **業務日(JST)**: すべての「今日」はAsia/Tokyo(UTC+9)固定で判定する。
- 破壊的操作(削除・復元)は必ずバックアップの後で。復元は現DBを自動バックアップしてから行う。

---

## 1. 毎日の流れ(約30分)

1. **起動**: `pnpm dev` を一度立ち上げておく(常駐可)。ブラウザで http://localhost:3000 。
2. **始業**: Claude Codeでこのリポジトリを開き `/kickoff` を1回実行。
   - 前回異常終了の回収 → 実行計画 → タスク実行 → QA → **日報生成 → バックアップ → run終了** まで自動で一巡する。
3. **承認**(`/approvals`): QA合格投稿を確認し、承認 / 却下(理由必須) / 修正依頼(理由必須)。
4. **書き出しと投稿**(`/publish`):
   - 承認済みの「書き出し」を押すと `data/workspace/05_generated-posts/<業務日>_<postId>/` にPNG連番・`caption.txt`・`checklist.md`・`meta.json` が出力される。
   - そのフォルダを開き、`checklist.md` を確認しながら **Instagramアプリで手動投稿**。
   - 投稿し終えたら「投稿済みにする」を押す。3日後・7日後の実績入力タスクが自動で予定される。
5. **実績入力**(`/publish`): 3日後・7日後に、リーチ・保存・プロフィール閲覧などの数値を入力。
   - 取得できない項目は**空のまま**でよい(0や推定で埋めない。空欄=未取得として扱う)。
6. **終業**: 特別な操作は不要。`/kickoff` 終了時にバックアップが取得済み。

### 1.1 制作実績画像を投稿へ使う

1. `/portfolio` で顧客・匿名表示名・制作内容を登録する。
2. 登録された実績カードの「HP画面キャプチャ」からPNG/JPEG/WebP(20MB以下)をアップロードする。ファイルは自動的に `04_portfolio-assets/<実績ID>/` へ保存される。
3. 顧客の同意証跡を `07_customer-permissions/` へ保存し、許可範囲で「画面キャプチャ」を有効にしてapprovedを記録する。
4. `/kickoff` で実績投稿を生成する。画像許可+実画像があればshowcase、画像許可がなければ画像を使わないstoryになる。
5. 元画像を差し替えた場合は、以前の生成画像をそのまま公開できない。再レンダリング→再QA→代表者承認を行う。

顧客の画面キャプチャ許可がない場合、画像を登録済みでもAI・レンダラー・exportへ渡さない。showcaseは生成せず、storyの抽象図解だけを使用する。

---

## 2. 週次・月次(週1回・月1回)

- **週次AI集客会議**: Claude Codeで `/weekly-review` を実行。
  - 湊が集計(通常コード)を読み、蓮が改善仮説を出し、葵が議題・代表者判断事項を整理して議事録を保存する。
  - **数値はAIが作らない**。`pnpm company weekly-report` の集計結果(事実)だけを使う。投稿10本未満は「データ不足・傾向の可能性」と明記される。
  - **決定(decisions)は代表者承認が必要**。承認した決定だけを追記して再保存する。
- **月次**: `pnpm company monthly-report` または `/weekly-review` の月次版。
- 保存した議事録・会議は `/meetings` で閲覧できる。

---

## 3. バックアップと復元(V4-E)

### 3.1 バックアップ
```bash
pnpm company backup            # 当日分。data/backups/<YYYY-MM-DD>/ に作成
pnpm company backup --date 2026-07-14   # 日付指定
pnpm company backup-list       # 一覧(各世代の checksum 整合を表示)
```
- 中身: `company.db`(VACUUM INTO による整合スナップショット)+ `workspace`(素材・生成物)+ `manifest.json`(全ファイルのSHA-256・サイズを含む)。
- 日次14世代を自動保持(古いものから削除)。`/kickoff` 終了時にも自動作成される。
- 同日分を作り直す場合も、完全な新世代を検証してから差し替える。作成失敗で直前の正常世代は消えない。

### 3.2 復元
```bash
pnpm company backup-list                 # まず復元候補の日付と valid を確認
pnpm company restore --from 2026-07-14   # 検証→doctor→atomic置換
```
- 手順(自動): manifestと全ファイルのSHA-256検証 → **現DB/workspaceを自動バックアップ** → 一時領域で open/migration/foreign_key_check/doctor → 問題なければDBとworkspaceを同じバックアップ時点へ置換。
- **checksum不一致・doctorエラー・置換途中のエラー時は復元を中止/ロールバックし、現DB/workspaceを保全する**。
- 復元後は `pnpm company doctor` で整合を確認する。

### 3.3 いつ復元するか
- `pnpm company doctor` が「外部キー違反」「最新バックアップのSHA-256不一致」などの **error** を出したとき。
- 誤操作でデータが壊れたと分かったとき。まず `backup-list` で健全な世代を選ぶ。

---

## 4. 診断(doctor)

```bash
pnpm company doctor   # 読み取りのみ。DBは書き換えない
```
主なチェック:
- 外部キー整合(`foreign_key_check`)
- exported/published投稿の書き出しフォルダ・`meta.json` の実在
- 議事録成果物への参照切れ
- バックアップの有無・最新世代の整合
- ブランド素材(ロゴ・manifest)の有無、旧形式specの検出

`ok: true`(errorが0)なら運用可。`warn` は運用可だが要確認(例:「バックアップがまだありません」→ `pnpm company backup`)。

---

## 5. トラブル対応

| 症状 | 対応 |
|---|---|
| 承認画面で投稿が「要修復」になり承認できない | 整合性が崩れている(再レンダリング+再QAが必要)。他の投稿の承認は通常どおり可。`/kickoff` で修復タスクが回る |
| 書き出しフォルダが見つからない(doctorがwarn) | `pnpm company export --post <id>` で再書き出し |
| 「新規生成は停止中」表示 | 承認待ちが多い等の安全停止。承認を消化し、ダッシュボードから代表者が再開(解除は代表者のみ) |
| 失敗タスクが残る | リトライ上限2回で failed。詳細パネルから再開可能。原因はエラー文言に記録 |
| DBが壊れた疑い | `pnpm company backup-list` → 健全な世代へ `restore` → `doctor` |
| 秘密情報を誤って置いた | `pnpm check:secrets` で検出。指摘ファイルから除去(APIキー等はコミットしない) |
| CLIで書き出し/投稿記録がowner拒否になる | 代表者が `--actor owner` を明示する。AI社員や自動処理から付けない |

---

## 6. やってはいけないこと(不変条件)

1. エージェントにDBを直接操作させない(company CLI 経由のみ)。
2. `task_events` / `audit_log` を UPDATE/DELETE しない(append-only)。
3. 公開経路は「QA合格 → 代表者承認 → export → 人間の手動投稿 → published記録」だけ。
4. Instagram自動投稿・予約投稿API・DM支援/送信を追加しない。
5. UIからClaude Codeやサブエージェントを自動起動しない。
6. 進捗率を表示しない(状態は実イベントから導出)。
7. 許可範囲外の顧客名・URL・画像・推薦コメントをAI・export・reportへ渡さない。
8. 竹プランの仮価格を公開コンテンツへ出さない(社内検証用の仮価格)。
9. 数値集計・権利判定・承認判定・ファイル整合性判定をAIに委ねない。
10. リトライ上限2回、日次limitsは `>=` 境界、停止解除は代表者だけ。
11. API課金・有料サービス・クラウド常時稼働を追加しない。
12. デモデータと実データを混在させない(検証は `pnpm company seed --demo`、実運用は `pnpm company init`)。
13. 現在のBloom-LブランドとピクセルオフィスUIを保持する。

---

## 7. 参照

- 受け入れ基準と検証結果: [20-acceptance-criteria.md](20-acceptance-criteria.md)
- 引き継ぎ・不変条件の詳細: [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md)
- 素材ライセンス: [assets-license.md](assets-license.md)
