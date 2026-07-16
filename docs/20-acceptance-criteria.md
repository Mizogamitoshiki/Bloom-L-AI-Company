# 20. 受け入れ基準(MVP)

各項目はGiven/When/Then形式のテスト可能な基準。検証列: A=自動テスト(→16)、M=手動手順。
**MVP完了 = AC-1〜AC-30のうちMVP対象28項目(AC-24・AC-25を除く全項目)が合格し、代表者が検収記録を残すこと。**
※AC-24・AC-25(DM支援)は2026-07-13の代表者指示によりMVP対象外(第2段階の受け入れ基準として番号を維持)。

## A. 始業と日次ワークフロー(§18-2)

| ID | 基準 | 検証 |
|---|---|---|
| AC-1 | Given リポジトリセットアップ済み、When Claude Codeで `/kickoff` を1回実行、Then 未完了・失敗・承認待ちの確認 → 実行計画 → タスク実行 → QA → 日報生成までが人手の追加操作なしで一巡する | M(runログ保存) |
| AC-2 | Given 前回runが異常終了(終了イベントなし)、When 次の `/kickoff`、Then 残タスクがfailed化され、UIに「前回異常終了」が表示され、再計画される | A+M |
| AC-3 | Given 同一日に `/kickoff` を2回実行、When 2回目、Then 同一冪等キーのタスクは二重生成されない | A |
| AC-4 | Given 承認待ちが soft_cap(5件)以上、When kickoff、Then 生成系タスクがスキップされ、日報にその理由が記載される | A |

## B. 投稿生成(§18-3)

| ID | 基準 | 検証 |
|---|---|---|
| AC-5 | When パイプライン一巡、Then 投稿テーマ・キャプション(見出し/本文/CTA/ハッシュタグ)・カルーセルPNG(1080×1350、表紙+本文+CTAページ)が生成されDBに登録される | M |
| AC-6 | Given スロット文字数上限を超えるコピー、When スキーマ検証、Then レンダリング前に差し戻され、リトライは2回で打ち切られる | A |
| AC-7 | Given 同一のcarousel_spec、When 2回レンダリング、Then バイト同一(または画素同一)のPNGが生成される | A |
| AC-8 | Given 出典(URL・発行元・公開日・確認日)が欠けたsource、When ニュース投稿の企画・引用、Then 引用できずエラーになる | A |

## C. UI信頼性(§13絶対条件)

| ID | 基準 | 検証 |
|---|---|---|
| AC-9 | Given runningイベントを持つタスクが存在しない社員、When オフィス表示、Then その社員は「作業中」系の表示にならない(待機/完了/エラー等になる) | A |
| AC-10 | Given runningタスクのheartbeatが10分途絶、When オフィス表示、Then 「状態不明(最終更新N分前)」表示になる | A |
| AC-11 | 全画面を通して進捗率(%表示・プログレスバー)が存在しない。段階表示は実イベントがあるもののみ | A(静的検査)+M |
| AC-12 | Given エラー/待機/承認待ちのタスク、When 社員詳細パネル、Then 理由(エラー詳細・待機理由・承認待ち件数)が表示される | M |
| AC-13 | 準備中4部門はクリックしても役割と解放条件のみ表示し、稼働状態・タスクを一切表示しない | M |
| AC-14 | 社員詳細パネルに §13の必須項目(現在タスク/開始時刻/モデル/入力資料/段階/成果物/ログ/推定使用量/エラー/次の予定)がすべて表示される | M |

## D. 承認・監査(§18-4, §17)

| ID | 基準 | 検証 |
|---|---|---|
| AC-15 | QA不合格の投稿は承認キューに表示されない(DB直接操作でも状態遷移ガードが拒否) | A |
| AC-16 | When 承認/却下/修正依頼、Then posts状態が遷移し、approvals と audit_log に操作者・時刻・理由が記録される | A |
| AC-17 | When 修正依頼、Then 修正タスクが生成され、再制作後の成果物はversionが+1され旧版も参照できる | A+M |
| AC-18 | 未承認投稿は書き出し(export)できない(UI非表示かつAPI/CLIも拒否) | A |

## E. 書き出しと公開記録(§18-5)

| ID | 基準 | 検証 |
|---|---|---|
| AC-19 | When 承認済み投稿を書き出し、Then PNG連番+caption.txt+checklist.md+meta.json が05_generated-posts配下に出力される | A+M |
| AC-20 | When 「投稿済みにする」、Then published_at・publish_method=manual が記録され、3日後/7日後の実績値入力タスクが予定される | A |

## F. 実績と権利(§18-6, §7, §17)

| ID | 基準 | 検証 |
|---|---|---|
| AC-21 | When 実績を登録(許可記録付き)、Then 複数投稿(最低3種の切り口)の企画タスクが生成される | M |
| AC-22 | Given 許可状態が verbal_only/pending の実績、When パイプライン、Then QAで blocked_rights となり承認キューの「権利確認待ち」に隔離される | A |
| AC-23 | 推薦コメント(顧客の声)は許可記録(recorded)がない限り、いかなる成果物にも「顧客の発言」として出力されない | A(禁止語検査)+M |

## G. DM支援(§14-3)【第2段階 — MVP検収対象外(2026-07-13スコープ変更)】

| ID | 基準 | 検証 |
|---|---|---|
| AC-24 | 【第2段階】When DM本文を取り込み、Then 電話番号・メールアドレスがマスクされてからAI分析に渡り、要約・分類・見込み度・緊急度・不足質問・返信案2案が表示される。**原文はAI処理後に破棄され、DBには要約・分類・対応状況のみ残る(Q5)** | A(マスク)+M |
| AC-25 | 【第2段階】返信案に価格・納期・契約条件の確定表現が含まれる場合、警告が表示される。システムに「送信」機能自体が存在しない | A+M |

