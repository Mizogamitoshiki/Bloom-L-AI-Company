# Bloom-L AI Company — Claude Code V4実装プロンプト

以下のコードブロックを、リポジトリ直下で起動した新しいClaude Codeセッションへそのまま貼り付ける。
推奨モデルは、利用可能ならFable、高推論モデルの上限到達時はOpus。

````text
あなたは、Next.js、TypeScript strict、SQLite/Drizzle、ローカルファースト設計、Playwright、アクセシビリティ、運用設計に精通した主席フルスタックエンジニアです。

Bloom-L AI CompanyのV4「毎日安全に運用できるMVPの仕上げ」を実装してください。設計だけで停止せず、コード・マイグレーション・テスト・運用文書まで完成させてください。ただしV5以降、クラウド化、Meta API連携へは進まないでください。

## 0. 現在の重要な前提

- 作業ブランチは `feat/mvp-implementation`。
- V1/V2はコミット済み。V3本体、V3レビュー修正、ブランド反映、ピクセルオフィスUI改善は現在のワークツリーに存在する。
- ワークツリーには多数の変更・未追跡ファイルがある。これらは代表者とCodexが作成した正当な成果物である。
- `git reset --hard`、`git checkout -- .`、`git clean`、既存変更の破棄、無断の全面書き換えを禁止する。
- 現在のオフィスデザイン、`OfficeView`、`PixelAvatar`、`AppShell`、ブランドロゴ・ブランドカラーを維持する。V4機能追加に必要な範囲を除き、ホーム画面を再デザインしない。
- `README.md` の実装状況には古いV1/V2表記が残っているため、V4完了時に現状へ更新する。
- 直近確認: TypeScriptエラー0、本番ビルド成功。テストは129件中1件が並列実行時に一度だけ5秒タイムアウトしたが、該当ファイル単独では18/18合格。テストの安定性もV4で確認する。
- コミット・pushは代表者から明示的に指示されるまで行わない。

## 1. 最初に必ず読む資料

この順で読み、実装前に現在コードとの突合結果を短く報告してください。

1. `docs/README.md`
2. `docs/DECISIONS.md`
3. `docs/IMPLEMENTATION_HANDOFF.md`
4. `docs/17-one-month-mvp-roadmap.md`
5. `docs/20-acceptance-criteria.md`
6. `docs/08-data-model.md`
7. `docs/09-local-runtime-and-claude-code-integration.md`
8. `docs/10-pixel-office-ui-ux.md`
9. `docs/11-content-generation-pipeline.md`
10. `docs/12-instagram-and-external-integrations.md`
11. `docs/13-security-privacy-and-rights.md`
12. `docs/15-kpi-and-analytics.md`
13. `docs/16-testing-strategy.md`
14. `.claude/skills/kickoff/SKILL.md`

続いて `git status`、既存テスト、CLI、DBスキーマ、API、画面を監査し、V3で先行実装済みの機能とV4の不足を分類してください。既存機能を同じ名前で作り直さず、不足分だけを実装してください。

## 2. V4の完了目標

V4完了時、代表者が次の流れをローカルで安全に一巡できること。

`/kickoff → 投稿生成 → QA → 代表者承認 → export_bundle → Instagramへ人間が手動投稿 → 投稿済み記録 → 3日後/7日後の実績入力 → 日報/週報/月報 → 週次会議 → バックアップ`

Instagramへの実送信は代表者が手動で行う。V4ではMeta Graph APIによる自動・予約投稿を実装しない。

## 3. V4-A: 既存基盤監査と互換性

1. 既存のV3機能、実DB、投稿、成果物、承認履歴、ブランド素材を破壊しない。
2. スキーマ変更は `src/adapters/db/migrations.ts` の新しいバージョン付きmigrationだけで行う。
3. migrationは1トランザクション、再実行可能、`foreign_key_check` 合格、途中失敗時は部分適用ゼロ。
4. 古いDBに重複・孤立がある場合、勝手に削除せず、日本語の停止理由と修復方法を提示する。
5. `BLOOM_DB_PATH` を利用し、テスト/E2Eは一時DBだけを使う。実際の `data/company.db` をテストで変更しない。
6. 先行実装済みの日報、カレンダー、pipeline、portfolio、doctorを活用し、重複実装しない。

