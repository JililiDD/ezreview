import { TextDecoder } from "node:util";
import { sessionDirFor, readSessionInfo } from "./session.js";
import { checkHealthz, DEFAULT_HOST } from "./server.js";
import { consumeNextBatch } from "./feedback-queue.js";

export class WaitError extends Error {}

export interface AnnotationItem {
  id: string;
  type?: string;
  comment?: string;
  selector?: string;
  outerHTML?: string;
  selectedText?: string;
  context?: { before: string; after: string };
  [key: string]: unknown;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function renderBatch(items: AnnotationItem[]): string {
  return items
    .map((item) => {
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

async function nextSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  state: { buffer: string },
): Promise<string> {
  while (true) {
    const boundary = state.buffer.indexOf("\n\n");
    if (boundary !== -1) {
      const chunk = state.buffer.slice(0, boundary);
      state.buffer = state.buffer.slice(boundary + 2);
      return chunk;
    }
    const { value, done } = await reader.read();
    if (done) {
      throw new WaitError("Connection to the review server closed unexpectedly.");
    }
    state.buffer += decoder.decode(value, { stream: true });
  }
}

export async function waitForFeedback(file: string, opts: WaitOptions = {}): Promise<string> {
  const host = opts.host ?? DEFAULT_HOST;
  const sessionDir = sessionDirFor(file, opts.sessionRoot);
  const info = readSessionInfo(sessionDir);
  const notRunningMessage = `No running review session for ${file}. Run "ai-review-board ${file}" first.`;
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
  const controller = new AbortController();
  const res = await fetch(new URL("events", baseUrl), {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const state = { buffer: "" };

  try {
    await nextSseChunk(reader, decoder, state); // consume the initial ":ok" comment

    while (true) {
      const batch = consumeNextBatch(sessionDir) as AnnotationItem[] | null;
      if (batch) {
        return renderBatch(batch);
      }
      const chunk = await nextSseChunk(reader, decoder, state);
      if (!chunk.startsWith("event: feedback")) {
        continue; // ignore reload/other event types; loop back to re-check the file
      }
    }
  } finally {
    controller.abort();
  }
}
