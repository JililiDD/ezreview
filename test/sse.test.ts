import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { SseHub } from "../src/sse.js";

function fakeResponse(): { res: ServerResponse; writes: string[] } {
  const writes: string[] = [];
  const res = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as ServerResponse;
  return { res, writes };
}

describe("SseHub", () => {
  test("register/unregister track connected client count", () => {
    const hub = new SseHub();
    const { res: a } = fakeResponse();
    const { res: b } = fakeResponse();

    assert.equal(hub.size, 0);
    hub.register(a);
    assert.equal(hub.size, 1);
    hub.register(b);
    assert.equal(hub.size, 2);
    hub.unregister(a);
    assert.equal(hub.size, 1);
    hub.unregister(b);
    assert.equal(hub.size, 0);
  });

  test("broadcast writes the same event to every registered client", () => {
    const hub = new SseHub();
    const { res: a, writes: writesA } = fakeResponse();
    const { res: b, writes: writesB } = fakeResponse();
    hub.register(a);
    hub.register(b);

    hub.broadcast("reload", { timestamp: 123 });

    assert.equal(writesA.length, 1);
    assert.equal(writesB.length, 1);
    assert.equal(writesA[0], writesB[0]);
    assert.match(writesA[0], /^event: reload\ndata: \{"timestamp":123\}\n\n$/);
  });

  test("broadcast survives a client whose write throws, and prunes it", () => {
    const hub = new SseHub();
    const { res: good, writes: goodWrites } = fakeResponse();
    const broken = {
      write: () => {
        throw new Error("ECONNRESET");
      },
    } as unknown as ServerResponse;

    hub.register(broken);
    hub.register(good);
    assert.equal(hub.size, 2);

    assert.doesNotThrow(() => hub.broadcast("reload", {}));

    assert.equal(goodWrites.length, 1);
    assert.equal(hub.size, 1);
  });

  test("closeAll ends every connection and empties the registry", () => {
    const hub = new SseHub();
    let endCalledA = false;
    let endCalledB = false;
    const a = { end: () => { endCalledA = true; } } as unknown as ServerResponse;
    const b = { end: () => { endCalledB = true; } } as unknown as ServerResponse;
    hub.register(a);
    hub.register(b);

    hub.closeAll();

    assert.equal(endCalledA, true);
    assert.equal(endCalledB, true);
    assert.equal(hub.size, 0);
  });

  test("closeAll tolerates a client whose end() throws", () => {
    const hub = new SseHub();
    const broken = {
      end: () => {
        throw new Error("already destroyed");
      },
    } as unknown as ServerResponse;
    hub.register(broken);

    assert.doesNotThrow(() => hub.closeAll());
    assert.equal(hub.size, 0);
  });

  test("broadcast does not write to an unregistered client", () => {
    const hub = new SseHub();
    const { res, writes } = fakeResponse();
    hub.register(res);
    hub.unregister(res);

    hub.broadcast("reload", {});

    assert.equal(writes.length, 0);
  });
});