## 4. V4-B: 承認後の書き出し・投稿済み記録（最優先）

AC-18〜20を構造的に満たしてください。

### export_bundle

- core/use-case層に書き出しガードを置く。UIやCLIだけの判定にしない。
- `approved` かつ、最新copy→carousel_spec→PNG一式の整合性、最新QA合格、権利状態を再検査した投稿だけ書き出せる。
- 未承認、QA不合格、権利失効、旧画像、欠損画像はCLI/APIを直接呼んでも拒否する。
- 出力先は `data/workspace/05_generated-posts/<YYYY-MM-DD>_<postId>/`。日付境界はAsia/Tokyoのbusiness dateを使う。
- 必須内容:
  - `01.png`〜投稿順の連番PNG
  - `caption.txt`（見出し・本文・CTA・ハッシュタグ）
  - `checklist.md`（Instagram/Meta Business Suiteでの手動投稿手順、画像順、位置情報・タグ・最終確認、投稿後の記録手順）
  - `meta.json`（postId、title、templateId、exportedAt、画像順、source概要、権利状態、schemaVersion。秘密情報・許可範囲外の顧客情報は含めない）
- 一時ディレクトリへ全ファイルを生成し、成功後に同一ボリューム上でrenameする。途中失敗で完成フォルダやDB状態を半端に残さない。
- 成功後だけ `approved → exported`、`export_path`、audit_logの `post_exported` を1トランザクションで記録する。
- rename後にDBトランザクションが失敗した場合は、この呼び出しで作った完成フォルダを補償削除し、投稿をapprovedのまま維持する。既存フォルダは削除しない。
- 同一内容の再実行は冪等。無意味な重複フォルダや監査ログを増やさない。
- CLI: `pnpm company export --post <id> --actor owner`
- owner専用APIとUI導線を実装する。エージェントには公開判断権限を与えない。

### 投稿済み記録

- `exported` の投稿だけを「投稿済みにする」ことができる。
- 実際のInstagram送信機能は作らない。
- `published_at` は代表者操作時刻、`publish_method=manual`、audit_logに `publish_recorded` を記録する。
- 投稿済み記録と同じトランザクションで、湊担当の3日後・7日後実績入力タスクを、異なる必須stepKeyで各1件だけ作る。Asia/Tokyo基準で日付を計算し、再操作で重複しない。
- CLI: `pnpm company publish-record --post <id> --actor owner`
- owner専用APIとUI導線を実装する。
- pipelineまたは専用の公開準備UIで、`approved → 書き出し`、`exported → 投稿済みにする`、書き出し先、手動投稿チェックリストを確認できる。
- 承認画面の古い「書き出しはV3で実装予定」という文言を削除する。

## 5. V4-C: 実績値・週報/月報・AI会議

### post_metrics

- docs/08どおり `post_metrics` をDrizzleスキーマとmigrationへ正式実装し、postsへのFK・必要なindexを付ける。
- 代表者が投稿3日後/7日後に、Instagramインサイトから `reach/profileViews/saves/shares/comments/dmStarts/followerCount/note` を手入力できる画面/APIを作る。
- 未入力はNULLのまま。0や推定値で穴埋めしない。
- 負数拒否、整数、対象投稿存在確認、owner操作、audit_logを通常コードで強制する。

### レポート S-08

- 現在の日報を壊さず、週報・月報を追加する。
- `reportArtifactSchema` はdaily/weekly/monthlyを判別でき、期間開始・終了を持つ。既存daily成果物を読める後方互換を保つ。
- 集計値は通常コードだけで決定的に算出する。AIに数値計算や欠損補完をさせない。
- 週報/月報には、投稿数、公開数、承認率、修正回数、失敗率、柱別の実績、入力済みSNS指標、推定利用量を表示する。
- 投稿10本未満では統計的断定をせず、「データ不足」「傾向の可能性」と明記する。
- API無効時に円換算費用を断定表示しない。「Maxプラン枠内の推定利用量」であることを維持する。
- UIは日報/週報/月報タブと期間選択を持つ。空状態・入力不足を正直に表示する。

### 議事録 S-09 / 週次会議

