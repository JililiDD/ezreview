import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import { sessionDirFor, writeSessionInfo } from "../src/session.js";
import { waitForFeedback, renderBatch, WaitError, ReviewConfirmed } from "../src/wait.js";
import { appendThreadMessage } from "../src/feedback-queue.js";

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
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-renderbatch-test-"));
    const text = renderBatch(
      [{ id: "a-1", type: "element-annotation", selector: "#x", outerHTML: "<span>x</span>", comment: "too light" }],
      dir,
    );
    assert.match(text, /\[a-1\]/);
    assert.match(text, /#x/);
    assert.match(text, /<span>x<\/span>/);
    assert.match(text, /too light/);
  });

  test("renders a text-annotation item with selectedText and context", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-renderbatch-test-"));
    const text = renderBatch(
      [
        {
          id: "a-2",
          type: "text-annotation",
          selectedText: "revenue grew",
          context: { before: "our ", after: " this quarter" },
          nearestSelector: "#para",
          comment: "double check",
        },
      ],
      dir,
    );
    assert.match(text, /\[a-2\]/);
    assert.match(text, /revenue grew/);
    assert.match(text, /double check/);
  });

  test("renders a follow-up item (replyToId set) as its thread's full history, not just its own comment", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-renderbatch-followup-test-"));
    appendThreadMessage(dir, "a-3", "human", "why is this here?");
    appendThreadMessage(dir, "a-3", "agent", "because the API requires it");

    const text = renderBatch([{ id: "a-4", replyToId: "a-3", comment: "but why does the API require it?" }], dir);
    assert.match(text, /\[a-4\]/);
    assert.match(text, /thread a-3/);
    assert.match(text, /why is this here\?/);
    assert.match(text, /because the API requires it/);
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

  test("survives several seconds of complete silence before feedback arrives (regression: fetch()'s ~5min bodyTimeout misfiring on an intentionally idle long-poll)", async () => {
    const ctx = await setUp(5730);
    try {
      const waitPromise = waitForFeedback(ctx.artifactPath, { sessionRoot: ctx.sessionRoot });

      // Not a real 5-minute wait (unrealistic and flaky for a test suite) —
      // this delay is only meant to prove the connection has no short
      // implicit timeout of its own, structurally distinct from "arrives
      // almost instantly" which the other tests already cover.
      setTimeout(() => {
        void fetch(new URL("/feedback", ctx.handle.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ id: "a-3", comment: "took a while to write this" }]),
        });
      }, 2500);

      const rendered = await waitPromise;
      assert.match(rendered, /\[a-3\]/);
      assert.match(rendered, /took a while to write this/);
    } finally {
      await tearDown(ctx);
    }
  });

  test("throws WaitError if the server closes the connection while wait is still pending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-wait-close-test-"));
    const sessionRoot = mkdtempSync(join(tmpdir(), "ai-review-board-wait-close-session-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    const sessionDir = sessionDirFor(artifactPath, sessionRoot);
    const handle = await startReviewServer({ artifactPath, basePort: 5725, sessionDir });
    writeSessionInfo(sessionDir, { port: handle.port, pid: process.pid, file: artifactPath });

    try {
      const waitPromise = waitForFeedback(artifactPath, { sessionRoot });
      setTimeout(() => {
        void handle.close();
      }, 200);

      await assert.rejects(() => waitPromise, WaitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  test("throws WaitError (not a raw low-level error) if the connection is destroyed abruptly, not gracefully closed", async () => {
    // Regression: an abrupt socket reset rejects the underlying read()
    // instead of resolving with done: true — must still surface as the
    // same friendly WaitError, not an uncaught raw Node error (e.g.
    // "aborted"/ECONNRESET), which is exactly the class of bug this
    // work-item's fetch()-to-node:http switch exists to fix.
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-wait-abrupt-close-test-"));
    const sessionRoot = mkdtempSync(join(tmpdir(), "ai-review-board-wait-abrupt-close-session-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    const sessionDir = sessionDirFor(artifactPath, sessionRoot);
    const handle = await startReviewServer({ artifactPath, basePort: 5726, sessionDir });
    writeSessionInfo(sessionDir, { port: handle.port, pid: process.pid, file: artifactPath });

    try {
      const waitPromise = waitForFeedback(artifactPath, { sessionRoot });
      setTimeout(() => {
        // Forcibly destroys sockets at the transport level — distinct from
        // handle.close()'s graceful sseHub.closeAll() (client.end()) path.
        handle.server.closeAllConnections();
      }, 200);

      await assert.rejects(() => waitPromise, WaitError);
    } finally {
      await handle.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  test("throws ReviewConfirmed (not WaitError) when the server broadcasts a confirmed event, e.g. from Confirm document", async () => {
    const ctx = await setUp(5727);
    try {
      const waitPromise = waitForFeedback(ctx.artifactPath, { sessionRoot: ctx.sessionRoot });
      setTimeout(() => {
        ctx.handle.sseHub.broadcast("confirmed", {});
      }, 200);

      await assert.rejects(() => waitPromise, ReviewConfirmed);
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
