/**
 * V10 サンプルサイトのビルド(通常コード)。docs/32 §6.3
 * 颯の site_sample JSON → スキーマ検証 → 静的検査(外部URL/JS/実在情報/価格/素材参照) →
 * workspace/02_site-samples/<requestId>/v<n>/ へ書き出し(robots noindex・サンプル帯を注入) →
 * Playwright(ネットワーク遮断)で撮影 → SHA-256刻印 → site_samples 登録 → 紬の視覚QAタスクを自動生成。
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { createTask, failTask, submitArtifact } from "../db/store";
import { assertSiteSampleLimit, getSampleRequest, latestSiteSampleForRequest, recordSiteSample, setSampleRequestStatus, type SiteSampleRow } from "../db/samples";
import { siteSampleArtifactSchema, type SampleScreenshotRef, type SiteSampleArtifact } from "../../core/schemas";
import { findSampleIntegrityViolations } from "../../core/sample-guards";
import { describeScreenshot, resolveSampleAssetFile, sampleVersionDir, SAMPLE_SHOTS_DIR } from "../render/sample-media";
import { captureSiteScreenshots } from "./screenshot";
import { workspaceRoot } from "../root";
import { todayLocal } from "../../core/ids";

export class SampleBuildError extends Error {
  constructor(message: string, readonly violations: string[] = []) {
    super(message);
    this.name = "SampleBuildError";
  }
}

export interface BuildSiteSampleResult {
  sampleId: string;
  requestId: string;
  version: number;
  dirPath: string;
  files: string[];
  screenshots: SampleScreenshotRef[];
  artifactId: string;
  designQaTaskId: string;
}

const NOTICE_HTML =
  '<div class="bl-sample-notice" style="position:relative;z-index:2147483647;background:#1b2a4a;color:#fff;font:700 14px/1.6 sans-serif;text-align:center;padding:10px 16px;letter-spacing:.04em">サンプルサイト(架空)— Bloom-L制作サンプル。実在の事業者ではありません。</div>';
const ROBOTS_META = '<meta name="robots" content="noindex,nofollow">';
const STYLE_LINK = '<link rel="stylesheet" href="./style.css">';

/** 通常コードが注入する固定要素(颯は書かない): robots noindex・style.css参照・サンプル帯 */
export function decorateSampleHtml(html: string): string {
  let out = html;
  if (!/<meta\s+[^>]*name\s*=\s*["']robots["']/i.test(out)) {
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${ROBOTS_META}`) : `${ROBOTS_META}\n${out}`;
  }
  if (!/href\s*=\s*["']\.\/style\.css["']/i.test(out)) {
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${STYLE_LINK}\n</head>`) : `${STYLE_LINK}\n${out}`;
  }
  if (!out.includes('class="bl-sample-notice"')) {
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${NOTICE_HTML}\n</body>`) : `${out}\n${NOTICE_HTML}`;
  }
  return out;
}

function sha256(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

/**
 * 颯のタスク(type=build_site, assignee=emp_hayate, running)に対して実行する。
 * 検査NGは failTask(retry上限まで再提出可)+SampleBuildError。撮影失敗も同様。
 */
export async function buildSiteSample(db: Db, taskId: string, content: unknown, actor: string): Promise<BuildSiteSampleResult> {
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) throw new SampleBuildError(`タスクが見つかりません: ${taskId}`);
  if (task.type !== "build_site") throw new SampleBuildError(`sample-buildはtype=build_siteのタスクからのみ実行できます(現在: ${task.type})`);
  if (task.assigneeId !== "emp_hayate") throw new SampleBuildError(`sample-buildはWeb制作担当(emp_hayate)のタスクからのみ実行できます(現在: ${task.assigneeId})`);
  if (task.status !== "running") throw new SampleBuildError(`runningでないタスクには提出できません(現在: ${task.status})`);

  const parsed = siteSampleArtifactSchema.safeParse(content);
  if (!parsed.success) {
    const msg = `site_sampleの検証エラー: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / ")}`;
    failTask(db, taskId, msg.slice(0, 1000), actor);
    throw new SampleBuildError(msg);
  }
  const artifact: SiteSampleArtifact = parsed.data;
  const { request, assets } = getSampleRequest(db, artifact.requestId);
  if (request.status === "declined" || request.status === "posted") {
    throw new SampleBuildError(`この依頼は${request.status}のためビルドできません`);
  }
  const attested = assets.filter((a) => a.kind !== "reference").map((a) => a.fileName);
  const reference = assets.filter((a) => a.kind === "reference").map((a) => a.fileName);
  const violations = findSampleIntegrityViolations(artifact, attested, reference);
  if (violations.length > 0) {
    const msg = `サンプルの静的検査で${violations.length}件の違反: ${violations.map((v) => v.detail).join(" / ")}`;
    failTask(db, taskId, msg.slice(0, 1000), actor);
    throw new SampleBuildError(msg, violations.map((v) => v.detail));
  }
  assertSiteSampleLimit(db);

  // 書き出し(既存versionは触らない。冪等: 同じ依頼の再ビルドは次のversionへ)
  const latest: SiteSampleRow | null = latestSiteSampleForRequest(db, request.id);
  const version = (latest?.version ?? 0) + 1;
  const workspace = workspaceRoot();
  const dir = sampleVersionDir(request.id, version, workspace);
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  const files: string[] = [];
  for (const page of artifact.pages) {
    const file = path.join(dir, page.path);
    writeFileSync(file, decorateSampleHtml(page.html), "utf8");
    files.push(file);
  }
  const cssFile = path.join(dir, "style.css");
  writeFileSync(cssFile, artifact.css, "utf8");
  files.push(cssFile);
  for (const name of artifact.assetsUsed) {
    const src = resolveSampleAssetFile(request.id, name, workspace);
    const dst = path.join(dir, "assets", name);
    copyFileSync(src.absolutePath, dst);
    files.push(dst);
  }
  const htmlSha256 = sha256(...artifact.pages.map((p) => p.html), artifact.css);
  setSampleRequestStatus(db, request.id, "building", actor, { version });

  // 撮影(ネットワーク遮断)
  let screenshots: SampleScreenshotRef[];
  try {
    const shots = await captureSiteScreenshots(path.join(dir, "index.html"), path.join(dir, SAMPLE_SHOTS_DIR));
    const blocked = shots.flatMap((s) => s.blockedRequests);
    if (blocked.length > 0) {
      throw new SampleBuildError(`撮影中に外部リクエストを検出(遮断済み): ${[...new Set(blocked)].slice(0, 5).join(", ")}`);
    }
    screenshots = [];
    for (const s of shots) {
      // eslint-disable-next-line no-await-in-loop
      screenshots.push(await describeScreenshot(s.absolutePath, s.name, workspace));
      files.push(s.absolutePath);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    failTask(db, taskId, `撮影に失敗: ${msg}`.slice(0, 1000), actor);
    throw error instanceof SampleBuildError ? error : new SampleBuildError(`撮影に失敗: ${msg}`);
  }

  // 成果物登録(タスク完了)→ site_samples 登録 → 紬の視覚QAタスク
  const { artifactId } = submitArtifact(db, taskId, artifact, actor, { estOutputChars: JSON.stringify(artifact).length });
  const sample = recordSiteSample(
    db,
    {
      requestId: request.id,
      siteTitle: artifact.siteTitle,
      concept: artifact.concept,
      planFit: artifact.planFit,
      planFitReason: artifact.planFitReason,
      dirPath: path.relative(workspace, dir).split(path.sep).join("/"),
      htmlSha256,
      screenshots,
      artifactId,
      builderTaskId: taskId,
    },
    actor,
  );
  const qa = createTask(
    db,
    {
      type: "design",
      title: `サンプル画面の視覚QA: ${artifact.siteTitle}`.slice(0, 120),
      assigneeId: "emp_tsumugi",
      stepKey: `sample-qa-${sample.id}`,
      priority: 4,
      input: { sampleId: sample.id, requestId: request.id, version },
    },
    todayLocal(),
    actor,
  );
  return {
    sampleId: sample.id,
    requestId: request.id,
    version,
    dirPath: sample.dirPath,
    files,
    screenshots,
    artifactId,
    designQaTaskId: qa.task.id,
  };
}
