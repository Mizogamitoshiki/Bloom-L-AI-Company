# アセット・ライセンス台帳

素材のライセンス・生成元・利用条件の記録(確定§13)。新しい素材・フォント・アイコンを追加したら必ずここに追記する。

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| Noto Sans JP(woff, weight 400/700) | npmパッケージ `@fontsource/noto-sans-jp` v5(原著作: Google / Adobe, Noto Fonts) | SIL Open Font License 1.1 | 商用利用可・埋め込み可・再配布時はOFL全文保持。カルーセル画像生成(Satori)に使用。ファイルはnode_modules参照でリポジトリに同梱しない | 2026-07-13 |
| SVGアイコンセット(`apps/dashboard/components/icons.tsx`) | 本プロジェクトで自作 | プロジェクトに帰属 | 制約なし | 2026-07-13 |
| ピクセルアバター(`apps/dashboard/components/PixelAvatar.tsx`) | 本プロジェクトで自作(コード生成SVG) | プロジェクトに帰属 | プレースホルダー。将来差し替え時は新素材をここに記録 | 2026-07-13 |
| ブランドカラー(`config/brand-tokens.json`) | プレースホルダー(自作) | — | Bloom-L正式ブランドカラー配置後に差し替え | 2026-07-13 |
| 生成カルーセルPNG(`data/workspace/05_generated-posts/`) | 本システムが生成(Satori+Sharp+Noto Sans JP) | プロジェクトに帰属 | 外部画像・第三者素材は含まない(パイプライン上、取り込み経路なし) | 2026-07-13 |

## 禁止事項(docs/13)
- 出所不明の素材・ライセンス未確認のピクセルアート素材の使用
- 他者画像の無断転載(顧客素材は customer_permissions の記録がある場合のみ)

## ブランドマニフェスト(V3-K, 2026-07-13)

`data/workspace/01_brand/brand-manifest.json` を配置すると、**コード変更なしで**ブランド素材が読み込まれる(未配置時はプレースホルダーで動作)。スキーマは `src/adapters/config.ts` の `brandManifestSchema` が正。

```json
{
  "updatedAt": "2026-07-20",
  "rights": "ロゴ・カラーはBloom-L所有。第三者素材を含まない",
  "logo": { "file": "logo.svg", "usage": "カルーセル左上・最小24px" },
  "colors": { "primary": "#2f6f4f", "primaryDark": "#1e4a34", "accent": "#e8a13a", "surface": "#f6f3ec", "ink": "#22281f", "inkMuted": "#5c6357" },
  "fonts": [{ "name": "Noto Sans JP", "license": "SIL OFL 1.1" }],
  "rules": ["ロゴの変形・再配色禁止", "背景とのコントラスト4.5:1以上"]
}
```

- `colors` があれば brand-tokens.json より優先される(UI・カルーセル両方に反映)
- `rights`(権利情報)と `updatedAt` は必須。素材を差し替えたら必ず更新し、この台帳にも追記する
- 検証: `pnpm company doctor` がマニフェストの有無・ロゴ実在を確認する

