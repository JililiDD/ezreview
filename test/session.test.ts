import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeArtifactPath,
  sessionHash,
  sessionDirFor,
  readSessionInfo,
  writeSessionInfo,
} from "../src/session.js";

describe("normalizeArtifactPath / sessionHash", () => {
  test("same file via different relative paths yields the same hash", () => {
    const a = sessionHash("./demo.html");
    const b = sessionHash("demo.html");
    assert.equal(a, b);
  });

  test("different files yield different hashes", () => {
    assert.notEqual(sessionHash("a.html"), sessionHash("b.html"));
  });

  test("hash is 16 lowercase hex characters", () => {
    assert.match(sessionHash("demo.html"), /^[0-9a-f]{16}$/);
  });

  if (process.platform === "win32") {
    test("Windows: case differences normalize to the same hash", () => {
      assert.equal(normalizeArtifactPath("C:\\Demo\\File.html"), normalizeArtifactPath("c:\\demo\\file.html"));
      assert.equal(sessionHash("C:\\Demo\\File.html"), sessionHash("c:\\demo\\file.html"));
    });
  }
});

describe("sessionDirFor", () => {
  test("derives a directory under the given root keyed by hash", () => {
    const root = join(tmpdir(), "ezreview-root-test");
    const dir = sessionDirFor("demo.html", root);
    assert.equal(dir, join(root, sessionHash("demo.html")));
  });
});

describe("session.json read/write", () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "ezreview-session-test-"));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("returns undefined when no session.json exists", () => {
    const dir = join(root, "nonexistent-session");
    assert.equal(readSessionInfo(dir), undefined);
  });

  test("round-trips written session info", () => {
    const dir = join(root, "roundtrip");
    const info = { port: 4400, pid: 12345, file: "C:\\demo.html" };
    writeSessionInfo(dir, info);
    assert.deepEqual(readSessionInfo(dir), info);
  });

  test("returns undefined for corrupted JSON instead of throwing", () => {
    const dir = join(root, "corrupted");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.json"), "{not valid json");
    assert.doesNotThrow(() => readSessionInfo(dir));
    assert.equal(readSessionInfo(dir), undefined);
  });
});
