import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, validateArtifactFile, CliError, main, openReview } from "../src/cli.js";

describe("parseCliArgs", () => {
  test("parses --help", () => {
    assert.deepEqual(parseCliArgs(["--help"]), { kind: "help" });
  });

  test("parses a bare file positional as open", () => {
    assert.deepEqual(parseCliArgs(["demo.html"]), { kind: "open", file: "demo.html" });
  });

  test("no arguments yields an error", () => {
    const parsed = parseCliArgs([]);
    assert.equal(parsed.kind, "error");
  });

  test("parses wait <file>", () => {
    assert.deepEqual(parseCliArgs(["wait", "demo.html"]), { kind: "wait", file: "demo.html" });
  });

  test("wait with no file yields an error", () => {
    const parsed = parseCliArgs(["wait"]);
    assert.equal(parsed.kind, "error");
  });

  test("parses reply <file> --to <id> <text>", () => {
    assert.deepEqual(parseCliArgs(["reply", "demo.html", "--to", "a-1", "looks good"]), {
      kind: "reply",
      file: "demo.html",
      to: "a-1",
      text: "looks good",
    });
  });

  test("reply without --to yields an error", () => {
    const parsed = parseCliArgs(["reply", "demo.html", "some text"]);
    assert.equal(parsed.kind, "error");
  });

  test("reply without text yields an error", () => {
    const parsed = parseCliArgs(["reply", "demo.html", "--to", "a-1"]);
    assert.equal(parsed.kind, "error");
  });
});

describe("validateArtifactFile", () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ai-review-board-cli-test-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("throws CliError when file does not exist", () => {
    assert.throws(() => validateArtifactFile(join(dir, "missing.html")), CliError);
  });

  test("passes silently for an existing .html file", () => {
    const file = join(dir, "demo.html");
    writeFileSync(file, "<html></html>");
    assert.doesNotThrow(() => validateArtifactFile(file));
  });

  test("warns but does not throw for a non-.html file", () => {
    const file = join(dir, "demo.txt");
    writeFileSync(file, "not html");
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string) => {
      captured += chunk;
      return true;
    }) as typeof process.stderr.write;
    try {
      assert.doesNotThrow(() => validateArtifactFile(file));
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.match(captured, /does not have a \.html extension/);
  });
});

describe("main", () => {
  test("--help returns 0", async () => {
    assert.equal(await main(["--help"]), 0);
  });

  test("no file argument returns non-zero", async () => {
    assert.notEqual(await main([]), 0);
  });

  test("nonexistent file returns non-zero", async () => {
    assert.notEqual(await main(["does-not-exist.html"]), 0);
  });

  test("existing html file starts the server, prints the URL, and opens the browser", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-review-board-cli-main-test-"));
    const sessionRoot = mkdtempSync(join(tmpdir(), "ai-review-board-cli-main-session-"));
    const file = join(dir, "demo.html");
    writeFileSync(file, "<html></html>");

    let openedUrl: string | undefined;
    const result = await openReview(file, {
      sessionRoot,
      openBrowser: (url) => {
        openedUrl = url;
      },
    });

    try {
      assert.equal(result.reused, false);
      assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.equal(openedUrl, result.url);
    } finally {
      await result.handle?.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });
});
