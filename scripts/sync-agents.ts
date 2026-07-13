#!/usr/bin/env tsx
/**
 * .claude/agents/*.md を personas + org + config/model-profiles.yaml から生成する(docs/09, docs/14)。
 * モデル名はconfigにのみ存在し、コード・定義ファイルへの直書きを防ぐ(確定§10)。
 * 実行: pnpm sync-agents
 *
 * 実機確認(2026-07-13, Claude Code v2.1.207 / code.claude.com/docs):
 * - frontmatter: name/description(必須), tools/model(任意)。modelは sonnet/opus/haiku/inherit が有効
 * - frontmatterのtoolsはツール名のみ(Bash(...)のコマンド制限はpermissions設定で行う)
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { EMPLOYEES } from "../src/core/org";
import { PERSONAS } from "../src/core/personas";
import { findRepoRoot } from "../src/adapters/root";

const root = findRepoRoot();

const profilesSchema = z.object({
  profiles: z.record(z.object({ claude_code: z.string().min(1) })),
});
const profiles = profilesSchema.parse(
  parseYaml(readFileSync(path.join(root, "config", "model-profiles.yaml"), "utf8")),
).profiles;

/** frontmatterのtoolsはツール名のみ許可されるため、Bash(...)等はベース名に正規化する */
function baseToolNames(tools: string[]): string[] {
  return [...new Set(tools.map((t) => t.replace(/\(.*\)$/, "")))];
}

const agentsDir = path.join(root, ".claude", "agents");
mkdirSync(agentsDir, { recursive: true });

for (const emp of EMPLOYEES) {
  const persona = PERSONAS.find((p) => p.agentRef === emp.agentRef);
  if (!persona) throw new Error(`ペルソナ未定義: ${emp.agentRef}`);
  const model = profiles[emp.modelProfile]?.claude_code;
  if (!model) throw new Error(`モデルプロファイル未定義: ${emp.modelProfile}`);

  const body = `---
name: ${emp.agentRef}
description: ${emp.name}(${emp.role})。${persona.purpose.replace(/\n/g, " ")}
tools: ${baseToolNames(persona.tools).join(", ")}
model: ${model}
---

<!-- 自動生成ファイル: scripts/sync-agents.ts が src/core/personas.ts と config/model-profiles.yaml から生成。直接編集しない -->

あなたはBloom-L AIマーケティング部の「${emp.name}」(${emp.role})です。

## 性格
${persona.personality}

## 目的
${persona.purpose}

## 入力
${persona.inputs.map((s) => `- ${s}`).join("\n")}

## 出力
${persona.outputs.map((s) => `- ${s}`).join("\n")}
${persona.outputSchemaNote ? `\n### 出力JSONスキーマ(厳守。検証NGは差し戻される)\n${persona.outputSchemaNote}\n\n最終応答は説明文を付けず、このJSONだけを出力すること。` : ""}

## 禁止事項(共通)
${["外部への自動投稿・自動送信(Instagram投稿・DM送信は代表者のみ)", "価格・納期・契約条件の確定(竹プランの仮価格は特に出力禁止)", "未確認情報の断定(推測は必ず推測と明記)", "顧客名・顧客素材の許可記録なしでの使用", "効果保証・誇大表現", "秘密情報・個人情報の出力", "company CLI以外の方法でのDB・データ変更"].map((s) => `- ${s}`).join("\n")}

## 禁止事項(固有)
${persona.prohibitions.map((s) => `- ${s}`).join("\n")}

## 失敗時
${persona.onFailure}
`;
  writeFileSync(path.join(agentsDir, `${emp.agentRef}.md`), body);
  process.stdout.write(`generated: .claude/agents/${emp.agentRef}.md (model: ${model})\n`);
}
