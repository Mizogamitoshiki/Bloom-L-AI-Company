# Bloom-L AI Company

Bloom-L のInstagram運用をAI社員が支援するローカルファーストアプリ。
設計書は [docs/README.md](docs/README.md)(2026-07-13 代表者承認済み)。

**現在の実装状況: V1(基盤+ピクセルオフィス)完了。V2(kickoff・投稿生成・承認キュー)以降は未実装。**

## 必要環境

- macOS / Node.js 24+ / pnpm 9(`corepack enable pnpm`)
- Claude Code(AI実行はClaude Codeセッション内。アプリ自体はAPIキー不要・追加費用0円)

## セットアップと起動

```bash
pnpm install
pnpm company init          # DB初期化+組織シード(実運用)
# または動作確認用:
pnpm company seed --demo   # 架空のデモデータ(全画面に「デモデータ」バナー表示)

pnpm dev                   # http://localhost:3000 でオフィスを表示
```

## 日常運用(V2実装後の想定)

1. `pnpm dev` でダッシュボード起動(初回のみ)
2. Claude Codeでこのリポジトリを開き `/kickoff`(始業コマンド)
3. ブラウザで承認・却下・修正依頼(1日30分)

## company CLI(エージェント/運用の唯一のDB書き込み経路)

```bash
pnpm company run-start                 # 日次run開始(前回異常終了の検出・回収)
pnpm company plan-commit --file p.json # タスク一括作成(冪等)
pnpm company start --task <id>
pnpm company heartbeat --task <id> --stage "段階名"
pnpm company submit --task <id> --file content.json   # Zod検証→成果物登録→完了
pnpm company fail --task <id> --error "理由"          # リトライ上限2回、超過でfailed
pnpm company status                    # 会社状態JSON
```

## 検証

```bash
pnpm test        # 単体・統合テスト(リデューサ/状態遷移ガード/冪等性/回収)
pnpm typecheck   # ルート+ダッシュボードの厳格型チェック
pnpm build       # 本番ビルド
```

## 設計上の不変条件(抜粋、詳細は docs/IMPLEMENTATION_HANDOFF.md)

- 実イベントのない社員を「作業中」と表示しない。進捗率は表示しない
- heartbeatが10分途絶えたrunningタスクは「状態不明」表示に落とす
- DB書き込みは company CLI / 承認系ユースケースのみ。全入力はZod検証
- `task_events` / `audit_log` はappend-only
- Instagramへの自動投稿・DM自動送信は存在しない(公開は人間のみ)
- 秘密情報はコミットしない(`.env.example`のみ管理、`data/`はgitignore)
