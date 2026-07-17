"use client";
/**
 * V6-F: 成長分析(改善ループ)画面。
 * - 数値はすべて通常コード(core/analytics)の決定的集計。AIが計算した値は表示しない
 * - 未取得(null)と0を別表示する(未取得=「未取得」、0=「0」)
 * - sampleCountを常に表示し、10本未満は「サンプル不足(断定不可)」を明示する
 * - 改善提案はAIの提案であり、CEO(代表者)の承認・却下・修正依頼で初めて扱いが決まる
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import type { AnalysisFacts, GroupFact, MetricKey, PerPostFact } from "@core/analytics";

const METRIC_LABELS: Record<MetricKey, string> = {
  reach: "リーチ",
  profileViews: "プロフィール閲覧",
  saves: "保存",
  shares: "シェア",
  comments: "コメント",
  dmStarts: "DM開始",
  followerCount: "フォロワー数",
};

interface ProposalView {
  id: string;
  analysisSnapshotId: string;
  authorEmployeeId: string;
  authorName: string | null;
  title: string;
  observation: string;
  hypothesis: string;
  evidenceRefs: string[];
  structuredFactRefs: unknown[];
  testVariable: string;
  testChange: { from?: string | null; to: string; condition?: string | null } | null;
  expectedSignal: string;
  proposedAction: string;
  risk: string;
  expiresAt: string;
  createdAt: string;
  status: string;
  latestDecision: { decision: string; reason: string | null; decidedAt: string } | null;
  expired: boolean;
}

interface DirectiveView {
  id: string;
  postId: string;
  postTitle: string;
  proposalId: string;
  proposalTitle: string;
  reason: string | null;
  appliedBy: string;
  appliedAt: string;
}

interface OutcomeView {
  id: string;
  occurredOn: string;
  kind: string;
  source: string;
  relatedPostId: string | null;
  amountYen: number | null;
  anonymizedNote: string | null;
}

interface AnalyticsData {
  today: string;
  windows: Record<string, AnalysisFacts>;
  snapshots: { id: string; windowDays: number; generatedAt: string; sourceDataHash: string }[];
  proposals: ProposalView[];
  approvedDirectives: ProposalView[];
  appliedDirectives: DirectiveView[];
  businessOutcomes: OutcomeView[];
  businessOutcomeSummary: {
    counts: { inquiry: number; estimate: number; order: number };
    orderAmountYenTotal: number | null;
    amountEnteredCount: number;
    total: number;
  };
}

/** 未取得(null)と0を厳密に区別して表示する */
function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return "未取得";
  return String(v);
}

