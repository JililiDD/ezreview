import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { renderShellPage } from "./shell.js";
import { SseHub } from "./sse.js";
import { watchArtifactFile } from "./watcher.js";
import { watchForIdle, DEFAULT_IDLE_TIMEOUT_MS } from "./idle-exit.js";
import { isFaviconPath, loadFaviconAsset } from "./favicon-assets.js";
import {
  appendBatch,
  loadSubmittedIds,
  appendThreadMessage,
  loadThreadRoots,
  resetSessionFiles,
} from "./feedback-queue.js";
import { sessionDirFor } from "./session.js";

export const DEFAULT_HOST = "127.0.0.1";
export const BASE_PORT = 4400;
const MAX_PORT_ATTEMPTS = 50;

export interface ReviewServerOptions {
  artifactPath: string;
  host?: string;
  basePort?: number;
  idleTimeoutMs?: number;
  sessionDir?: string;
}

export interface ReviewServerHandle {
  server: Server;
  port: number;
  host: string;
  url: string;
  sseHub: SseHub;
  close(): Promise<void>;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolvePromise(raw.length ? JSON.parse(raw) : undefined);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export function createRequestHandler(
  artifactPath: string,
  sseHub: SseHub,
  sessionDir: string,
  onConfirmDocument: () => void,
) {
  const absoluteArtifactPath = resolve(artifactPath);
  // Seeded from disk (not empty) so ids submitted in a prior server process —
  // including ones already consumed by `wait` before this process started —
  // remain valid to reply to across an idle-exit restart.
  const submittedIds = loadSubmittedIds(sessionDir);

  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const pathname = (req.url ?? "/").split("?")[0];

    if (pathname === "/" && req.method === "GET") {
      const body = renderShellPage(basename(absoluteArtifactPath), absoluteArtifactPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }

    if (isFaviconPath(pathname) && req.method === "GET") {
      try {
        const faviconAsset = loadFaviconAsset(pathname);
        res.writeHead(200, {
          "Content-Type": faviconAsset.type,
          "Cache-Control": "public, max-age=86400",
        });
        res.end(faviconAsset.body);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Favicon asset not found");
      }
      return;
    }

    if (pathname === "/artifact" && req.method === "GET") {
      try {
        const body = readFileSync(absoluteArtifactPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`File not found: ${absoluteArtifactPath}`);
      }
      return;
    }

    if (pathname === "/healthz" && req.method === "GET") {
      const body = JSON.stringify({ file: absoluteArtifactPath, pid: process.pid });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body);
      return;
    }

    if (pathname === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":ok\n\n");
      sseHub.register(res);
      const cleanup = (): void => {
        sseHub.unregister(res);
      };
      req.on("close", cleanup);
      res.on("error", cleanup);
      return;
    }

    if (pathname === "/feedback" && req.method === "POST") {
      readJsonBody(req)
        .then((body) => {
          const isValidBatch =
            Array.isArray(body) && body.every((item) => item && typeof item === "object" && "id" in item);
          if (!isValidBatch) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "expected an array of annotation items, each with an id" }));
            return;
          }
          const batchIds = (body as Array<{ id: unknown }>).map((item) => String(item.id));
          const idsSeenInBatch = new Set<string>();
          const duplicateId = batchIds.find((id) => {
            if (submittedIds.has(id) || idsSeenInBatch.has(id)) {
              return true;
            }
            idsSeenInBatch.add(id);
            return false;
          });
          if (duplicateId) {
            res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: `duplicate annotation id: ${duplicateId}` }));
            return;
          }
          const unknownReplyTo = (body as Array<{ replyToId?: unknown }>).find(
            (item) => item.replyToId != null && !submittedIds.has(String(item.replyToId)),
          );
          if (unknownReplyTo) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: `unknown annotation id: ${String(unknownReplyTo.replyToId)}` }));
            return;
          }
          appendBatch(sessionDir, body as unknown[]);
          for (const item of body as Array<{ id: unknown }>) {
            submittedIds.add(String(item.id));
          }
          sseHub.broadcast("feedback", {});
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "invalid JSON body" }));
        });
      return;
    }

    if (pathname === "/reply" && req.method === "POST") {
      readJsonBody(req)
        .then((body) => {
          const isValid =
            !!body &&
            typeof body === "object" &&
            typeof (body as { id?: unknown }).id === "string" &&
            typeof (body as { text?: unknown }).text === "string";
          if (!isValid) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "expected { id: string, text: string }" }));
            return;
          }
          const { id, text } = body as { id: string; text: string };
          if (!submittedIds.has(id)) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: `unknown annotation id: ${id}` }));
            return;
          }
          // Callers may pass either the root annotation id or a follow-up's
          // child id. Normalize both to the durable root so history and SSE
          // always address the one bubble that owns the thread.
          const rootId = loadThreadRoots(sessionDir).get(id) ?? id;
          appendThreadMessage(sessionDir, rootId, "agent", text);
          sseHub.broadcast("reply", { id: rootId, text });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, id: rootId }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "invalid JSON body" }));
        });
      return;
    }

    if (pathname === "/confirm-document" && req.method === "POST") {
      resetSessionFiles(sessionDir);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      // Broadcast before shutting down so any client waiting on /events —
      // in particular `wait`, which otherwise cannot tell a deliberate
      // confirm-close apart from an idle-exit or a crash — knows this
      // disconnect means the human ended the review, not an accident.
      sseHub.broadcast("confirmed", {});
      onConfirmDocument();
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  };
}

export function listenOnAvailablePort(
  server: Server,
  host: string,
  basePort: number,
  maxAttempts = MAX_PORT_ATTEMPTS,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    let attempt = 0;

    function tryListen(port: number): void {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener("listening", onListening);
        if ((err.code === "EADDRINUSE" || err.code === "EACCES" || err.code === "EPERM") && attempt < maxAttempts) {
          attempt += 1;
          tryListen(port + 1);
          return;
        }
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        resolvePromise(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    }

    tryListen(basePort);
  });
}

export interface HealthzInfo {
  file: string;
  pid: number;
}

export async function checkHealthz(baseUrl: string, timeoutMs = 500): Promise<HealthzInfo | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(new URL("/healthz", baseUrl), { signal: controller.signal });
    if (!res.ok) {
      return undefined;
    }
    return (await res.json()) as HealthzInfo;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const basePort = options.basePort ?? BASE_PORT;
  const sessionDir = options.sessionDir ?? sessionDirFor(options.artifactPath);
  const sseHub = new SseHub();
  const handler = createRequestHandler(options.artifactPath, sseHub, sessionDir, () => {
    close().catch(() => {});
  });
  const server = createHttpServer(handler);
  const port = await listenOnAvailablePort(server, host, basePort);

  const watcherHandle = watchArtifactFile(options.artifactPath, () => {
    sseHub.broadcast("reload", { timestamp: Date.now() });
  });

  function close(): Promise<void> {
    idleHandle.stop();
    watcherHandle.close();
    sseHub.closeAll();
    // Backstop for a connection accepted just before closeAll() ran but not yet registered.
    server.closeAllConnections();
    return new Promise((resolvePromise, reject) => {
      server.close((err) => (err ? reject(err) : resolvePromise()));
    });
  }

  const idleHandle = watchForIdle(sseHub, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, () => {
    close().catch(() => {});
  });

  return {
    server,
    port,
    host,
    url: `http://${host}:${port}/`,
    sseHub,
    close,
  };
}
