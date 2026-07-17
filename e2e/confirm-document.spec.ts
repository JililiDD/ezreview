import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-board-confirm-document-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", fixtureName), artifactPath);
  const sessionDir = join(dir, "session");
  const handle = await startReviewServer({ artifactPath, basePort, sessionDir });
  return { dir, artifactPath, sessionDir, handle };
}

async function cleanup(dir: string, handle: ReviewServerHandle) {
  await handle.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

test("Confirm document sits in the toolbar's former Send all slot; Send all now lives in the rail footer", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6300);
  try {
    await page.goto(handle.url);

    await expect(page.locator("#toolbar #confirm-document")).toHaveText("Confirm document");
    await expect(page.locator("#rail-footer #send-all")).toHaveText("Send all (0)");
  } finally {
    await cleanup(dir, handle);
  }
});

test("clicking Confirm document while the queue is non-empty is blocked with a status message, no confirm dialog", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6310);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();

    let dialogShown = false;
    page.on("dialog", (dialog) => {
      dialogShown = true;
      void dialog.dismiss();
    });

    await page.locator("#confirm-document").click();
    await expect(page.locator("#status-text")).toHaveText("Send or clear the queue first");
    expect(dialogShown).toBe(false);
  } finally {
    await cleanup(dir, handle);
  }
});

test("clicking Confirm document with an empty queue shows a native confirm dialog, and confirming resets the session", async ({
  page,
}) => {
  const { dir, sessionDir, handle } = await startWithFixture("bubble-queue.html", 6320);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("why is this here?");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    expect(existsSync(join(sessionDir, "threads.jsonl"))).toBe(true);

    let dialogMessage = "";
    page.on("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await page.locator("#confirm-document").click();
    await expect.poll(() => dialogMessage).not.toBe("");
    expect(dialogMessage.length).toBeGreaterThan(0);

    await expect(page.locator("#status-dot")).toHaveClass(/disconnected/, { timeout: 3000 });
    expect(existsSync(join(sessionDir, "threads.jsonl"))).toBe(false);
    expect(existsSync(join(sessionDir, "feedback-queue.jsonl"))).toBe(false);
    expect(existsSync(join(sessionDir, "submitted-ids.jsonl"))).toBe(false);
  } finally {
    await cleanup(dir, handle);
  }
});
