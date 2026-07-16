import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function selectWholeElementText(page: import("@playwright/test").Page, iframeSelector: string) {
  await page.evaluate((sel) => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    const el = doc.querySelector(sel)!;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, iframeSelector);
}

async function clearSelectionAndMouseUp(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.getSelection()!.removeAllRanges();
    doc.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

let dir: string;
let artifactPath: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-review-board-text-sel-e2e-"));
  artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 5400 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("selecting text shows the + Add comment button, Review on", async ({ page }) => {
  await page.goto(handle.url);
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "true");

  await selectWholeElementText(page, "#mid-span");

  await expect(page.locator("#add-comment-button")).toBeVisible();
});

test("selecting text shows the + Add comment button even with Review off", async ({ page }) => {
  await page.goto(handle.url);
  await page.locator("#review-switch").click();
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "false");

  await selectWholeElementText(page, "#mid-span");

  await expect(page.locator("#add-comment-button")).toBeVisible();
});

test("clearing the selection hides the button", async ({ page }) => {
  await page.goto(handle.url);
  await selectWholeElementText(page, "#mid-span");
  await expect(page.locator("#add-comment-button")).toBeVisible();

  await clearSelectionAndMouseUp(page);

  await expect(page.locator("#add-comment-button")).not.toBeVisible();
});

test("the button is positioned near the selection's bounding box", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await selectWholeElementText(page, "#mid-span");

  const button = page.locator("#add-comment-button");
  await expect(button).toBeVisible();
  const buttonBox = await button.boundingBox();
  const spanBox = await frame.locator("#mid-span").boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(spanBox).not.toBeNull();
  // button should be roughly above/near the selection, not somewhere unrelated
  expect(Math.abs(buttonBox!.y - spanBox!.y)).toBeLessThan(60);
});

test("a live-reload while the button is showing hides it and shows a reselect hint", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-text-sel-reload-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5410 });

  try {
    await page.goto(localHandle.url);
    await selectWholeElementText(page, "#mid-span");
    await expect(page.locator("#add-comment-button")).toBeVisible();

    writeFileSync(localArtifact, "<html><body><p>reloaded content</p></body></html>");

    await expect(page.locator("#add-comment-button")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator("#status-text")).toHaveText("Selection cleared — please reselect");
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});
