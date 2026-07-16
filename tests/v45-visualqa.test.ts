/**
 * V4.5 v3: visual QAの厳格化(revisionInstructionsが残っていればpass不可)と
 * meta.json ↔ DB の整合(reconcileVisualQaInMeta)を検証する。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { visualQaArtifactSchema } from "@core/schemas";
import { reconcileVisualQaInMeta } from "@adapters/render/preview";

describe("visual QA schema(厳格)", () => {
  const base = { kind: "visual_qa" as const, criticalIssues: [], minorIssues: [], revisionInstructions: [], pageFindings: [] };

  it("criticalIssuesがあるとpass不可", () => {
    expect(visualQaArtifactSchema.safeParse({ ...base, result: "pass", criticalIssues: ["空疎なページ"] }).success).toBe(false);
  });
  it("revisionInstructionsが残っているとpass不可(v3で追加)", () => {
    expect(visualQaArtifactSchema.safeParse({ ...base, result: "pass", revisionInstructions: ["余白を埋める必要"] }).success).toBe(false);
  });
  it("critical/revisionが空ならpass可", () => {
    expect(visualQaArtifactSchema.safeParse({ ...base, result: "pass", minorIssues: ["軽微な調整"] }).success).toBe(true);
  });
  it("failはissue付きで許容", () => {
    expect(visualQaArtifactSchema.safeParse({ ...base, result: "fail", criticalIssues: ["表紙以外が同一"], revisionInstructions: ["本文を作り直す"] }).success).toBe(true);
  });
});

describe("meta.json ↔ DB 整合(reconcileVisualQaInMeta)", () => {
  it("visual QAをmeta.jsonへ反映する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bloom-meta-"));
    try {
      const dir = path.join(root, "tpl-howto", "v3", "steps");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ templateId: "tpl-howto", variant: "steps", visualQa: null }));
      const vqa = { kind: "visual_qa", result: "pass", criticalIssues: [], minorIssues: [], revisionInstructions: [], pageFindings: [] };
      reconcileVisualQaInMeta(root, "tpl-howto", 3, "steps", vqa);
      const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as { visualQa: { result: string } };
      expect(meta.visualQa.result).toBe("pass");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
