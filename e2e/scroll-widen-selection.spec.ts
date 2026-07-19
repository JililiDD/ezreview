import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-native-scroll-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "table.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 6030 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("mouse wheel keeps its native scrolling behavior while Review Mode is on", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#cell-0-0").hover();

  await page.mouse.wheel(0, 400);

  await expect.poll(() => frame.locator("body").evaluate((body) => body.ownerDocument!.defaultView!.scrollY)).toBeGreaterThan(0);
});

test("mouse wheel no longer widens the hovered element selection", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const highlight = page.locator("#element-highlight");
  await frame.locator("#cell-0-0").hover();

  const cellBox = await frame.locator("#cell-0-0").boundingBox();
  await page.mouse.wheel(0, 40);
  const highlightBox = await highlight.boundingBox();

  expect(Math.abs(highlightBox!.width - cellBox!.width)).toBeLessThan(2);
  expect(Math.abs(highlightBox!.height - cellBox!.height)).toBeLessThan(2);
});