## H. レポート・利用量(§18-7)

| ID | 基準 | 検証 |
|---|---|---|
| AC-26 | kickoff完了時に日報(完了/失敗/承認状況/明日の予定/推定利用量)が生成され、UIで閲覧できる | M |
| AC-27 | 利用量表示に「推定」であることが明示され、API無効時に金額(円)を断定表示しない | M |

## I. 安全装置・運用(§17)

| ID | 基準 | 検証 |
|---|---|---|
| AC-28 | Given limits超過(日次タスク上限等)、When 追加の生成タスク、Then budget_pausedとなりUIに理由が表示され、代表者の再開操作で復帰する | A |
| AC-29 | リポジトリに秘密情報・実値の.env・data/配下がコミットされていない(.env.exampleのみ)。secretスキャンが合格 | A |
| AC-30 | When `company restore --from {日付}` を実行、Then バックアップからDBとworkspaceが同じ時点へ復元され、doctorが整合を確認する | M |

## J. 品質基準(合格ライン)

| 項目 | 基準 |
|---|---|
| アクセシビリティ | axe重大違反0 / キーボードのみで承認操作完了 / reduced-motion時と一覧モードで全情報に到達可能 |
| パフォーマンス | オフィス画面の初期表示3秒以内(ローカル)/ ポーリングでUIが固まらない |
| テスト | unit・integrationが全通過 / E2E主要5シナリオ通過(→16) |
| デモ分離 | デモモード時は全画面に「デモデータ」表示。実データと混在しない |

## K. V4検証結果(2026-07-14実施、2026-07-15再監査)

自動検証の全体結果: **`pnpm test` 161件通過 / `pnpm typecheck` 通過 / `pnpm build` 成功 / `pnpm e2e` 19件通過(Playwright+axe)/ `pnpm check:secrets` 合格**。MVP対象28項目(AC-24・AC-25を除く)は下表のとおり合格。doctorは実DBを変更しないようDBコピーでmigration/整合検査を行う。

| ID | 状態 | 検証根拠 |
|---|---|---|
| AC-1 | ✅(M) | `/kickoff` が daily-report→backup→run-finish まで一巡(kickoff SKILL) |
| AC-2 | ✅(A+M) | 前回異常終了の回収を `tests` で確認(reducers/store) |
| AC-3 | ✅(A) | 冪等キーのタスク二重生成なし(store/idempotency テスト) |
| AC-4 | ✅(A) | 承認待ちsoft_cap超過で生成スキップ+日報記載(v3-gates) |
| AC-5 | ✅(M) | カルーセルPNG(1080×1350)+キャプション生成(render-post) |
| AC-6 | ✅(A) | スロット超過は差し戻し・リトライ2回打ち切り(render/renderer) |
| AC-7 | ✅(A) | 同一specで決定的PNG(render 再現性テスト) |
| AC-8 | ✅(A) | 出典欠落のニュース引用は拒否(v3-gates: sources) |
| AC-9〜11 | ✅(A) | 実イベントなしは「作業中」にしない/進捗率非表示(reducers, E2E: progressbar 0件) |
| AC-12〜14 | ✅(M) | 社員詳細パネルの必須項目(手動確認) |
| AC-15 | ✅(A) | QA不合格は承認キューへ出さない(qa-integrity) |
| AC-16 | ✅(A) | 承認/却下/修正で状態遷移+audit記録(store, E2E: 承認シナリオ) |
| AC-17 | ✅(A+M) | 修正依頼で版+1・旧版参照(store) |
| AC-18 | ✅(A) | 未承認はexport不可(UI非表示+API/CLI拒否)(v4-export) |
| AC-19 | ✅(A+M) | export で PNG連番+caption+checklist+meta を出力(v4-export, E2E: 公開準備導線) |
| AC-20 | ✅(A) | published_at・publish_method=manual 記録+3日/7日実績タスク(v4-export) |
| AC-21 | ✅(M) | 実績登録で複数切り口の企画タスク生成(手動) |
| AC-22 | ✅(A) | verbal_only/pending は blocked_rights 隔離(v3-gates) |
| AC-23 | ✅(A+M) | 許可なし推薦コメントは成果物に出ない(禁止語検査) |
| AC-24・AC-25 | ⏸ 第2段階 | DM支援。MVP対象外(2026-07-13スコープ変更) |
| AC-26 | ✅(M) | 日報が kickoff 完了時に生成・UI閲覧可(buildDailyReport) |
| AC-27 | ✅(M) | 利用量は「推定」明示・API無効時に金額を断定しない |
| AC-28 | ✅(A) | limits超過で budget_paused+代表者再開(v3-gates) |
| AC-29 | ✅(A) | `pnpm check:secrets` 合格・`data/`はgitignore |
| AC-30 | ✅(A+M) | `company restore --from` が全ファイル検証→doctor→DB/workspace置換。改ざん/欠損・途中失敗は中止し現状態を保全(v4-backup) |

品質基準(J): axe critical/serious 違反 **0**(全9画面)/ キーボードだけで承認・exportへ到達可 / 375・768・1440pxで主要9画面の横overflowなし / E2Eコア7シナリオ通過(`e2e/core.spec.ts`)。

> 凡例: ✅ 合格、⏸ MVP対象外(第2段階)。A=自動テスト、M=手動手順。テスト名の括弧内は `tests/` 内の該当ファイル。
