# 12. Instagram・外部サービス連携

> **V5追補(2026-07-15):** Instagram Login経由の公式API公開アダプターを実装した。既定は`disabled`、設定確認時は`dry_run`、実投稿は代表者が`live`を明示した場合のみ。詳細は[25-v5-instagram-official-publishing.md](25-v5-instagram-official-publishing.md)。MVP当時の手動経路はフォールバックとして維持する。

## 1. Instagram運用(MVP=手動)【確定§12・§18】

### 手動投稿フロー
1. 承認済み投稿を書き出し(export_bundle)
2. 代表者がスマホ(またはMeta Business Suiteの予約投稿画面)で投稿
   - AirDrop/共有フォルダで画像転送、caption.txtをコピペ、checklist.mdに従いタグ・位置情報を設定
3. UIで「投稿済みにする」を記録(published)
4. 3日後・7日後に実績値(リーチ・保存・プロフィール閲覧・DM数)を手動入力 → post_metrics

### 予約投稿(手動の範囲)
- Meta Business Suite / Instagramアプリの公式予約機能が使えるアカウント種別なら、代表者の手動操作での予約を推奨(checklist.mdに手順記載)。これはAPI連携ではないため追加確認不要

## 2. Meta Graph API連携(V5で安全な公開経路を実装、外部設定・実機確認は未完了)

### 前提条件(初期セットアップ時に確認する項目【確定§12】)
- [ ] アカウント種別(ビジネス/クリエイター) — Instagram Login経路はプロアカウントが対象
- [ ] Instagram Login用Metaアプリ・必要権限(`instagram_business_basic` / `instagram_business_content_publish`)
- [ ] Meta Business Suiteへのアクセス
- [ ] Meta開発者アカウント・アプリ作成の可否

### 移行条件【D-12推奨】(すべて満たしたら着手)
1. 手動運用30日以上継続(投稿12本以上)
2. 承認フローの運用が安定(無承認公開インシデント0)
3. アカウント要件の確認完了(Q1回答時点では不明のため、第2段階冒頭の確認項目)
4. 代表者がAPI利用(無料だがMetaアプリ審査等の手間)を承認

### 連携時の設計(SnsPort)
```ts
interface SnsPort {
  export(post): ExportBundle;            // MVP実装: ManualExportAdapter
  publish?(post): Result;                // V5: MetaInstagramClient(承認・export済みのみ)
  fetchMetrics?(postRef): Metrics;       // 将来: インサイト自動取得
}
```
- APIでも**承認済み投稿のみ**送信可能(承認チェックはcore層で強制、アダプターでは回避不能)
- トークンは `.env`(ローカル)保管。Gitへコミットしない【確定】

## 3. Google Drive(第2段階)【確定§12の構造をローカル先行】

- MVP: `data/workspace/` に §12 と同一の論理構造(01_brand〜07_customer-permissions)を実装
- StoragePort経由でアクセスし、将来 `DriveStorageAdapter`(googleapis + OAuth)へ差し替え
- 移行時は「Driveを正・ローカルをキャッシュ」とする同期方針(競合は更新時刻の新しい方+監査ログ)
- 週次バックアップzipのDriveアップロードを最初のDrive連携ユースケースにする(読み書きが単純)

## 4. 通知(NotifyPort)

| 段階 | 実装 | 備考 |
|---|---|---|
| MVP | DashboardNotifyAdapter(UI内通知+kickoff末尾サマリー) | Q3で確定(2026-07-13)。追加費用0・実装小 |
| 第2段階 | MailNotifyAdapter(Gmail) | Q3で確定: **Gmail API + OAuthを第一候補。SMTP+アプリパスワードは原則使用しない** |
| 将来候補 | LINE Notify後継/LINE公式アカウント | 名前のみ予約。設計しない |

通知イベント: 承認待ち発生 / タスク失敗 / 予算停止 / 週報完成 / 権利確認要求

## 5. その他SNS(将来)【確定§6の優先度に従う】

- Threads / Facebook: export_bundleの再利用(キャプション長の調整のみ)を第2段階の低コスト拡張として設計余地を残す
- Googleビジネスプロフィール: 地域検索の受け皿。HP完成後に「投稿」機能への転載を検討
- TikTok / YouTube Shorts: 縦型動画の型確立後。本設計では対象外
