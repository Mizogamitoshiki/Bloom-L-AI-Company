/**
 * V4.5 v2: テンプレート承認ゲート(全variant必須・visual QA必須・理由必須・owner専用)と
 * 無根拠な成果断定のcontent QA、v1保持を検証する。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import {
  ensureSeedOrg, ensureTemplateVersion, ensureTemplateVersionAt, getTemplateVersion,
  upsertTemplateVariantQa, recordTemplateVisualQa, decideTemplateVersion,
  templateApprovability, currentTemplateVersion,
} from "@adapters/db/store";
import { scanUnsupportedClaims } from "@core/guards";
import { PASS_VISUAL_QA } from "./fixtures";

let dir: string, opened: OpenedDb;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v45a-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => { opened.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

const FAIL_VISUAL_QA = { kind: "visual_qa", result: "fail", criticalIssues: ["視線の起点が不明で内容が伝わらない"], minorIssues: [], revisionInstructions: ["表紙を作り直す"], pageFindings: [] };

function seedVariantQa(templateId: string, variant: string, visual: unknown | null): void {
  const version = currentTemplateVersion(opened.db, templateId);
  const tv = getTemplateVersion(opened.db, templateId, version) ?? ensureTemplateVersion(opened.db, templateId);
  const layoutIds = [`cover-${variant}`, `p1-${variant}`, `p2-${variant}`, `p3-${variant}`, `p4-${variant}`, "cta"];
  const pageHashes = layoutIds.map((_, i) => `${variant}-h${i}`);
  upsertTemplateVariantQa(opened.db, {
    templateId, version, variant, fingerprint: tv.fingerprint, contentQaResult: "pass", mechanicalQaResult: "pass",
    previewComplete: true, pageCount: 6, fixtureKind: "fictional", rights: "架空データ", layoutIds, pageHashes,
  });
  if (visual) recordTemplateVisualQa(opened.db, { templateId, version, variant, visualQa: visual });
}

describe("V4.5 v2 承認ゲート", () => {
  it("全variantのプレビュー/QAが揃わなければ承認できない(未確認variant)", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seedVariantQa("tpl-howto", "steps", PASS_VISUAL_QA); // guideは未確認
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(templateApprovability(opened.db, "tpl-howto", ver).ok).toBe(false);
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "approved" }, "owner")).toThrow(/未確認|承認できません/);
  });

  it("visual QAが未実施なら承認できない(mechanical/content passでも)", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seedVariantQa("tpl-howto", "steps", null);
    seedVariantQa("tpl-howto", "guide", null);
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "approved" }, "owner")).toThrow(/visual|承認できません/);
  });

  it("visual QAがfailなら承認できない", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seedVariantQa("tpl-howto", "steps", PASS_VISUAL_QA);
    seedVariantQa("tpl-howto", "guide", FAIL_VISUAL_QA);
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(templateApprovability(opened.db, "tpl-howto", ver).ok).toBe(false);
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "approved" }, "owner")).toThrow(/承認できません/);
  });

  it("全variantのcontent/mechanical/visual QAが揃えば承認できる(owner)", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seedVariantQa("tpl-howto", "steps", PASS_VISUAL_QA);
    seedVariantQa("tpl-howto", "guide", PASS_VISUAL_QA);
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(templateApprovability(opened.db, "tpl-howto", ver).ok).toBe(true);
    const row = decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "approved" }, "owner");
    expect(row.status).toBe("approved");
  });

  it("ownerでもQA未完了版は承認できない", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seedVariantQa("tpl-howto", "steps", PASS_VISUAL_QA); // guide未整備
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "approved" }, "owner")).toThrow();
    expect(getTemplateVersion(opened.db, "tpl-howto", ver)!.status).toBe("draft");
  });

  it("却下・修正依頼は理由(note)必須", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "rejected" }, "owner")).toThrow(/理由/);
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "revision_requested" }, "owner")).toThrow(/理由/);
    const row = decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "rejected", note: "余白が多い" }, "owner");
    expect(row.status).toBe("rejected");
  });

  it("v2を作ってもv1は保持される(既存版を消さない)", () => {
    ensureTemplateVersion(opened.db, "tpl-howto"); // v1
    ensureTemplateVersionAt(opened.db, "tpl-howto", 2); // v2
    expect(getTemplateVersion(opened.db, "tpl-howto", 1)).toBeTruthy();
    expect(getTemplateVersion(opened.db, "tpl-howto", 2)).toBeTruthy();
  });
});

describe("V4.5 v2 content QA: 無根拠な成果断定", () => {
  it("根拠がなければ成果断定を拒否する", () => {
    expect(scanUnsupportedClaims("問い合わせが増えました", false).length).toBeGreaterThan(0);
    expect(scanUnsupportedClaims("売上が伸びています", false).length).toBeGreaterThan(0);
    expect(scanUnsupportedClaims("業務が改善しました", false).length).toBeGreaterThan(0);
  });
  it("根拠があれば許容する / 設計・導線の表現は通す", () => {
    expect(scanUnsupportedClaims("問い合わせが増えました", true)).toEqual([]);
    expect(scanUnsupportedClaims("予約希望を記録できる導線を設計しました", false)).toEqual([]);
    expect(scanUnsupportedClaims("時間外でも受け付けられる構成にしました", false)).toEqual([]);
  });
});
