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

let dir: string;
let artifactPath: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-text-sel-e2e-"));
  artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 5400 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("selecting text opens the draft comment bubble directly, Review on", async ({ page }) => {
  await page.goto(handle.url);
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "true");

  await selectWholeElementText(page, "#mid-span");

  await expect(page.locator(".bubble-draft")).toBeVisible();
  await expect(page.locator(".bubble-draft textarea")).toBeFocused();
});

test("selecting text does not open a draft comment bubble when Review is off", async ({ page }) => {
  await page.goto(handle.url);
  await page.locator("#review-switch").click();
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "false");

  await selectWholeElementText(page, "#mid-span");

  await expect(page.locator(".bubble-draft")).toHaveCount(0);
});

test("re-enabling Review restores the ability to open a draft via text selection", async ({ page }) => {
  await page.goto(handle.url);
  await page.locator("#review-switch").click();
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "false");

  await page.locator("#review-switch").click();
  await expect(page.locator("#review-switch")).toHaveAttribute("data-on", "true");

  await selectWholeElementText(page, "#mid-span");

  await expect(page.locator(".bubble-draft")).toBeVisible();
});

test("selecting a new span while a draft is already open replaces it with a fresh draft", async ({ page }) => {
  await page.goto(handle.url);
  await selectWholeElementText(page, "#mid-span");
  await expect(page.locator(".bubble-draft")).toHaveCount(1);

  await selectWholeElementText(page, "#mid-span");
  await expect(page.locator(".bubble-draft")).toHaveCount(1);
});

test("the draft bubble is positioned near the selection's bounding box", async ({ page }) => {
  await page.goto(handle.url);
  const frame = page.frameLocator("#artifact-frame");
  await selectWholeElementText(page, "#mid-span");

  const draft = page.locator(".bubble-draft");
  await expect(draft).toBeVisible();
  const draftBox = await draft.boundingBox();
  const spanBox = await frame.locator("#mid-span").boundingBox();
  expect(draftBox).not.toBeNull();
  expect(spanBox).not.toBeNull();
  // draft should be roughly below/near the selection, not somewhere unrelated
  expect(Math.abs(draftBox!.y - spanBox!.y)).toBeLessThan(80);
});

test("a live-reload while a text-selection draft is open closes it and shows a reselect hint", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ezreview-text-sel-reload-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5410 });

  try {
    await page.goto(localHandle.url);
    await selectWholeElementText(page, "#mid-span");
    await expect(page.locator(".bubble-draft")).toBeVisible();

    writeFileSync(localArtifact, "<html><body><p>reloaded content</p></body></html>");

    await expect(page.locator(".bubble-draft")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator("#status-text")).toHaveText("Selection cleared — please reselect");
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});