## V3 UI Polish(2026-07-14)

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| 正式ロゴ `data/workspace/01_brand/logo.png`(+@2x) | 提供された正式デザインから抽出(AI描き直しなし・同一縦横比 約2.6:1 を維持) | Bloom-L所有 | サイドバー/トップバー左上。/api/brand/logo で配信。差し替えは同名・同縦横比で置換すれば**コード変更不要** | 2026-07-14 |
| ブランドカラー(brand-manifest.json colors) | 正式ロゴ画像からsharpでピクセルサンプリング(ロイヤルブルー #0b46b8 系) | Bloom-L所有 | primary/hover/soft/border 等のセマンティックトークンへ layout.tsx が注入。目視ではなく実測値 | 2026-07-14 |
| オフィス家具・スプライト(CSS/DOM生成) | 本プロジェクトで自作(CSS疑似要素+コード生成SVGアバター) | プロジェクトに帰属 | Canvas/Phaser/PixiJS不使用。DOM/CSSのみ | 2026-07-14 |

## V4(2026-07-14)

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| 成功色(success)の微調整 | brand-manifest.json / globals.css の `--color-success` を `#1f9d57` → `#157a41` に変更 | Bloom-L所有(同一グリーンの濃色シェード) | 白背景・薄緑背景の小さめ文字で **WCAG AA(4.5:1)** を満たすための最小変更。primary(ロイヤルブルー)等の他ブランド色は不変。axe critical/serious=0を担保 | 2026-07-14 |
| E2E/アクセシビリティ検証ツール | `@playwright/test`, `@axe-core/playwright`(devDependencies)+ Chromium(`pnpm e2e:install` でローカル取得。リポジトリに同梱しない) | Apache-2.0 / MPL-2.0 系(いずれも商用可・無料) | E2Eは一時DB/workspace/専用ポートで隔離。実データを触らない | 2026-07-14 |
| 生成物: 書き出しbundle(`data/workspace/05_generated-posts/<日付>_<postId>/`) | 本システムが生成(PNG+caption.txt+checklist.md+meta.json) | プロジェクトに帰属 | 顧客情報・秘密情報は meta.json に含めない(rightsStateのみ)。外部素材なし | 2026-07-14 |
| バックアップ(`data/backups/<日付>/`) | 本システムが生成(company.db スナップショット+workspace+SHA-256 manifest) | プロジェクトに帰属 | gitignore(`data/`)。14世代保持。外部送信なし | 2026-07-14 |

## V4.5 v2(2026-07-15 — 投稿デザイン品質v2)

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| ベクターアイコン(check/cross/arrow/warn) | 本プロジェクトで自作(SVG data URI) | プロジェクトに帰属 | フォント記号に依存しない描画。外部素材なし | 2026-07-15 |
| カルーセルcomponent追加(screen mock/timeline/before-after/info card) | 本プロジェクトで自作(Satori flexbox) | プロジェクトに帰属 | 抽象UI。実在サービス名・写真・AI人物は使わない | 2026-07-15 |
| ゴールデンプレビュー v2(`06_template-previews/<id>/v2/<variant>/`) | 本システムが生成(4系統×2variant・固定fixture・架空データ) | プロジェクトに帰属 | gitignore。各PNGに「架空データ」ラベルを合成し実在誤認を防ぐ。v1は保持。代表者承認まで公開不可 | 2026-07-15 |

## V4.5(2026-07-15 — 投稿デザイン品質)

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| Noto Sans JP 追加ウェイト(400/500/700/800/900 woff) | npm `@fontsource/noto-sans-jp` v5(Google / Adobe, Noto Fonts) | SIL Open Font License 1.1 | 商用可・埋め込み可。カルーセルのtype scaleに使用。node_modules参照でリポジトリ非同梱 | 2026-07-15 |
| 実ロゴのカルーセル埋め込み(`logo.png` / `logo@2x.png`) | 既存のBloom-L正式ロゴ(AI描き直しなし) | Bloom-L所有 | data URIで縦横比固定・埋め込み。文字代用しない。差し替えはlogo.png置換で反映(fingerprintが変わり再承認が必要) | 2026-07-15 |
| カルーセルcomponent・デザイントークン(`src/core/templates/`) | 本プロジェクトで自作(Satori flexbox。番号/チェック/比較表/端末モック/出典カード等) | プロジェクトに帰属 | 外部画像・第三者素材なし。写真・AI人物は使用しない | 2026-07-15 |
| ゴールデンプレビュー(`data/workspace/06_template-previews/`) | 本システムが生成(4系統×固定fixture・架空データ) | プロジェクトに帰属 | gitignore(`data/`)。代表者承認まで公開不可。contact sheet/overview含む | 2026-07-15 |

## V4.6(2026-07-15 — プレミアムAIオフィス)

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| オフィス全景 `apps/dashboard/public/office-v46/office-reference.png` | 代表者が提供したBloom-L AI Company参照デザインからのロスレス切り出し | Bloom-L所有・本プロジェクト内利用 | 情景レイヤーとしてのみ使用。画像内の文字・状態・数値は業務データとして参照しない。実状態はHTMLレイヤーを重ねる | 2026-07-15 |
| AI社員顔クロップ `apps/dashboard/public/office-v46/faces/*.png`(14点) | 代表者が提供した同参照デザインからのロスレス切り出し | Bloom-L所有・本プロジェクト内利用 | 50×50px、補間なしで表示。9社員と代表者のポートレートに使用し、未知IDは従来の自作SVGへフォールバック | 2026-07-15 |

## V4.6.1(2026-07-15 — 焼き込み画像の廃止)

| 資産 | 生成元 / 入手元 | ライセンス | 利用条件・備考 | 追加日 |
|---|---|---|---|---|
| オフィス床・部屋・家具(CSS/DOM生成) | 本プロジェクトで自作(CSSのみ。画像不使用) | プロジェクトに帰属 | 実データ駆動。人物・名前・状態・モデル・経過時間はすべて実DBから。架空データを表示しない | 2026-07-15 |
| `office-reference.png` | 代表者提供の参照デザイン | Bloom-L所有 | **不使用(表示・配信しない)**。仮名・偽状態・偽経過時間・偽モデルが焼き込まれ実在9名と矛盾するため廃止。faces クロップのみ歩行キャラの頭に使用 | 2026-07-15 |
