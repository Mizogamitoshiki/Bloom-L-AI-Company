# 14. モデルルーティングと利用量制御

## 1. モデルプロファイル【確定§10: 直書き禁止・役割で切替】

`config/model-profiles.yaml`(モデル名はここにのみ存在。コード・エージェント定義へは生成スクリプトが注入):

```yaml
profiles:
  light:     # 分類・整形・定型(可能な限り通常コードで代替し、AI呼び出し自体を避ける)
    claude_code: haiku      # 利用可能な軽量モデル。実装時に実環境で確認して設定
  standard:  # 日常運用の既定(調査・企画・コピー・QA・分析)
    claude_code: sonnet
  heavy:     # 重要な戦略判断・難しいレビュー・失敗時の再検討のみ
    claude_code: opus
routing:
  default: standard
  escalation:            # 昇格ルール(社長補佐が提案、回数制限あり)
    - when: qa_fact_conflict      # QAが事実矛盾を検出
      to: heavy
    - when: task_failed_twice     # 2回失敗した生成タスクの再検討
      to: heavy
    - when: weekly_strategy       # 週次/月次の戦略見直し
      to: heavy
  escalation_daily_cap: 3         # heavy昇格は1日3回まで
```

- 実装時に、Claude Codeサブエージェントのモデル指定が実環境で機能するかを確認してから既定値を確定する(§10: 未確認機能を前提にしない)。指定不能な場合はセッション既定モデルで動かし、プロファイルは記録用として維持

## 2. 「AIを使わない」領域の明示【確定§19】

通常コードで実装(AI呼び出し禁止): レンダリング / 文字数・スキーマ検証 / マスキング / 集計・KPI計算 / カレンダー配置 / バックアップ / イベント整合チェック / export生成

## 3. コンテキスト効率化【確定§10: キャッシュ・要約・差分】

| 手法 | 内容 |
|---|---|
| 共有コンテキスト | 当日の調査・決定を `runs/{date}/context.md` に集約し、各エージェントには**要約版のみ**渡す(全履歴を渡さない) |
| 調査キャッシュ | sourcesは再利用。同一テーマの再調査は7日以内なら既存レコード参照(重複調査禁止) |
| 差分処理 | 修正依頼時は全文再生成でなく、修正対象スロットのみ再生成 |
| プロンプト固定化 | エージェント定義は静的ファイル(セッション内キャッシュが効く形) |

## 4. 利用量の記録と表示

- Claude Codeセッション内実行では正確なトークン数が取得できない前提に立ち、**推定値**(入出力文字数・実行時間)を `usage_records` に記録。UIには「推定」と明示【§13: 根拠のない数値を出さない、の応用】
- 日報に「本日のタスク数・推定使用量・heavy昇格回数」を表示
- API利用を有効化した場合のみ、実トークン数と円換算を記録・表示

## 5. 上限とブレーキ(`config/limits.yaml`)【確定§10・§17】

```yaml
daily:
  max_generated_posts: 3        # 1日の投稿生成上限(承認在庫の過剰防止)
  max_tasks: 20
  max_heavy_escalations: 3
  max_research_fetches: 15
retry:
  per_task: 2                   # 超過でfailed(無制限再試行の禁止)
  replan_days: 2
approval_queue:
  soft_cap: 5                   # 超過時は生成系をスキップ
api:                            # API有効化時のみ
  monthly_budget_yen: 3000      # Q2の枠内。超過で自動budget_paused
```

- 上限到達時の挙動: 新規生成タスクを `budget_paused` にし、UI該当社員を「予算停止」表示。承認処理・日報などの軽量処理は継続
- レート制限(Maxプラン枠)検出時: 当日runを「途中終了(理由: 利用枠)」として正常記録し、翌日kickoffが続きから再開(冪等キー)

### V3追補(2026-07-13 実装反映・レビュー指摘2対応)
- limits.yamlの実接続(**境界はすべて>=(到達で停止・拒否)**):
  - `daily.max_generated_posts`(3。通常運用1)→ createPostで拒否
  - `approval_queue.soft_cap`(5)→ 到達で生成を自動停止(generation_paused)
  - `daily.max_est_output_chars` → usage_records追加直後に日次合計を再集計し、**同じ成功トランザクション内で停止を保存**(その日最後のタスクで超過しても停止が残る)。タスク作成時にも事前チェック
  - `daily.max_research_fetches` → source登録(addSource)で拒否(重複返却は消費しない)
  - `daily.max_heavy_escalations` → heavy昇格記録(company escalate)で拒否
  - `daily.max_agent_launches`(新設)→ タスク起動(startedイベント)で拒否
- 停止(generation_paused)は**代表者がUIから再開するまで日付をまたいでも維持**。理由はオフィスのバナー・pipeline・日報に表示
- 自動停止の保存は生成トランザクションの外(または成功トランザクションの中)で行い、失敗ロールバックで停止が消えないようにする
- これらはすべてMaxプラン枠内の推定量に対する運用ブレーキであり、API課金の発生・計測ではない(APIは引き続き既定で無効)
