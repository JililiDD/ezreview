import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let artifactPath: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ezreview-e2e-"));
  artifactPath = join(dir, "demo.html");
  writeFileSync(artifactPath, "<html><body><h1>Demo artifact</h1></body></html>");
  handle = await startReviewServer({ artifactPath, basePort: 4700 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("shell page shows the dark toolbar and loads the artifact in the iframe", async ({ page }) => {
  await page.goto(handle.url);

  const toolbar = page.locator("#toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCSS("height", "48px");
  await expect(toolbar).toHaveCSS("background-color", "rgba(18, 24, 38, 0.72)");
  await expect(page.locator("#wordmark")).toHaveText("ezreview");
  await expect(page.locator("#wordmark")).toHaveCSS("color", "rgb(78, 230, 196)");
  await expect(page.locator("#wordmark-logo")).toBeVisible();
  await expect(page.locator("#wordmark-logo")).toHaveAttribute("src", "/favicon.svg");

  const fileName = page.locator("#file-name");
  await expect(fileName).toHaveText("demo.html");
  await expect(fileName).toHaveAttribute("title", artifactPath);

  const reviewSwitch = page.locator("#review-mode-switch");
  await expect(reviewSwitch).toHaveAttribute("data-on", "true");
  await expect(page.locator("#scroll-hint")).toHaveCount(0);
  const toolbarOrder = await page.locator("#theme-toggle, #review-mode, #approve").evaluateAll((nodes) =>
    nodes.map((node) => node.id),
  );
  expect(toolbarOrder).toEqual(["theme-toggle", "review-mode", "approve"]);

  const frame = page.frameLocator("#artifact-frame");
  await expect(frame.locator("h1")).toHaveText("Demo artifact");
});

test("modifying the artifact reloads only the iframe, not the shell", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ezreview-e2e-reload-"));
  const artifactPath = join(localDir, "demo.html");
  writeFileSync(artifactPath, "<html><body><h1>v0</h1></body></html>");
  const localHandle = await startReviewServer({ artifactPath, basePort: 4710 });

  try {
    await page.goto(localHandle.url);
    const reviewSwitch = page.locator("#review-mode-switch");
    await expect(reviewSwitch).toHaveAttribute("data-on", "true");

    writeFileSync(artifactPath, "<html><body><h1>v1</h1></body></html>");

    const frame = page.frameLocator("#artifact-frame");
    await expect(frame.locator("h1")).toHaveText("v1", { timeout: 3000 });

    // the shell itself never reloaded: toolbar state survived
    await expect(reviewSwitch).toHaveAttribute("data-on", "true");
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("connection status dot turns red when the SSE stream drops", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ezreview-e2e-disconnect-"));
  const artifactPath = join(localDir, "demo.html");
  writeFileSync(artifactPath, "<html><body><h1>Demo</h1></body></html>");
  const localHandle = await startReviewServer({ artifactPath, basePort: 4720 });

  try {
    await page.goto(localHandle.url);
    const dot = page.locator("#status-dot");
    await expect(dot).not.toHaveClass(/disconnected/);

    await localHandle.close();

    await expect(dot).toHaveClass(/disconnected/, { timeout: 3000 });
    await expect(page.locator("#status-text")).toHaveText("Disconnected · retrying…");
  } finally {
    rmSync(localDir, { recursive: true, force: true });
  }
});
