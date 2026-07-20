import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const sourceAssetsDir = resolve(moduleDir, "../assets");
const assetsDir = existsSync(sourceAssetsDir) ? sourceAssetsDir : resolve(moduleDir, "../../assets");

const faviconAssets = new Map([
  ["/favicon.svg", { file: "favicon.svg", type: "image/svg+xml" }],
  ["/favicon.ico", { file: "favicon.ico", type: "image/x-icon" }],
  ["/favicon-16x16.png", { file: "favicon-16x16.png", type: "image/png" }],
  ["/favicon-32x32.png", { file: "favicon-32x32.png", type: "image/png" }],
  ["/favicon-64x64.png", { file: "favicon-64x64.png", type: "image/png" }],
  ["/favicon-192x192.png", { file: "favicon-192x192.png", type: "image/png" }],
  ["/favicon-512x512.png", { file: "favicon-512x512.png", type: "image/png" }],
]);

export interface FaviconAsset {
  body: Uint8Array;
  type: string;
}

export function isFaviconPath(pathname: string): boolean {
  return faviconAssets.has(pathname);
}

export function loadFaviconAsset(pathname: string): FaviconAsset {
  const asset = faviconAssets.get(pathname);
  if (!asset) throw new Error(`Unknown favicon path: ${pathname}`);
  return { body: readFileSync(join(assetsDir, asset.file)), type: asset.type };
}
