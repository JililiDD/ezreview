import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const QUEUE_FILENAME = "feedback-queue.jsonl";

export function appendBatch(sessionDir: string, items: unknown[]): void {
  mkdirSync(sessionDir, { recursive: true });
  appendFileSync(join(sessionDir, QUEUE_FILENAME), JSON.stringify(items) + "\n");
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
