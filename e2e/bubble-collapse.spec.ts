import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ezreview-bubble-collapse-e2e-"));
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

test("clicking a bubble's own collapse toggle hides its thread and reply controls, keeping only the ME comment", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6400);
  try {
    await page.goto(handle.url);
    await queueAndSend(page, "why is this here?");

    const id = await page.locator(".bubble").getAttribute("data-annotation-id");
    await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: "because the API requires it" }),
    });

    const bubble = page.locator(".bubble");
    await expect(bubble.locator(".answer-block")).toBeVisible();
    await expect(bubble.locator(".followup-reply-btn")).toBeVisible();

    await bubble.locator(".bubble-collapse-toggle").click();
    await expect(bubble.locator(".me-block .bubble-comment")).toHaveText("why is this here?");
    await expect(bubble.locator(".answer-block")).not.toBeVisible();
    await expect(bubble.locator(".followup-reply-btn")).not.toBeVisible();
    await expect(bubble.locator(".bubble-collapse-toggle")).toHaveText("+");

    await bubble.locator(".bubble-collapse-toggle").click();
    await expect(bubble.locator(".answer-block")).toBeVisible();
    await expect(bubble.locator(".followup-reply-btn")).toBeVisible();
    await expect(bubble.locator(".bubble-collapse-toggle")).toHaveText("−");
  } finally {
    await cleanup(dir, handle);
  }
});

test("the rail-wide collapse-all button collapses every sent bubble, and toggles them all back", async ({ page }) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6410);
  try {
    await page.goto(handle.url);
    const frame = page.frameLocator("#artifact-frame");

    await frame.locator("#near-top").click();
    await page.locator(".bubble-draft textarea").fill("first");
    await page.locator(".bubble-draft .bubble-add").click();
    await frame.locator("#near-top-2").click();
    await page.locator(".bubble-draft textarea").fill("second");
    await page.locator(".bubble-draft .bubble-add").click();
    await page.locator("#send-all").click();
    await expect(page.locator(".bubble-sent")).toHaveCount(2);

    await page.locator("#rail-collapse-all").click();
    await expect(page.locator(".bubble-collapse-toggle")).toHaveText(["+", "+"]);

    await page.locator("#rail-collapse-all").click();
    await expect(page.locator(".bubble-collapse-toggle")).toHaveText(["−", "−"]);
  } finally {
    await cleanup(dir, handle);
  }
});

test("collapsing the whole rail hides #rail-collapse-all too, since it would otherwise overlap #rail-collapse", async ({
  page,
}) => {
  const { dir, handle } = await startWithFixture("bubble-queue.html", 6420);
  try {
    await page.goto(handle.url);
    await expect(page.locator("#rail-collapse-all")).toBeVisible();

    await page.locator("#rail-collapse").click();
    await expect(page.locator("#rail-collapse-all")).not.toBeVisible();

    await page.locator("#rail-collapse").click();
    await expect(page.locator("#rail-collapse-all")).toBeVisible();
  } finally {
    await cleanup(dir, handle);
  }
});
