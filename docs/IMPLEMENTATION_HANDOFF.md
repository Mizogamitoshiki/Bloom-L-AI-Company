# IMPLEMENTATION_HANDOFF — 実装引き継ぎ資料

実装担当(Claude Code / Opus、プロンプト2)への引き継ぎ。

> **設計承認: 2026-07-13 代表者承認済み**(Q1〜Q5回答+D-01〜D-13承認。記録は `DECISIONS.md`)。
> スコープ変更: **DM支援はMVP対象外(第2段階)**。実装しない(スキーマ・設計は将来用に維持)。
> 代表者は実装開始を別途指示する。**指示前にコード変更を開始しないこと。**

## 1. 最初に読む順序

1. `README.md`(分類ルール) → 2. `DECISIONS.md`(全設計判断) → 3. `17-one-month-mvp-roadmap.md`(スコープと週次計画) → 4. `20-acceptance-criteria.md`(完成条件) → 5. 実装対象領域の各設計書(07/08/09/10/11)

## 2. 実装開始前チェックリスト

- [x] 代表者の設計承認が得られている(2026-07-13。Q1〜Q5の回答を `DECISIONS.md` に記録済み)
- [ ] `claude --version` と スキル/サブエージェント/モデル指定の動作を実環境で再確認(→09)。確認できない機能は使わず、`docs/` に差分を追記
- [ ] Node 24 / pnpm が動作
- [ ] リポジトリ状態と設計書に矛盾がないか監査し、矛盾はOPEN項目として報告(プロンプト2の手順1)

## 3. 実装順(縦切り。詳細は17)

| 縦切り | 内容 | 完了の定義 |
|---|---|---|
| V1 | core(スキーマ/リデューサ/状態機械)+company CLI+S-01オフィス(seedデータ) | AC-3, AC-9〜11相当のテスト通過 |
| V2 | kickoffスキル+エージェント最小経路(葵→昊→琴葉)+レンダラー(tpl-howto)+S-02/S-03承認 | AC-1, 5, 6, 7, 15〜18 |
| V3 | QA/リサーチ/実績・権利管理+tpl-news/portfolio+S-04/S-05/S-06+日報・limits | AC-8, 13, 21〜23, 26〜28 |
| V4 | レポート/議事録/設定+バックアップ+E2E/a11y+運用手順書(**DM支援は含めない — 第2段階**) | MVP対象AC全28項目(AC-24/25除く)+J品質基準 |

## 4. 技術スタック(承認済み判断の要約)

- Next.js(App Router)+ TypeScript strict + Tailwind(任意)/ SQLite(better-sqlite3)+ Drizzle / Zod / Satori + Sharp / Vitest + Playwright + axe / SVGアイコン(Lucide等)/ フォント: Noto Sans JP同梱
- 追加ライブラリ導入時はライセンス(商用可・無料)を確認し `docs/assets-license.md` に記録

## 5. 守るべき不変条件(実装中に迷ったらここへ戻る)

1. DBへの書き込みは company CLI(エージェント側)と承認系ユースケース(UI側)のみ。**エージェントにDB直接アクセスを与えない**
2. `task_events` / `audit_log` はappend-only。UPDATE/DELETEするコードを書かない
3. 公開経路は「承認済み → export → 人間」のみ。承認チェックはcore層ユースケース内で行い、UI/CLI/将来アダプターから回避不能にする
4. 表示状態は必ずイベントからの導出。演出用の状態をDBに保存しない。進捗率を実装しない
5. 秘密情報: `.env.example` のみコミット。`data/` `runs/` `.env` はgitignore。ログ・イベントpayloadに個人情報を入れない(型で強制)
6. リトライ上限2回。無限ループ・無制限再試行を書かない
7. モデル名は `config/model-profiles.yaml` のみ。コード・エージェント定義への直書き禁止(生成スクリプト経由)
8. AIを呼ばない領域(レンダリング・集計・検証・マスキング等)にAI呼び出しを追加しない
9. デモデータは実データと分離し、デモ中は全画面にバナー表示
10. 外部APIは公式仕様だけを使用し、未設定時はfail-closedにする。V5のMetaアダプターは既定`disabled`、秘密値は環境変数のみ、AI社員/CLIに公開権限を与えない
11. **DM支援(S-07・陽葵の起動・dm_items書き込み)はMVPで実装しない**(第2段階)。dm_itemsスキーマ定義とマスキング設計は将来用に維持してよいが、UI・エージェント経路を作らない
12. 竹プランの価格(120,000円/月12,000円)は**社内検証用の仮価格**。生成コンテンツ(投稿・キャプション)に竹プランの具体価格を出力しない(QA禁止語チェックに含める)

## 6. ディレクトリ規約

`07-system-architecture.md` §3のリポジトリ構成に従う。`src/core` はNext.js・CLI双方からimportされるため、Node/ブラウザ依存コードを置かない(better-sqlite3等はadapters側)。

## 7. 環境変数(.env.example に置くキー)

```
# MVP では全て任意(未設定で動作すること)
AI_MODE=claude_code          # claude_code | api(将来)
ANTHROPIC_API_KEY=           # API有効化時のみ(Q2承認後)
TZ=Asia/Tokyo
```

