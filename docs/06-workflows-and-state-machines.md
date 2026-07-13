# 06. ワークフローと状態遷移

## 1. 状態モデルの原則【確定§19】

- タスク(作業単位)・投稿(成果物のライフサイクル)・承認(代表者の判断)は**別エンティティ・別状態機械**
- すべての遷移は `task_events` / `audit_log` に追記され、UIはイベントから状態を再現できる
- キャラクター演出状態は実状態から**導出**する別データ(→ `10`)。逆方向の依存はない

## 2. タスク状態遷移

```mermaid
stateDiagram-v2
    [*] --> pending: 作成
    pending --> queued: 実行計画に採用
    queued --> running: エージェント起動
    running --> done: 成果物登録+検証OK
    running --> failed: エラー(リトライ2回超)
    running --> budget_paused: 利用量しきい値超過
    queued --> cancelled: 代表者/社長補佐が取消
    running --> cancelled: 停止操作
    failed --> queued: 翌日再計画(回数上限あり)
    budget_paused --> queued: 代表者が再開
    done --> [*]
    cancelled --> [*]
```

- `running` はハートビートイベント(進捗記録)を伴う。**最終イベントから10分無更新なら UI は「状態不明(停止の可能性)」と表示**し、「作業中」を出し続けない【§13信頼性】
- 進捗率は表示しない。表示するのは「現在の段階(例: 3/5 コピー作成中)」のみ — 段階はイベントに実記録があるものだけ【§13】

## 3. 投稿ライフサイクル

```mermaid
stateDiagram-v2
    [*] --> idea: 企画採用
    idea --> drafting: コピー/デザイン制作中
    drafting --> qa_review: 成果物一式そろう
    qa_review --> awaiting_approval: QA合格
    qa_review --> drafting: QA差し戻し(理由必須)
    awaiting_approval --> approved: 代表者承認
    awaiting_approval --> rejected: 代表者却下(理由記録)
    awaiting_approval --> revision_requested: 修正依頼
    revision_requested --> drafting: 修正タスク生成
    approved --> exported: 投稿用ファイル書き出し
    exported --> published: 代表者が手動投稿し「投稿済み」を記録
    published --> measured: 実績値入力(3日後/7日後)
    rejected --> [*]: アーカイブ(理由は学習用に保持)
    measured --> [*]
```

- `awaiting_approval` へ入れるのは QA 合格のみ【§14】。権利確認未了(顧客同意なし等)の投稿は QA が `blocked_rights`(警告付き差し戻し)にする
- 承認・却下・修正依頼は必ず `approvals` + `audit_log` に記録【§17】

## 3b. 承認リクエスト状態遷移(承認エンティティ単体)

投稿とは別エンティティとして、承認リクエスト自体の状態を管理する【§19: 承認を別エンティティとして扱う】。

```mermaid
stateDiagram-v2
    [*] --> open: QA合格で承認リクエスト生成
    open --> decided_approved: 代表者が承認
    open --> decided_rejected: 代表者が却下(理由必須)
    open --> decided_revision: 代表者が修正依頼(指示必須)
    open --> withdrawn: 対象投稿のキャンセル/権利ブロック発覚で取り下げ
    decided_revision --> [*]: 修正後は新しい承認リクエストを生成(旧決定は不変)
    decided_approved --> [*]
    decided_rejected --> [*]
    withdrawn --> [*]
```

- 決定済みレコード(`approvals`)は不変(append-only)。修正後の再提出は**新規リクエスト**となり、判断履歴が版として残る
- `open` のまま7日経過した場合は日報で「滞留」警告(自動承認・自動失効はしない)

## 4. 日次始業ワークフロー(§14-1)

```mermaid
sequenceDiagram
    actor 代表 as 代表者
    participant CC as Claude Code(/kickoff)
    participant AOI as 葵(社長補佐)
    participant AG as 担当AI社員(順次)
    participant DB as SQLite(イベントログ)
    participant UI as ピクセルオフィスUI

    代表->>CC: /kickoff 実行
    CC->>DB: run開始イベント
    CC->>AOI: 起動
    AOI->>DB: 未完了・失敗・承認待ちタスク照会
    AOI->>DB: 本日の実行計画(優先順位)を登録
    loop 計画されたタスクごと(順次)
        AOI->>AG: 必要な担当だけ起動(共有コンテキスト付き)
        AG->>DB: running/進捗/成果物イベント追記
        AG->>DB: 成果物(スキーマ検証済み)登録
    end
    AOI->>AG: 紫苑(QA)起動
    AG->>DB: QA結果登録(合格分のみ awaiting_approval へ)
    AOI->>DB: 日報生成・run終了イベント
    UI->>DB: ポーリング(実状態を反映)
    代表->>UI: 承認・却下・修正依頼
    UI->>DB: approvals + audit_log 記録
```

