import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderShellPage } from "./shell.js";

export const DEFAULT_HOST = "127.0.0.1";
export const BASE_PORT = 4400;
const MAX_PORT_ATTEMPTS = 50;

export interface ReviewServerOptions {
  artifactPath: string;
  host?: string;
  basePort?: number;
}

export interface ReviewServerHandle {
  server: Server;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

export function createRequestHandler(artifactPath: string) {
  const absoluteArtifactPath = resolve(artifactPath);

  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const pathname = (req.url ?? "/").split("?")[0];

    if (pathname === "/" && req.method === "GET") {
      const body = renderShellPage();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
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
        if (err.code === "EADDRINUSE" && attempt < maxAttempts) {
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

export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const basePort = options.basePort ?? BASE_PORT;
  const handler = createRequestHandler(options.artifactPath);
  const server = createHttpServer(handler);
  const port = await listenOnAvailablePort(server, host, basePort);

  return {
    server,
    port,
    host,
    url: `http://${host}:${port}/`,
    close(): Promise<void> {
      return new Promise((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
      });
    },
  };
}
