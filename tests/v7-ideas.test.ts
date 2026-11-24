/**
 * V7: 代表者アイデアボックス。
 * 登録・見送りはowner専用、aoiは実行状態の前進のみ、doneにはresolution必須。
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import { ensureSeedOrg } from "@adapters/db/store";
import { addOwnerIdea, listOwnerIdeas, updateOwnerIdea } from "@adapters/db/ideas";

let dir: string, opened: OpenedDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-ideas-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("V7 代表者アイデアボックス", () => {
  it("登録はowner専用で、空文は拒否する", () => {
    expect(() => addOwnerIdea(opened.db, "お客様の声を投稿に入れたい", "aoi")).toThrow(/代表者/);
    expect(() => addOwnerIdea(opened.db, "   ", "owner")).toThrow(/空/);
    const { ideaId } = addOwnerIdea(opened.db, "お客様の声を投稿に入れたい", "owner");
    const ideas = listOwnerIdeas(opened.db, { status: "new" });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.id).toBe(ideaId);
  });

  it("aoiは実行状態を前進でき、doneにはresolutionが必須", () => {
    const { ideaId } = addOwnerIdea(opened.db, "祭りの時期に合わせた投稿をしたい", "owner");
    expect(() => updateOwnerIdea(opened.db, ideaId, { status: "done" }, "aoi")).toThrow(/resolution/);
    const planned = updateOwnerIdea(opened.db, ideaId, { status: "in_progress", resolution: "本日の投稿企画へ反映", refPostId: "post-1" }, "aoi");
    expect(planned.status).toBe("in_progress");
    expect(planned.resolutionRefJson).toContain("post-1");
    const done = updateOwnerIdea(opened.db, ideaId, { status: "done", resolution: "投稿「秋祭り前のHP見直し」として承認待ち" }, "aoi");
    expect(done.status).toBe("done");
  });

  it("見送り(declined)はowner専用で理由必須。aoiの巻き戻しも拒否する", () => {
    const { ideaId } = addOwnerIdea(opened.db, "動画投稿もやってみたい", "owner");
    expect(() => updateOwnerIdea(opened.db, ideaId, { status: "declined", resolution: "却下" }, "aoi")).toThrow(/代表者/);
    expect(() => updateOwnerIdea(opened.db, ideaId, { status: "declined" }, "owner")).toThrow(/理由/);
    const declined = updateOwnerIdea(opened.db, ideaId, { status: "declined", resolution: "動画は現体制では品質担保できないため見送り" }, "owner");
    expect(declined.status).toBe("declined");
    // aoiはdeclinedからの遷移不可(復活はownerのみ)
    expect(() => updateOwnerIdea(opened.db, ideaId, { status: "planned" }, "aoi")).toThrow(/遷移/);
    const revived = updateOwnerIdea(opened.db, ideaId, { status: "new" }, "owner");
    expect(revived.status).toBe("new");
  });

  it("owner/aoi以外は更新できない", () => {
    const { ideaId } = addOwnerIdea(opened.db, "テスト", "owner");
    expect(() => updateOwnerIdea(opened.db, ideaId, { status: "planned" }, "sora")).toThrow(/のみ/);
  });
});
