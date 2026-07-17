import { TextDecoder } from "node:util";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { sessionDirFor, readSessionInfo } from "./session.js";
import { checkHealthz, DEFAULT_HOST } from "./server.js";
import { consumeNextBatch, loadThreadHistory } from "./feedback-queue.js";

export class WaitError extends Error {}

// Not an error: signals a deliberate "Confirm document" click, distinct from
// an idle-exit/crash/network-blip disconnect (both of which throw WaitError).
// The CLI exits 0 on this, not 1 — the review ended on purpose, so a caller
// must not treat it as a failure worth retrying.
export class ReviewConfirmed extends Error {}

export interface AnnotationItem {
  id: string;
  type?: string;
  comment?: string;
  selector?: string;
  outerHTML?: string;
  selectedText?: string;
  context?: { before: string; after: string };
  replyToId?: string;
  [key: string]: unknown;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// sessionDir is required (not optional-with-a-degraded-fallback): the only
// production caller always has one, and a follow-up item silently rendered
// without its thread history would be a real bug, not a reasonable default.
export function renderBatch(items: AnnotationItem[], sessionDir: string): string {
  return items
    .map((item) => {
      if (item.replyToId) {
        const history = loadThreadHistory(sessionDir, item.replyToId);
        const historyText = history.map((m) => `  [${m.from}] ${m.text}`).join("\n");
        return `[${item.id}] Follow-up on thread ${item.replyToId} — full history:\n${historyText}`;
      }
      const comment = item.comment ?? "";
      if (item.type === "text-annotation") {
        return `[${item.id}] Selected text: "${item.selectedText}" (before: "${item.context?.before ?? ""}", after: "${item.context?.after ?? ""}", near ${item.nearestSelector ?? "?"}). Comment: ${comment}`;
      }
      const outer = item.outerHTML ? ` — ${truncate(item.outerHTML, 500)}` : "";
      return `[${item.id}] Element ${item.selector}${outer}. Comment: ${comment}`;
    })
    .join("\n");
}

export interface WaitOptions {
  host?: string;
  sessionRoot?: string;
}

// Byte-source abstraction so nextSseChunk's chunk-boundary parsing stays
// unchanged regardless of what actually produced the bytes — only the
// adapter below needs to know it's really a node:http IncomingMessage.
interface ByteReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
}

function readerFromIncomingMessage(res: IncomingMessage): ByteReader {
  const iterator = res[Symbol.asyncIterator]();
  return {
    async read() {
      const { value, done } = await iterator.next();
      return { value: value as Uint8Array | undefined, done: !!done };
    },
  };
}

async function nextSseChunk(reader: ByteReader, decoder: TextDecoder, state: { buffer: string }): Promise<string> {
  while (true) {
    const boundary = state.buffer.indexOf("\n\n");
    if (boundary !== -1) {
      const chunk = state.buffer.slice(0, boundary);
      state.buffer = state.buffer.slice(boundary + 2);
      return chunk;
    }
    // A graceful close (server calls res.end()) resolves with done: true; an
    // abrupt one (socket reset, forcibly destroyed connection) instead rejects
    // this read — both must present the same friendly WaitError to the CLI,
    // not a raw low-level error message (the exact failure mode this fix exists for).
    let value: Uint8Array | undefined;
    let done: boolean;
    try {
      ({ value, done } = await reader.read());
    } catch {
      throw new WaitError("Connection to the review server closed unexpectedly.");
    }
    if (done) {
      throw new WaitError("Connection to the review server closed unexpectedly.");
    }
    state.buffer += decoder.decode(value, { stream: true });
  }
}

function connectToEvents(baseUrl: string): Promise<{ req: ClientRequest; res: IncomingMessage }> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(new URL("events", baseUrl), { headers: { Accept: "text/event-stream" } }, (res) => {
      resolvePromise({ req, res });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function waitForFeedback(file: string, opts: WaitOptions = {}): Promise<string> {
  const host = opts.host ?? DEFAULT_HOST;
  const sessionDir = sessionDirFor(file, opts.sessionRoot);
  const info = readSessionInfo(sessionDir);
  const notRunningMessage = `No running review session for ${file}. Run "ezreview ${file}" first.`;
  if (!info) {
    throw new WaitError(notRunningMessage);
  }

  const baseUrl = `http://${host}:${info.port}/`;
  const health = await checkHealthz(baseUrl);
  if (!health) {
    throw new WaitError(notRunningMessage);
  }

  // Subscribe before checking the file (not the reverse) so a batch that
  // lands in the narrow window between the check and the subscribe can
  // never be missed — the SSE connection is already open and buffering.
  //
  // node:http, not the global fetch(): this connection is meant to sit
  // quietly for as long as it takes a human to write feedback (minutes to
  // tens of minutes), but fetch()'s underlying undici dispatcher enforces a
  // ~5 minute idle body timeout on every request — including ones designed
  // to stay open with no data in between. node:http has no such default.
  const { req, res } = await connectToEvents(baseUrl);
  const reader = readerFromIncomingMessage(res);
  const decoder = new TextDecoder();
  const state = { buffer: "" };

  try {
    await nextSseChunk(reader, decoder, state); // consume the initial ":ok" comment

    while (true) {
      const batch = consumeNextBatch(sessionDir) as AnnotationItem[] | null;
      if (batch) {
        return renderBatch(batch, sessionDir);
      }
      const chunk = await nextSseChunk(reader, decoder, state);
      if (chunk.startsWith("event: confirmed")) {
        throw new ReviewConfirmed("Review confirmed complete — no further feedback will arrive.");
      }
      if (!chunk.startsWith("event: feedback")) {
        continue; // ignore reload/other event types; loop back to re-check the file
      }
    }
  } finally {
    req.destroy();
  }
}
