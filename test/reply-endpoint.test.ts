import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import { appendBatch, consumeNextBatch } from "../src/feedback-queue.js";
import type { ReviewServerHandle } from "../src/server.js";

async function postFeedback(handle: ReviewServerHandle, items: unknown[]): Promise<Response> {
  return fetch(new URL("/feedback", handle.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
}

async function postReply(handle: ReviewServerHandle, id: string, text: string): Promise<Response> {
  return fetch(new URL("/reply", handle.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, text }),
  });
}

describe("POST /reply", () => {
  let dir: string;
  let artifactPath: string;
  let handle: ReviewServerHandle;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "ezreview-reply-endpoint-test-"));
    artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    handle = await startReviewServer({ artifactPath, basePort: 5900, sessionDir: join(dir, "session") });
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("replying to a submitted id succeeds and broadcasts a reply SSE event", async () => {
    await postFeedback(handle, [{ id: "a-1", comment: "why is this here?" }]);

    const controller = new AbortController();
    const res = await fetch(new URL("/events", handle.url), {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // consume ":ok"

    const replyRes = await postReply(handle, "a-1", "because the API requires it");
    assert.equal(replyRes.status, 200);

    const { value } = await reader.read();
    const chunk = decoder.decode(value);
    assert.match(chunk, /^event: reply\n/);
    assert.match(chunk, /"id":"a-1"/);
    assert.match(chunk, /because the API requires it/);

    controller.abort();
  });

  test("replying to the same id twice both succeed — multi-round threads have no answered-once cap", async () => {
    await postFeedback(handle, [{ id: "a-2", comment: "second question" }]);

    const first = await postReply(handle, "a-2", "first answer");
    assert.equal(first.status, 200);

    const second = await postReply(handle, "a-2", "second answer, still the same thread");
    assert.equal(second.status, 200);
  });

  test("replying to an id that was never submitted is rejected with 400", async () => {
    const res = await postReply(handle, "a-never-submitted", "answer");
    assert.equal(res.status, 400);
  });

  test("a malformed body (missing text) is rejected with 400", async () => {
    const res = await fetch(new URL("/reply", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "a-1" }),
    });
    assert.equal(res.status, 400);
  });

  test("replying to an id that survived a server restart between submission and reply succeeds (AC: submittedIds durability)", async () => {
    // Regression for a real Phase 6 E2E bug: an id appended to the queue by
    // one server process (here, standing in for a batch that reached the
    // queue any way other than a live /feedback POST — e.g. `wait` consuming
    // it, or the queue simply predating the current process), consumed by
    // `wait`, then replied to only after a *fresh* server process starts on
    // the same session dir, must still be recognized as a valid id — not
    // rejected as "unknown annotation id" just because the new process's
    // in-memory bookkeeping starts empty.
    const restartDir = mkdtempSync(join(tmpdir(), "ezreview-reply-restart-test-"));
    const restartArtifact = join(restartDir, "demo.html");
    writeFileSync(restartArtifact, "<html></html>");
    const sessionDir = join(restartDir, "session");

    try {
      appendBatch(sessionDir, [{ id: "a-restart-1", comment: "does this survive a restart?" }]);
      consumeNextBatch(sessionDir); // simulates `wait` picking it up

      const restartedHandle = await startReviewServer({
        artifactPath: restartArtifact,
        basePort: 5950,
        sessionDir,
      });
      try {
        const res = await postReply(restartedHandle, "a-restart-1", "yes, it does now");
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);
      } finally {
        await restartedHandle.close();
      }
    } finally {
      rmSync(restartDir, { recursive: true, force: true });
    }
  });
});
