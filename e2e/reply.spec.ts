import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-board-reply-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", fixtureName), artifactPath);
  const handle = await startReviewServer({ artifactPath, basePort });
  return { dir, artifactPath, handle };
}

async function cleanup(dir: string, handle: ReviewServerHandle) {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
}

async function queueAndSend(page: import("@playwright/test").Page, comment: string) {
  const frame = page.frameLocator("#artifact-frame");
  await frame.locator("#near-top").click();
  await page.locator(".bubble-draft textarea").fill(comment);
  await page.locator(".bubble-draft .bubble-add").click();
  await page.locator("#send-all").click();
  await expect(page.locator(".bubble-sent")).toBeVisible();
}

test("an agent reply renders inside the same bubble with an AGENT label, and a follow-up input stays available", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6200);
  try {
    await page.goto(handle.url);
    await queueAndSend(page, "why is this here?");

    const id = await page.locator(".bubble").getAttribute("data-annotation-id");
    expect(id).not.toBeNull();

    // simulate the agent's `reply --to <id> "<text>"` CLI command
    const res = await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: "because the API requires it" }),
    });
    expect(res.status).toBe(200);

    const bubble = page.locator(".bubble");
    await expect(bubble.locator(".answer-block .agent-label")).toHaveText("AGENT");
    await expect(bubble.locator(".answer-block .answer-text")).toHaveText("because the API requires it");

    // DAC-3: no terminal "✓ Answered" badge — threads have no terminal state.
    await expect(bubble.locator(".answered-badge")).toHaveCount(0);

    // DAC-1: the follow-up input is persistent (no click-to-expand needed),
    // and a second reply to the same id still succeeds (no answered-once cap).
    await expect(bubble.locator(".followup-controls textarea")).toBeVisible();

    const secondRes = await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: "it's part of the ISO 8601 spec" }),
    });
    expect(secondRes.status).toBe(200);
    await expect(bubble.locator(".answer-block")).toHaveCount(2);
  } finally {
    await cleanup(dir, handle);
  }
});

test("submitting a follow-up via the persistent input queues it and threads it after Send all", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6205);
  try {
    await page.goto(handle.url);
    await queueAndSend(page, "why is this here?");

    const bubble = page.locator(".bubble");
    await bubble.locator(".followup-controls textarea").fill("still unclear, can you say more?");
    await bubble.locator(".followup-controls .bubble-add").click();

    // The follow-up renders immediately inside the thread, and Send all's
    // counter reflects it as a queued item awaiting submission.
    await expect(bubble.locator(".bubble-thread .bubble-comment")).toHaveText("still unclear, can you say more?");
    await expect(page.locator("#send-all")).toHaveText("Send all (1)");

    await page.locator("#send-all").click();
    await expect(page.locator("#send-all")).toHaveText("Send all (0)");
  } finally {
    await cleanup(dir, handle);
  }
});

test("a reply to an annotation that already moved into the history group still renders correctly", async ({ page }) => {
  const { dir, artifactPath, handle } = await startWithFixture("bubble-queue.html", 6210);
  const { writeFileSync } = await import("node:fs");
  try {
    await page.goto(handle.url);
    await queueAndSend(page, "question");
    const id = await page.locator(".bubble").getAttribute("data-annotation-id");

    writeFileSync(artifactPath, "<html><body><div id=\"near-top\">A</div></body></html>");
    await expect(page.locator("#history-group")).toBeVisible({ timeout: 3000 });

    await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: "answered after history move" }),
    });

    await page.locator("#history-header").click();
    await expect(page.locator("#history-list .answer-block .answer-text")).toHaveText("answered after history move");
  } finally {
    await cleanup(dir, handle);
  }
});
