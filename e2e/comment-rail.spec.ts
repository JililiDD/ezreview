import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-comment-rail-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "wide-content.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 6010 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("the artifact pane and the comment rail split the stage, rail on the right", async ({ page }) => {
  await page.goto(handle.url);
  const paneBox = await page.locator("#artifact-pane").boundingBox();
  const railBox = await page.locator("#comment-rail").boundingBox();
  expect(paneBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(railBox!.x).toBeGreaterThan(paneBox!.x + paneBox!.width - 1);
  // 280px content width + the rail's 1px left border, per content-box sizing.
  expect(railBox!.width).toBeCloseTo(281, 0);
});

test("hovering a full-width element clips the highlight box to the iframe pane, not the rail", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#wide-title").hover();

  const highlight = page.locator("#element-highlight");
  await expect(highlight).toBeVisible();

  const highlightBox = await highlight.boundingBox();
  const paneBox = await page.locator("#artifact-pane").boundingBox();
  expect(highlightBox).not.toBeNull();
  expect(paneBox).not.toBeNull();
  // The highlight must never extend past the artifact pane's right edge —
  // this was the exact real-usage complaint that motivated the side panel:
  // a full-width hover highlight used to visually cross into the comment
  // bubbles because there was no dedicated pane for them.
  expect(highlightBox!.x + highlightBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
});

test("a queued bubble sits inside the rail's horizontal bounds, never over the artifact pane", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#wide-title").click();
  await page.locator(".bubble-draft textarea").fill("too loud");
  await page.locator(".bubble-draft .bubble-add").click();

  const bubbleBox = await page.locator(".bubble").boundingBox();
  const railBox = await page.locator("#comment-rail").boundingBox();
  expect(bubbleBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(bubbleBox!.x).toBeGreaterThanOrEqual(railBox!.x - 1);
  expect(bubbleBox!.x + bubbleBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width + 1);
});

test("collapsing the rail hides bubbles and grows the artifact pane; expanding restores both", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#wide-title").click();
  await page.locator(".bubble-draft textarea").fill("collapse test");
  await page.locator(".bubble-draft .bubble-add").click();
  await expect(page.locator(".bubble")).toBeVisible();

  const paneBoxBefore = await page.locator("#artifact-pane").boundingBox();

  await page.locator("#rail-collapse").click();
  await expect(page.locator(".bubble")).toBeHidden();
  const paneBoxCollapsed = await page.locator("#artifact-pane").boundingBox();
  expect(paneBoxCollapsed!.width).toBeGreaterThan(paneBoxBefore!.width);

  await page.locator("#rail-collapse").click();
  await expect(page.locator(".bubble")).toBeVisible();
  const paneBoxExpanded = await page.locator("#artifact-pane").boundingBox();
  expect(paneBoxExpanded!.width).toBeCloseTo(paneBoxBefore!.width, 0);
});

test("dragging the rail grip resizes the rail and repositions bubbles to match", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#wide-title").click();
  await page.locator(".bubble-draft textarea").fill("resize test");
  await page.locator(".bubble-draft .bubble-add").click();

  const railBoxBefore = await page.locator("#comment-rail").boundingBox();
  const grip = page.locator("#rail-grip");
  const gripBox = await grip.boundingBox();
  expect(gripBox).not.toBeNull();

  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox!.x - 80, gripBox!.y + gripBox!.height / 2);
  await page.mouse.up();

  const railBoxAfter = await page.locator("#comment-rail").boundingBox();
  expect(railBoxAfter!.width).toBeGreaterThan(railBoxBefore!.width + 40);

  const bubbleBox = await page.locator(".bubble").boundingBox();
  expect(bubbleBox!.x).toBeGreaterThanOrEqual(railBoxAfter!.x - 1);
  expect(bubbleBox!.x + bubbleBox!.width).toBeLessThanOrEqual(railBoxAfter!.x + railBoxAfter!.width + 1);
});

test("many queued comments overflow the rail's visible height and the rail scrolls to reach them", async ({ page }) => {
  const manyDir = mkdtempSync(join(tmpdir(), "ezreview-comment-rail-many-e2e-"));
  const artifactPath = join(manyDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "many-elements.html"), artifactPath);
  const manyHandle = await startReviewServer({ artifactPath, basePort: 6020 });

  try {
    await page.goto(manyHandle.url);
    const frame = page.frameLocator("#artifact-frame");
    for (let i = 0; i < 30; i++) {
      await frame.locator("#item-" + i).click();
      await page.locator(".bubble-draft textarea").fill("a fairly long comment about item number " + i + " to give each bubble real height");
      await page.locator(".bubble-draft .bubble-add").click();
    }

    await expect(page.locator(".bubble")).toHaveCount(30);

    // With 30 real bubbles this must overflow on any reasonable viewport —
    // if it doesn't, the rail silently grew instead of staying scrollable,
    // and the original bug (content cut off with no way to reach it) is
    // back. Checked via actually moving scrollTop and confirming it took
    // effect, not just comparing scrollHeight/clientHeight once — proves the
    // element is a genuinely functioning scroll container, not merely
    // "numerically taller than its box while something else prevents
    // scrolling it" (position/overflow oddity, wrong ancestor, etc).
    const before = await page.locator("#rail-scroll").evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    // Auto-scroll from focusing the newest bubble's textarea may have already
    // moved scrollTop, so don't assume a starting value — just confirm the
    // element actually responds to being scrolled, in both directions.
    const scrolledToBottom = await page.locator("#rail-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(scrolledToBottom).toBeGreaterThan(before.clientHeight);

    const scrolledToTop = await page.locator("#rail-scroll").evaluate((el) => {
      el.scrollTop = 0;
      return el.scrollTop;
    });
    expect(scrolledToTop).toBe(0);
  } finally {
    await manyHandle.close();
    rmSync(manyDir, { recursive: true, force: true });
  }
});
