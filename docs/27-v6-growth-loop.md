# 27. V6 投稿後分析・CEO承認型改善ループ・Cron-ready基盤

**実装日: 2026-07-17。** V6はBloom-L AI Companyを「投稿を作るだけ」から「成果を学習しながら成長するAIマーケティング組織」へ進める基盤である。
**改善提案はAIの提案であり、会社方針の最終決定権は常にCEO(代表者)にある。**

## 1. 改善ループの全体像

```
投稿(公開) → 3日後・7日後の実績入力(代表者が/publishから手動転記)
  → 通常コードによる決定的集計(analysis snapshot。AIは数値を作らない)
  → 湊: snapshotの事実の読み上げ / 蓮: 改善仮説(improvement_proposal)
  → 紫苑+通常コード: evidence実在・断定表現の機械検査
  → CEO: /analytics で承認・却下・修正依頼(append-only判断履歴)
  → 承認済み・期限内の指示だけが次回/kickoffへ(最大3件・二重適用防止)
  → 適用投稿を記録 → 効果を再計測(同じsnapshot経路)
```

## 2. 分析ファクトの計算規則(V6-A。すべて通常コード)

- 正本は既存 `post_metrics`(3日/7日窓・NULL可)。**複製テーブルは作らない**
- 3日窓と7日窓は混ぜない(windowDaysごとに別ファクト)
- **未取得(null)と0を厳密に区別**する。欠損の0埋め・推定補完はしない
- 率は分母(reach)が正の数のときだけ計算: saveRate=saves/reach, shareRate, profileViewRate, dmStartRate, commentRate。reachがnull/0なら率もnull
- グループ比較(柱・形式・templateId・templateVersion・variant・CTA)は**中央値を主要表示**。平均は取得3件以上のときのみ参考表示
- 各グループに sampleCount / evidencePostIds / 指標別取得件数 / 欠損数 / exploratoryフラグ(10本未満)を必ず含む
- 計測済み10本未満: 「勝ち」「最強」「効果がある」「成功」等の断定禁止(通常コード`findForbiddenAssertions`が拒否)。10本以上でも因果断定(「〜のおかげで」等)は常に禁止
- 実装: `src/core/analytics.ts`(純関数)+ `src/adapters/db/analytics.ts`(収集・保存)

## 3. 分析スナップショット(V6-B)

