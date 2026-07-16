import type { SseHub } from "./sse.js";

export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface IdleWatcherHandle {
  stop(): void;
}

export function watchForIdle(hub: SseHub, idleMs: number, onIdle: () => void): IdleWatcherHandle {
  let timer: NodeJS.Timeout | undefined;

  function arm(): void {
    timer = setTimeout(() => {
      timer = undefined;
      onIdle();
    }, idleMs);
  }

  function disarm(): void {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  if (hub.size === 0) {
    arm();
  }

  hub.on("empty", arm);
  hub.on("connected", disarm);

  return {
    stop(): void {
      disarm();
      hub.off("empty", arm);
      hub.off("connected", disarm);
    },
  };
}
