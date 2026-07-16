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
}
