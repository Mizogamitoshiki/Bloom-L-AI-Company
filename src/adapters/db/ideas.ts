/**
 * V7: 代表者アイデアボックス。
 * 不変条件:
 * - アイデアの登録・見送り(declined)はowner専用
 * - オーケストレーター(aoi)は実行状態の前進(new→planned→in_progress→done)と実現内容の記録だけができる
 * - アイデアは投稿・タスクへの「入力」であり、公開ゲート(QA・承認)を一切迂回しない
 * - doneにはresolution(どう実現したか)が必須。空のまま完了にできない
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import * as t from "./schema";
import { audit } from "./store";
import { nowIso, ulid } from "../../core/ids";

export const IDEA_STATUSES = ["new", "planned", "in_progress", "done", "declined"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export type OwnerIdeaRow = typeof t.ownerIdeas.$inferSelect;

const MAX_IDEA_LENGTH = 500;

export function addOwnerIdea(db: Db, text: string, actor: string): { ideaId: string } {
  if (actor !== "owner") throw new Error("アイデアの登録は代表者(owner)のみ行えます");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("アイデアの本文が空です");
  if (trimmed.length > MAX_IDEA_LENGTH) {
    throw new Error(`アイデアは${MAX_IDEA_LENGTH}文字以内で入力してください(現在${trimmed.length}文字)`);
  }
  const id = ulid();
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(t.ownerIdeas).values({ id, text: trimmed, status: "new", createdAt: now, updatedAt: now }).run();
    audit(tx, actor, "owner_idea_added", "owner_idea", id, { length: trimmed.length });
  });
  return { ideaId: id };
}

export function listOwnerIdeas(db: Db, options: { status?: string } = {}): OwnerIdeaRow[] {
  const base = db.select().from(t.ownerIdeas);
  const rows = options.status
    ? base.where(eq(t.ownerIdeas.status, options.status)).orderBy(desc(t.ownerIdeas.createdAt)).all()
    : base.orderBy(desc(t.ownerIdeas.createdAt)).all();
  return rows;
}

/** aoi(オーケストレーター)が進められる遷移。declinedはowner専用 */
const AOI_TRANSITIONS: Record<string, IdeaStatus[]> = {
  new: ["planned", "in_progress", "done"],
  planned: ["in_progress", "done"],
  in_progress: ["done"],
};

export function updateOwnerIdea(
  db: Db,
  ideaId: string,
  input: { status: string; resolution?: string; refPostId?: string; refTaskId?: string },
  actor: string,
): OwnerIdeaRow {
  if (!(IDEA_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error(`不正なstatusです: ${input.status}(${IDEA_STATUSES.join(" / ")})`);
  }
  const status = input.status as IdeaStatus;
  const row = db.select().from(t.ownerIdeas).where(eq(t.ownerIdeas.id, ideaId)).get();
  if (!row) throw new Error(`アイデアが見つかりません: ${ideaId}`);

  if (actor === "owner") {
    // ownerは任意の状態へ変更できる(見送り・復活・完了の訂正を含む)
  } else if (actor === "aoi") {
    const allowed = AOI_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(status)) {
      throw new Error(
        `aoiはこの遷移を行えません: ${row.status} → ${status}(見送りや巻き戻しは代表者のみ)`,
      );
    }
  } else {
    throw new Error("アイデアの更新は代表者(owner)またはオーケストレーター(aoi)のみ行えます");
  }

  if (status === "done" && !input.resolution?.trim() && !row.resolution) {
    throw new Error("完了(done)にはresolution(どう実現したか)の記録が必要です");
  }
  if (status === "declined" && actor === "owner" && !input.resolution?.trim() && !row.resolution) {
    throw new Error("見送り(declined)には理由(resolution)の記録が必要です");
  }

  const refJson =
    input.refPostId || input.refTaskId
      ? JSON.stringify({ ...(input.refPostId ? { postId: input.refPostId } : {}), ...(input.refTaskId ? { taskId: input.refTaskId } : {}) })
      : row.resolutionRefJson;
  db.transaction((tx) => {
    tx.update(t.ownerIdeas)
      .set({
        status,
        resolution: input.resolution?.trim() || row.resolution,
        resolutionRefJson: refJson,
        updatedAt: nowIso(),
      })
      .where(eq(t.ownerIdeas.id, ideaId))
      .run();
    audit(tx, actor, "owner_idea_updated", "owner_idea", ideaId, { from: row.status, to: status });
  });
  return db.select().from(t.ownerIdeas).where(eq(t.ownerIdeas.id, ideaId)).get()!;
}
