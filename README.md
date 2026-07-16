# Bloom-L AI Company

Bloom-L のInstagram運用をAI社員が支援するローカルファーストアプリ。
設計書は [docs/README.md](docs/README.md)(2026-07-13 代表者承認済み)。

**現在の実装状況: V4完了(MVP仕上げ)。** 投稿生成→QA→承認→書き出し→手動投稿→投稿済み記録→実績入力→週報/月報/議事録→バックアップまでを、代表者が1日約30分・ローカルで安全に運用できる。E2E(Playwright+axe)/秘密情報スキャン/バックアップ復旧を含む。

## 必要環境

- macOS / Node.js 24+ / pnpm 9(`corepack enable pnpm`)
- Claude Code(AI実行はClaude Codeセッション内。アプリ自体はAPIキー不要・追加費用0円)
- E2Eを動かす場合のみ Chromium(初回だけ `pnpm e2e:install`)

## セットアップと起動

```bash
pnpm install
pnpm company init          # DB初期化+組織シード(実運用)
# または動作確認用:
pnpm company seed --demo   # 架空のデモデータ(全画面に「デモデータ」バナー表示)

pnpm dev                   # http://localhost:3000 でオフィスを表示
```

## 代表者の1日(約30分)

1. `pnpm dev` でダッシュボード起動(初回のみ。常駐でよい)
2. Claude Codeでこのリポジトリを開き `/kickoff`(始業。日報生成→バックアップ→run終了まで自動)
3. ブラウザで確認・操作(いずれも代表者のみ):
   - **承認**(`/approvals`): QA合格投稿の承認 / 却下 / 修正依頼
   - **公開準備**(`/publish`): 承認済みを **書き出し(export)** → `data/workspace/05_generated-posts/<日付>_<postId>/` のPNG+キャプションを見て **手動でInstagram投稿** → 「投稿済みにする」を記録
   - **実績入力**(`/publish`): 3日後・7日後にリーチ等の数値を入力(未取得欄は空のままでよい。0で埋めない)
   - **週次会議**(Claude Codeで `/weekly-review`): 集計→議事録保存。`/meetings` で閲覧
   - **設定**(`/settings`): 週の投稿目標・作業時間などの運用設定

> Instagramへの自動投稿・予約投稿・DM送信は**実装していない**。公開は必ず人間が手で行う。

## company CLI(エージェント/運用の唯一のDB書き込み経路)

```bash
# 日次オーケストレーション(/kickoff が使う)
pnpm company run-start                 # 日次run開始(前回異常終了の検出・回収)
pnpm company plan-commit --file p.json # タスク一括作成(冪等)
pnpm company start --task <id>
pnpm company submit --task <id> --file content.json   # Zod検証→成果物登録→完了
pnpm company fail --task <id> --error "理由"          # リトライ上限2回、超過でfailed
pnpm company daily-report              # 日報(通常コード集計)
pnpm company run-finish --run <id>

# レポート・会議(V4-C。数値はAIでなく通常コードが集計)
pnpm company weekly-report  [--date YYYY-MM-DD]   # 週報(投稿10本未満は統計的断定なし)
pnpm company monthly-report [--date YYYY-MM-DD]   # 月報
pnpm company meeting-save --file minutes.json --actor owner  # 代表者が決定事項を含む議事録を保存

# 書き出し・公開記録(V4-B。代表者のみ。CLIは owner 実行を明示)
pnpm company export --post <id> --actor owner          # 承認済み → 書き出し(整合性・QA・権利を再検査)
pnpm company publish-record --post <id> --actor owner  # 投稿済み記録 → 3日/7日後の実績入力タスク作成

# バックアップ・復旧(V4-E)
pnpm company backup       [--date YYYY-MM-DD]   # 整合スナップショット+workspace+SHA-256 manifest(14世代)
pnpm company backup-list                        # 一覧(checksum整合つき)
pnpm company restore --from YYYY-MM-DD          # 検証→doctor→atomic置換(復元前に自動バックアップ)

# 診断
pnpm company doctor                      # 読み取り整合検査(FK・書き出し先・バックアップ有無など)
pnpm company status                      # 会社状態JSON
```

> 承認・却下・公開許可の記録・生成停止の解除・書き出しの実行主体は**代表者**。エージェント/オーケストレーターはこれらをCLIから実行できない(actorガードで拒否)。

## 検証

```bash
pnpm test          # 単体・統合テスト(リデューサ/状態遷移ガード/冪等性/書き出し/復旧/レポート)
pnpm typecheck     # ルート+ダッシュボードの厳格型チェック
pnpm build         # 本番ビルド
pnpm check:secrets # 秘密情報スキャン(APIキー・トークン・秘密鍵の混入検査)
pnpm e2e:install   # 初回のみ: E2E用Chromium取得
pnpm e2e           # E2E(Playwright+axe)。一時DB/workspace/専用ポートで隔離。実データを触らない
```

運用手順(バックアップ・復元・トラブル対応)は [docs/21-local-operations-runbook.md](docs/21-local-operations-runbook.md)。

## 設計上の不変条件(抜粋、詳細は docs/IMPLEMENTATION_HANDOFF.md §5)

- 実イベントのない社員を「作業中」と表示しない。進捗率(%・プログレスバー)は実装しない
- heartbeatが10分途絶えたrunningタスクは「状態不明」表示に落とす
- DB書き込みは company CLI / 承認系ユースケースのみ。全入力はZod検証
- `task_events` / `audit_log` はappend-only(UPDATE/DELETE禁止)
- 公開経路は「QA合格 → 代表者承認 → export → 人間の手動投稿 → published記録」のみ
- Instagram自動投稿・予約投稿API・DM送信は存在しない(公開は人間のみ)
- 数値集計・権利判定・承認判定・ファイル整合性判定はAIに委ねず通常コードで行う
- 秘密情報はコミットしない(`.env.example`のみ管理、`data/` `runs/` はgitignore)
