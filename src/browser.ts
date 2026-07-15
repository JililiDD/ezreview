import { spawn, type ChildProcess } from "node:child_process";

export function buildOpenCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

export type SpawnFn = (command: string, args: string[]) => ChildProcess;

export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: SpawnFn = (command, args) => spawn(command, args, { stdio: "ignore", detached: true }),
): void {
  const { command, args } = buildOpenCommand(platform, url);
  try {
    const child = spawnFn(command, args);
    child.on("error", () => {
      process.stderr.write(`Could not open a browser automatically. Open this URL manually: ${url}\n`);
    });
    child.unref();
  } catch {
    process.stderr.write(`Could not open a browser automatically. Open this URL manually: ${url}\n`);
  }
}
