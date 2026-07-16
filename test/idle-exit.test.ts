import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SseHub } from "../src/sse.js";
import { watchForIdle } from "../src/idle-exit.js";
import type { ServerResponse } from "node:http";

function fakeResponse(): ServerResponse {
  return { write: () => true, end: () => {} } as unknown as ServerResponse;
}

describe("watchForIdle", () => {
  test("fires onIdle after the timeout when no client ever connects", async () => {
    const hub = new SseHub();
    let fired = false;
    const handle = watchForIdle(hub, 50, () => {
      fired = true;
    });

    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fired, true);
    handle.stop();
  });

  test("cancels the timer once a client connects before it fires", async () => {
    const hub = new SseHub();
    let fired = false;
    const handle = watchForIdle(hub, 50, () => {
      fired = true;
    });

    hub.register(fakeResponse());
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fired, false);
    handle.stop();
  });

  test("restarts the timer once the last client disconnects", async () => {
    const hub = new SseHub();
    let fired = false;
    const handle = watchForIdle(hub, 50, () => {
      fired = true;
    });

    const client = fakeResponse();
    hub.register(client);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fired, false, "should not fire while a client is connected");

    hub.unregister(client);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fired, true, "should fire once the idle window elapses after disconnect");
    handle.stop();
  });

  test("stop() prevents onIdle from firing", async () => {
    const hub = new SseHub();
    let fired = false;
    const handle = watchForIdle(hub, 50, () => {
      fired = true;
    });

    handle.stop();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fired, false);
  });
});
