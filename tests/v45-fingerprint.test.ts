/**
 * V4.5 v2 P0-1: fingerprintがレンダリング実装(コード・component・variant集合・token・ロゴ)の
 * 変更を検知することを検証する。materialの純関数digestと、実ファイル収集の両方をテストする。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeFingerprintFromMaterial, collectFingerprintMaterial, computeFingerprint,
  FingerprintError, type FingerprintMaterial,
} from "@adapters/render/fingerprint";
import { loadTheme } from "@adapters/render/theme";
import { findRepoRoot } from "@adapters/root";

const BASE: FingerprintMaterial = {
  designSystemVersion: "ds-v1",
  schemaVersion: "carousel-v2",
  tokens: "{tokens}",
  colors: { primary: "#0b46b8" },
  logoSha: "abc",
  templateId: "tpl-howto",
  version: 1,
  variants: ["banded", "stacked"],
  sourceHashes: { "components.ts": "h1", "tpl-howto.ts": "h2" },
};

describe("fingerprint material(純関数digest)", () => {
  it("同一materialは決定的に同一fingerprint", () => {
    expect(computeFingerprintFromMaterial(BASE)).toBe(computeFingerprintFromMaterial({ ...BASE }));
  });

  it("layout/component実装(sourceHashes)が変わるとfingerprintが変わる", () => {
    const changed = { ...BASE, sourceHashes: { ...BASE.sourceHashes, "tpl-howto.ts": "CHANGED" } };
    expect(computeFingerprintFromMaterial(changed)).not.toBe(computeFingerprintFromMaterial(BASE));
  });

  it("variant集合が変わるとfingerprintが変わる", () => {
    const changed = { ...BASE, variants: ["stacked"] };
    expect(computeFingerprintFromMaterial(changed)).not.toBe(computeFingerprintFromMaterial(BASE));
  });

  it("design-system version / schema version / token / logo / 色 が変わるとfingerprintが変わる", () => {
    for (const patch of [
      { designSystemVersion: "ds-v2" }, { schemaVersion: "carousel-v3" }, { tokens: "{other}" },
      { logoSha: "zzz" }, { colors: { primary: "#000000" } },
    ] as Partial<FingerprintMaterial>[]) {
      expect(computeFingerprintFromMaterial({ ...BASE, ...patch })).not.toBe(computeFingerprintFromMaterial(BASE));
    }
  });
});

describe("fingerprint material(実ファイル収集)", () => {
  it("実テンプレートソースを読み、共通component+実装+variantをmaterialに含める", () => {
    const m = collectFingerprintMaterial("tpl-howto", 1, loadTheme());
    expect(Object.keys(m.sourceHashes)).toEqual(expect.arrayContaining(["design-system.ts", "components.ts", "tpl-howto.ts"]));
    expect(m.variants.length).toBeGreaterThanOrEqual(2);
    expect(m.sourceHashes["tpl-howto.ts"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("テンプレート実装ファイルの中身が変わるとfingerprintが変わる(コピーtemplatesRootで検証)", () => {
    const root = path.join(findRepoRoot(), "src", "core", "templates");
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-fp-"));
    try {
      cpSync(root, dir, { recursive: true });
      const before = computeFingerprintFromMaterial(collectFingerprintMaterial("tpl-howto", 1, loadTheme(), dir));
      // レイアウト実装ファイルを1バイト変更
      writeFileSync(path.join(dir, "tpl-howto.ts"), "// layout change\n" + "x".repeat(10));
      const after = computeFingerprintFromMaterial(collectFingerprintMaterial("tpl-howto", 1, loadTheme(), dir));
      expect(after).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ソースを読み込めない場合は fail closed(FingerprintError)", () => {
    expect(() => collectFingerprintMaterial("tpl-howto", 1, loadTheme(), "/nonexistent/path/xyz")).toThrow(FingerprintError);
  });

  it("computeFingerprintは実ファイル込みで64桁hex", () => {
    expect(computeFingerprint("tpl-compare", 1)).toMatch(/^[0-9a-f]{64}$/);
  });
});
