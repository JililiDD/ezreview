import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openIdempotently } from "../src/idempotent-open.js";
import { readSessionInfo, sessionDirFor } from "../src/session.js";

describe("openIdempotently", () => {
  let dir: string;
  let sessionRoot: string;
  let artifactPath: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ezreview-idempotent-test-"));
    sessionRoot = mkdtempSync(join(tmpdir(), "ezreview-idempotent-session-"));
    artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessionRoot, { recursive: true, force: true });
  });

  test("first open starts a real server and writes session.json", async () => {
    const result = await openIdempotently(artifactPath, { sessionRoot, basePort: 4800 });
    assert.equal(result.reused, false);
    assert.ok(result.handle);

    const sessionInfo = readSessionInfo(sessionDirFor(artifactPath, sessionRoot));
    assert.equal(sessionInfo?.port, result.handle!.port);
    assert.equal(sessionInfo?.pid, process.pid);

    await result.handle!.close();
  });

  test("second open reuses the live server instead of starting a new one", async () => {
    const first = await openIdempotently(artifactPath, { sessionRoot, basePort: 4810 });
    assert.equal(first.reused, false);

    try {
      const second = await openIdempotently(artifactPath, { sessionRoot, basePort: 4810 });
      assert.equal(second.reused, true);
      assert.equal(second.url, first.url);
      assert.equal(second.handle, undefined);
    } finally {
      await first.handle!.close();
    }
  });

  test("open restarts a fresh server after the previous process is gone", async () => {
    const first = await openIdempotently(artifactPath, { sessionRoot, basePort: 4820 });
    await first.handle!.close();

    const second = await openIdempotently(artifactPath, { sessionRoot, basePort: 4820 });
    try {
      assert.equal(second.reused, false);
      assert.ok(second.handle);
    } finally {
      await second.handle!.close();
    }
  });
});
