/**
 * V6-F: 成長分析データ(読み取り専用)。
 * 集計はすべて通常コード(core/analytics)。AI生成値は含まれない。
 * 未取得(null)と0を区別したまま返す。秘密値なし。
 */
import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { gatherAnalyticsInput, listAnalysisSnapshots } from "@adapters/db/analytics";
import {
  businessOutcomeSummary,
  listBusinessOutcomes,
  listImprovementProposals,
  listApprovedDirectives,
  listPostDirectives,
} from "@adapters/db/improvements";
import { buildAnalysisFacts, ANALYSIS_WINDOWS } from "@core/analytics";
import { businessDate } from "@core/ids";
import { cloudSensitiveReadBlockedReason } from "@core/runtime";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // V6再レビューP1-3: 提案・CEO判断・受注金額・匿名メモを含むため、認証未確定のcloud環境では
  // DBへ触れる前に読み取り自体を拒否する(403)。ローカル単一ユーザー運用は従来どおり。
  const readBlocked = cloudSensitiveReadBlockedReason(process.env);
  if (readBlocked) {
    return NextResponse.json({ error: readBlocked }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { db, sqlite } = openDb();
    try {
      const today = businessDate();
      const windows = Object.fromEntries(
        ANALYSIS_WINDOWS.map((w) => [w, buildAnalysisFacts(gatherAnalyticsInput(db, w), w, { today })]),
      );
      const outcomes = listBusinessOutcomes(db).map((o) => ({
        id: o.id,
        occurredOn: o.occurredOn,
        kind: o.kind,
        source: o.source,
        relatedPostId: o.relatedPostId,
        amountYen: o.amountYen,
        anonymizedNote: o.anonymizedNote,
      }));
      return NextResponse.json(
        {
          today,
          windows,
          snapshots: listAnalysisSnapshots(db).slice(0, 20),
          proposals: listImprovementProposals(db, { today }),
          approvedDirectives: listApprovedDirectives(db, { today }),
          appliedDirectives: listPostDirectives(db),
          businessOutcomes: outcomes,
          businessOutcomeSummary: businessOutcomeSummary(db),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
