import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-review-board-scroll-widen-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "table.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 6030 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("hovering a cell highlights just the cell; scrolling widens to row, then table", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const highlight = page.locator("#element-highlight");

  await frame.locator("#cell-0-0").hover();
  const cellBox = await frame.locator("#cell-0-0").boundingBox();
  let highlightBox = await highlight.boundingBox();
  expect(Math.abs(highlightBox!.width - cellBox!.width)).toBeLessThan(2);
  expect(Math.abs(highlightBox!.height - cellBox!.height)).toBeLessThan(2);

  await page.mouse.wheel(0, 100);
  const rowBox = await frame.locator("#row-0").boundingBox();
  highlightBox = await highlight.boundingBox();
  expect(Math.abs(highlightBox!.width - rowBox!.width)).toBeLessThan(2);
  expect(Math.abs(highlightBox!.height - rowBox!.height)).toBeLessThan(2);
  expect(highlightBox!.width).toBeGreaterThan(cellBox!.width);

  await page.mouse.wheel(0, 100);
  const tableBox = await frame.locator("#the-table").boundingBox();
  highlightBox = await highlight.boundingBox();
  expect(Math.abs(highlightBox!.width - tableBox!.width)).toBeLessThan(2);
  expect(Math.abs(highlightBox!.height - tableBox!.height)).toBeLessThan(2);
});

test("scrolling the other way narrows the selection back down", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const highlight = page.locator("#element-highlight");

  await frame.locator("#cell-0-0").hover();
  await page.mouse.wheel(0, 100); // -> row
  await page.mouse.wheel(0, 100); // -> table
  await page.mouse.wheel(0, -100); // back down -> row

  const rowBox = await frame.locator("#row-0").boundingBox();
  const highlightBox = await highlight.boundingBox();
  expect(Math.abs(highlightBox!.width - rowBox!.width)).toBeLessThan(2);
  expect(Math.abs(highlightBox!.height - rowBox!.height)).toBeLessThan(2);
});

test("moving to hover a different cell resets the widened selection back to cell granularity", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const highlight = page.locator("#element-highlight");

  await frame.locator("#cell-0-0").hover();
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, 100); // widened all the way to the table

  await frame.locator("#cell-1-1").hover();
  const cellBox = await frame.locator("#cell-1-1").boundingBox();
  const highlightBox = await highlight.boundingBox();
  expect(Math.abs(highlightBox!.width - cellBox!.width)).toBeLessThan(2);
  expect(Math.abs(highlightBox!.height - cellBox!.height)).toBeLessThan(2);
});

test("clicking after widening annotates the widened element (the row), not the original cell", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");

  await frame.locator("#cell-0-0").hover();
  await page.mouse.wheel(0, 100); // -> row
  await frame.locator("#cell-0-0").click();
  await page.locator(".bubble-draft textarea").fill("comment on the row");
  await page.locator(".bubble-draft .bubble-add").click();

  // item.target is a real DOM element (not JSON-serializable across
  // page.evaluate), so the selector string is the check that actually
  // proves which element got annotated.
  const item = await page.evaluate(() => (window as any).__annotationQueue[0]);
  expect(item.selector).toContain("row-0");
});

test("the scroll hint in the toolbar is visible only while Review is on", async ({ page }) => {
  await page.goto(handle.url);
  const hint = page.locator("#scroll-hint");
  await expect(hint).toBeVisible();

  await page.locator("#review-switch").click();
  await expect(hint).toBeHidden();

  await page.locator("#review-switch").click();
  await expect(hint).toBeVisible();
});

test("toggling Review does not move the Review toggle itself — the hint reserves its own space either way", async ({ page }) => {
  await page.goto(handle.url);
  const toggle = page.locator("#review-toggle");
  const boxBefore = await toggle.boundingBox();

  await page.locator("#review-switch").click(); // Review off, hint hidden
  const boxOff = await toggle.boundingBox();
  expect(boxOff!.x).toBeCloseTo(boxBefore!.x, 0);

  await page.locator("#review-switch").click(); // Review on, hint visible again
  const boxOn = await toggle.boundingBox();
  expect(boxOn!.x).toBeCloseTo(boxBefore!.x, 0);
});