- docs/08の `meetings` をDrizzleスキーマとmigrationへ正式実装する。
- `meeting_minutes` 成果物スキーマを追加し、agenda、participants、facts、observations、proposals、decisions、ownerActions、nextWeekPlanを分離する。
- 事実・観察・提案を混ぜない。決定は代表者が承認したものだけ `decisions` として記録する。
- `.claude/skills/weekly-review/SKILL.md` を追加する。
  - 湊: DB集計結果を読む。数値を作らない
  - 蓮: 改善仮説を提案
  - 葵: 議題と代表者向け判断事項を整理
  - サブエージェントはDBを直接変更せずJSONだけ返す
  - オーケストレーターがcompany CLI経由で保存する
- CLI: `weekly-report`、`meeting-save`、必要なら `monthly-report`。入力はZod検証する。
- `/meetings` で週次/月次議事録、決定、未決事項、次週計画を閲覧できる。
- AI会議を自動で常時起動しない。代表者がClaude Codeで `/weekly-review` を実行したときだけ動く。

## 6. V4-D: 設定 S-10

- `/settings` とowner専用APIを実装する。
- 編集可能な運用設定は、最低限 `weeklyPostTarget`（1〜7、初期3）、`ownerDailyMinutes`（10〜120、初期30）、`timezone`（MVPはAsia/Tokyo固定表示）とする。
- 書き込みはZod検証、settingsテーブル、actor=owner、audit_logの `setting_changed` を経由する。
- モデルプロファイル、limits、ブランドマニフェストは現在値と参照元を表示する。V4ではUIからYAML/JSONファイルを直接書き換えない。
- `api_enabled` はV4で有効化しない。Anthropic APIキー入力欄、Metaトークン入力欄、秘密情報保存UIを作らない。
- 保存成功・検証エラー・再読み込み時の状態を日本語で明示する。

## 7. V4-E: バックアップ・復旧・doctor

AC-30を満たしてください。

- CLI:
  - `pnpm company backup [--date YYYY-MM-DD]`
  - `pnpm company backup-list`
  - `pnpm company restore --from YYYY-MM-DD`
- 保存先: `data/backups/<YYYY-MM-DD>/`。Git管理対象外を維持する。
- SQLiteの整合したスナップショット、必要なworkspace成果物、manifest（作成時刻、schema migration、対象ファイル、サイズ、SHA-256）を保存する。
- backups自身を再帰コピーしない。`.env`、秘密情報、runsの不要な一時ファイルを含めない。
- 日次14世代を保持し、古い世代を安全にローテーションする。
- restore前に現在DBの退避を自動作成する。
- manifest/checksum検証→一時領域へ復元→DB open/migration/foreign_key_check/doctor成功→atomic置換の順。失敗時は現DBを変更しない。
- backup/restoreは実DBを使わないintegration testを用意する。
- `/kickoff` の正常終了順を `daily-report → backup → run-finish` とし、バックアップ失敗を隠さず代表者へ報告する。バックアップ失敗だけで既に完了した投稿成果物を消さない。
- doctorにV4のFK、export bundle、report/meeting参照、backup manifestの検査を追加する。doctorは勝手に修復しない。

## 8. V4-F: E2E・アクセシビリティ・秘密情報検査

- Playwright + `@axe-core/playwright` を開発依存へ追加する。商用利用可能な無料ライセンスを確認し `docs/assets-license.md` に追記する。
- E2Eは専用の一時DB・一時workspace・専用ポートを使い、実データを変更しない。
- docs/16の主要5シナリオを実装する:
  1. デモ/fixture → オフィス → 社員詳細 → 承認 → export → published記録
  2. heartbeat停止→状態不明、error理由表示
  3. 修正依頼→drafting→再制作後version+1
  4. 権利未確認の実績投稿が承認経路へ出ない
  5. reduced-motion/一覧モードで情報へ到達可能
- 追加E2E:
  - キーボードだけで承認操作とexport導線へ到達できる
  - 全主要画面 `/`, `/approvals`, `/pipeline`, `/calendar`, `/portfolio`, `/reports`, `/meetings`, `/settings` でaxe critical/serious違反0
  - 375px、768px、1440pxで重大な横スクロールがない
- `pnpm e2e` と、必要なら `pnpm e2e:install` を追加する。
- `pnpm check:secrets` を追加し、少なくともGit追跡対象の `.env`、`data/`、秘密鍵、一般的なAPIキーパターンを検出して失敗する。実値を出力ログへ表示しない。
- flaky回避のため固定sleepを多用せず、role/label/testidと状態待ちを使う。必要な重いレンダラーテストだけ根拠付きでtimeoutを調整する。

