import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const QUEUE_FILENAME = "feedback-queue.jsonl";
const SUBMITTED_IDS_FILENAME = "submitted-ids.jsonl";
const ANSWERED_IDS_FILENAME = "answered-ids.jsonl";

function readIdLines(path: string): Set<string> {
  if (!existsSync(path)) {
    return new Set();
  }
  const lines = readFileSync(path, "utf-8").split("\n").filter((line) => line.length > 0);
  return new Set(lines);
}

// Recorded at append time (not at wait's consume time) so an id counts as
// submitted the moment it enters the queue, regardless of which process
// consumes it or whether a server restart happens in between — this is the
// durable source of truth /reply checks against, not an in-memory Set scoped
// to a single server process's lifetime.
export function appendBatch(sessionDir: string, items: unknown[]): void {
  mkdirSync(sessionDir, { recursive: true });
  appendFileSync(join(sessionDir, QUEUE_FILENAME), JSON.stringify(items) + "\n");
  const ids = (items as Array<{ id: unknown }>).map((item) => String(item.id));
  appendFileSync(join(sessionDir, SUBMITTED_IDS_FILENAME), ids.map((id) => id + "\n").join(""));
}

export function loadSubmittedIds(sessionDir: string): Set<string> {
  return readIdLines(join(sessionDir, SUBMITTED_IDS_FILENAME));
}

export function recordAnsweredId(sessionDir: string, id: string): void {
  mkdirSync(sessionDir, { recursive: true });
  appendFileSync(join(sessionDir, ANSWERED_IDS_FILENAME), id + "\n");
}

export function loadAnsweredIds(sessionDir: string): Set<string> {
  return readIdLines(join(sessionDir, ANSWERED_IDS_FILENAME));
}

export function consumeNextBatch(sessionDir: string): unknown[] | null {
  const path = join(sessionDir, QUEUE_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  const lines = readFileSync(path, "utf-8").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  const [first, ...rest] = lines;
  if (rest.length === 0) {
    unlinkSync(path);
  } else {
    // Write-then-rename instead of an in-place rewrite: a concurrent reader
    // (the server process appending a new batch) can only ever observe the
    // old file or the fully-written new one, never a partially-written one.
    const tmpPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tmpPath, rest.join("\n") + "\n");
    renameSync(tmpPath, path);
  }
  return JSON.parse(first) as unknown[];
}
