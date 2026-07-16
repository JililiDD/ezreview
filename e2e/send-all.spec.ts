import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-board-send-all-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", fixtureName), artifactPath);
  const handle = await startReviewServer({ artifactPath, basePort });
  return { dir, artifactPath, handle };
}

async function cleanup(dir: string, handle: ReviewServerHandle) {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
}

test("Send all submits a real POST /feedback with the queued item's data and transitions to Sent", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 5800);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("too light");
    await page.locator(".bubble-draft .bubble-add").click();

    let requestBody: unknown = null;
    page.on("request", (req) => {
      if (req.url().includes("/feedback") && req.method() === "POST") {
        requestBody = JSON.parse(req.postData() ?? "[]");
      }
    });

    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    expect(requestBody).not.toBeNull();
    const body = requestBody as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("element-annotation");
    expect(body[0].comment).toBe("too light");
    expect(typeof body[0].selector).toBe("string");

    await expect(page.locator(".bubble .bubble-delete")).toHaveCount(0);
    await expect(page.locator(".bubble .sent-badge")).toHaveText("✓ Sent · awaiting agent edits");
    await expect(page.locator("#send-all")).toHaveText("Send all (0)");
  } finally {
    await cleanup(dir, handle);
  }
});

test("a sent element-annotation includes outerHTML truncated to 500 characters", async ({ page }) => {
  const { dir, artifactPath, handle } = await startWithFixture("bubble-queue.html", 5810);
  try {
    // give the target a very long attribute so outerHTML exceeds 500 chars
    const longArtifact = `<!doctype html><html><body><div id="near-top" data-x="${"x".repeat(600)}">A</div></body></html>`;
    writeFileSync(artifactPath, longArtifact);
    await page.goto(handle.url);
    await page.waitForTimeout(300); // let the initial watcher settle, avoid a spurious reload mid-test

    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();

    let requestBody: Array<Record<string, unknown>> | null = null;
    page.on("request", (req) => {
      if (req.url().includes("/feedback") && req.method() === "POST") {
        requestBody = JSON.parse(req.postData() ?? "[]");
      }
    });
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    expect(requestBody).not.toBeNull();
    const outerHTML = requestBody![0].outerHTML as string;
    expect(outerHTML.length).toBeLessThanOrEqual(501); // 500 + the truncation ellipsis char
    expect(outerHTML.endsWith("…")).toBe(true);
  } finally {
    await cleanup(dir, handle);
  }
});

test("sent bubbles move into a collapsed Processed (N) history group on the next reload", async ({ page }) => {
  const { dir, artifactPath, handle } = await startWithFixture("bubble-queue.html", 5820);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    await expect(page.locator("#history-group")).not.toBeVisible();

    writeFileSync(artifactPath, "<html><body><div id=\"near-top\">A</div><div id=\"near-top-2\">B</div></body></html>");

    const historyGroup = page.locator("#history-group");
    await expect(historyGroup).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#history-header")).toHaveText("Processed (1)");
    await expect(page.locator("#history-list")).not.toBeVisible();

    await page.locator("#history-header").click();
    await expect(page.locator("#history-list")).toBeVisible();
    await expect(page.locator("#history-list .bubble-sent")).toBeVisible();
  } finally {
    await cleanup(dir, handle);
  }
});

test("hover linkage still works on a sent element-annotation bubble (regression)", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 5830);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    await page.locator(".bubble-sent").hover();

    const highlight = page.locator("#element-highlight");
    await expect(highlight).toBeVisible();
    const highlightBox = await highlight.boundingBox();
    const targetBox = await frame.locator("#near-top").boundingBox();
    expect(Math.abs(highlightBox!.y - targetBox!.y)).toBeLessThanOrEqual(2);
  } finally {
    await cleanup(dir, handle);
  }
});

test("a failed submission (non-ok response) surfaces an error and leaves the queue intact", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 5840);
  try {
    await page.route("**/feedback", (route) => route.fulfill({ status: 500, body: "server error" }));

    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();

    await page.locator("#send-all").click();

    await expect(page.locator("#status-text")).toHaveText("Send failed — please retry");
    await expect(page.locator(".bubble-sent")).toHaveCount(0);
    await expect(page.locator(".bubble .bubble-delete")).toHaveCount(1);
    await expect(page.locator("#send-all")).toHaveText("Send all (1)");
  } finally {
    await cleanup(dir, handle);
  }
});

test("a network-level failure (fetch rejects) also surfaces an error and leaves the queue intact", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 5850);
  try {
    await page.route("**/feedback", (route) => route.abort("failed"));

    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();

    await page.locator("#send-all").click();

    await expect(page.locator("#status-text")).toHaveText("Send failed — network error");
    await expect(page.locator(".bubble-sent")).toHaveCount(0);
    await expect(page.locator("#send-all")).toHaveText("Send all (1)");
  } finally {
    await cleanup(dir, handle);
  }
});