## 9. 運用文書

以下を作成・更新してください。

- `README.md`: V4完了状態、5分以内の起動手順、日常運用、主要コマンド
- `docs/21-local-operations-runbook.md`:
  - 初回起動
  - 毎朝 `/kickoff`
  - 30分の承認作業
  - export後のInstagram手動投稿
  - 投稿済み記録と3日/7日実績入力
  - `/weekly-review`
  - バックアップ確認・復旧
  - エラー、budget_paused、stale、権利ブロック時の対処
  - 終了方法
- `docs/20-acceptance-criteria.md`: 各ACの実装/自動/手動検証結果欄を追記する。基準そのものを都合よく弱めない。
- `docs/IMPLEMENTATION_HANDOFF.md`: V4実装結果、不変条件の追加、既知制約を追記する。
- DB・UI・パイプライン・テストに変更があれば対応する既存設計書へV4追補を入れる。

## 10. 絶対に守る不変条件

1. エージェントはDBを直接操作しない。company CLI経由のみ。
2. `task_events` と `audit_log` はappend-only。UPDATE/DELETE禁止。
3. 公開経路は `QA合格 → 代表者承認 → export → 人間の手動投稿 → published記録` だけ。
4. Instagram自動投稿、予約投稿API、DM支援、DM送信を実装しない。
5. UIからClaude Codeやサブエージェントを自動起動しない。
6. 進捗率を表示しない。状態は実イベントから導出する。
7. 許可範囲外の顧客名・URL・画像・推薦コメントをAI、export、reportへ渡さない。
8. 竹プランの仮価格を公開コンテンツへ出さない。
9. AIに数値集計、権利判定、承認判定、ファイル整合性判定を委ねない。
10. リトライ上限2回、日次limits境界は `>=`、代表者だけが停止解除できる。
11. API課金、有料サービス、クラウド常時稼働を追加しない。
12. デモデータと実データを混在させない。
13. 現在のBloom-LブランドとピクセルオフィスUIを保持する。

## 11. 実装順序とレビュー停止点

次の順で実装し、各段階のテストを通してから次へ進んでください。

1. 監査・migration計画
2. export/published + metrics
3. reports/meetings/settings
4. backup/restore/doctor
5. E2E/a11y/secrets
6. docs・全検収

途中で設計書との重大な矛盾、既存データを安全に移行できない問題、有料契約・外部権限が必要な問題が見つかった場合だけ停止して報告してください。軽微な実装判断は、推奨案と根拠を `docs/IMPLEMENTATION_HANDOFF.md` に記録して進めてください。

## 12. 必須テスト・最終検証

最低限、以下を実行してください。

```bash
pnpm sync-agents
pnpm test
pnpm typecheck
pnpm build
pnpm e2e
pnpm check:secrets
pnpm company doctor
git diff --check
```

追加で次を検証してください。

- V2形式/V3形式/現在実DBのmigrationがデータを保持する
- 未承認export拒否、QA/権利失効export拒否、成功export、途中失敗ロールバック、再実行冪等
- exported以外のpublished拒否、3日/7日タスク重複なし
- metrics未入力を推定で埋めない
- report集計の決定性と投稿10本未満の断定禁止
- setting_changed監査とowner以外拒否
- backup改ざん/欠損時restore拒否、restore失敗時に現DB無傷
- E2Eが実DBを変更しない
- 既存129テストを後退させない

## 13. 完了報告形式

実装後はV5へ進まず、次を日本語で報告して停止してください。

1. 実装した機能（V4-A〜F別）
2. 変更・追加ファイル
3. migration番号と実DB保全結果
4. AC-1〜30のうちMVP対象28項目の結果表（AC-24/25は対象外のまま）
5. unit/integration/E2E/a11y/typecheck/build/doctor/secretsの件数と結果
6. 代表者がローカルで確認する具体的手順
7. 外部設定が必要なもの（V4では原則なし）
8. 既知の制約と第2段階へ残したもの
9. コミット・pushをしていないことの確認

V4の目的は「機能を増やして豪華にすること」ではなく、代表者が毎日30分で、安全に投稿を公開し、数字を記録し、週次改善し、壊れても復旧できるMVPを完成させることです。
````
