/**
 * 投稿のカルーセルレンダリング一式(通常コード・AI不使用)。
 * plan+最新copy → spec構築(sourceCopyArtifactIdを刻印) → 文字あふれ検査 → PNG生成 → 成果物登録。
 * CLI(company render)とテストの双方から使う。
 */
import path from "node:path";
import type { Db } from "../db/client";
import {
  createTask,
  startTask,
  failTask,
  addRenderArtifacts,
  getPostContent,
} from "../db/store";
import { buildSpecFromContent } from "../../core/templates/tpl-howto";
import { renderCarousel, OverflowError } from "./renderer";
import { findRepoRoot } from "../root";
import { todayLocal } from "../../core/ids";

export type RenderPostResult =
  | { skipped: true; taskId: string; message: string }
  | {
      skipped: false;
      taskId: string;
      pageCount: number;
      files: string[];
      specArtifactId: string;
      imageArtifactIds: string[];
    };

/**
 * 文字あふれ時: renderタスクを即failed(fatal)+琴葉への短縮タスクを自動生成した上でOverflowErrorを再throwする。
 */
export async function renderPost(
  db: Db,
  postId: string,
  actor = "system",
  opts: { outDirBase?: string } = {},
): Promise<RenderPostResult> {
  const { post, plan, copy, copyVersion, copyArtifactId } = getPostContent(db, postId);
  if (!plan) throw new Error(`投稿 ${postId} に post_plan 成果物がありません`);
  if (!copy || copyVersion === null || !copyArtifactId) throw new Error(`投稿 ${postId} に copy 成果物がありません`);

  const spec = buildSpecFromContent(plan, copyArtifactId, copy.slides);
  const { task, created } = createTask(
    db,
    {
      type: "render",
      title: `カルーセル生成 v${copyVersion}: ${post.title}`.slice(0, 120),
      assigneeId: "emp_tsumugi",
      postId,
      stepKey: `render-${copyArtifactId}`,
      priority: 5,
    },
    todayLocal(),
    actor,
  );
  if (!created && task.status === "done") {
    return { skipped: true, taskId: task.id, message: `copy v${copyVersion} は既にレンダリング済み(冪等)` };
  }
  if (task.status === "queued") startTask(db, task.id, actor);

  const base = opts.outDirBase ?? path.join(findRepoRoot(), "data", "workspace", "05_generated-posts");
  const outDir = path.join(base, postId, `v${copyVersion}`);
  try {
    const result = await renderCarousel(spec, outDir);
    const saved = addRenderArtifacts(db, task.id, spec, result.files, actor);
    return { skipped: false, taskId: task.id, pageCount: result.pageCount, files: result.files, ...saved };
  } catch (err) {
    if (err instanceof OverflowError) {
      failTask(db, task.id, err.message, actor, { fatal: true });
      createTask(
        db,
        {
          type: "write_copy",
          title: `文字あふれ修正: ${post.title}`.slice(0, 120),
          assigneeId: "emp_kotoha",
          postId,
          stepKey: `copy-shorten-${copyArtifactId}`,
          priority: 3,
          input: {
            overflows: err.overflows.map((o) => ({ slot: o.slotPath, over: `${Math.ceil(o.measuredHeight)}px/${o.maxHeight}px` })),
          },
        },
        todayLocal(),
        actor,
      );
      throw err;
    }
    failTask(db, task.id, err instanceof Error ? err.message : String(err), actor, { fatal: true });
    throw err;
  }
}
