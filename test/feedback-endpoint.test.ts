import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import { consumeNextBatch, loadThreadHistory } from "../src/feedback-queue.js";
import type { ReviewServerHandle } from "../src/server.js";

describe("POST /feedback", () => {
  let dir: string;
  let sessionDir: string;
  let artifactPath: string;
  let handle: ReviewServerHandle;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "ai-review-board-feedback-endpoint-test-"));
    sessionDir = join(dir, "session");
    artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    handle = await startReviewServer({ artifactPath, basePort: 5600, sessionDir });
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a valid batch is appended to the session's queue file", async () => {
    const batch = [{ id: "a-1", type: "element-annotation", selector: "#x", comment: "fix this" }];
    const res = await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    assert.equal(res.status, 200);

    const consumed = consumeNextBatch(sessionDir);
    assert.deepEqual(consumed, batch);
  });

  test("a connected SSE client receives a feedback event on submission", async () => {
    const controller = new AbortController();
    const res = await fetch(new URL("/events", handle.url), {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // consume ":ok"

    const batch = [{ id: "a-2", comment: "second" }];
    await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });

    const { value } = await reader.read();
    const chunk = decoder.decode(value);
    assert.match(chunk, /^event: feedback\n/);

    controller.abort();
    consumeNextBatch(sessionDir); // drain for isolation from other tests
  });

  test("a non-array body is rejected with 400", async () => {
    const res = await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "an array" }),
    });
    assert.equal(res.status, 400);
  });

  test("an item without an id is rejected with 400", async () => {
    const res = await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ comment: "no id here" }]),
    });
    assert.equal(res.status, 400);
  });

  test("malformed JSON is rejected with 400, not a server crash", async () => {
    const res = await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    assert.equal(res.status, 400);
  });

  test("a follow-up with a valid replyToId succeeds and threads onto the root id's history", async () => {
    await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ id: "a-thread-root", comment: "why is this here?" }]),
    });
    consumeNextBatch(sessionDir); // drain for isolation from other tests

    const res = await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ id: "a-thread-followup", replyToId: "a-thread-root", comment: "still unclear?" }]),
    });
    assert.equal(res.status, 200);
    consumeNextBatch(sessionDir); // drain for isolation from other tests

    const history = loadThreadHistory(sessionDir, "a-thread-root");
    assert.deepEqual(
      history.map((m) => m.text),
      ["why is this here?", "still unclear?"],
    );
  });

  test("a follow-up whose replyToId was never submitted is rejected with 400", async () => {
    const res = await fetch(new URL("/feedback", handle.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ id: "a-orphan-followup", replyToId: "a-never-submitted", comment: "??" }]),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /unknown annotation id/);
  });
});

describe("sessionDir wiring through idempotent-open", () => {
  test("the review server's session dir is the same one openIdempotently computed", async () => {
    const { openIdempotently } = await import("../src/idempotent-open.js");
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-feedback-sessiondir-test-"));
    const sessionRoot = mkdtempSync(join(tmpdir(), "ai-review-board-feedback-sessionroot-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");

    const result = await openIdempotently(artifactPath, { sessionRoot, basePort: 5610 });
    try {
      const batch = [{ id: "a-1", comment: "x" }];
      const res = await fetch(new URL("/feedback", result.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      assert.equal(res.status, 200);

      const { sessionDirFor } = await import("../src/session.js");
      const expectedSessionDir = sessionDirFor(artifactPath, sessionRoot);
      assert.deepEqual(consumeNextBatch(expectedSessionDir), batch);
    } finally {
      await result.handle?.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });
});