- `analysis_snapshots`(migration #11): append-only。`(window_days, source_data_hash)`一意
- sourceDataHash = 入力データ(投稿+metrics+分類キー)+**JST業務日(asOfBusinessDate)**の正規化JSONのSHA-256。同一業務日・同一入力なら同じsnapshot(新規行を作らない)。入力または業務日が変わったときだけ追記
- snapshot_jsonは通常コードの出力のみ(AI生成文章を混ぜない)。asOfBusinessDateとevidencePostIdsから判定基準日・元投稿・計測窓を追跡可能

## 4. 改善提案とCEO判断(V6-C)

- `improvement_proposals`: analysisSnapshotId / authorEmployeeId / title / structuredFactRefs / 通常コード生成observation / hypothesis / evidenceRefs / testVariable(6種enumから1つ) / testChange / expectedSignal / proposedAction / risk / expiresAt
- 保存時の機械検査(fail closed): snapshot実在・structuredFactRefsの参照先と値の完全一致・evidenceRefs実在・actor/author整合・断定/因果表現の拒否・期限が過去日でない
- `improvement_decisions`: **append-only判断履歴**(approved/rejected/revision_requested/superseded)。現在状態はproposal単位の明示連番`decisionSequence`から決定し、同一ミリ秒でも一意。却下・修正依頼は理由必須
- **owner以外が承認を書き込める経路は存在しない**(core層`decideImprovementProposal`がactor=ownerを要求。UI/CLI/APIすべてこの1関数を通る)

## 5. kickoff接続(V6-E)

- `pnpm company improvement-directives` が返すのは「最新判断=approved かつ 期限内」だけ、**最大3件**
- rejected / revision_requested / superseded / 期限切れ / 未判断は構造的に含まれない
- 適用記録は `post_improvement_directives`(post_id, proposal_id一意)。**kickoff再実行でも二重適用しない**(冪等)
- 採用理由はpost_plan成果物の`appliedImprovements`(最大3件)にも残る
- 改善指示が0件でも従来どおりkickoffは動く。ブランドルール・公開ガード(QA/権利/承認)より優先しない。投稿頻度・予算は変更しない
- **適用後もCEOが承認しない限り投稿は公開されない**(既存の承認フローは不変)

## 6. AI社員の役割(V6-D)

| 社員 | V6の役割 | 禁止 |
|---|---|---|
| 湊(データ分析) | 通常コード生成のsnapshotだけを読み、事実と観察を分離して要約。欠損を明記 | 数値の再計算・補完、null→0扱い、10本未満の因果断定 |
| 蓮(CMO候補) | 湊の事実を根拠に改善仮説(柱×形式×CTA / template×variant×CTA単位・1変数) | 少数データからの勝者断定、価格・商品仕様・頻度・予算の変更 |
| 葵(AI社長室長候補) | 事実・観察・提案・CEO判断事項の整理、承認後の改善指示の管理 | 提案の決定扱い、承認前の提案をkickoffへ渡すこと |
| 紫苑(品質管理) | 仮説数値のsnapshot一致・evidence実在の確認、断定・誇張・因果断定の拒否 | QA合格を承認と混同すること |

AI社員はDBを直接触らない(company CLI経由のみ)。上記の検査は通常コード(`saveImprovementProposal`)も同じ基準で強制する。

## 7. 事業成果の手動記録(V6-G)

- `business_outcomes`: occurredOn / kind(inquiry|estimate|order) / source(instagram|referral|website|unknown) / relatedPostId(任意) / amountYen(任意・負数不可) / anonymizedNote(任意・匿名)
- **owner専用**(`pnpm company business-outcome-add --actor owner`)。UIは/analyticsのKPIに表示
- 顧客名・電話・メール・LINE ID・DM原文・URLなど**顧客を特定しうる文字列は通常コードが検出して保存を拒否**する
- データがない値は「未取得」と表示(0にしない)

## 8. Instagram Insights取得境界(V6-H)

- `MetricsSourcePort`(manual / instagram_insights)。**現行の正はmanual(代表者の手動転記)**
- `INSTAGRAM_INSIGHTS_MODE=disabled | dry_run | live`(既定disabled。不正値もdisabledへ)
- V6では取得実装なし: どのモードでも**Metaへ通信せず「未実装」を正直に返す**。必要permission・アカウント種別・アプリレビュー要否の公式確認が完了するまで実装しない(推測実装の禁止)
- permission追加・アプリレビュー開始・token更新はコードから行わない

## 9. Cron-ready基盤(V6-I。本番稼働はしない)

- 処理本体: `runScheduledAnalytics`(3日/7日スナップショットの冪等生成。決定的・Meta/AI/Blob不使用)
- ローカル検証: `pnpm company analytics-cron-dry-run`(**書き込みなし**)
- 入口: `GET /api/cron/analytics`
  1. `Authorization: Bearer ${CRON_SECRET}` をtiming-safe比較。**未設定・不一致は401**
  2. `VERCEL_ENV=production` 以外は**403(書き込み拒否)**
  3. Vercel上のSQLiteは**503 not_ready** / PostgreSQL未実装も**503 not_ready**
  → したがってV6時点では**どの環境でも書き込みへ到達しない**(fail closed)
- Cronから Claude Code・Maxプラン・AIサブエージェント・Meta投稿処理を呼ばない(処理本体に存在しない)
- **Vercel CronはUTCで実行される。** JST業務日は通常コード(`src/core/ids.ts`の+9時間変換)で扱う。例えばJST 07:00に動かす場合はUTC 22:00(前日)を指定する
- 設定例は `docs/examples/vercel-cron.example.json`(**無効なexample**。リポジトリ直下にvercel.jsonを置いていないため、デプロイしても自動有効化されない)

### なぜ本番有効化しないか

1. PostgreSQL実接続が未実装(SQLiteはVercelの永続DBに使えない)
2. Production owner認証が未実装(cloud mutationはfail closed)
3. Vercel本番デプロイ自体を行っていない(V5.4方針)
→ これらが完了し、代表者が明示的にCron登録するまで稼働しない。

## 10. 将来組織の設計記録(V6では権限・実行経路を与えない)

```
CEO(代表者・人間) — 承認・送信・契約・重要判断の唯一の決定者
├─ 葵: 将来のAI社長室長 / Chief of Staff候補(現: AI社長補佐)
├─ 美月: CEO専属AI秘書【準備中 — 名前と将来役割の記録のみ。agent定義・モデル消費・DB権限なし】
├─ 楓: AI-PMO責任者【準備中 — 同上】
└─ AIマーケティング本部
   └─ SNSマーケティング部
      └─ Instagram運用課 ← V6の改善ループはこの課の範囲
         (蓮=将来のCMO候補、凛・昊・琴葉・紬・紫苑・湊・陽葵)
将来本部(表示のみ・解放条件はdocs/04 §5): AI営業・CS本部 / AI Web制作本部 / AI開発本部 / AI経理・管理本部
```

美月・楓はV6では**記録のみ**。新しいagent定義・モデル消費・DB更新権限・外部送信権限を与えない(実稼働はCEOの明示指示後の将来スライス)。

## 11. CLI一覧(V6追加)

```bash
pnpm company analytics-snapshot [--window 3|7]        # 決定的スナップショット生成(冪等)
pnpm company analytics-show [--window 3|7]            # 最新スナップショット表示
pnpm company improvement-proposal-save --file <json> --actor aoi
pnpm company improvement-list
pnpm company improvement-decide --proposal <id> --decision approved --actor owner   # owner専用
pnpm company improvement-directives                   # 承認済み・期限内・最大3件
pnpm company improvement-apply --post <id> --proposal <id> --reason "<採用理由>" --actor aoi
pnpm company business-outcome-add --json '<outcome>' --actor owner                  # owner専用
pnpm company analytics-cron-dry-run                   # 書き込みなし
```

全変更系はactor明示必須。system→ownerの自動昇格はしない。

## 12. 代表者の確認手順

1. http://localhost:3000/analytics を開く(サイドバー「成長分析」)
2. データ充足状況と3日/7日切替を確認(未入力は「未取得」表示。0とは別)
3. 実績が未入力なら /publish の実績入力から転記する
4. 改善提案が届いたら、観察・仮説・根拠投稿・リスクを読み、承認/却下/修正依頼(却下・修正は理由必須。確認ダイアログあり)
5. 承認した指示は「次回kickoffへ渡る改善指示」に表示され、次回/kickoffの企画へ反映される(最大3件)
6. 問い合わせ・見積もり・受注が発生したら `pnpm company business-outcome-add --actor owner` で匿名記録

## 13. V6の既知制約

- Instagram Insightsの自動取得は未実装(手動転記が正)
- Cronは本番未稼働(上記9の理由)
- 計測データが少ない間、分析は「傾向の可能性」の域を出ない(仕様どおりの制約)
- 事業成果はKPI表示まで(受注単価・LTV等の高度な分析はデータ蓄積後)

---

## 14. V6再レビュー追補(2026-07-17)

- **冪等hashの材料**: sourceDataHashは「入力データ+JST業務日(asOfBusinessDate)」から算出する。同一業務日・同一入力では冪等、翌日に期限状態(notDue→overdue)が変われば新しいsnapshotを追記する。asOfBusinessDateはsnapshot_json内にも保存される(P1-1。cronのdry-runも同一関数を使用)
- **構造化ファクト照合**: 提案は`structuredFactRefs`(post/group/coverageスコープ+申告値)でsnapshot内の事実を参照する。通常コードが実在と値の**完全一致**を検査し、observation本文も参照から自動生成する。AIの自由文の数値は保存されない(P1-2)。存在しないgroup・metric・投稿ID・集計値、値の不一致(例: 架空の保存率99%)は保存拒否
- **actor整合**: 提案保存はsystem不可・owner不可(CEOは判断者)。提案者本人(agentRef)かオーケストレーター(aoi)のみ
- **一変数の構造化**: testVariableは `pillar | format | cta | template | variant | posting_time` の6種enumから1つだけ。変更内容はtestChange(from/to/condition)で構造化(P2-1)
- **クラウド読み取り保護**: /api/analytics(提案・CEO判断・受注金額・匿名メモを含む)は、owner認証未確定のcloud環境では読み取りも403でfail closed。ローカル単一ユーザー運用は従来どおり(P1-3)
- **JST期間**: periodStart/periodEndはbusinessDateFromIso(JST業務日変換)で算出(P2-2)
- migration **#12 v6-structured-proposals**(structured_fact_refs_json / test_change_json 列の追加のみ。#11は変更しない)
- migration **#13 v6-decision-sequence**(既存判断履歴をproposal単位で連番化し、`(proposal_id, decision_sequence)`一意制約を追加。最新判断を時刻・rowidの暗黙順序に依存させない)
