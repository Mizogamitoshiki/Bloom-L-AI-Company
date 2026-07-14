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
