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

---

## V5.2: 公開画像URL連携(Vercel Blob)+ dry-run(2026-07-16)

### 目的
Meta公式APIは「Metaが取得できる公開HTTPS URL」の画像を要求する。V5.2では、**全ゲート通過済みのexport bundleの確定画像だけ**を公開ストレージへ配置し、実投稿せずに投稿予定内容を確認するdry-runを提供する。**META_PUBLISH_MODE=disabled は維持**され、実投稿は行われない。

### 構成(port/adapter)
- `src/adapters/storage/media-storage.ts` — ストレージport(interface)+ 公開URL安全検証(HTTPSのみ・localhost/file/data/javascript拒否・トークン混入検査)
- `src/adapters/storage/vercel-blob.ts` — Vercel Blob adapter(REST API直叩き・SDK依存なし・fetch注入可能)。**将来S3へ移行する場合は同じportを実装した`s3.ts`を追加し、use-case側のdeps.storageを差し替えるだけ**
- `src/adapters/instagram/media-upload.ts` — `uploadPostMedia`(owner専用use-case)
- DB: `post_media_uploads`(migration #10。postId/画像順/SHA-256/公開URL/provider/日時)

### 環境変数
| 変数 | 用途 |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel BlobのRead/Writeトークン(**コミット禁止**。.envのみ) |
| `META_PUBLISH_MODE` | 既定`disabled`を維持。dry-runはこの値を変更しない |
| `META_GRAPH_API_VERSION` / `META_IG_USER_ID` / `META_ACCESS_TOKEN` | 公式API設定(dry-runでは設定有無だけを表示) |
| `META_MEDIA_BASE_URL` | (代替)静的ホスティング利用時のURL基点。media-upload利用時は不要 |

### Vercel Blob設定手順(代表者)
1. https://vercel.com → 対象プロジェクト(なければ無料Hobbyで作成)→ **Storage → Blob → Create Store**
2. **Read/Writeトークンを発行**し、ローカルの `.env` に `BLOB_READ_WRITE_TOKEN=...` を追記(.envはgitignore済み)
3. `pnpm company instagram-readiness` で `storageConfigured: true` を確認

### アップロード手順と安全ゲート
```bash
pnpm company media-upload --post <postId> --actor owner
```
次を**すべて**満たす投稿だけがアップロードできる(UI/CLI/APIどの経路でも同じcore検査):
代表者承認済み(exported) / 最新内容QA pass / 紫苑visual QA pass / render↔copy整合 / テンプレ版承認+fingerprint一致+design QA pass / 権利有効 / bundle実在 / 画像全存在・枚数spec一致・PNG・1080×1350・**SHA-256がexport時と一致** / caption存在 / 禁止表現・顧客権利の再検査。
- 保存先: `instagram/<postId>/<連番>-<sha256先頭16>.png`(content-addressed)
- 同一hashは既存URLを再利用(重複アップロードなし)。再実行は冪等
- DB記録は全アップロード成功後に1トランザクション。**外部成功後にDB保存が失敗した場合**は、キーが決定的なため再実行すれば同じURLへ再収束する(補償方針)

### dry-run手順
```bash
pnpm company instagram-dry-run --post <postId> --actor owner
```
- **Metaへメディア作成・投稿・公開リクエストを一切送信しない**(何度実行しても投稿されない。テストで保証)
- 確認内容: ユーザーID/トークン設定有無・公開URL(全HTTPS・Meta取得可能)・画像順/枚数・caption・CTA・タイトル・テンプレ版/fingerprint・内容/visual/design QA・権利・Graph API版・mode=dry_run・apiCalled=false
- 結果は監査ログへ記録(トークン・Authorization・秘密情報は保存しない)
- UI: /publish の「dry-runを実行」でも同じ(「Instagramにはまだ投稿されていません」を明示)

### 障害時の停止・公開URL失効時の対応
- 停止: `.env` から `BLOB_READ_WRITE_TOKEN` を除去すれば、アップロードは外部通信前に停止する(既定で安全側)
- 公開URLを失効させたい場合: Vercelダッシュボード → Storage → Blob から該当ファイルを削除。DB記録が残っていても、次回media-upload時に再アップロードされる。削除後にdry-runを再実行してURL到達性を再確認すること
- Blob側を全消しした場合も、export bundleが正なので `media-upload` の再実行だけで復旧する

### 実投稿を有効にする前の代表者確認項目(V5.3以降)
1. dry-run結果(画像順・caption・URL)を全件確認した
2. `pnpm company instagram-readiness` で liveReady に必要な不足項目が0である
3. Metaデベロッパー設定(アプリ・Instagram Login・権限)を代表者自身が確認した
4. 初回は捨て投稿でのテストを行い、即削除できることを確認した
5. `META_PUBLISH_MODE=live` への変更は代表者が.envを手動編集する(AI・自動処理は変更しない)
