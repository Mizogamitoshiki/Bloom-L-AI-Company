# Bloom-L AI Company 設計書一式

本ディレクトリは「Bloom-L AI Company」(AI社員によるSNS運用組織)の設計書一式である。
このフェーズでは**実装を行っていない**。実装は代表者の設計承認後、`IMPLEMENTATION_HANDOFF.md` に従って開始する。

- 確定仕様の原本: リポジトリ直下 `Bloom-L_AI_Company_ClaudeCode_Prompts.md`(§1〜§22)
- 設計基準日: 2026-07-13
- 実機確認済み環境: macOS (Darwin 25.5.0) / Claude Code 2.1.207 / Node v24.14.0 / pnpm 11.9.0

## 記載の分類ルール

全設計書で以下のラベルを使い分ける。ラベルのない記述は原則【確定】に由来する。

| ラベル | 意味 |
|---|---|
| 【確定】 | 確定仕様(§1〜§22)に明記された事項。変更には代表者の判断が必要 |
| 【推奨】 | 設計者の推奨案。根拠を併記。代表者が上書き可能 |
| 【仮定】 | 進行のために置いた仮定。誤りが判明したら該当設計を見直す |
| 【未確定】 | 代表者の回答・確認が必要な事項。`02-assumptions-and-open-questions.md` に集約 |

## ファイル構成と読む順序

| # | ファイル | 内容 | 主読者 |
|---|---|---|---|
| 00 | [00-executive-summary.md](00-executive-summary.md) | 全体要約・主要判断 | 代表者(最初に読む) |
| 01 | [01-confirmed-requirements.md](01-confirmed-requirements.md) | 確定要件の整理 | 全員 |
| 02 | [02-assumptions-and-open-questions.md](02-assumptions-and-open-questions.md) | 仮定・未確定事項・代表者への質問(5問) | 代表者(承認前に必読) |
| 03 | [03-business-and-sns-strategy.md](03-business-and-sns-strategy.md) | 事業・料金プラン検証・SNS戦略 | 代表者 |
| 04 | [04-ai-company-organization.md](04-ai-company-organization.md) | AI組織・会議体 | 全員 |
| 05 | [05-agent-specifications.md](05-agent-specifications.md) | AI社員9名の仕様 | 実装者 |
| 06 | [06-workflows-and-state-machines.md](06-workflows-and-state-machines.md) | ワークフロー・状態遷移・例外 | 実装者 |
| 07 | [07-system-architecture.md](07-system-architecture.md) | システム構成・コンポーネント | 実装者 |
| 08 | [08-data-model.md](08-data-model.md) | データモデル・ER図 | 実装者 |
| 09 | [09-local-runtime-and-claude-code-integration.md](09-local-runtime-and-claude-code-integration.md) | ローカル実行・Claude Code連携 | 実装者 |
| 10 | [10-pixel-office-ui-ux.md](10-pixel-office-ui-ux.md) | ピクセルオフィスUI・画面仕様 | 実装者 |
| 11 | [11-content-generation-pipeline.md](11-content-generation-pipeline.md) | 投稿・カルーセル生成パイプライン | 実装者 |
| 12 | [12-instagram-and-external-integrations.md](12-instagram-and-external-integrations.md) | Instagram・外部サービス連携 | 代表者+実装者 |
| 13 | [13-security-privacy-and-rights.md](13-security-privacy-and-rights.md) | セキュリティ・プライバシー・権利 | 全員 |
| 14 | [14-model-routing-and-usage-limits.md](14-model-routing-and-usage-limits.md) | モデル選択・利用量制御 | 実装者 |
| 15 | [15-kpi-and-analytics.md](15-kpi-and-analytics.md) | KPI・分析 | 代表者 |
| 16 | [16-testing-strategy.md](16-testing-strategy.md) | テスト戦略 | 実装者 |
| 17 | [17-one-month-mvp-roadmap.md](17-one-month-mvp-roadmap.md) | 1か月MVPロードマップ | 全員 |
| 18 | [18-cloud-migration-plan.md](18-cloud-migration-plan.md) | クラウド移行計画 | 実装者(将来) |
| 19 | [19-risks-and-mitigations.md](19-risks-and-mitigations.md) | リスクと対策 | 代表者 |
| 20 | [20-acceptance-criteria.md](20-acceptance-criteria.md) | 受け入れ基準(テスト可能) | 全員 |
| — | [DECISIONS.md](DECISIONS.md) | 設計判断記録(比較表付き) | 実装者 |
| — | [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md) | 実装引き継ぎ資料 | 実装者(実装開始時に最初に読む) |

## 承認フロー

1. 代表者が `00` → `02` → `03` → `17` → `20` を読む
2. `02-assumptions-and-open-questions.md` の質問(最大5問)に回答する
3. 回答を `DECISIONS.md` に追記し、影響する設計書を更新する
4. 代表者が設計を承認したら、新しいコンテキストで実装用プロンプト(プロンプト2)を実行する

**設計承認前に実装を開始しないこと。**
