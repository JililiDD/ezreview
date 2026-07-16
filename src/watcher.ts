import { watch, type FSWatcher } from "node:fs";

export const DEFAULT_DEBOUNCE_MS = 250;

export interface FileWatcherHandle {
  close(): void;
}

export function watchArtifactFile(
  filePath: string,
  onChange: () => void,
  debounceMs = DEFAULT_DEBOUNCE_MS,
): FileWatcherHandle {
  let timer: NodeJS.Timeout | undefined;

  const watcher: FSWatcher = watch(filePath, () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, debounceMs);
  });

  // A deleted/recreated artifact (some editors save this way) can make the
  // watched path disappear out from under fs.watch. An unhandled "error"
  // here would otherwise crash the whole process; degrade to "no more
  // live-reload for this session" instead.
  watcher.on("error", () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  });

  return {
    close(): void {
      if (timer) {
        clearTimeout(timer);
      }
      watcher.close();
    },
  };
}
