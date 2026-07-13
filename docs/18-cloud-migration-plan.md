# 18. クラウド移行計画(将来)

移行はローカル運用が安定し(§11)、成果が出てからの判断。**MVPはこの計画のためにローカルを複雑化しない**。移行時も同じドメインモデル・ワークフローを使う【確定】。

## 1. 移行トリガー(提案)

- 手動運用60日以上+DM相談が継続的に発生
- 「Macを開かない日もパイプラインを進めたい」「予約投稿の完全自動化をしたい」という明確な必要性
- API費用の月次予算が承認済み(Q2の枠を再設定)

## 2. 段階移行図

```mermaid
graph LR
    subgraph P0["現在: ローカルMVP"]
        L1[Next.js local] --- L2[(SQLite)] --- L3[Claude Codeセッション]
    end
    subgraph P1["段階1: ハイブリッド"]
        H1[Next.js on Vercel(閲覧・承認)] --- H2[(Turso/Neon)]
        H3[ローカルClaude Code(生成は従来通り)] --- H2
    end
    subgraph P2["段階2: フルクラウド"]
        C1[Vercel] --- C2[(Postgres/Neon)]
        C3[ワーカー(Anthropic API+スケジューラ)] --- C2
        C3 --- C4[Meta API予約投稿]
    end
    P0 --> P1 --> P2
```

- 段階1: 「外出先から承認だけできる」を最小コストで実現。生成はローカルのまま(API費用ゼロ維持可)
- 段階2: AgentRunnerを `AnthropicApiRunner` へ切替、スケジューラ(Vercel Cron等)で始業を自動化

## 3. 差し替え対応表(アダプター境界)【確定§11・§19】

| ポート | MVP実装 | クラウド実装候補 |
|---|---|---|
| DB | SQLite(Drizzle) | Turso(SQLite互換・移行容易)or Neon Postgres(Drizzle dialect切替+移行スクリプト) |
| Storage | LocalFS | Google Drive / S3 / Vercel Blob |
| AgentRunner | Claude Codeセッション | Anthropic API(モデルプロファイルはそのまま流用) |
| Notify | Dashboard | Gmail / LINE |
| Sns | ManualExport | Meta Graph API |
| スケジューラ | 代表者の/kickoff | Vercel Cron / GitHub Actions schedule |

## 4. 移行時に必須となるセキュリティ強化(§17で設計済みの残し)

- 認証(単一ユーザーでもOAuth/パスキー必須。actor列は実装済み)
- DB・ストレージの保存時暗号化、環境変数はVercel/AWSのシークレット管理
- 監査ログの改ざん耐性(append-only維持+定期エクスポート)
- テナント分離(将来、他社向けに提供する場合): tenant_id列追加を想定したID設計(ULID)済み

## 5. 移行手順(概略)

1. `company export --full` でDB+素材をエクスポート(バックアップ機構を流用)
2. Drizzleのdialect切替+スキーママイグレーション実行、データ投入、doctor整合確認
3. アダプターを環境変数で切替(コード変更なしが目標)
4. 並行運用1〜2週(ローカルを正)→ 切替(クラウドを正)→ ローカルはバックアップ役へ
