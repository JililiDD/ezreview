import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-bubble-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "bubble-queue.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 5200 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("clicking an element opens a draft bubble with Add to queue / Cancel", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();

  const draft = page.locator(".bubble-draft");
  await expect(draft).toBeVisible();
  await expect(draft.locator("textarea")).toBeVisible();
  await expect(draft.locator(".bubble-add")).toBeVisible();
  await expect(draft.locator(".bubble-cancel")).toBeVisible();
});

test("the draft bubble opens floating near the clicked element, not already inside the comment rail", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();

  const draftBox = await page.locator(".bubble-draft").boundingBox();
  const targetBox = await frame.locator("#near-top").boundingBox();
  const railBox = await page.locator("#comment-rail").boundingBox();
  expect(draftBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(railBox).not.toBeNull();

  // Near the click, not off in the rail on the other side of the page.
  expect(Math.abs(draftBox!.y - targetBox!.y)).toBeLessThan(150);
  expect(draftBox!.x).toBeLessThan(railBox!.x);

  const isInRail = await page.locator("#comment-rail .bubble-draft").count();
  expect(isInRail).toBe(0);
});

test("the draft bubble's textarea is auto-focused, ready to type without an extra click", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();

  await expect(page.locator(".bubble-draft textarea")).toBeFocused();
});

test("committing the draft (Add to queue) moves the bubble into the comment rail", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("move me into the rail");
  await page.locator(".bubble-draft .bubble-add").click();

  await expect(page.locator("#comment-rail .bubble")).toHaveCount(1);
  await expect(page.locator("body > .bubble")).toHaveCount(0);
});

test("Cancel discards the draft without touching the queue", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();

  const draft = page.locator(".bubble-draft");
  await draft.locator("textarea").fill("this should be discarded");
  await draft.locator(".bubble-cancel").click();

  await expect(page.locator(".bubble-draft")).toHaveCount(0);
  await expect(page.locator("#send-all")).toHaveText("Submit review (0)");
});

test("Add to queue transitions the bubble to queue state and increments the count", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();

  const draft = page.locator(".bubble-draft");
  await draft.locator("textarea").fill("too light");
  await draft.locator(".bubble-add").click();

  await expect(page.locator(".bubble-draft")).toHaveCount(0);
  const queued = page.locator(".bubble");
  await expect(queued).toHaveCount(1);
  await expect(queued.locator(".bubble-comment")).toHaveText("too light");
  await expect(queued.locator(".bubble-delete")).toBeVisible();
  await expect(page.locator("#send-all")).toHaveText("Submit review (1)");
});

test("annotation ids are not reused after the review page reloads", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("before reload");
  await page.locator(".bubble-draft .bubble-add").click();
  const firstId = await page.locator(".bubble").getAttribute("data-annotation-id");

  await page.reload();
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("after reload");
  await page.locator(".bubble-draft .bubble-add").click();
  const secondId = await page.locator(".bubble").getAttribute("data-annotation-id");

  expect(firstId).not.toBeNull();
  expect(secondId).not.toBeNull();
  expect(secondId).not.toBe(firstId);
});

test("Delete removes a queued bubble and decrements the count", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("x");
  await page.locator(".bubble-draft .bubble-add").click();
  await expect(page.locator("#send-all")).toHaveText("Submit review (1)");

  await page.locator(".bubble .bubble-delete").click();

  await expect(page.locator(".bubble")).toHaveCount(0);
  await expect(page.locator("#send-all")).toHaveText("Submit review (0)");
});

test("two queued bubbles with close anchors stack without overlapping", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");

  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill("first");
  await page.locator(".bubble-draft .bubble-add").click();

  await frame.locator("#near-top-2").click();
  await page.locator(".bubble-draft textarea").fill("second");
  await page.locator(".bubble-draft .bubble-add").click();

  const bubbles = page.locator(".bubble");
  await expect(bubbles).toHaveCount(2);

  const box1 = await bubbles.nth(0).boundingBox();
  const box2 = await bubbles.nth(1).boundingBox();
  expect(box1).not.toBeNull();
  expect(box2).not.toBeNull();
  // no vertical overlap: one bubble's bottom is at/above the other's top
  const noOverlap =
    box1!.y + box1!.height <= box2!.y + 1 || box2!.y + box2!.height <= box1!.y + 1;
  expect(noOverlap).toBe(true);
});

test("clicking Send all with an empty queue does not submit anything (edge case)", async ({ page }) => {
  await page.goto(handle.url);

  let feedbackRequestSeen = false;
  page.on("request", (req) => {
    if (req.url().includes("/feedback")) feedbackRequestSeen = true;
  });

  await page.locator("#send-all").click();
  await page.waitForTimeout(200);

  expect(feedbackRequestSeen).toBe(false);
});

// Real Send-all submission + Sent/History bubble states are covered in
// e2e/send-all.spec.ts (Phase 5) — this file stays focused on the
// draft->queue->delete mechanics established in Phase 3.
