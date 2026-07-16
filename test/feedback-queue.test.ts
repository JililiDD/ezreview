import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBatch, consumeNextBatch, loadSubmittedIds, loadAnsweredIds, recordAnsweredId } from "../src/feedback-queue.js";

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

  test("loadSubmittedIds/loadAnsweredIds return an empty set when no file exists yet", () => {
    const sessionDir = join(dir, "no-ids-file-yet");
    assert.deepEqual(loadSubmittedIds(sessionDir), new Set());
    assert.deepEqual(loadAnsweredIds(sessionDir), new Set());
  });

  test("recordAnsweredId persists across separate loads (simulating a server restart)", () => {
    const sessionDir = join(dir, "answered-durability");
    recordAnsweredId(sessionDir, "a-1");
    assert.deepEqual(loadAnsweredIds(sessionDir), new Set(["a-1"]));
  });
});
