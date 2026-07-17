import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.js";
import { sessionDirFor, writeSessionInfo } from "../src/session.js";
import { sendReply, ReplyError } from "../src/reply.js";
import { main } from "../src/cli.js";
import type { ReviewServerHandle } from "../src/server.js";

async function setUp(basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ezreview-reply-test-"));
  const sessionRoot = mkdtempSync(join(tmpdir(), "ezreview-reply-session-test-"));
  const artifactPath = join(dir, "demo.html");
  writeFileSync(artifactPath, "<html></html>");
  const sessionDir = sessionDirFor(artifactPath, sessionRoot);
  const handle = await startReviewServer({ artifactPath, basePort, sessionDir });
  writeSessionInfo(sessionDir, { port: handle.port, pid: process.pid, file: artifactPath });
  return { dir, sessionRoot, artifactPath, sessionDir, handle };
}

async function tearDown(ctx: { dir: string; sessionRoot: string; handle: ReviewServerHandle }) {
  await ctx.handle.close();
  rmSync(ctx.dir, { recursive: true, force: true });
  rmSync(ctx.sessionRoot, { recursive: true, force: true });
}

describe("sendReply", () => {
  test("throws ReplyError when there is no running session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-reply-norun-test-"));
    const sessionRoot = mkdtempSync(join(tmpdir(), "ezreview-reply-norun-session-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    try {
      await assert.rejects(() => sendReply(artifactPath, "a-1", "text", { sessionRoot }), ReplyError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  test("succeeds for a submitted, unanswered id", async () => {
    const ctx = await setUp(6100);
    try {
      await fetch(new URL("/feedback", ctx.handle.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id: "a-1", comment: "question" }]),
      });
      await assert.doesNotReject(() => sendReply(ctx.artifactPath, "a-1", "answer", { sessionRoot: ctx.sessionRoot }));
    } finally {
      await tearDown(ctx);
    }
  });

  test("a second reply to the same id also succeeds — multi-round threads have no answered-once cap", async () => {
    const ctx = await setUp(6110);
    try {
      await fetch(new URL("/feedback", ctx.handle.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id: "a-2", comment: "question" }]),
      });
      await assert.doesNotReject(() => sendReply(ctx.artifactPath, "a-2", "first", { sessionRoot: ctx.sessionRoot }));
      await assert.doesNotReject(() => sendReply(ctx.artifactPath, "a-2", "second", { sessionRoot: ctx.sessionRoot }));
    } finally {
      await tearDown(ctx);
    }
  });

  test("throws ReplyError for an unsubmitted id (400)", async () => {
    const ctx = await setUp(6120);
    try {
      await assert.rejects(
        () => sendReply(ctx.artifactPath, "a-never-submitted", "answer", { sessionRoot: ctx.sessionRoot }),
        ReplyError,
      );
    } finally {
      await tearDown(ctx);
    }
  });
});

describe("cli reply subcommand exit codes", () => {
  test("no running session -> non-zero exit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ezreview-cli-reply-norun-"));
    const artifactPath = join(dir, "demo.html");
    writeFileSync(artifactPath, "<html></html>");
    try {
      const code = await main(["reply", artifactPath, "--to", "a-1", "answer"]);
      assert.notEqual(code, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