function rate(v: number | null | undefined): string {
  if (v === null || v === undefined) return "未取得";
  return `${(v * 100).toFixed(2)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  proposed: "CEO判断待ち",
  approved: "承認済み",
  rejected: "却下",
  revision_requested: "修正依頼",
  superseded: "置き換え済み",
};

const tableWrap: React.CSSProperties = { overflowX: "auto" };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap", borderBottom: "2px solid var(--color-surface-dark, #ddd)" };
const td: React.CSSProperties = { padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap", borderBottom: "1px solid var(--color-surface-dark, #eee)" };

export default function AnalyticsPage(): JSX.Element {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<3 | 7>(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setData(json as AnalyticsData);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(proposal: ProposalView, decision: "approved" | "rejected" | "revision_requested"): Promise<void> {
    const reason = (reasonById[proposal.id] ?? "").trim();
    if (decision !== "approved" && !reason) {
      setActionError("却下・修正依頼には理由の入力が必要です");
      return;
    }
    const label = decision === "approved" ? "承認" : decision === "rejected" ? "却下" : "修正依頼";
    if (!window.confirm(`改善提案「${proposal.title}」を${label}します。よろしいですか?\n(判断はappend-onlyで記録され、承認済みだけが次回kickoffへ渡ります)`)) {
      return;
    }
    setBusy(proposal.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/improvements/${proposal.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ decision, reason: reason || undefined }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "判断の記録に失敗しました");
      setNotice(`「${proposal.title}」を${label}として記録しました`);
      setReasonById((prev) => ({ ...prev, [proposal.id]: "" }));
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <AppShell current="/analytics" title="成長分析">
        <PageHeader title="成長分析" subtitle="投稿結果の事実と改善ループ" />
        <div className="error-box" role="alert">読み込みに失敗しました: {loadError}</div>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell current="/analytics" title="成長分析">
        <PageHeader title="成長分析" subtitle="投稿結果の事実と改善ループ" />
        <p role="status">読み込み中…</p>
      </AppShell>
    );
  }

  const facts = data.windows[String(windowDays)];
  if (!facts) {
    return (
      <AppShell current="/analytics" title="成長分析">
        <PageHeader title="成長分析" subtitle="投稿結果の事実と改善ループ" />
        <div className="error-box" role="alert">分析データの形式が不正です</div>
      </AppShell>
    );
  }
  const cov = facts.dataCoverage;
  const insufficient = cov.measuredCount < 10;
  const axisSections: { title: string; axis: GroupFact["axis"] }[] = [
    { title: "コンテンツ柱別", axis: "pillar" },
    { title: "投稿形式別", axis: "format" },
    { title: "テンプレート別", axis: "template" },
    { title: "テンプレート版別", axis: "templateVersion" },
    { title: "variant別", axis: "variant" },
    { title: "CTA別", axis: "cta" },
  ];

  return (
    <AppShell current="/analytics" title="成長分析">
      <PageHeader
        title="成長分析"
        subtitle="通常コードの決定的集計による事実と、CEO承認型の改善ループ(数値はAIが計算していません)"
      />

      {/* 1. データ充足状況(不足は画面上部で明示) */}
      <section aria-label="データ充足状況" style={{ marginBottom: 16 }}>
        {insufficient ? (
          <div className="error-box" role="alert" style={{ marginBottom: 8 }}>
            <strong>データ不足: </strong>
            計測済み投稿が{cov.measuredCount}本(10本未満)です。以下の比較はすべて「傾向の可能性」であり、
            勝ち負け・成功の断定はできません。因果関係も断定できません。
          </div>
        ) : (
          <p style={{ fontSize: 13, margin: "0 0 8px" }}>
            計測済み{cov.measuredCount}本。関連の観察は可能ですが、因果関係は断定できません。
          </p>
        )}
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, margin: 0 }}>
          <div><dt style={{ fontSize: 12 }}>公開投稿数</dt><dd style={{ margin: 0, fontWeight: 700 }}>{cov.publishedCount}</dd></div>
          <div><dt style={{ fontSize: 12 }}>{windowDays}日後 入力済み</dt><dd style={{ margin: 0, fontWeight: 700 }}>{cov.measuredCount}</dd></div>
          <div><dt style={{ fontSize: 12 }}>期限到来・未入力</dt><dd style={{ margin: 0, fontWeight: 700 }}>{cov.overdueCount}</dd></div>
          <div><dt style={{ fontSize: 12 }}>期限前・未入力</dt><dd style={{ margin: 0, fontWeight: 700 }}>{cov.notDueCount}</dd></div>
        </dl>
        {cov.missingFields.length > 0 ? (
          <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>入力済み投稿の欠損項目: {cov.missingFields.join(" / ")}(欠損は0扱いしません)</p>
        ) : null}
      </section>

      {/* 2. 3日後・7日後の切り替え(窓は混ぜない) */}
      <div role="tablist" aria-label="計測窓の切り替え" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {([3, 7] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={windowDays === w}
            className={windowDays === w ? "btn" : "btn btn--secondary"}
            onClick={() => setWindowDays(w)}
          >
            {w}日後の実績
          </button>
        ))}
      </div>

      {notice ? <p role="status" style={{ fontWeight: 600 }}>{notice}</p> : null}
      {actionError ? <div className="error-box" role="alert">{actionError}</div> : null}

      {/* 3. KPIカード(合計は入力済み投稿のみ。未取得は未取得と表示) */}
      <section aria-label="KPI" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16 }}>KPI({windowDays}日後・入力済み{cov.measuredCount}本の合計)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          {(Object.keys(METRIC_LABELS) as MetricKey[]).map((mk) => (
            <div key={mk} style={{ border: "1px solid var(--color-surface-dark, #ddd)", borderRadius: 8, padding: "8px 12px" }}>
              <div style={{ fontSize: 12 }}>{METRIC_LABELS[mk]}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{num(facts.totals.entered[mk])}</div>
              <div style={{ fontSize: 11.5 }}>入力 {facts.totals.enteredCount[mk]} / {cov.measuredCount}件</div>
            </div>
          ))}
        </div>
        <h3 style={{ fontSize: 14, marginTop: 12 }}>事業成果(代表者の手動記録・匿名)</h3>
        <p style={{ fontSize: 13, margin: 0 }}>
          問い合わせ {data.businessOutcomeSummary.counts.inquiry}件 / 見積もり {data.businessOutcomeSummary.counts.estimate}件 / 受注 {data.businessOutcomeSummary.counts.order}件 / 受注金額合計{" "}
          {data.businessOutcomeSummary.orderAmountYenTotal === null ? "未取得" : `${data.businessOutcomeSummary.orderAmountYenTotal.toLocaleString("ja-JP")}円(金額入力${data.businessOutcomeSummary.amountEnteredCount}件分)`}
          {data.businessOutcomeSummary.total === 0 ? "(記録なし。pnpm company business-outcome-add --actor owner で記録できます)" : null}
        </p>
      </section>

      {/* 4. 投稿別結果 */}
      <section aria-label="投稿別結果" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16 }}>投稿別結果({windowDays}日後)</h2>
        {facts.perPostFacts.length === 0 ? (
          <p>公開済みの投稿がまだありません。投稿を公開し、3日後・7日後に実績を入力するとここに表示されます。</p>
        ) : (
          <div style={tableWrap}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th} scope="col">投稿</th>
                  <th style={th} scope="col">状態</th>
                  <th style={th} scope="col">リーチ</th>
                  <th style={th} scope="col">保存</th>
                  <th style={th} scope="col">保存率</th>
                  <th style={th} scope="col">プロフ閲覧率</th>
                  <th style={th} scope="col">DM開始率</th>
                  <th style={th} scope="col">柱/テンプレ/variant</th>
                </tr>
              </thead>
              <tbody>
                {facts.perPostFacts.map((p: PerPostFact) => (
                  <tr key={p.postId}>
                    <td style={td}>{p.title}</td>
                    <td style={td}>{p.measured ? "入力済み" : p.metricDueOn && p.metricDueOn <= data.today ? "入力待ち(期限到来)" : "期限前"}</td>
                    <td style={td}>{p.metrics ? num(p.metrics.reach) : "未取得"}</td>
                    <td style={td}>{p.metrics ? num(p.metrics.saves) : "未取得"}</td>
                    <td style={td}>{rate(p.rates?.saveRate)}</td>
                    <td style={td}>{rate(p.rates?.profileViewRate)}</td>
                    <td style={td}>{rate(p.rates?.dmStartRate)}</td>
                    <td style={td}>柱{p.pillar} / {p.templateId}{p.templateVersion !== null ? `@v${p.templateVersion}` : ""} / {p.variant ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5〜7. グループ比較(中央値を主要表示。sampleCount常時表示・根拠追跡可能) */}
      {axisSections.map(({ title, axis }) => {
        const groups = facts.groups.filter((g) => g.axis === axis);
        return (
          <section key={axis} aria-label={`${title}比較`} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16 }}>{title}比較(投稿あたり中央値)</h2>
            {groups.length === 0 ? (
              <p style={{ fontSize: 13 }}>この軸で分類できるデータがまだありません。</p>
            ) : (
              <div style={tableWrap}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th} scope="col">{title.replace("別", "")}</th>
                      <th style={th} scope="col">sampleCount</th>
                      <th style={th} scope="col">判定可否</th>
                      <th style={th} scope="col">リーチ中央値</th>
                      <th style={th} scope="col">保存中央値</th>
                      <th style={th} scope="col">保存率中央値</th>
                      <th style={th} scope="col">DM開始率中央値</th>
                      <th style={th} scope="col">根拠投稿</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.key}>
                        <td style={td}>{g.label}</td>
                        <td style={td}>{g.sampleCount}</td>
                        <td style={td}>{g.exploratory ? "サンプル不足(断定不可・観察のみ)" : "関連の観察が可能(因果は断定不可)"}</td>
                        <td style={td}>{num(g.medians.reach)}</td>
                        <td style={td}>{num(g.medians.saves)}</td>
                        <td style={td}>{rate(g.medians.saveRate)}</td>
                        <td style={td}>{rate(g.medians.dmStartRate)}</td>
                        <td style={td}>
                          <details>
                            <summary style={{ cursor: "pointer" }}>{g.evidencePostIds.length}件</summary>
                            <ul style={{ margin: "4px 0", paddingLeft: 16 }}>
                              {g.evidencePostIds.map((id) => {
                                const post = facts.perPostFacts.find((p) => p.postId === id);
                                return <li key={id} style={{ fontSize: 12 }}>{post?.title ?? id}</li>;
                              })}
                            </ul>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {/* 8. 欠損・入力待ち一覧 */}
      <section aria-label="入力待ち" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16 }}>実績入力の待ち状況({windowDays}日後)</h2>
        {cov.overdueCount === 0 && cov.notDueCount === 0 ? (
          <p style={{ fontSize: 13 }}>未入力の投稿はありません。</p>
        ) : (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {facts.perPostFacts.filter((p) => !p.measured).map((p) => (
              <li key={p.postId} style={{ fontSize: 13 }}>
                {p.title} — {p.metricDueOn && p.metricDueOn <= data.today ? `期限到来(${p.metricDueOn})。/publish の実績入力から転記してください` : `入力期限 ${p.metricDueOn ?? "未定"}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 9〜10. 改善提案一覧とCEO判断 */}
      <section aria-label="改善提案" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16 }}>改善提案(AIの提案 — CEOの判断で初めて確定します)</h2>
        {data.proposals.length === 0 ? (
          <p style={{ fontSize: 13 }}>改善提案はまだありません。週次会議(/weekly-review)で湊の事実整理と蓮の仮説から作成されます。</p>
        ) : (
          data.proposals.map((p) => (
            <article
              key={p.id}
              aria-label={`改善提案 ${p.title}`}
              style={{
                border: "1px solid var(--color-surface-dark, #ddd)",
                borderLeft: p.status === "approved" ? "4px solid var(--color-success, #157a41)" : "4px solid var(--color-info, #888)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 10,
              }}
            >
              <h3 style={{ fontSize: 14.5, margin: "0 0 4px" }}>
                {p.title}
                {" — "}
                <span>状態: {STATUS_LABEL[p.status] ?? p.status}{p.expired ? "(期限切れ)" : ""}</span>
              </h3>
              <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>
                提案者: {p.authorName ?? p.authorEmployeeId}(AI社員の提案) / 有効期限: {p.expiresAt} / 変更する主要変数(1つのみ): {p.testVariable}
                {p.testChange ? ` → ${p.testChange.to}${p.testChange.condition ? `(条件: ${p.testChange.condition})` : ""}` : ""}
              </p>
              <dl style={{ fontSize: 13, margin: 0 }}>
                <dt style={{ fontWeight: 600 }}>観察(snapshotの事実)</dt><dd style={{ margin: "0 0 4px" }}>{p.observation}</dd>
                <dt style={{ fontWeight: 600 }}>仮説(断定ではない)</dt><dd style={{ margin: "0 0 4px" }}>{p.hypothesis}</dd>
                <dt style={{ fontWeight: 600 }}>提案する行動</dt><dd style={{ margin: "0 0 4px" }}>{p.proposedAction}</dd>
                <dt style={{ fontWeight: 600 }}>期待する観測シグナル / リスク</dt><dd style={{ margin: "0 0 4px" }}>{p.expectedSignal} / {p.risk}</dd>
                <dt style={{ fontWeight: 600 }}>根拠投稿ID</dt><dd style={{ margin: "0 0 4px" }}>{p.evidenceRefs.join(", ")}</dd>
              </dl>
              {p.latestDecision ? (
                <p style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  CEO判断: {STATUS_LABEL[p.latestDecision.decision] ?? p.latestDecision.decision}({new Date(p.latestDecision.decidedAt).toLocaleString("ja-JP")})
                  {p.latestDecision.reason ? ` — 理由: ${p.latestDecision.reason}` : ""}
                </p>
              ) : null}
              {p.status === "proposed" || p.status === "revision_requested" ? (
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: "block", fontSize: 12.5 }}>
                    理由(却下・修正依頼は必須)
                    <input
                      type="text"
                      value={reasonById[p.id] ?? ""}
                      onChange={(e) => setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      style={{ display: "block", width: "100%", maxWidth: 480, marginTop: 4 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn--success" disabled={busy === p.id} onClick={() => void decide(p, "approved")}>
                      承認する
                    </button>
                    <button type="button" className="btn btn--secondary" disabled={busy === p.id} onClick={() => void decide(p, "rejected")}>
                      却下する
                    </button>
                    <button type="button" className="btn btn--secondary" disabled={busy === p.id} onClick={() => void decide(p, "revision_requested")}>
                      修正依頼
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>

      {/* 11. 承認済みの次回改善指示 */}
      <section aria-label="次回改善指示" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16 }}>次回kickoffへ渡る改善指示(承認済み・期限内・最大3件)</h2>
        {data.approvedDirectives.length === 0 ? (
          <p style={{ fontSize: 13 }}>承認済みの改善指示はありません(0件でもkickoffは従来どおり動きます)。</p>
        ) : (
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            {data.approvedDirectives.map((d) => (
              <li key={d.id} style={{ fontSize: 13, marginBottom: 4 }}>
                <strong>{d.title}</strong> — {d.proposedAction}(期限 {d.expiresAt})
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 12. どの投稿にどの改善指示が適用されたか */}
      <section aria-label="改善指示の適用記録" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16 }}>改善指示の適用記録</h2>
        {data.appliedDirectives.length === 0 ? (
          <p style={{ fontSize: 13 }}>適用記録はまだありません。</p>
        ) : (
          <div style={tableWrap}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th} scope="col">投稿</th>
                  <th style={th} scope="col">改善提案</th>
                  <th style={th} scope="col">採用理由</th>
                  <th style={th} scope="col">適用日時</th>
                </tr>
              </thead>
              <tbody>
                {data.appliedDirectives.map((d) => (
                  <tr key={d.id}>
                    <td style={td}>{d.postTitle}</td>
                    <td style={td}>{d.proposalTitle}</td>
                    <td style={td}>{d.reason ?? "—"}</td>
                    <td style={td}>{new Date(d.appliedAt).toLocaleString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12.5, marginTop: 8 }}>
          改善指示が適用された投稿も、CEOが承認しない限り公開されません(承認・QA・権利のガードは従来どおり)。
        </p>
      </section>
    </AppShell>
  );
}
