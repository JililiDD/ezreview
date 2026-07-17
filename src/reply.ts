import { sessionDirFor, readSessionInfo } from "./session.js";
import { checkHealthz, DEFAULT_HOST } from "./server.js";

export class ReplyError extends Error {}

export interface ReplyOptions {
  host?: string;
  sessionRoot?: string;
}

export async function sendReply(file: string, id: string, text: string, opts: ReplyOptions = {}): Promise<void> {
  const host = opts.host ?? DEFAULT_HOST;
  const sessionDir = sessionDirFor(file, opts.sessionRoot);
  const info = readSessionInfo(sessionDir);
  const notRunningMessage = `No running review session for ${file}. Run "ezreview ${file}" first.`;
  if (!info) {
    throw new ReplyError(notRunningMessage);
  }

  const baseUrl = `http://${host}:${info.port}/`;
  const health = await checkHealthz(baseUrl);
  if (!health) {
    throw new ReplyError(notRunningMessage);
  }

  const res = await fetch(new URL("reply", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, text }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ReplyError(body.error ?? `reply failed with status ${res.status}`);
  }
}
