import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { startReviewServer, DEFAULT_HOST } from "../src/server.js";
import type { ReviewServerHandle } from "../src/server.js";

describe("startReviewServer", () => {
  let dir: string;
  let artifactPath: string;
  let handle: ReviewServerHandle;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "ezreview-server-test-"));
    artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html><body>hello artifact</body></html>");
    handle = await startReviewServer({ artifactPath, basePort: 4500 });
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("binds to 127.0.0.1 only", () => {
    assert.equal(handle.host, DEFAULT_HOST);
  });

  test("GET / returns the shell page", async () => {
    const res = await fetch(`${handle.url}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /id="toolbar"/);
    assert.match(body, /id="artifact-frame"/);
  });

  test("GET /artifact returns the original file bytes", async () => {
    const res = await fetch(new URL("/artifact", handle.url));
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /hello artifact/);
  });

  test("GET /healthz returns session identity", async () => {
    const res = await fetch(new URL("/healthz", handle.url));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { file: string; pid: number };
    assert.equal(json.pid, process.pid);
    assert.match(json.file, /demo\.html$/);
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(new URL("/nope", handle.url));
    assert.equal(res.status, 404);
  });
});

describe("port probing", () => {
  test("advances to the next port when the base port is occupied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-server-port-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");

    const occupier = createServer();
    await new Promise<void>((resolvePromise) => {
      occupier.listen(4600, DEFAULT_HOST, () => resolvePromise());
    });

    try {
      const handle = await startReviewServer({ artifactPath, basePort: 4600 });
      try {
        assert.equal(handle.port, 4601);
      } finally {
        await handle.close();
      }
    } finally {
      await new Promise<void>((resolvePromise) => occupier.close(() => resolvePromise()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
