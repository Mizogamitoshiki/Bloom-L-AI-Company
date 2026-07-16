# 25. V5 Instagram公式API公開

基準日: 2026-07-15。V4.6で確定したオフィスデザイン、V4.5の投稿品質ゲート、V4の手動公開経路を維持したまま、Instagram公式APIの安全な公開経路を追加する。

## 実装範囲

- Instagram Loginを推奨経路とする公式Graph APIアダプター
- 画像1枚とカルーセル(2〜10枚)のコンテナ作成、準備完了確認、`media_publish`
- `disabled / dry_run / live`の3モード。既定は`disabled`
- `/publish`の接続状態、dry-run、代表者確認付き実投稿ボタン
- 公開直前のQA・権利・承認済みテンプレート・export bundle再検査
- `instagram_publish_jobs`による冪等性、外部公開結果の先行記録、監査ログ
- 通信結果が曖昧な場合は`needs_reconciliation`で停止し、自動再試行しない
- 手動投稿経路を常時フォールバックとして維持

## 外部設定

秘密値は`.env`にだけ設定し、コミットしない。

```dotenv
META_PUBLISH_MODE=disabled
META_GRAPH_API_VERSION=v23.0
META_IG_USER_ID=
META_ACCESS_TOKEN=
META_MEDIA_BASE_URL=https://media.example.com/bloom-l-instagram
```

`META_MEDIA_BASE_URL`は`data/workspace/05_generated-posts/<export bundle>/`を同じ相対構造で配信する公開HTTPS基点である。Metaはローカルファイルを読めないため、`localhost`やMac内のパスではliveにならない。

## 有効化手順

1. Instagramをビジネスまたはクリエイターのプロアカウントにする
2. MetaアプリでInstagram Loginとコンテンツ公開権限を設定する
3. 公開メディア用HTTPSホストへexport bundleのPNGを配置する
4. `.env`を`dry_run`にして`/publish`から全画像・caption・URL計画を確認する
5. 実アカウントで限定的な接続テストを行い、代表者が`live`へ変更する
6. 公開前は必ず画面の最終確認ダイアログで画像・文章・対象アカウントを確認する

## 状態と障害回復

`dry_run → publishing → remote_published → published`を記録する。Meta側の成功/失敗を断定できない通信エラーは`needs_reconciliation`とし、同じ投稿を再送しない。Instagramアプリで公開有無を確認し、DBを直接変更せず、今後追加する代表者専用の照合手順で解消する。

## V5に含めないもの

- AI社員による無承認公開
- バックグラウンドの日時予約デーモン
- DMの取得・返信・送信
- インサイト自動取得
- AWS/S3等のメディアホスト自動構築(接続先の設定境界まで)
- クラウド常時稼働

これらは実アカウントの運用確認後にV6以降で判断する。
