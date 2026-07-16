# 11. コンテンツ生成パイプライン

## 1. 全体像

```
sources/実績素材 → 企画(昊) → コピー(琴葉) → carousel_spec(紬)
   → 【通常コード】レンダラー(Satori+Sharp) → PNG群 + 自動検査
   → QA(紫苑: AI視覚確認含む) → 承認 → export_bundle → 手動投稿
```

AIが作るのは**構造化データ(JSON)まで**。ピクセルを作るのは決定的な通常コード【§19】。同じspecからは常に同じ画像が生成される(再現性・差分レビュー可能)。

## 2. 画像生成方式の決定【D-09。比較はDECISIONS.md】

- **第一候補: Satori(JSX→SVG)+ Sharp(SVG→PNG)**
- フォールバック: Playwright(HTML→スクリーンショット)。SatoriのCSSサブセットで表現できないテンプレートが必要になった場合のみ
- Canva: 補助用途(特殊な単発ビジュアルを代表者が手動作成)【確定: 無料プラン・必須にしない】

## 3. テンプレートシステム

### 3.1 テンプレート定義
- `src/core/templates/{id}/` に Reactコンポーネント(Satori互換サブセット)+ スロット定義(Zod)
- 初期テンプレート5種【推奨】(MVP必須は tpl-howto / tpl-news / tpl-portfolio の3種。残り2種は余裕があれば → `17`):
  | ID | 用途 | ページ構成 |
  |---|---|---|
  | tpl-howto | 課題解決カルーセル(柱⑥③) | 表紙+本文4-7+CTA |
  | tpl-news | ニュース解説(柱①④) | 表紙+要点3+出典+CTA |
  | tpl-portfolio | 実績紹介(柱⑤) | 表紙+Before/After+工夫+CTA |
  | tpl-checklist | チェックリスト | 表紙+項目+CTA |
  | tpl-faq | FAQ | 表紙+Q&A×3+CTA |
- 全テンプレート共通: ブランドトークン(色・ロゴ位置)/ セーフエリア(端64px)/ 最終ページCTA(DM誘導)固定
- 出力: 1080×1350(4:5)PNG【推奨: フィードとプロフィールグリッドの両立。ストーリーズ用1080×1920は第2段階】

### 3.2 スロット制約(文字切れ防止の第一層)
```ts
// 例: tpl-howto の本文ページ
const HowtoBodySlot = z.object({
  heading: z.string().min(4).max(22),      // 全角基準の実測上限
  body: z.string().max(84),
  pageNo: z.number().int().min(1).max(9),
});
```
- 上限値は実フォント(Noto Sans JP)での実測により決定し、テンプレートとセットで版管理
- コピー生成時点(琴葉)でこのスキーマ検証 → 超過はレンダリング前に差し戻し

### 3.3 レンダリング時検査(第二層・通常コード)
1. Satoriのレイアウト結果から各テキストノードの行数・オーバーフローを検出(セーフエリア逸脱=エラー)
2. 出力PNGの解像度・ページ数・ファイルサイズ検証
3. ページ間一貫性: 同一テンプレート・同一トークンで全ページ生成されているかをspecレベルで検証
4. NG時: `render_failed` イベント+琴葉への短縮タスク自動生成(→06)

### 3.4 視覚QA(第三層・AI)
- 紫苑が生成PNGを読み取り、チェック: 文字切れ・不自然な改行・ロゴ欠け・誤字(画像上)・視認性
- 判定は最新の`post_renders.visual_qa_json`に項目別記録する。PNGを実際に確認できない場合は`pass`にしてはならない
- `visual_qa.result=pass`を記録してから内容QAを`pass`にできる。どちらかが未実施・failなら承認キュー・書き出しへ進めない
- 記録コマンド: `pnpm company post-visual-qa --post <postId> --file <visual-qa.json> --actor shion`

## 4. フォント・素材

- フォント: Noto Sans JP(OFL)をリポジトリ同梱(サブセット化してサイズ削減)【仮定AS-7】
- ロゴ・ブランドカラー: `data/workspace/01_brand/` 配置後に `config/brand-tokens.json` へ登録。未配置時はプレースホルダーで生成し、QAが「ブランド未適用」警告を付ける
- 写真・スクリーンショット: 許可記録済みの実績素材と代表者提供素材のみ。外部画像の転載禁止【確定】

## 5. その他形式の生成

| 形式 | MVP | 方式 |
|---|---|---|
| カルーセル | ○ | 上記パイプライン |
| キャプション+ハッシュタグ | ○ | テキスト(export_bundleに.txt同梱) |
| 短尺動画台本・字幕案 | ○(台本まで) | Markdown台本+絵コンテ(撮影・編集は代表者/第2段階で自動化検討) |
| HPスクロール動画 | △第2段階 | Playwrightで実サイトを録画(自社・許可済み実績のみ)【推奨】 |
| 図解・チェックリスト画像 | ○ | tpl-checklist流用 |

## 6. export_bundle(書き出し)【MVP成果物§18-5】

```
data/workspace/05_generated-posts/{post-id}_{slug}/
├── 01.png … 07.png        # カルーセル(投稿順)
├── caption.txt             # キャプション+ハッシュタグ(コピペ用)
├── checklist.md            # 手動投稿チェックリスト(投稿手順・タグ付け・位置情報)
└── meta.json               # post_id・承認記録・出典・使用素材と許可への参照
```

- 承認済み(approved)のみ書き出し可能。書き出しはaudit_logに記録

### V3追補(2026-07-13 実装反映)
- テンプレートレジストリ(`src/core/templates/index.ts`)導入。templateIdから通常コードでレンダラー・スロット・期待ページ数を解決(CLIへの分岐直書き禁止)
- **tpl-news**: 表紙→事実→Bloom-Lの見解(分離ラベル)→事業者への影響→出典+CTA(5ページ)。出典はDB登録済みsourcesから通常コードが注入(確認済みsource必須)
- **tpl-portfolio**: 表紙→課題→対応→成果→技術+CTA(5ページ)。表示名(実名/匿名)は公開許可のscopeから通常コードが決定。未許可はレンダリング前に拒否
- carousel_specはtemplateId判別union+`sourceCopyArtifactId`(不変ID)でQA整合性ゲートに接続
