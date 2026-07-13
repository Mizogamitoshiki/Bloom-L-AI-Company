# 09. ローカル実行とClaude Code連携

## 1. 実機確認結果(2026-07-13)【仮定AS-2の根拠】

| 項目 | 確認結果 |
|---|---|
| Claude Code | v2.1.207 インストール済み |
| 非対話実行 | `claude -p/--print` が公式オプションとして存在 |
| カスタムエージェント | `--agents <json>` オプションおよび `.claude/agents/` 定義が利用可能 |
| スキル | `.claude/skills/` のスキル(スラッシュコマンド)が利用可能 |
| 権限制御 | `--allowedTools` 等の公式権限オプションあり |
| バックグラウンド | `--bg` によるバックグラウンドエージェントあり(MVPでは不使用【推奨: 監視が複雑になるため】) |
| Node / pnpm | v24.14.0 / 11.9.0 |

実装開始時に `claude --version` と各機能を再確認する(仕様変更に備える)【確定§10の指示】。存在が確認できない機能は使わない。

## 2. 実行方式【D-03採用案】

**AI実行はすべて「代表者が開いたClaude Codeセッション」の中で行う。**

- 費用: Maxプランの利用枠内。Anthropic APIキー不要 → 追加費用0円
- 正当性: Claude Codeの公式機能(スキル・サブエージェント・Bash)のみを使用。**Maxプラン認証情報の非公式流用(OAuthトークン抽出等)は行わない**【確定§10】
- 制約として受け入れること: Macとセッションが開いている間だけ稼働(§11「常時稼働不要」と整合)/ 利用枠のレート制限にかかったら当日の生成を打ち切り、翌日再開(budget_paused)

## 3. 始業コマンド `/kickoff`

`.claude/skills/kickoff/SKILL.md` として実装。内容(概略):

```
1. `pnpm company run-start` を実行(前回run異常終了の検出・回収を含む)
2. `pnpm company plan --json` の出力(未完了/失敗/承認待ち/カレンダー)を読む
3. 葵(社長補佐)として本日の実行計画を決定し `pnpm company plan-commit` で登録
4. 計画のタスクを順に処理:
   - 各タスクの担当エージェント定義(.claude/agents/{name}.md)をサブエージェントとして起動
   - サブエージェントは成果物JSONを stdout に出力 → `pnpm company submit --task {id}` が
     Zod検証してDBへ(検証失敗はエラーを返し、リトライは最大2回)
   - 開始・進捗・終了イベントはCLIが自動記録(heartbeat)
5. デザインspec完了後 `pnpm company render --post {id}`(Satori+Sharp、AI不使用)
6. QAタスク → 合格分のみ awaiting_approval へ
7. `pnpm company daily-report` で日報生成、run終了イベント、バックアップ
8. 最後に代表者向けサマリー(承認待ち件数・失敗・要判断事項)を表示
```

**設計上の要点**
- Claude(エージェント)は**DBを直接触らない**。必ず `company` CLIを経由し、CLIがスキーマ検証・イベント記録・冪等性・監査ログを保証する(プロンプト逸脱への防御)
- 途中でセッションが落ちても、イベントログに実状態が残る。次回kickoffが回収する(冪等キーで二重実行防止)
- `--dangerously-skip-permissions` は使わない。`.claude/settings.json` の `permissions.allow` に `Bash(pnpm company *)` 等の最小許可を定義【推奨】

## 4. サブエージェント定義

- `.claude/agents/{aoi|ren|rin|sora|kotoha|tsumugi|shion|minato|hinata}.md`
- frontmatterで tools を最小化(例: 琴葉は Read + `Bash(pnpm company *)` のみ。凛のみWeb系ツールを許可)
- 本文 = `05-agent-specifications.md` の 目的/入力/出力/禁止事項 + 出力JSONスキーマ(コピペではなく生成時に `persona_json` から自動生成するスクリプトを用意【推奨: 二重管理防止】)
- モデルはfrontmatterの `model` に `config/model-profiles.yaml` から解決した値を書き込む(生成スクリプトが同期)

## 5. アプリ(Next.js)との連携【D-04】

```
Claude Code ──(company CLI)──> SQLite <──(読み取り+承認書き込み)── Next.js
```

- 連携はDBとファイルシステムのみ。プロセス間RPC・ソケットは使わない(単純・堅牢)
- UIの「今すぐ分析」等のボタンは、**タスクをqueuedで積むだけ**。実行は次のkickoff(またはセッションが開いていれば代表者がClaude Codeに「続けて」と指示)
- UIからClaude Codeを自動起動しない(認証・権限の境界を越えない)

## 6. AgentRunnerPort(将来のAPI移行境界)【D-05】

```ts
interface AgentRunnerPort {
  run(task: TaskSpec, context: SharedContext): Promise<AgentResult>; // 実装1: ClaudeCodeManualRunner(MVP=人が開くセッション内で実行される前提の記録系)
}                                                                    // 実装2: AnthropicApiRunner(将来・デフォルト無効)
```

- `AnthropicApiRunner` は `.env` に `ANTHROPIC_API_KEY` があり、かつ `settings.api_enabled=true`(UIで代表者が費用見積もりを確認して有効化)した場合のみ動作(→ Q2)
- 有効化時は `usage_records` に実トークン数と概算費用(円)を記録し、`config/limits.yaml` の日次/月次上限で自動 budget_paused

## 7. 起動手順(代表者の日常)

```
朝:
 1) ターミナルで pnpm dev(初回のみ。launchd自動起動を推奨設定として同梱)
 2) claude を開き /kickoff
 3) ブラウザで http://localhost:3000 → 承認・投稿(30分)。DM対応はInstagramアプリで代表者が手動(AI支援は第2段階)
夜(任意): 投稿実績値の入力
```