## 8. 完了報告(プロンプト2の完成条件)

実装完了時は `20-acceptance-criteria.md` の検収表を埋め、実装したもの/しなかったもの/起動方法/テスト結果/手動確認手順/外部設定が必要な箇所/既知の制約/次の安全な実装候補 を報告する。

## 9. OPEN項目(実装中に判明した未確定事項の追記欄)

| 日付 | 項目 | 状態 |
|---|---|---|
| — | (実装開始後に記入) | |

## V3追補(2026-07-13 実装済み)

V3(本格QA・sources・実績/権利・tpl-news/portfolio・S-04/05/06・日報・上限・旧データ互換・ブランドマニフェスト)は実装済み。不変条件の追加:

13. 公開許可はscope 4項目の個別判定(`checkPortfolioRights`)。AIプロンプトへ顧客データを渡すときは必ず `listPortfolioForAi`(許可範囲マスク済み)を使う。生のportfolio_items/customer_permissionsをエージェントに渡さない
14. 上限の境界は>=(到達で停止・拒否)。自動停止(generation_paused)の保存を失敗するトランザクションの中で行わない(ロールバックで消える)。解除はowner専用UIのみ
15. スキーマ変更は `src/adapters/db/migrations.ts` にバージョン付きmigrationとして追加する(DDL直改変やその場ALTERをしない)。破壊的変更はprecheckで孤立・重複を検査し、勝手に削除せず日本語で停止する
16. source/顧客URLは `normalizeHttpUrl`(http/httpsのみ・正規化)を必ず通す
17. ブランド素材は `01_brand/brand-manifest.json`(brandManifestSchema)経由で読み込む。コードへの色・パス直書き禁止

## V4追補(2026-07-14 実装済み — MVP仕上げ)

V4(書き出しbundle・投稿済み記録・実績入力・週報/月報・議事録/週次会議・設定S-10・バックアップ/復元/doctor拡張・E2E+axe・秘密情報スキャン・運用手順書)を実装。検証結果は `20-acceptance-criteria.md §K`。DM支援は引き続き第2段階(未実装)。追加/再確認した不変条件:

18. 公開経路は「QA合格 → 代表者承認 → **export(tmp生成→atomic rename→DBトランザクション、失敗時は補償削除)** → 人間の手動投稿 → published記録」。export/publish-record/metric入力/設定変更は **owner専用**(actorガード)。エージェント用CLIに承認・公開権限のコマンドを追加しない
19. 数値集計・権利判定・承認判定・ファイル整合性判定は **AIに委ねず通常コード**で行う。週報/月報は決定的集計(`buildPeriodReport`)、投稿10本未満は統計的断定をしない(`dataNote`)
20. 書き出し先は業務日(JST)基準の `05_generated-posts/<YYYY-MM-DD>_<postId>/`。exportは冪等(既出力なら再生成しない)。`meta.json` に顧客情報・秘密情報を含めない(rightsStateのみ)
21. バックアップは整合スナップショット(`VACUUM INTO`)+workspace+全ファイルSHA-256 manifest(`backup-v2`)、14世代。同日再作成は一時世代の完成後に差し替え、失敗時は旧世代を保持する。復元は **全ファイル検証 → 現DB/workspace自動バックアップ → 一時領域でopen/migration/foreign_key_check/doctor → DB/workspaceをロールバック可能な手順で置換**。検証・置換失敗時は現状態を保全する。`backup-v1`は読み取り互換のみ維持
22. テスト/E2Eは実DB・実backups・実workspaceを触らない。隔離用env: `BLOOM_DB_PATH` / `BLOOM_WORKSPACE_PATH` / `BLOOM_BACKUP_PATH`。E2E(`playwright.config.ts`)は `.e2e-tmp/` と専用ポートで完結

## V5追補(2026-07-15 実装済み — Instagram公式API公開基盤)

23. 現在のV4.6オフィスデザインを確定版として維持し、V5では公開準備画面に接続状態と公開操作だけを追加する
24. Instagram実投稿は`owner`専用。`approved → export`を経た投稿に対して、最新QA・権利・テンプレートfingerprintを公開直前に再検査する
25. Meta認証情報は`.env`のみ。DB、監査ログ、API応答、UIへ値を保存・表示しない
26. 投稿ジョブは冪等キーで一意化する。通信結果が曖昧な失敗は`needs_reconciliation`で停止し、自動再試行しない
27. `META_PUBLISH_MODE`は`disabled`を既定とし、`dry_run`は外部通信ゼロ、`live`は公開HTTPS画像URLと代表者の最終確認を必須にする
23. 秘密情報は `pnpm check:secrets`(git管理下を走査)で継続検査。ブランドの success 色は AA(4.5:1)を満たす濃さ(`#157a41`)を使う

## V5.4追補(2026-07-17 実装済み — クラウド対応基盤・移行準備のみ)

V5.4(DB境界・PostgreSQL移行準備・export/import-check・Vercel安全ゲート・cloud認証ガード・cloud-readiness診断)を実装。**実デプロイ・PostgreSQL契約・実データ投入は行っていない。** 追加の不変条件:

