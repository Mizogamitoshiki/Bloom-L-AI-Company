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
10. 未確認の外部API・機能(Meta API等)を前提にした実装をしない。アダプターinterfaceまで
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
