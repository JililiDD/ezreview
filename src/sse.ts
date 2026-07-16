import type { ServerResponse } from "node:http";

export class SseHub {
  private readonly clients = new Set<ServerResponse>();

  register(res: ServerResponse): void {
    this.clients.add(res);
  }

  unregister(res: ServerResponse): void {
    this.clients.delete(res);
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
