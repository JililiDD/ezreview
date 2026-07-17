import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const QUEUE_FILENAME = "feedback-queue.jsonl";
const SUBMITTED_IDS_FILENAME = "submitted-ids.jsonl";
const THREADS_FILENAME = "threads.jsonl";

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
  for (const item of items as Array<{ id: unknown; replyToId?: unknown; comment?: unknown }>) {
    const threadId = item.replyToId != null ? String(item.replyToId) : String(item.id);
    appendThreadMessage(sessionDir, threadId, "human", String(item.comment ?? ""));
  }
}

export function loadSubmittedIds(sessionDir: string): Set<string> {
  return readIdLines(join(sessionDir, SUBMITTED_IDS_FILENAME));
}

export interface ThreadMessage {
  threadId: string;
  from: "human" | "agent";
  text: string;
  timestamp: number;
}

// Durable so a thread's history survives an idle-exit restart (same goal as
// submitted-ids.jsonl) — `wait` needs the full history, not just the latest
// message, and agent processes are typically cold-started each time.
export function appendThreadMessage(sessionDir: string, threadId: string, from: "human" | "agent", text: string): void {
  mkdirSync(sessionDir, { recursive: true });
  const message: ThreadMessage = { threadId, from, text, timestamp: Date.now() };
  appendFileSync(join(sessionDir, THREADS_FILENAME), JSON.stringify(message) + "\n");
}

export function loadThreadHistory(sessionDir: string, threadId: string): ThreadMessage[] {
  const path = join(sessionDir, THREADS_FILENAME);
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf-8").split("\n").filter((line) => line.length > 0);
  return lines
    .map((line) => JSON.parse(line) as ThreadMessage)
    .filter((message) => message.threadId === threadId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Full session reset for "Confirm document": wipes every persisted file for
// this artifact's sessionDir. Missing files are not an error — a freshly
// opened session may not have created all three yet.
export function resetSessionFiles(sessionDir: string): void {
  for (const filename of [QUEUE_FILENAME, SUBMITTED_IDS_FILENAME, THREADS_FILENAME]) {
    const path = join(sessionDir, filename);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
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