**例外フロー**
| 例外 | 挙動 |
|---|---|
| 前日runが異常終了(終了イベントなし) | kickoff冒頭で検出 → 残タスクを `failed` 化して再計画。UIに「前回異常終了」を明示 |
| 承認待ちが5件以上滞留 | 生成系タスクをスキップし、日報で代表者に承認を依頼(在庫過剰の防止) |
| エージェント失敗(リトライ2回超) | タスク `failed`+理由記録。翌日再計画は最大2営業日分まで、超えたら「要代表者判断」 |
| 利用量しきい値超過 | 以降の生成タスクを `budget_paused`。UIの該当社員は「予算停止」部屋へ |
| 代表者が数日起動しない | 何も起きない(壊れない)。次回kickoffで期限切れ企画をカレンダー再配置 |

## 5. 投稿制作ワークフロー(§14-2)

```mermaid
sequenceDiagram
    participant RIN as 凛(リサーチ)
    participant REN as 蓮(戦略)
    participant SORA as 昊(企画)
    participant KOTO as 琴葉(コピー)
    participant TSU as 紬(デザイン)
    participant CODE as レンダラー(通常コード)
    participant SHION as 紫苑(QA)
    actor 代表 as 代表者

    RIN->>RIN: 情報源・実績素材の取得と記録(出典必須)
    RIN->>REN: sources / 素材サマリー
    REN->>SORA: 週次方針・採用判定
    SORA->>KOTO: 投稿企画(テーマ・構成・CTA)
    KOTO->>TSU: 確定文言(スキーマ検証済み)
    TSU->>CODE: carousel_spec(JSON)
    CODE->>CODE: Satori+Sharpで PNG 1080×1350 生成+文字あふれ検査
    CODE->>SHION: 画像+文言+出典+許可記録
    SHION->>SHION: 事実/誤字/ブランド/著作権/権利チェック
    SHION->>代表: 合格分のみ承認キューへ
    代表->>代表: 承認 → 書き出し → 手動投稿(または予約投稿画面)
    Note over 代表,SHION: 投稿3日後・7日後に代表者が実績値をUIへ入力 → 湊(分析)が集計・改善提案
```

**例外フロー**: 文字あふれ→琴葉へ短縮タスク自動生成 / 出典欠落→企画段階で自動リジェクト / 許可記録なしの顧客素材→`blocked_rights` / レンダラー失敗→タスクfailed(AIは関与しない領域のため通常のバグとして扱う)

## 6. DM支援ワークフロー(§14-3)【第2段階 — 2026-07-13のスコープ変更によりMVPでは実装しない。設計のみ維持】

```mermaid
sequenceDiagram
    actor 代表 as 代表者
    participant UI as UI(DM支援画面)
    participant MASK as マスキング処理(通常コード)
    participant HINA as 陽葵(顧客対応)
    participant DB as SQLite

    代表->>UI: DM本文を貼り付け(取り込み)
    UI->>MASK: 電話番号・メール等を自動マスク
    MASK->>DB: 取り込みレコード(Q5確定: AI処理後に原文破棄、要約・分類・対応状況のみ保存)
    UI->>HINA: 分析依頼(次回kickoff時 or 手動「今すぐ」)
    HINA->>DB: 要約・分類・見込み度・緊急度・不足質問・返信案2案
    代表->>UI: 返信案を編集・コピー
    代表->>代表: Instagramアプリで手動送信
    代表->>UI: 「送信済み」を記録(対応状況の追跡)
```

**例外**: 分類不能→「代表者直接確認」で最優先表示 / 見積もり依頼を含む→返信案には価格を書かず「代表者から回答」定型を挿入(AIが価格を確定しない【確定】)

## 7. 実績素材→投稿化ワークフロー

1. 代表者がUIから実績を登録(顧客名・URL・画面・ハイライト・**公開許可状態**)
2. 許可状態が「記録済み」の項目のみ、昊が複数投稿(完成紹介/課題/工夫/スマホ対応/技術/工程/価値【§7】)へ展開する企画タスクを生成
3. 以降は投稿制作ワークフローに合流

## 8. 承認オペレーション(代表者の30分)

| 時間 | 操作 |
|---|---|
| 〜5分 | kickoff実行、日報サマリー確認(前日実績値の入力依頼があれば入力) |
| 〜20分 | 承認キュー処理: プレビュー(画像+キャプション+QAレポート+出典)を見て 承認/却下/修正依頼(理由テンプレート選択+自由記述) |
| 〜30分 | 承認済みを書き出し→Instagramへ手動投稿 or 予約設定。DMがあれば代表者が手動対応(AI返信案は第2段階) |
