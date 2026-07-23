import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ezreview-reply-formatting-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "bubble-queue.html"), artifactPath);
  const handle = await startReviewServer({ artifactPath, basePort });
  return { dir, handle };
}

async function cleanup(dir: string, handle: ReviewServerHandle) {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
}

test("agent replies preserve line breaks and paragraph spacing", async ({ page }) => {
  const { dir, handle } = await startWithFixture(6215);
  try {
    await page.goto(handle.url);
    await page.frameLocator("#artifact-frame").locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("show the full answer");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#submit-review").click();

    const id = await page.locator(".bubble").getAttribute("data-annotation-id");
    const text = "First paragraph\n\nSecond paragraph";
    const response = await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text }),
    });
    expect(response.status).toBe(200);

    const answer = page.locator(".answer-text");
    await expect(answer).toHaveCSS("white-space", "pre-wrap");
    await expect(answer).toHaveCSS("overflow-wrap", "anywhere");
    await expect(answer).toHaveText(text, { useInnerText: false });
    const box = await answer.boundingBox();
    expect(box!.height).toBeGreaterThan(30);
  } finally {
    await cleanup(dir, handle);
  }
});
