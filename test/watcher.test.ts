import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchArtifactFile } from "../src/watcher.js";

describe("watchArtifactFile", () => {
  let dir: string;
  let filePath: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ezreview-watcher-test-"));
    filePath = join(dir, "demo.html");
    writeFileSync(filePath, "<html>v0</html>");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a single write triggers exactly one callback within 1s", async () => {
    let calls = 0;
    const handle = watchArtifactFile(filePath, () => {
      calls += 1;
    });

    try {
      writeFileSync(filePath, "<html>v1</html>");
      await new Promise((r) => setTimeout(r, 900));
      assert.equal(calls, 1);
    } finally {
      handle.close();
    }
  });

  test("five rapid writes within the debounce window collapse into one callback", async () => {
    let calls = 0;
    const handle = watchArtifactFile(filePath, () => {
      calls += 1;
    });

    try {
      for (let i = 0; i < 5; i += 1) {
        writeFileSync(filePath, `<html>rapid-${i}</html>`);
        await new Promise((r) => setTimeout(r, 40));
      }
      // wait past the debounce window from the last write
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(calls, 1);
    } finally {
      handle.close();
    }
  });

  test("the watched file disappearing does not crash the process (unhandled watcher error)", async () => {
    // On this machine/platform, deleting the watched file surfaces as a
    // "change"/"rename" fs.watch event (not necessarily an "error") and so
    // still triggers one debounced onChange call — that's acceptable
    // (a delete is a legitimate reason to reload). The actual regression
    // this test guards is: if this ever *does* surface as an "error" event
    // (documented as platform/editor-save-strategy dependent), the process
    // must not crash from an unhandled EventEmitter "error" — reaching the
    // assertion below at all proves that.
    const goneFilePath = join(dir, "disappearing.html");
    writeFileSync(goneFilePath, "<html>v0</html>");

    const handle = watchArtifactFile(goneFilePath, () => {});

    try {
      unlinkSync(goneFilePath);
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(true, "process survived the watched file disappearing");
    } finally {
      handle.close();
    }
  });

  test("close() stops further callbacks", async () => {
    let calls = 0;
    const handle = watchArtifactFile(filePath, () => {
      calls += 1;
    });
    handle.close();

    writeFileSync(filePath, "<html>after-close</html>");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(calls, 0);
  });
});
