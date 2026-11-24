/**
 * limits.yaml の相互整合性検査(改善#4)。
 * max_tasks < max_agent_launches のような組み合わせは、意図した上限に達する前に
 * 別の上限で先に停止してしまうため、Zodのsuperrefineで構造的に拒否する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { findRepoRoot } from "@adapters/root";
import { limitsSchema } from "@core/schemas";

const BASE = {
  daily: {
    max_generated_posts: 3,
    max_tasks: 60,
    max_heavy_escalations: 3,
    max_research_fetches: 20,
    max_est_output_chars: 400000,
    max_agent_launches: 40,
  },
  retry: { per_task: 2, replan_days: 2 },
  approval_queue: { soft_cap: 5 },
  stale: { heartbeat_minutes: 10 },
  api: { monthly_budget_yen: 0 },
};

describe("limits.yaml 相互整合性", () => {
  it("実際のconfig/limits.yamlがそのまま検証を通る", () => {
    const raw = readFileSync(path.join(findRepoRoot(), "config", "limits.yaml"), "utf8");
    expect(() => limitsSchema.parse(parseYaml(raw))).not.toThrow();
  });

  it("max_tasks <= max_agent_launches は拒否される(タスク起動が先に上限で止まるため)", () => {
    const bad = { ...BASE, daily: { ...BASE.daily, max_tasks: 32, max_agent_launches: 40 } };
    expect(() => limitsSchema.parse(bad)).toThrow(/max_tasks/);
  });

  it("max_generated_posts > max_tasks は拒否される(投稿1本に複数タスクが必要なため)", () => {
    const bad = { ...BASE, daily: { ...BASE.daily, max_generated_posts: 100, max_tasks: 60 } };
    expect(() => limitsSchema.parse(bad)).toThrow(/max_generated_posts/);
  });

  it("整合の取れた値は通る", () => {
    expect(() => limitsSchema.parse(BASE)).not.toThrow();
  });
});
