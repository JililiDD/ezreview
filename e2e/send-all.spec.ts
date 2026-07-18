import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ezreview-send-all-e2e-"));
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
    await expect(page.locator("#send-all")).toHaveText("Submit review (0)");
  } finally {
    await cleanup(dir, handle);
  }
});

test("Send all shows a reply-pending spinner until the agent replies to every submitted item", async ({ page }) => {
  const { dir, artifactPath, handle } = await startWithFixture("bubble-queue.html", 5805);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("change the date");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    await expect(page.locator("#reply-spinner")).toHaveClass(/visible/);

    writeFileSync(artifactPath, "<html><body><div id=\"near-top\">Changed by agent</div></body></html>");
    await expect(page.frameLocator("#artifact-frame").locator("#near-top")).toHaveText("Changed by agent");
    await expect(page.locator("#reply-spinner")).toHaveClass(/visible/);

    const id = await page.locator(".bubble").getAttribute("data-annotation-id");
    await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: "answer" }),
    });

    await expect(page.locator("#reply-spinner")).not.toHaveClass(/visible/);
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

test("sent bubbles stay directly in the rail across a reload, not moved into any collapsed group", async ({ page }) => {
  const { dir, artifactPath, handle } = await startWithFixture("bubble-queue.html", 5820);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");
    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("x");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    writeFileSync(artifactPath, "<html><body><div id=\"near-top\">A</div><div id=\"near-top-2\">B</div></body></html>");
    await page.waitForTimeout(500); // let the reload settle

    await expect(page.locator(".bubble-sent")).toBeVisible();
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

test("a sent bubble keeps its stacking slot: a newly queued bubble near the same anchor does not overlap it", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 5845);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");

    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("first");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toBeVisible();

    // no reload happened — the sent bubble must still occupy its stacking
    // slot when a second, nearby annotation is queued
    await frame.locator("#near-top-2").click();
    await page.locator(".bubble-draft textarea").fill("second");
    await page.locator(".bubble-draft .bubble-add").click();

    const bubbles = page.locator(".bubble");
    await expect(bubbles).toHaveCount(2);
    const sentBox = await page.locator(".bubble-sent").boundingBox();
    const queuedBox = await page.locator(".bubble:not(.bubble-sent)").boundingBox();
    expect(sentBox).not.toBeNull();
    expect(queuedBox).not.toBeNull();
    const noOverlap =
      sentBox!.y + sentBox!.height <= queuedBox!.y + 1 || queuedBox!.y + queuedBox!.height <= sentBox!.y + 1;
    expect(noOverlap).toBe(true);
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
    await expect(page.locator("#send-all")).toHaveText("Submit review (1)");
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
    await expect(page.locator("#send-all")).toHaveText("Submit review (1)");
  } finally {
    await cleanup(dir, handle);
  }
});
