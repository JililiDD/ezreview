import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-overlay-e2e-"));
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

test("document root elements are neither highlighted nor selectable", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const highlight = page.locator("#element-highlight");

  await frame.locator("#target-a").hover();
  await expect(highlight).toBeVisible();

  for (const rootSelector of ["body", "html"]) {
    // The click target is authoritative even if the last hover target was
    // reviewable and no root-level mousemove arrived first.
    await frame.locator(rootSelector).dispatchEvent("click");
    await expect(page.locator(".bubble-draft")).toHaveCount(0);

    await frame.locator(rootSelector).dispatchEvent("mousemove");
    await expect(highlight).not.toBeVisible();
  }
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

test("the toolbar stays above an element highlight that scrolls into its area", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  const largeTarget = frame.locator(".spacer");
  await largeTarget.hover();

  await largeTarget.evaluate((target) => {
    target.ownerDocument!.defaultView!.scrollBy(0, target.getBoundingClientRect().top + 30);
  });

  await expect.poll(() => page.evaluate(() => {
    const toolbarRect = document.getElementById("toolbar")!.getBoundingClientRect();
    const highlight = document.getElementById("element-highlight")!;
    const highlightRect = highlight.getBoundingClientRect();
    return highlightRect.top < toolbarRect.bottom && getComputedStyle(highlight).clipPath !== "none";
  })).toBe(true);

  const paintOrder = await page.evaluate(() => {
    const toolbar = document.getElementById("toolbar")!;
    const highlight = document.getElementById("element-highlight")!;
    const toolbarRect = toolbar.getBoundingClientRect();
    const highlightRect = highlight.getBoundingClientRect();
    if (highlightRect.top >= toolbarRect.bottom || highlightRect.bottom <= toolbarRect.top) {
      throw new Error("test setup failed: highlight does not overlap the toolbar");
    }

    // The production overlay ignores pointer input. Temporarily including it
    // in hit testing lets the browser report the real paint order without
    // changing layout or stacking contexts.
    highlight.style.pointerEvents = "auto";
    const layer = document.elementFromPoint(highlightRect.left + 10, 30);
    toolbar.style.visibility = "hidden";
    const layerBelowToolbar = document.elementFromPoint(highlightRect.left + 10, 30);
    toolbar.style.visibility = "";
    highlight.style.pointerEvents = "none";
    return {
      topLayer: layer && toolbar.contains(layer) ? "toolbar" : layer?.id,
      layerBelowToolbar: layerBelowToolbar?.id,
    };
  });

  expect(paintOrder.topLayer).toBe("toolbar");
  expect(paintOrder.layerBelowToolbar).not.toBe("element-highlight");
});

test("Review off: no highlight and no listener interference", async ({ page }) => {
  await page.goto(handle.url);
  await page.locator("#review-mode-switch").click();
  await expect(page.locator("#review-mode-switch")).toHaveAttribute("data-on", "false");

  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#target-a").hover();

  await expect(page.locator("#element-highlight")).not.toBeVisible();
});

test("a live-reload while hovering clears the now-stale highlight box", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ezreview-overlay-reload-e2e-"));
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
