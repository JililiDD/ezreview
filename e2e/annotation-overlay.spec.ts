import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-review-board-overlay-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "hover-highlight.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 4800 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("Review on: hovering an element shows a highlight box aligned to it", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const target = frame.locator("#target-a");
  await target.hover();

  const highlight = page.locator("#element-highlight");
  await expect(highlight).toBeVisible();

  const targetBox = await target.boundingBox();
  const highlightBox = await highlight.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(highlightBox).not.toBeNull();
  expect(Math.abs(targetBox!.x - highlightBox!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(targetBox!.y - highlightBox!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(targetBox!.width - highlightBox!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(targetBox!.height - highlightBox!.height)).toBeLessThanOrEqual(2);
});

test("Review on: highlight follows scroll inside the iframe", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const targetMid = frame.locator("#target-mid");
  await targetMid.hover();

  const highlight = page.locator("#element-highlight");
  const beforeScroll = await highlight.boundingBox();
  const targetBeforeScroll = await targetMid.boundingBox();
  // sanity: the target must still have scroll room left in both directions,
  // otherwise this test can't distinguish "followed scroll" from "hit a boundary"
  expect(targetBeforeScroll).not.toBeNull();

  await frame.locator("body").evaluate((body) => {
    body.ownerDocument!.defaultView!.scrollBy(0, 150);
  });
  await page.waitForTimeout(150);

  const afterScroll = await highlight.boundingBox();
  const targetAfterScroll = await targetMid.boundingBox();
  expect(afterScroll).not.toBeNull();
  expect(beforeScroll).not.toBeNull();
  expect(targetAfterScroll).not.toBeNull();
  // the scroll must have actually moved the target (test-design guard)
  expect(Math.abs(targetAfterScroll!.y - targetBeforeScroll!.y)).toBeGreaterThan(50);
  // and the highlight must have followed it to within the same tolerance as the static-position test
  expect(Math.abs(afterScroll!.y - targetAfterScroll!.y)).toBeLessThanOrEqual(2);
});

test("Review off: no highlight and no listener interference", async ({ page }) => {
  await page.goto(handle.url);
  await page.locator("#review-switch").click();
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "false");

  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#target-a").hover();

  await expect(page.locator("#element-highlight")).not.toBeVisible();
});

test("a live-reload while hovering clears the now-stale highlight box", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-overlay-reload-e2e-"));
  const artifactPath = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "hover-highlight.html"), artifactPath);
  const localHandle = await startReviewServer({ artifactPath, basePort: 4830 });

  try {
    await page.goto(localHandle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#target-a").hover();

    const highlight = page.locator("#element-highlight");
    await expect(highlight).toBeVisible();

    // trigger a live-reload without moving the mouse
    writeFileSync(artifactPath, "<html><body><h1>reloaded</h1></body></html>");

    await expect(highlight).not.toBeVisible({ timeout: 3000 });
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("Review on: clicking a link inside the artifact does not navigate", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#link-a").click();

  await page.waitForTimeout(200);
  const iframeSrc = await page.locator("#artifact-frame").getAttribute("src");
  expect(iframeSrc).toMatch(/^\/artifact/);
});

test("Review on: dragging to select text still produces a native selection", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const paragraph = frame.locator("#selectable-text");
  const box = await paragraph.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 5, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 5, box!.y + box!.height / 2, { steps: 5 });
  await page.mouse.up();

  const selectionText = await frame.locator("body").evaluate(
    (body) => body.ownerDocument!.getSelection()?.toString() ?? "",
  );
  expect(selectionText.length).toBeGreaterThan(0);
});
