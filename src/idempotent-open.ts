import { checkHealthz, startReviewServer, DEFAULT_HOST, type ReviewServerHandle } from "./server.js";
import { normalizeArtifactPath, sessionDirFor, readSessionInfo, writeSessionInfo } from "./session.js";

export interface IdempotentOpenOptions {
  host?: string;
  basePort?: number;
  sessionRoot?: string;
}

export interface IdempotentOpenResult {
  url: string;
  reused: boolean;
  handle?: ReviewServerHandle;
}

export async function openIdempotently(
  file: string,
  opts: IdempotentOpenOptions = {},
): Promise<IdempotentOpenResult> {
  const host = opts.host ?? DEFAULT_HOST;
  const normalizedFile = normalizeArtifactPath(file);
  const dir = sessionDirFor(file, opts.sessionRoot);
  const existing = readSessionInfo(dir);

  if (existing) {
    const health = await checkHealthz(`http://${host}:${existing.port}/`);
    if (health && normalizeArtifactPath(health.file) === normalizedFile) {
      return { url: `http://${host}:${existing.port}/`, reused: true };
    }
  }

  const handle = await startReviewServer({ artifactPath: file, host, basePort: opts.basePort, sessionDir: dir });
  writeSessionInfo(dir, { port: handle.port, pid: process.pid, file: normalizedFile });
  return { url: handle.url, reused: false, handle };
}
