import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");
const source = readFileSync(join(assetsDir, "favicon.svg"), "utf8");
const sizes = [16, 32, 64, 192, 512];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body,svg{width:100%;height:100%;margin:0;display:block}</style>${source}`);
    await page.screenshot({ path: join(assetsDir, `favicon-${size}x${size}.png`), omitBackground: true });
  }
} finally {
  await browser.close();
}
