import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

const standaloneSource = resolve("dist/ezreview.mjs");

function waitForServerUrl(child: ChildProcessByStdio<null, Readable, Readable>): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`standalone server did not start: ${stderr}`)), 10_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (!match) return;
      clearTimeout(timeout);
      resolvePromise(match[0]);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`standalone server exited before startup with code ${code}: ${stderr}`));
    });
  });
}

function runStandalone(bundlePath: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [bundlePath, ...args], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("the standalone bundle runs without node_modules or external assets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ezreview-standalone-test-"));
  const bundlePath = join(dir, basename(standaloneSource));
  const artifactPath = join(dir, "artifact.html");
  const homeDir = join(dir, "home");
  copyFileSync(standaloneSource, bundlePath);
  writeFileSync(artifactPath, "<!doctype html><html><body>standalone artifact</body></html>");

  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    PATH: join(dir, "missing-path"),
  };
  const bundleText = readFileSync(bundlePath, "utf8");
  assert.match(bundleText, /^#!\/usr\/bin\/env node/);
  assert.doesNotMatch(bundleText, /\bfrom\s+["']\./);
  assert.doesNotMatch(bundleText, /\bimport\s*\(\s*["']\./);

  const help = runStandalone(bundlePath, ["--help"], env);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /ezreview <file\.html>/);

  const server = spawn(process.execPath, [bundlePath, artifactPath], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const url = await waitForServerUrl(server);
    const faviconExpectations = new Map([
      ["/favicon.svg", "image/svg+xml"],
      ["/favicon.ico", "image/x-icon"],
      ["/favicon-16x16.png", "image/png"],
      ["/favicon-32x32.png", "image/png"],
      ["/favicon-64x64.png", "image/png"],
      ["/favicon-192x192.png", "image/png"],
      ["/favicon-512x512.png", "image/png"],
    ]);
    for (const [pathname, contentType] of faviconExpectations) {
      const response = await fetch(new URL(pathname, url));
      assert.equal(response.status, 200, pathname);
      assert.equal(response.headers.get("content-type"), contentType, pathname);
      assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
    }

    const feedbackResponse = await fetch(new URL("/feedback", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ id: "standalone-1", comment: "standalone feedback" }]),
    });
    assert.equal(feedbackResponse.status, 200);

    const waitResult = runStandalone(bundlePath, ["wait", artifactPath], env);
    assert.equal(waitResult.status, 0, waitResult.stderr);
    assert.match(waitResult.stdout, /standalone feedback/);

    const replyResult = runStandalone(
      bundlePath,
      ["reply", artifactPath, "--to", "standalone-1", "standalone reply"],
      env,
    );
    assert.equal(replyResult.status, 0, replyResult.stderr);
    assert.match(replyResult.stdout, /Reply sent to standalone-1/);
  } finally {
    server.kill();
    await new Promise<void>((resolvePromise) => {
      if (server.exitCode !== null) resolvePromise();
      else server.once("exit", () => resolvePromise());
    });
    rmSync(dir, { recursive: true, force: true });
  }
});
