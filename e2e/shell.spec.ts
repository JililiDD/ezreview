import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

let dir: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-review-board-e2e-"));
  const artifactPath = join(dir, "demo.html");
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
  await expect(toolbar).toHaveCSS("height", "40px");
  await expect(toolbar).toHaveCSS("background-color", "rgb(23, 24, 28)");

  const reviewSwitch = page.locator("#review-switch");
  await expect(reviewSwitch).toHaveAttribute("data-on", "true");

  const frame = page.frameLocator("#artifact-frame");
  await expect(frame.locator("h1")).toHaveText("Demo artifact");
});
