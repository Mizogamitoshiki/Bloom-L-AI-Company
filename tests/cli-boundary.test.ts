/**
 * P1指摘1(2026-07-13): 承認の構造的分離。
 * AI社員が使うcompany CLIに承認系コマンドが存在しないこと(文章でなくコードで防止)。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliSource = readFileSync(path.join(root, "scripts", "company.ts"), "utf8");

describe("7. AI向けcompany CLIから承認操作ができない", () => {
  it("CLIソースにdecideコマンド・decidePost参照が存在しない(静的検査)", () => {
    expect(cliSource).not.toMatch(/case "decide"/);
    expect(cliSource).not.toMatch(/\bdecidePost\b/);
    expect(cliSource).not.toMatch(/\bDecision\b/);
  });

  it("`company decide` の実行は『不明なコマンド』で失敗する(実行検査)", () => {
    const r = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        path.join(root, "scripts", "company.ts"),
        "decide",
        "--post",
        "x",
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, BLOOM_DB_PATH: path.join(tmpdir(), "bloom-cli-boundary.db") }, timeout: 60_000 },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("不明なコマンド");
  }, 60_000);

  it("エージェント定義: Bash権限を持つのはオーケストレーター(aoi)のみ", () => {
    const agentsDir = path.join(root, ".claude", "agents");
    const refs = ["aoi", "ren", "rin", "sora", "kotoha", "tsumugi", "shion", "minato", "hinata"];
    for (const ref of refs) {
      const src = readFileSync(path.join(agentsDir, `${ref}.md`), "utf8");
      const toolsLine = src.split("\n").find((l) => l.startsWith("tools:")) ?? "";
      if (ref === "aoi") {
        expect(toolsLine).toContain("Bash");
      } else {
        expect(toolsLine).not.toContain("Bash");
      }
    }
  });

  it("actor未指定のsystemをownerへ自動昇格しない", () => {
    expect(cliSource).not.toMatch(/args\.actor\s*===\s*["']system["']\s*\?\s*["']owner["']/);
  });
});
