import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import { sessionDirFor, writeSessionInfo } from "../src/session.js";
import { waitForFeedback, renderBatch, WaitError } from "../src/wait.js";

async function setUp(basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-board-wait-test-"));
  const sessionRoot = mkdtempSync(join(tmpdir(), "ai-review-board-wait-session-test-"));
  const artifactPath = join(dir, "demo.html");
  writeFileSync(artifactPath, "<html></html>");
  const sessionDir = sessionDirFor(artifactPath, sessionRoot);
  const handle = await startReviewServer({ artifactPath, basePort, sessionDir });
  writeSessionInfo(sessionDir, { port: handle.port, pid: process.pid, file: artifactPath });
  return { dir, sessionRoot, artifactPath, sessionDir, handle };
}

async function tearDown(ctx: { dir: string; sessionRoot: string; handle: import("../src/server.js").ReviewServerHandle }) {
  await ctx.handle.close();
  rmSync(ctx.dir, { recursive: true, force: true });
  rmSync(ctx.sessionRoot, { recursive: true, force: true });
}

describe("renderBatch", () => {
  test("renders an element-annotation item with selector, outerHTML, and comment", () => {
    const text = renderBatch([
      { id: "a-1", type: "element-annotation", selector: "#x", outerHTML: "<span>x</span>", comment: "too light" },
    ]);
    assert.match(text, /\[a-1\]/);
    assert.match(text, /#x/);
    assert.match(text, /<span>x<\/span>/);
    assert.match(text, /too light/);
  });

  test("renders a text-annotation item with selectedText and context", () => {
    const text = renderBatch([
      {
        id: "a-2",
        type: "text-annotation",
        selectedText: "revenue grew",
        context: { before: "our ", after: " this quarter" },
        nearestSelector: "#para",
        comment: "double check",
      },
    ]);
    assert.match(text, /\[a-2\]/);
    assert.match(text, /revenue grew/);
    assert.match(text, /double check/);
  });
});

describe("waitForFeedback", () => {
  test("throws WaitError when there is no running session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-wait-norun-test-"));
    const sessionRoot = mkdtempSync(join(tmpdir(), "ai-review-board-wait-norun-session-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    try {
      await assert.rejects(() => waitForFeedback(artifactPath, { sessionRoot }), WaitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  test("catch-up: a batch submitted before wait starts is returned immediately", async () => {
    const ctx = await setUp(5700);
    try {
      await fetch(new URL("/feedback", ctx.handle.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id: "a-1", selector: "#x", comment: "fix" }]),
      });

      const rendered = await waitForFeedback(ctx.artifactPath, { sessionRoot: ctx.sessionRoot });
      assert.match(rendered, /\[a-1\]/);
      assert.match(rendered, /fix/);
    } finally {
      await tearDown(ctx);
    }
  });

  test("subscribe: a batch submitted after wait starts is still delivered", async () => {
    const ctx = await setUp(5710);
    try {
      const waitPromise = waitForFeedback(ctx.artifactPath, { sessionRoot: ctx.sessionRoot });

      setTimeout(() => {
        void fetch(new URL("/feedback", ctx.handle.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ id: "a-2", selector: "#y", comment: "later" }]),
        });
      }, 100);

      const rendered = await waitPromise;
      assert.match(rendered, /\[a-2\]/);
      assert.match(rendered, /later/);
    } finally {
      await tearDown(ctx);
    }
  });

  test("two batches submitted before two waits are each consumed exactly once (AC-8)", async () => {
    const ctx = await setUp(5720);
    try {
      await fetch(new URL("/feedback", ctx.handle.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id: "a-1", comment: "first" }]),
      });
      await fetch(new URL("/feedback", ctx.handle.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id: "a-2", comment: "second" }]),
      });

      const first = await waitForFeedback(ctx.artifactPath, { sessionRoot: ctx.sessionRoot });
      const second = await waitForFeedback(ctx.artifactPath, { sessionRoot: ctx.sessionRoot });

      assert.match(first, /first/);
      assert.match(second, /second/);
      assert.doesNotMatch(second, /first/);
    } finally {
      await tearDown(ctx);
    }
  });
});
