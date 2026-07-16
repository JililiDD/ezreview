import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";

export class SseHub extends EventEmitter {
  private readonly clients = new Set<ServerResponse>();

  register(res: ServerResponse): void {
    const wasEmpty = this.clients.size === 0;
    this.clients.add(res);
    if (wasEmpty) {
      this.emit("connected");
    }
  }

  unregister(res: ServerResponse): void {
    const had = this.clients.delete(res);
    if (had && this.clients.size === 0) {
      this.emit("empty");
    }
  }

  get size(): number {
    return this.clients.size;
  }

  broadcast(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  // server.close() waits for existing keep-alive connections to end on their own; without this, it hangs forever while any SSE tab is open.
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // already gone; nothing to clean up
      }
    }
    this.clients.clear();
  }
}