28. `DATABASE_PROVIDER` の既定は `sqlite`。postgresは接続実装が入るまでfail closedで停止し、「移行準備完了」以上の表現をしない。`DATABASE_URL` の値をログ・エラー文・UI・監査ログへ出さない
29. Instagram liveは実行環境ゲート(`src/core/runtime.ts`)を通る。テスト/Vercel Preview環境では構造的に拒否(降格)し、Vercel productionは `ALLOW_LIVE_INSTAGRAM_PUBLISH=true` との二重条件。ローカル代表者環境の既存手順(V5.3)は変えない
30. cloud実行(`VERCEL_ENV`検出 or `APP_RUNTIME_MODE=cloud`)でowner認証が未確定の間、変更系APIは共通境界(`assertOwnerRequest`)で全拒否。即席の簡易パスワード認証を実装しない
31. `db-export` はreadonly接続のみ(openDb・migrationを通さない)。出力は決定的JSONL+SHA-256 manifest、tmp→atomic rename。移行データは `data/` 配下(gitignore)に置き、Gitへ追加しない
32. importは全体1トランザクション・二重import拒否の設計を維持し、実接続の無い状態で「成功」と報告するテスト・コードを書かない
33. E2Eの webServer は実`.env` へ依存させない(playwright.config.tsで `META_PUBLISH_MODE=disabled`・空トークンを明示固定)

## V6追補(2026-07-17 実装済み — 投稿後分析・CEO承認型改善ループ・Cron準備)

V6(analysis snapshot・改善提案/CEO判断・kickoff接続・/analytics・事業成果・Insights境界・Cron-ready)を実装。詳細は `27-v6-growth-loop.md`。追加の不変条件:

34. 数値計算・率計算・中央値・欠損判定は `src/core/analytics.ts`(通常コード)のみ。AIはanalysis snapshotの値を読み言い換えるだけで、再計算・補完・丸め直しをしない。未取得(null)を0にしない
35. 計測済み投稿10本未満での断定表現、および件数によらない因果断定は、`findForbiddenAssertions`(通常コード)が改善提案の保存時に拒否する。evidenceRefsはsnapshotの計測済み投稿と機械照合する。V6再レビュー: 提案の数値は`structuredFactRefs`による構造化参照のみ(実在+完全一致を検査、observationは通常コード生成)。snapshotの冪等hashは入力+JST業務日。提案保存はsystem/owner不可(提案者本人かaoiのみ)。testVariableは6種enumの1つだけ。/api/analyticsは認証未確定のcloud環境で読み取りも403(詳細: 27-v6-growth-loop.md §14)
36. 改善提案(improvement_proposals)と判断(improvement_decisions)は分離。判断はappend-onlyで、**ownerだけが** `decideImprovementProposal` を通じて記録できる(AI・system・CLI自動昇格の経路なし)
37. kickoffへ渡る改善指示は「最新判断=approved かつ 期限内」だけ・最大3件。適用は `(post_id, proposal_id)` 一意で二重適用を構造的に防ぐ。承認前の提案を企画へ渡さない
38. business_outcomesはowner専用・匿名。顧客を特定しうる文字列(メール・電話・LINE ID・URL・@)は通常コードが検出して保存を拒否する。DM原文・氏名・連絡先を分析データへ保存しない
39. Instagram Insights取得は境界(MetricsSourcePort)のみ。公式permission・アプリレビュー要否を確認できるまで実装しない(どのモードでもMetaへ通信しない)。`INSTAGRAM_INSIGHTS_MODE` 既定disabled
40. /api/cron/analytics はBearer CRON_SECRET必須(未設定・不一致401)・production以外403・DB未準備503。CronからClaude Code・AIエージェント・Meta投稿処理を呼ばない。Vercel Cron設定は無効なexample(docs/examples/)のみで、vercel.jsonへ登録しない
41. 美月(CEO専属AI秘書)・楓(AI-PMO)は設計記録のみ(準備中)。agent定義・モデル消費・DB権限・外部送信権限を与えない

## V4再監査追補(2026-07-15)

24. owner専用POST APIはactor文字列だけを信用せず、UIが付ける確認ヘッダー・same-origin `Origin`・`Sec-Fetch-Site`を共通境界で検査する。ローカル単一利用のCSRF/誤操作防止であり、クラウド移行時はログイン/セッション認証へ置換する
25. CLIの`system`を`owner`へ自動昇格しない。export/publish-recordは代表者が`--actor owner`を明示する。議事録の`decisions`もownerだけが確定でき、AIは提案をagendaへ残す
26. `post_metrics(post_id, window_days)`と`meetings(kind, period_end)`はmigration #5の一意制約で重複を防止する。週報/月報は投稿IDを重複計上せず、同一投稿の3日/7日実績を累積加算せず最新スナップショットを採用する
27. E2E seedはデモseedに依存せず、権利ブロック・修正再制作・承認・実export・published記録・キーボード操作・reduced-motionを一時DB/workspaceで実行する
