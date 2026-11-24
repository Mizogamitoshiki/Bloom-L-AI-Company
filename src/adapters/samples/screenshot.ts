/**
 * V10 サンプルサイトの撮影(通常コード・Playwright/Chromium)。docs/32 §6.3
 * - ローカルの静的HTMLを file:// で開き、http(s)への全リクエストを遮断する(外部取得を構造的に不可能にする)
 * - PC(1440x900)/スマホ(390x844, DPR2)で、ファーストビューと全画面の計4枚をPNGで保存する
 * - 決定性のため animations を無効化し、フォント読み込みを待ってから撮影する
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
// @playwright/test(既存devDependency)が同梱するChromiumドライバを使う(追加依存なし。CLI/ローカル実行専用)
import { chromium, type Browser } from "@playwright/test";
import type { SampleScreenshotName } from "../../core/schemas";

export interface ShotSpec {
  name: SampleScreenshotName;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  fullPage: boolean;
}

export const SHOT_SPECS: readonly ShotSpec[] = [
  { name: "pc-fold", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, fullPage: false },
  { name: "pc-full", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, fullPage: true },
  { name: "sp-fold", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, fullPage: false },
  { name: "sp-full", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, fullPage: true },
];

/** 全画面撮影の高さ上限(px, DPR適用前)。極端に長いページでも撮影が止まらないようにする */
export const MAX_FULL_PAGE_HEIGHT = 6000;

export class ScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotError";
  }
}

export interface CapturedShot {
  name: SampleScreenshotName;
  absolutePath: string;
  blockedRequests: string[];
}

function isLocalFile(url: string): boolean {
  return url.startsWith("file://") || url.startsWith("about:") || url.startsWith("data:");
}

/**
 * index.html(絶対パス)を撮影して outDir に <name>.png を保存する。
 * 外部URLへのリクエストは全て abort し、発生したURLを blockedRequests に記録する(検査用)。
 */
export async function captureSiteScreenshots(indexHtmlAbs: string, outDir: string, specs: readonly ShotSpec[] = SHOT_SPECS): Promise<CapturedShot[]> {
  if (!path.isAbsolute(indexHtmlAbs)) throw new ScreenshotError("撮影対象は絶対パスで指定してください");
  mkdirSync(outDir, { recursive: true });
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new ScreenshotError(
      `Chromiumを起動できません(pnpm e2e:install で導入してください): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const results: CapturedShot[] = [];
  try {
    for (const spec of specs) {
      const context = await browser.newContext({
        viewport: { width: spec.width, height: spec.height },
        deviceScaleFactor: spec.deviceScaleFactor,
        isMobile: spec.isMobile,
        hasTouch: spec.isMobile,
        offline: false,
        reducedMotion: "reduce",
        locale: "ja-JP",
      });
      const blocked: string[] = [];
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (isLocalFile(url)) return route.continue();
        blocked.push(url);
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      const fileUrl = `file://${indexHtmlAbs}`;
      await page.goto(fileUrl, { waitUntil: "load", timeout: 30_000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      // DOM型を持たないNode側からは文字列式で評価する(tsconfigのlibにdomを足さない)
      await page.evaluate("document.fonts ? document.fonts.ready : null");
      const absolutePath = path.join(outDir, `${spec.name}.png`);
      if (spec.fullPage) {
        const pageHeight = Number(
          await page.evaluate("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)"),
        );
        const height = Math.min(Math.max(pageHeight, spec.height), MAX_FULL_PAGE_HEIGHT);
        await page.screenshot({ path: absolutePath, type: "png", clip: { x: 0, y: 0, width: spec.width, height }, fullPage: true });
      } else {
        await page.screenshot({ path: absolutePath, type: "png", fullPage: false });
      }
      await context.close();
      results.push({ name: spec.name, absolutePath, blockedRequests: blocked });
    }
  } finally {
    await browser.close();
  }
  return results;
}
