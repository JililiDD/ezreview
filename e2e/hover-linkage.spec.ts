import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let artifactPath: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-hover-linkage-e2e-"));
  artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "bubble-queue.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 5300 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("hovering a queued bubble highlights its visible source element", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("x");
  await page.locator(".bubble-draft .bubble-add").click();

  const bubble = page.locator(".bubble");
  await bubble.hover();

  const highlight = page.locator("#element-highlight");
  await expect(highlight).toBeVisible();

  const highlightBox = await highlight.boundingBox();
  const targetBox = await frame.locator("#near-top").boundingBox();
  expect(highlightBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(Math.abs(highlightBox!.x - targetBox!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(highlightBox!.y - targetBox!.y)).toBeLessThanOrEqual(2);

  await expect(bubble.locator(".anchor-lost-badge")).toHaveCount(0);
});

test("moving off the bubble hides the highlight", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("x");
  await page.locator(".bubble-draft .bubble-add").click();

  const bubble = page.locator(".bubble");
  await bubble.hover();
  await expect(page.locator("#element-highlight")).toBeVisible();

  await page.mouse.move(5, 5);
  await expect(page.locator("#element-highlight")).not.toBeVisible();
});

test("hovering a far-away bubble does not scroll, while clicking it scrolls to and highlights its source", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ezreview-hover-linkage-scroll-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "hover-linkage-scroll.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5320 });

  try {
    await page.goto(localHandle.url);
    const frame = page.frameLocator("#artifact-frame");

    // scroll to a controlled, moderate position (not all the way to the
    // target's edge) so the resulting draft bubble stays on-screen — this
    // only needs "far enough to require a real scroll", not "maximally far"
    await frame.locator("body").evaluate((body) => body.ownerDocument!.defaultView!.scrollTo(0, 300));
    await frame.locator("#far-target").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();

    // scroll back to top and hover the decoy, so currentHoverTarget is stale
    // and pointing at a different element than the queued annotation
    await frame.locator("body").evaluate((body) => body.ownerDocument!.defaultView!.scrollTo(0, 0));
    await frame.locator("#decoy").hover();
    await expect(page.locator("#element-highlight")).toBeVisible();

    const bubble = page.locator(".bubble");
    const scrollBeforeHover = await frame.locator("body").evaluate((body) => body.ownerDocument!.defaultView!.scrollY);
    await bubble.hover();
    await page.waitForTimeout(150);
    const scrollAfterHover = await frame.locator("body").evaluate((body) => body.ownerDocument!.defaultView!.scrollY);
    expect(scrollAfterHover).toBe(scrollBeforeHover);

    await bubble.click({ position: { x: 20, y: 20 } });

    const highlight = page.locator("#element-highlight");
    await expect(highlight).toBeVisible();
    const highlightBox = await highlight.boundingBox();
    const farTargetBox = await frame.locator("#far-target").boundingBox();
    expect(highlightBox).not.toBeNull();
    expect(farTargetBox).not.toBeNull();
    expect(Math.abs(highlightBox!.y - farTargetBox!.y)).toBeLessThanOrEqual(2);
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("a queued bubble whose source element was removed explains that its source was not found", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ezreview-hover-linkage-lost-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "bubble-queue.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5310 });

  try {
    const localPage = page;
    await localPage.goto(localHandle.url);
    const frame = localPage.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await localPage.locator(".bubble-draft textarea").fill("x");
    await localPage.locator(".bubble-draft .bubble-add").click();

    // simulate the agent removing the annotated element in a later edit
    writeFileSync(localArtifact, "<html><body><p>completely different content</p></body></html>");
    await localPage.waitForTimeout(1200); // past the watcher's debounce + reload

    const bubble = localPage.locator(".bubble");
    const badge = bubble.locator(".anchor-lost-badge");
    await expect(badge).toBeVisible();
    await expect(badge.locator(".anchor-lost-label")).toHaveText("Source not found");
    await expect(badge).not.toContainText("Anchor lost");
    const help = badge.locator(".anchor-lost-help");
    const tooltip = localPage.locator(".anchor-lost-tooltip");
    await expect(help).toHaveAccessibleName("Why the source could not be found");
    // The status and its help control exist before any pointer interaction,
    // so keyboard-only users can focus it directly.
    await help.focus();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("element was removed or its structure changed");

    // Exercise the narrowest supported rail and place the source badge at
    // the bottom edge. The body-level tooltip must stay inside the visible
    // scroll viewport horizontally and vertically, flipping above as needed.
    await localPage.locator("#comment-rail").evaluate((rail) => {
      (rail as HTMLElement).style.width = "180px";
    });
    await bubble.evaluate((node) => {
      (node as HTMLElement).style.marginTop = "900px";
      node.scrollIntoView({ block: "end" });
    });
    await help.blur();
    await help.focus();
    const tooltipBox = await tooltip.boundingBox();
    const railBox = await localPage.locator("#rail-scroll").boundingBox();
    expect(tooltipBox!.x).toBeGreaterThanOrEqual(railBox!.x);
    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width);
    expect(tooltipBox!.y).toBeGreaterThanOrEqual(railBox!.y);
    expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(railBox!.y + railBox!.height);
    await expect(localPage.locator("#element-highlight")).not.toBeVisible();
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});
