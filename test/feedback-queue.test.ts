import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBatch, consumeNextBatch, loadSubmittedIds, appendThreadMessage, loadThreadHistory } from "../src/feedback-queue.js";

describe("feedback-queue", () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ai-review-board-feedback-queue-test-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("consuming when no file exists returns null", () => {
    const sessionDir = join(dir, "no-file-yet");
    assert.equal(consumeNextBatch(sessionDir), null);
  });

  test("appended batches are consumed in FIFO order, one at a time", () => {
    const sessionDir = join(dir, "fifo");
    appendBatch(sessionDir, [{ id: "a-1", comment: "first" }]);
    appendBatch(sessionDir, [{ id: "a-2", comment: "second" }]);
    appendBatch(sessionDir, [{ id: "a-3", comment: "third" }]);

    assert.deepEqual(consumeNextBatch(sessionDir), [{ id: "a-1", comment: "first" }]);
    assert.deepEqual(consumeNextBatch(sessionDir), [{ id: "a-2", comment: "second" }]);
    assert.deepEqual(consumeNextBatch(sessionDir), [{ id: "a-3", comment: "third" }]);
  });

  test("consuming past the last batch returns null and does not throw", () => {
    const sessionDir = join(dir, "drained");
    appendBatch(sessionDir, [{ id: "a-1" }]);
    consumeNextBatch(sessionDir);

    assert.equal(consumeNextBatch(sessionDir), null);
    assert.doesNotThrow(() => consumeNextBatch(sessionDir));
  });

  test("appendBatch creates the session directory if it does not exist yet", () => {
    const sessionDir = join(dir, "not-created-yet", "nested");
    assert.doesNotThrow(() => appendBatch(sessionDir, [{ id: "a-1" }]));
    assert.deepEqual(consumeNextBatch(sessionDir), [{ id: "a-1" }]);
  });

  test("an id is recorded as submitted at append time, and stays submitted after its batch is consumed", () => {
    // Regression for a real Phase 6 E2E bug: submittedIds was previously only
    // populated by the live /feedback HTTP handler, so an id consumed via
    // `wait` from a batch appended some other way (or before a server
    // restart cleared the in-memory Set) could never be replied to.
    const sessionDir = join(dir, "submitted-durability");
    appendBatch(sessionDir, [{ id: "a-1" }, { id: "a-2" }]);

    assert.deepEqual(loadSubmittedIds(sessionDir), new Set(["a-1", "a-2"]));

    consumeNextBatch(sessionDir); // the batch is gone from the queue now...
    assert.deepEqual(loadSubmittedIds(sessionDir), new Set(["a-1", "a-2"])); // ...but still recorded as submitted
  });

  test("loadSubmittedIds returns an empty set when no file exists yet", () => {
    const sessionDir = join(dir, "no-ids-file-yet");
    assert.deepEqual(loadSubmittedIds(sessionDir), new Set());
  });

  test("appendBatch records the original comment as the first human message in that id's thread", () => {
    const sessionDir = join(dir, "thread-seed");
    appendBatch(sessionDir, [{ id: "a-1", comment: "why is this here?" }]);

    const history = loadThreadHistory(sessionDir, "a-1");
    assert.equal(history.length, 1);
    assert.equal(history[0].from, "human");
    assert.equal(history[0].text, "why is this here?");
  });

  test("appendBatch files a follow-up (replyToId set) under the root thread, not its own id", () => {
    const sessionDir = join(dir, "thread-followup");
    appendBatch(sessionDir, [{ id: "a-1", comment: "why is this here?" }]);
    appendBatch(sessionDir, [{ id: "a-2", replyToId: "a-1", comment: "still unclear, can you say more?" }]);

    const history = loadThreadHistory(sessionDir, "a-1");
    assert.equal(history.length, 2);
    assert.equal(history[1].text, "still unclear, can you say more?");
    // The follow-up's own id never becomes a thread of its own.
    assert.deepEqual(loadThreadHistory(sessionDir, "a-2"), []);
  });

  test("appendThreadMessage persists agent replies durably, and loadThreadHistory returns them in chronological order", () => {
    const sessionDir = join(dir, "thread-agent-replies");
    appendBatch(sessionDir, [{ id: "a-1", comment: "why is this here?" }]);
    appendThreadMessage(sessionDir, "a-1", "agent", "because the API requires it");
    appendBatch(sessionDir, [{ id: "a-2", replyToId: "a-1", comment: "but why does the API require it?" }]);
    appendThreadMessage(sessionDir, "a-1", "agent", "it's part of the ISO 8601 spec");

    const history = loadThreadHistory(sessionDir, "a-1");
    assert.deepEqual(
      history.map((m) => [m.from, m.text]),
      [
        ["human", "why is this here?"],
        ["agent", "because the API requires it"],
        ["human", "but why does the API require it?"],
        ["agent", "it's part of the ISO 8601 spec"],
      ],
    );
  });

  test("loadThreadHistory returns an empty array for a thread with no messages", () => {
    const sessionDir = join(dir, "thread-empty");
    assert.deepEqual(loadThreadHistory(sessionDir, "never-existed"), []);
  });
});
