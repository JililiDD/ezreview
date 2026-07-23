import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";
import { writeSessionInfo } from "../src/session.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ezreview-confirm-document-e2e-"));
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

test("Confirm document sits in the toolbar's former Submit review slot; Submit review now lives in the rail footer", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6300);
  try {
    await page.goto(handle.url);

    await expect(page.locator("#toolbar #approve")).toHaveText("Approve");
    await expect(page.locator("#rail-footer #submit-review")).toHaveText("Submit review (0)");
  } finally {
    await cleanup(dir, handle);
  }
});

test("clicking Confirm document while the queue is non-empty is blocked with a status message, no confirm modal", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6310);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();

    await page.locator("#approve").click();
    await expect(page.locator("#status-text")).toHaveText("Send or clear the queue first");
    await expect(page.locator("#confirm-modal-backdrop")).not.toHaveClass(/visible/);
  } finally {
    await cleanup(dir, handle);
  }
});

test("clicking Confirm document with an empty queue shows a custom confirm modal, and confirming resets the session and locks the page read-only", async ({
  page,
}) => {
  const { dir, artifactPath, sessionDir, handle } = await startWithFixture("bubble-queue.html", 6320);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("why is this here?");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#submit-review").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    expect(existsSync(join(sessionDir, "threads.jsonl"))).toBe(true);
    writeSessionInfo(sessionDir, { port: handle.port, pid: process.pid, file: artifactPath });

    await page.locator("#approve").click();
    await expect(page.locator("#confirm-modal-backdrop")).toHaveClass(/visible/);
    await expect(page.locator("#confirm-modal")).toContainText("All feedback history will be deleted");

    await page.locator("#confirm-modal-ok").click();
    await expect(page.locator("#confirm-modal-backdrop")).not.toHaveClass(/visible/);

    await expect(page.locator("#approve")).toHaveText("Confirmed");
    await expect(page.locator("#approve")).toBeDisabled();
    await expect(page.locator("#submit-review")).toBeDisabled();
    await expect(page.locator("#status-dot")).toHaveClass(/disconnected/, { timeout: 3000 });
    expect(existsSync(sessionDir)).toBe(false);

    await expect(page.locator("#review-mode-switch")).toHaveAttribute("data-on", "false");
  } finally {
    await cleanup(dir, handle);
  }
});

test("Cancel on the confirm modal leaves the document editable", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6321);
  try {
    await page.goto(handle.url);
    await page.locator("#approve").click();
    await expect(page.locator("#confirm-modal-backdrop")).toHaveClass(/visible/);

    await page.locator("#confirm-modal-cancel").click();
    await expect(page.locator("#confirm-modal-backdrop")).not.toHaveClass(/visible/);
    await expect(page.locator("#approve")).toHaveText("Approve");
    await expect(page.locator("#approve")).toBeEnabled();
    await expect(page.locator("#submit-review")).toBeDisabled();
  } finally {
    await cleanup(dir, handle);
  }
});
