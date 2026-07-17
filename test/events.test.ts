import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import type { ReviewServerHandle } from "../src/server.js";

async function readSseEvents(url: string, signal: AbortSignal): Promise<AsyncGenerator<string>> {
  const res = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  async function* generate(): AsyncGenerator<string> {
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        yield buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
      }
    }
  }

  return generate();
}

describe("/events SSE endpoint", () => {
  let dir: string;
  let artifactPath: string;
  let handle: ReviewServerHandle;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "ezreview-events-test-"));
    artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    handle = await startReviewServer({ artifactPath, basePort: 4900 });
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("connecting registers a client and disconnecting unregisters it", async () => {
    assert.equal(handle.sseHub.size, 0);

    const controller = new AbortController();
    const events = await readSseEvents(new URL("/events", handle.url).toString(), controller.signal);
    const first = await events.next();
    assert.equal(first.value, ":ok");

    assert.equal(handle.sseHub.size, 1);

    controller.abort();
    // give the server a tick to process the "close" event
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(handle.sseHub.size, 0);
  });

  test("broadcast delivers the same event to two concurrently connected clients", async () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const eventsA = await readSseEvents(new URL("/events", handle.url).toString(), controllerA.signal);
    const eventsB = await readSseEvents(new URL("/events", handle.url).toString(), controllerB.signal);
    await eventsA.next(); // consume ":ok"
    await eventsB.next();

    assert.equal(handle.sseHub.size, 2);

    handle.sseHub.broadcast("reload", { timestamp: 42 });

    const receivedA = (await eventsA.next()).value;
    const receivedB = (await eventsB.next()).value;
    assert.equal(receivedA, 'event: reload\ndata: {"timestamp":42}');
    assert.equal(receivedB, receivedA);

    controllerA.abort();
    controllerB.abort();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("close() with a live, non-aborted SSE client", () => {
  test("resolves promptly instead of hanging on the open keep-alive connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-events-close-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    const handle = await startReviewServer({ artifactPath, basePort: 4910 });

    try {
      // deliberately no AbortController — the client never disconnects on its own
      const res = await fetch(new URL("/events", handle.url).toString(), {
        headers: { Accept: "text/event-stream" },
      });
      const reader = res.body!.getReader();
      await reader.read(); // consume ":ok" so the connection is fully established
      assert.equal(handle.sseHub.size, 1);

      const closed = handle.close();
      const timedOut = Symbol("timeout");
      const result = await Promise.race([
        closed.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve(timedOut), 2000)),
      ]);

      assert.notEqual(result, timedOut, "handle.close() hung with a live SSE client connected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
