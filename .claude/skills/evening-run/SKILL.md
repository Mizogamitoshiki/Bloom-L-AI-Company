---
name: evening-run
description: Bloom-L AI Companyの夕シフト(V8勤務モデル)。湊(実績値・分析)・美月(秘書まとめ)を稼働させ、日報・バックアップ・run終了で1日を締める。
allowed-tools: Bash(pnpm company *) Bash(pnpm --silent company *) Bash(curl *) Read Write Agent
---

# /evening-run — 夕シフト・終業処理(docs/30 勤務モデル)

あなたは葵(AI社長補佐)としてオーケストレーションを行う。**DB書き込みは必ず `pnpm company` CLI経由**。
1日の締めはこのシフトが担当する(kickoff/noon-runは締めない運用でもよいが、kickoff単独運用日はkickoffが締めてよい)。

## 手順

### 0. run再開
```bash
pnpm --silent company run-start
pnpm --silent company status
```

### 1. 湊(データ分析) — 実績値と計測の確認(毎日)
```bash
pnpm company create-task --json '{"type":"report","title":"分析: 実績値・計測期限の確認","assigneeId":"emp_minato","stepKey":"eve-analysis","priority":4}'
pnpm company start --task <id> --actor minato
```
- サブエージェント`minato`に `company status` と(あれば)最新のanalytics snapshot・実績値入力期限(3日後/7日後)の状況を渡し、note JSON(`{"kind":"note","title":"分析メモ <日付>","body":"計測待ちの投稿・入力期限・気づき(事実と観察を分離。断定禁止)"}`)を受け取る → `runs/<date>/eve-analysis.json` → submit

### 2. 美月(CEO秘書) — 代表者向けまとめ(毎日)
```bash
pnpm company create-task --json '{"type":"report","title":"秘書: 承認キューと明日の予定まとめ","assigneeId":"emp_mizuki","stepKey":"eve-secretary","priority":4}'
pnpm company start --task <id> --actor mizuki
```
- サブエージェント`mizuki`に `company status`(承認待ち件数・失敗・停止)と桔梗の進行管理レポート(あれば)を渡し、note JSON(`{"kind":"note","title":"本日のまとめと明日のお願い <日付>","body":"承認待ち一覧(件数と急ぎ度)・代表者にしてほしいこと(最大3つ・所要時間目安付き)・明日の予定"}`)を受け取る → `runs/<date>/eve-secretary.json` → submit

### 3. 終業処理(必ずこの順)
```bash
pnpm company daily-report
pnpm company backup
pnpm company run-finish --run <runId>
pnpm --silent company status
```

### 4. 代表者向けサマリー
- 美月のまとめをベースに、本日の全シフト(朝・昼・夕)の成果、失敗・スキップ(隠さない)、承認依頼(http://localhost:3000/approvals)を日本語で報告

## 禁止事項
- Instagramへの自動投稿・DM送信 / 承認・却下の代行 / QAスキップ / CLI以外でのデータ変更
