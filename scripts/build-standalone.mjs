import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const outputFile = join(projectRoot, "dist", "ezreview.mjs");

const faviconDefinitions = [
  ["/favicon.svg", "favicon.svg", "image/svg+xml"],
  ["/favicon.ico", "favicon.ico", "image/x-icon"],
  ["/favicon-16x16.png", "favicon-16x16.png", "image/png"],
  ["/favicon-32x32.png", "favicon-32x32.png", "image/png"],
  ["/favicon-64x64.png", "favicon-64x64.png", "image/png"],
  ["/favicon-192x192.png", "favicon-192x192.png", "image/png"],
  ["/favicon-512x512.png", "favicon-512x512.png", "image/png"],
];

async function embeddedFaviconModule() {
  const entries = await Promise.all(
    faviconDefinitions.map(async ([pathname, filename, type]) => {
      const body = await readFile(join(projectRoot, "assets", filename));
      return [pathname, { body: body.toString("base64"), type }];
    }),
  );

  return `
const faviconAssets = new Map(${JSON.stringify(entries)}.map(([pathname, asset]) => [
  pathname,
  { body: Buffer.from(asset.body, "base64"), type: asset.type },
]));

export function isFaviconPath(pathname) {
  return faviconAssets.has(pathname);
}

export function loadFaviconAsset(pathname) {
  const asset = faviconAssets.get(pathname);
  if (!asset) throw new Error(\`Unknown favicon path: \${pathname}\`);
  return asset;
}
`;
}

const embedFaviconsPlugin = {
  name: "embed-favicons",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^\.\/favicon-assets\.js$/ }, () => ({
      path: "favicon-assets",
      namespace: "embedded-favicons",
    }));
    buildContext.onLoad({ filter: /.*/, namespace: "embedded-favicons" }, async () => ({
      contents: await embeddedFaviconModule(),
      loader: "js",
    }));
  },
};

await mkdir(dirname(outputFile), { recursive: true });
await build({
  entryPoints: [join(projectRoot, "src", "cli.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
  sourcemap: false,
  legalComments: "inline",
  plugins: [embedFaviconsPlugin],
});
await chmod(outputFile, 0o755);

process.stdout.write(`${outputFile}\n`);
