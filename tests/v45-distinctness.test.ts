/**
 * V4.5 v3: variant差分の構造判定(純関数)と、承認ゲートでの差分不足の拒否。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { distinctInteriorPageCount, variantsSufficientlyDistinct } from "@core/templates/distinctness";
import { openDb, type OpenedDb } from "@adapters/db/client";
import {
  ensureSeedOrg, ensureTemplateVersion, getTemplateVersion, currentTemplateVersion,
  upsertTemplateVariantQa, recordTemplateVisualQa, templateApprovability,
} from "@adapters/db/store";
import { PASS_VISUAL_QA } from "./fixtures";

describe("distinctInteriorPageCount(純関数)", () => {
  const ids = (pre: string) => [`cover-${pre}`, `p1-${pre}`, `p2-${pre}`, `p3-${pre}`, `p4-${pre}`, "cta"];
  const hashes = (pre: string) => ids(pre).map((_, i) => `${pre}-h${i}`);

  it("01〜05すべて異なれば差分5", () => {
    const a = { layoutIds: ids("A"), pageHashes: hashes("A") };
    const b = { layoutIds: ids("B"), pageHashes: hashes("B") };
    expect(distinctInteriorPageCount(a, b)).toBe(5);
    expect(variantsSufficientlyDistinct(a, b)).toBe(true);
  });

  it("表紙だけ違い本文が同一なら差分1(不足)", () => {
    const base = { layoutIds: ids("X"), pageHashes: hashes("X") };
    const coverOnly = { layoutIds: ["cover-Y", ...ids("X").slice(1)], pageHashes: ["Y-h0", ...hashes("X").slice(1)] };
    expect(distinctInteriorPageCount(base, coverOnly)).toBe(1);
    expect(variantsSufficientlyDistinct(base, coverOnly)).toBe(false);
  });

  it("layoutId名だけ変えても画像ハッシュが同一ならカウントしない(回避不可)", () => {
    const a = { layoutIds: ids("A"), pageHashes: hashes("SAME") };
    const b = { layoutIds: ids("B"), pageHashes: hashes("SAME") }; // 名前違うがhash同一
    expect(distinctInteriorPageCount(a, b)).toBe(0);
  });
});

describe("承認ゲート: 本文差分不足のvariantは承認できない", () => {
  let dir: string, opened: OpenedDb;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "bloom-v45d-")); opened = openDb(path.join(dir, "t.db")); ensureSeedOrg(opened.db); });
  afterEach(() => { opened.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  function seed(variant: string, interiorPrefix: string): void {
    const version = currentTemplateVersion(opened.db, "tpl-howto");
    const tv = getTemplateVersion(opened.db, "tpl-howto", version) ?? ensureTemplateVersion(opened.db, "tpl-howto");
    const layoutIds = [`cover-${variant}`, `p1-${interiorPrefix}`, `p2-${interiorPrefix}`, `p3-${interiorPrefix}`, `p4-${interiorPrefix}`, "cta"];
    const pageHashes = [`${variant}-h0`, ...[1, 2, 3, 4].map((i) => `${interiorPrefix}-h${i}`), "cta-h"];
    upsertTemplateVariantQa(opened.db, { templateId: "tpl-howto", version, variant, fingerprint: tv.fingerprint, contentQaResult: "pass", mechanicalQaResult: "pass", previewComplete: true, pageCount: 6, fixtureKind: "fictional", rights: "架空", layoutIds, pageHashes });
    recordTemplateVisualQa(opened.db, { templateId: "tpl-howto", version, variant, visualQa: PASS_VISUAL_QA });
  }

  it("表紙だけ違い本文が同一の2variantは承認不可(差分不足)", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seed("steps", "SAME"); // 本文prefix同一
    seed("guide", "SAME");
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    const ap = templateApprovability(opened.db, "tpl-howto", ver);
    expect(ap.ok).toBe(false);
    expect(ap.failures.some((f) => /差分/.test(f.reason))).toBe(true);
  });

  it("本文が3ページ以上異なれば差分は満たす", () => {
    ensureTemplateVersion(opened.db, "tpl-howto");
    seed("steps", "AAA");
    seed("guide", "BBB");
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(templateApprovability(opened.db, "tpl-howto", ver).ok).toBe(true);
  });
});
