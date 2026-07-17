import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startReviewServer } from "../src/server.js";
import { sessionDirFor, writeSessionInfo } from "../src/session.js";
import type { ReviewServerHandle } from "../src/server.js";

const CLI_ENTRY = resolve(import.meta.dirname, "..", "src", "cli.js");

// spawnSync would block this process's event loop for the child's entire
// lifetime — fatal here, since this same process hosts the live server the
// spawned CLI child needs to reach over HTTP (it would starve mid-request).
function spawnAsync(command: string, args: string[]): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
}

describe("cli.js as a real child process (not an in-process main() call)", () => {
  test("a reply error (non-ok HTTP response) exits cleanly with code 1 — no crash", async () => {
    // Regression test for a real bug found during Phase 6's fresh-agent E2E
    // acceptance run: calling process.exit() immediately after a non-ok
    // fetch response could race undici's socket teardown on Windows and
    // crash with a libuv assertion ("UV_HANDLE_CLOSING") instead of exiting
    // cleanly. In-process main() calls (as in cli.test.ts) can't catch this
    // — it only manifests when the actual OS process exits.
    const dir = mkdtempSync(join(tmpdir(), "ezreview-cli-process-test-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    // The real cli.js entry has no session-root override (that's an
    // in-process-only testing hook on the underlying functions), so this
    // test necessarily uses the real default session directory to match
    // exactly what the shipped CLI does.
    const sessionDir = sessionDirFor(artifactPath);

    let handle: ReviewServerHandle | undefined;
    try {
      handle = await startReviewServer({ artifactPath, basePort: 6300, sessionDir });
      writeSessionInfo(sessionDir, { port: handle.port, pid: process.pid, file: artifactPath });

      // A reply to an id that was never submitted produces a real non-ok
      // (400) HTTP response from the server — the exact trigger condition.
      const result = await spawnAsync(process.execPath, [
        CLI_ENTRY,
        "reply",
        artifactPath,
        "--to",
        "a-never-submitted",
        "some answer",
      ]);

      // A crash on Windows surfaces as a non-null signal or an abnormal
      // negative/huge status code, never a clean small positive integer.
      assert.equal(result.signal, null, `process was killed by a signal: ${result.signal}`);
      assert.equal(result.status, 1, `expected a clean exit 1, got status ${result.status}\nstderr: ${result.stderr}`);
      assert.match(result.stderr, /unknown annotation id/);
    } finally {
      await handle?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
