import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import type { ReviewServerHandle } from "../src/server.js";

async function readOneSseEvent(url: string, signal: AbortSignal): Promise<{ next(): Promise<string> }> {
  const res = await fetch(url, { headers: { Accept: "text/event-stream" }, signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next(): Promise<string> {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          return chunk;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended before an event arrived");
        buffer += decoder.decode(value, { stream: true });
      }
    },
  };
}

describe("watcher -> broadcast -> SSE client end-to-end", () => {
  let dir: string;
  let artifactPath: string;
  let handle: ReviewServerHandle;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "ezreview-live-reload-test-"));
    artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html>v0</html>");
    handle = await startReviewServer({ artifactPath, basePort: 5000 });
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("modifying the artifact delivers exactly one reload event to a connected client", async () => {
    const controller = new AbortController();
    const events = await readOneSseEvent(new URL("/events", handle.url).toString(), controller.signal);
    await events.next(); // consume ":ok"

    writeFileSync(artifactPath, "<html>v1</html>");
    const received = await events.next();

    assert.match(received, /^event: reload\ndata: \{"timestamp":\d+\}$/);

    controller.abort();
  });

  test("closing the server stops the watcher (no lingering broadcast after close)", async () => {
    const localDir = mkdtempSync(join(tmpdir(), "ezreview-live-reload-close-test-"));
    const localArtifact = join(localDir, "demo.html");
    writeFileSync(localArtifact, "<html>v0</html>");
    const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5010 });

    let broadcastCount = 0;
    const originalBroadcast = localHandle.sseHub.broadcast.bind(localHandle.sseHub);
    localHandle.sseHub.broadcast = (type, data) => {
      broadcastCount += 1;
      originalBroadcast(type, data);
    };

    await localHandle.close();
    writeFileSync(localArtifact, "<html>after-close</html>");
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(broadcastCount, 0);
    rmSync(localDir, { recursive: true, force: true });
  });
});
