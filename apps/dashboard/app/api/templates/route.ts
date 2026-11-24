import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { openDb } from "@adapters/db/client";
import { listTemplateVersions, listTemplateVariantQa, templateApprovability, renderTemplateVersion } from "@adapters/db/store";
import { TEMPLATES } from "@core/templates/index";
import { workspaceRoot } from "@adapters/root";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 各テンプレートの最新版 + 全variantのプレビュー・QA・承認可否。参照のみ(承認はPOST/decision) */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      const root = path.join(workspaceRoot(), "06_template-previews");
      const allVersions = listTemplateVersions(db);
      const templateIds = Object.keys(TEMPLATES);
      const items = templateIds.map((templateId) => {
        const versionsForTpl = allVersions.filter((v) => v.templateId === templateId).sort((a, b) => b.version - a.version);
        const latest = versionsForTpl[0];
        if (!latest) return { templateId, family: (TEMPLATES as Record<string, { family: string }>)[templateId]!.family, version: null, variants: [], publishVersion: null };
        // 実際にレンダリング・公開(書き出し)に使われる版。承認済み版が現行コードと一致する場合のみ非null
        const rv = renderTemplateVersion(db, templateId);
        const publishVersion = versionsForTpl.find((v) => v.version === rv)?.status === "approved" ? rv : null;
        const declaredVariants = (TEMPLATES as Record<string, { variants: readonly string[] }>)[templateId]!.variants;
        const qaRows = listTemplateVariantQa(db, templateId, latest.version);
        const variants = declaredVariants.map((variant) => {
          const metaPath = path.join(root, templateId, `v${latest.version}`, variant, "meta.json");
          let preview: unknown = null;
          if (existsSync(metaPath)) {
            try { preview = JSON.parse(readFileSync(metaPath, "utf8")); } catch { preview = null; }
          }
          const qa = qaRows.find((r) => r.variant === variant) ?? null;
          return { variant, preview, qa };
        });
        return {
          templateId, family: latest.family, version: latest.version, status: latest.status, fingerprint: latest.fingerprint,
          note: latest.note, variants, approvability: templateApprovability(db, templateId, latest.version),
          publishVersion,
          versionHistory: versionsForTpl.map((v) => ({ version: v.version, status: v.status })),
        };
      });
      const overviewExists = existsSync(path.join(root, "overview.png"));
      return NextResponse.json({ items, overviewExists });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
