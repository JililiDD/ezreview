import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildOpenCommand, openInBrowser } from "../src/browser.js";

describe("buildOpenCommand", () => {
  test("win32 uses cmd /c start", () => {
    const cmd = buildOpenCommand("win32", "http://127.0.0.1:4400/");
    assert.equal(cmd.command, "cmd");
    assert.deepEqual(cmd.args, ["/c", "start", "", "http://127.0.0.1:4400/"]);
  });

  test("darwin uses open", () => {
    const cmd = buildOpenCommand("darwin", "http://127.0.0.1:4400/");
    assert.equal(cmd.command, "open");
    assert.deepEqual(cmd.args, ["http://127.0.0.1:4400/"]);
  });

  test("linux uses xdg-open", () => {
    const cmd = buildOpenCommand("linux", "http://127.0.0.1:4400/");
    assert.equal(cmd.command, "xdg-open");
    assert.deepEqual(cmd.args, ["http://127.0.0.1:4400/"]);
  });
});

describe("openInBrowser", () => {
  test("degrades gracefully and prints the URL when spawn errors", async () => {
    const fakeChild = new EventEmitter() as EventEmitter & { unref(): void };
    fakeChild.unref = () => {};

    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string) => {
      captured += chunk;
      return true;
    }) as typeof process.stderr.write;

    try {
      openInBrowser("http://127.0.0.1:4400/", "linux", () => {
        queueMicrotask(() => fakeChild.emit("error", new Error("ENOENT")));
        return fakeChild as never;
      });
      await new Promise((r) => setImmediate(r));
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.match(captured, /Could not open a browser automatically/);
  });

  test("degrades gracefully when spawnFn throws synchronously", () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string) => {
      captured += chunk;
      return true;
    }) as typeof process.stderr.write;

    try {
      openInBrowser("http://127.0.0.1:4400/", "linux", () => {
        throw new Error("spawn ENOENT");
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.match(captured, /Could not open a browser automatically/);
  });
});
