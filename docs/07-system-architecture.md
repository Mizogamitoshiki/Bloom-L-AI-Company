# 07. システムアーキテクチャ

## 1. システムコンテキスト図

```mermaid
graph LR
    subgraph Mac["代表者のMac(ローカル)"]
        CC["Claude Codeセッション<br/>(エージェント実行環境・Maxプラン枠)"]
        APP["Next.jsアプリ<br/>(ピクセルオフィスUI+承認)"]
        CLI["company CLI<br/>(検証+イベント追記)"]
        DB[("SQLite<br/>イベントログ+状態")]
        FS[/"ローカル素材フォルダ<br/>(Drive同一構造)"/]
    end
    代表者((代表者)) -->|/kickoff・承認・素材登録| Mac
    CC --> CLI --> DB
    APP <--> DB
    CC <--> FS
    APP <--> FS
    CC -->|Web検索/閲覧(公式機能)| WEB[公開Web情報]
    代表者 -->|書き出しファイルを手動投稿| IG[Instagram]
    代表者 -.将来.-> DRIVE[(Google Drive)]
    APP -.将来アダプター.-> META[Meta Graph API]
```

- **アプリはAI認証情報を持たない**。AI実行はすべてClaude Codeセッション内(→ `09`)【D-03/D-04】
- Instagramへの経路はMVPでは人間のみ【確定】

## 2. コンポーネント図(モジュラーモノリス)【D-01】

```mermaid
graph TD
    subgraph app["apps/dashboard(Next.js App Router)"]
        UI1[オフィス画面]
        UI2[承認キュー/パイプライン]
        UI3["素材・実績/レポート/設定<br/>(DM支援は第2段階)"]
        API[Route Handlers(読み取り+承認系の書き込みのみ)]
    end
    subgraph core["src/core(ドメイン層・UIから独立)"]
        DOM[ドメイン型+Zodスキーマ]
        RED[イベントリデューサ(状態導出)]
        SVC[ユースケース(タスク計画/QA/承認/レポート)]
    end
    subgraph adapters["src/adapters(交換可能)"]
        ST[StoragePort: LocalFS → Drive]
        NT[NotifyPort: Dashboard → Mail/LINE]
        SNS[SnsPort: ManualExport → MetaAPI]
        AIP[AgentRunnerPort: ClaudeCode → AnthropicAPI]
        DBA[DB: SQLite → Postgres]
    end
    subgraph tools["scripts/(通常コード)"]
        CLI2[company CLI(イベント追記・検証)]
        REN[カルーセルレンダラー(Satori+Sharp)]
        BK[バックアップ/集計]
    end
    subgraph agents[".claude/(エージェント定義)"]
        SK[skills: kickoff 等]
        AG[agents: 社員9名の定義]
    end
    app --> core
    tools --> core
    core --> adapters
    agents -->|Bash経由で| CLI2
```

**依存方向の規則**: `core` は他へ依存しない。UI・CLI・エージェントは必ず `core` のスキーマとユースケースを通す(同一の検証を共有)。

## 3. リポジトリ構成【推奨】

```
Bloom-L-AI-Company/
├── docs/                      # 本設計書
├── apps/dashboard/            # Next.js(App Router)
├── src/core/                  # ドメイン型・Zod・リデューサ・ユースケース
├── src/adapters/              # storage / notify / sns / agent-runner / db
├── scripts/                   # company CLI・レンダラー・バックアップ(tsx実行)
├── .claude/
│   ├── skills/kickoff/        # 始業コマンド
│   └── agents/                # 社員定義(9ファイル)
├── config/
│   ├── model-profiles.yaml    # モデルルーティング(→14)
│   ├── brand-tokens.json      # ブランドカラー等(後から差し替え)
│   └── limits.yaml            # 利用量しきい値・リトライ上限
├── data/
│   ├── company.db             # SQLite(gitignore)
│   ├── backups/               # 日次バックアップ(gitignore)
│   └── workspace/             # §12と同一構造の素材フォルダ(gitignore)
│       ├── 01_brand/ … 07_customer-permissions/
├── runs/{YYYY-MM-DD}/         # 当日コンテキスト・ログ(gitignore)
└── .env.example               # 実値はコミットしない【確定】
```

## 4. 実行時の関係(2プロセス+CLI)

| プロセス | 起動 | 役割 | 認証情報 |
|---|---|---|---|
| Next.js(`pnpm dev`) | 代表者が起動(またはlaunchd自動起動【推奨】) | 表示・承認・素材登録・レポート | なし |
| Claude Codeセッション | 代表者が `/kickoff` | エージェント実行・成果物生成 | Maxプランのログイン(Claude Code管理) |
| company CLI | 上記から都度呼ばれる | Zod検証 → SQLiteへappend(WALモード) | なし |

- 同時書き込み: SQLiteはWALモード+CLIは短トランザクション。UIの書き込みは承認系のみで競合面が小さい
- UI更新: 2秒間隔のポーリング(SWR)【推奨: SSEより単純で、ローカルでは十分。D-07】

## 5. 設計原則との対応(§19)

| 原則 | 実現方法 |
|---|---|
| ローカルファースト | 全データがMac内。外部通信はWeb調査と(将来の)Drive/Metaのみ |
| モジュラーモノリス | 単一リポジトリ・単一Nextアプリ+coreモジュール分離。マイクロサービスなし |
| 通常コードを優先 | レンダリング・集計・マスキング・バックアップ・カレンダー計算はAI不使用 |
| 構造化+スキーマ検証 | 全成果物はZodスキーマ。CLIが検証してからDBへ |
| エンティティ分離 | 会社/部門/社員/タスク/成果物/承認/イベントを別テーブル(→ `08`) |
| イベントログから状態再現 | task_events append-only+リデューサ。スナップショットはキャッシュ扱い |
| 冪等性 | タスクに冪等キー(type+subject+date)。同一キーの再実行は既存成果物を返す |
| アダプター化 | 5ポート(Storage/Notify/Sns/AgentRunner/DB)をinterface定義、MVPはローカル実装 |
| クラウド移行可能 | ドメイン層無変更で、アダプター差し替え+DB移行(→ `18`) |
