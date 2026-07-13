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
