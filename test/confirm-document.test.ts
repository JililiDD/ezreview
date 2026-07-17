import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import { appendBatch } from "../src/feedback-queue.js";

describe("POST /confirm-document", () => {
  test("deletes all persisted session files and shuts down the server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-confirm-document-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    const sessionDir = join(dir, "session");

    appendBatch(sessionDir, [{ id: "a-1", comment: "why is this here?" }]);

    const handle = await startReviewServer({ artifactPath, basePort: 5980, sessionDir });

    try {
      const res = await fetch(new URL("/confirm-document", handle.url), { method: "POST" });
      assert.equal(res.status, 200);

      assert.equal(existsSync(join(sessionDir, "feedback-queue.jsonl")), false);
      assert.equal(existsSync(join(sessionDir, "submitted-ids.jsonl")), false);
      assert.equal(existsSync(join(sessionDir, "threads.jsonl")), false);

      // The response is sent before the server closes, so give the close() a
      // moment to complete rather than asserting synchronously.
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(handle.server.listening, false);
    } finally {
      await handle.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("broadcasts a confirmed SSE event to connected clients before shutting down", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-confirm-document-sse-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    const sessionDir = join(dir, "session");
    const handle = await startReviewServer({ artifactPath, basePort: 5985, sessionDir });

    try {
      const controller = new AbortController();
      const res = await fetch(new URL("/events", handle.url), {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      await reader.read(); // consume ":ok"

      await fetch(new URL("/confirm-document", handle.url), { method: "POST" });

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      assert.match(chunk, /^event: confirmed\n/);

      controller.abort();
    } finally {
      await handle.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not error when persisted files never existed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-confirm-document-empty-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    const sessionDir = join(dir, "session");

    const handle = await startReviewServer({ artifactPath, basePort: 5990, sessionDir });

    try {
      const res = await fetch(new URL("/confirm-document", handle.url), { method: "POST" });
      assert.equal(res.status, 200);
    } finally {
      await handle.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
