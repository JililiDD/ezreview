import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";

describe("idle auto-exit end-to-end", () => {
  test("server closes itself after the idle window with no connected clients", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-idle-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");

    const handle = await startReviewServer({ artifactPath, basePort: 5100, idleTimeoutMs: 100 });

    try {
      assert.equal(handle.server.listening, true);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(handle.server.listening, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("server stays up while a client is connected past the idle window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-idle-active-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");

    const handle = await startReviewServer({ artifactPath, basePort: 5110, idleTimeoutMs: 100 });
    const controller = new AbortController();

    try {
      const res = await fetch(new URL("/events", handle.url).toString(), {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      await res.body!.getReader().read(); // consume ":ok"

      await new Promise((r) => setTimeout(r, 300));
      assert.equal(handle.server.listening, true, "should not idle-exit while a client is connected");
    } finally {
      controller.abort();
      await handle.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
