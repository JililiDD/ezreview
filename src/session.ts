import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

export function normalizeArtifactPath(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function sessionHash(filePath: string): string {
  const normalized = normalizeArtifactPath(filePath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function sessionDirFor(filePath: string, root: string = join(homedir(), ".ezreview")): string {
  return join(root, sessionHash(filePath));
}

export interface SessionInfo {
  port: number;
  pid: number;
  file: string;
}

export function readSessionInfo(sessionDir: string): SessionInfo | undefined {
  const sessionJsonPath = join(sessionDir, "session.json");
  if (!existsSync(sessionJsonPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(sessionJsonPath, "utf-8");
    return JSON.parse(raw) as SessionInfo;
  } catch {
    return undefined;
  }
}

export function writeSessionInfo(sessionDir: string, info: SessionInfo): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "session.json"), JSON.stringify(info, null, 2));
}
