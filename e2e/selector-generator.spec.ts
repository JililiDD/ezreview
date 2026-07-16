import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function startWithFixture(fixtureName: string, basePort: number) {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-board-selector-e2e-"));
  const artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", fixtureName), artifactPath);
  const handle = await startReviewServer({ artifactPath, basePort });
  return { dir, handle };
}

async function cleanup(dir: string, handle: ReviewServerHandle) {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
}

// The generator lives inside the shell page's iframe-scoped closure; test it
// by calling window.__generateSelector against elements inside the iframe's
// own document (the function itself is a shell-page global, but it operates
// on iframe-document elements, matching how the real overlay uses it).
async function generateSelectorFor(page: import("@playwright/test").Page, elementSelectorInFixture: string) {
  return page.evaluate((sel) => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const el = frame.contentDocument!.querySelector(sel)!;
    return (window as any).__generateSelector(el);
  }, elementSelectorInFixture);
}

test.describe("selector generator (D-001)", () => {
  test("element with an id returns #id", async ({ page }) => {
    const { dir, handle } = await startWithFixture("selector-basics.html", 4900);
    try {
      await page.goto(handle.url);
      const result = await generateSelectorFor(page, "#has-id");
      expect(result.selector).toBe("#has-id");
      expect(result.shadowHost).toBeNull();

      const uniqueness = await page.evaluate((sel) => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const matches = frame.contentDocument!.querySelectorAll(sel);
        return matches.length;
      }, result.selector);
      expect(uniqueness).toBe(1);
    } finally {
      await cleanup(dir, handle);
    }
  });

  test("element without an id among siblings uses nth-of-type and is unique", async ({ page }) => {
    const { dir, handle } = await startWithFixture("selector-basics.html", 4910);
    try {
      await page.goto(handle.url);
      const result = await generateSelectorFor(page, "ul li:nth-of-type(2)");
      expect(result.shadowHost).toBeNull();

      const match = await page.evaluate((sel) => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const matches = frame.contentDocument!.querySelectorAll(sel);
        return { count: matches.length, text: matches[0]?.textContent };
      }, result.selector);
      expect(match.count).toBe(1);
      expect(match.text).toBe("two");
    } finally {
      await cleanup(dir, handle);
    }
  });

  test("deep no-id chain with same-tag siblings at every level resolves to a unique, multi-segment selector", async ({ page }) => {
    const { dir, handle } = await startWithFixture("selector-basics.html", 4920);
    try {
      await page.goto(handle.url);

      const needle = "distinguishable only by its full ancestor chain";
      const result = await page.evaluate((text) => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const doc = frame.contentDocument!;
        const el = Array.from(doc.querySelectorAll("p")).find((p) => p.textContent?.includes(text))!;
        return { generated: (window as any).__generateSelector(el), matched: true };
      }, needle);

      expect(result.matched).toBe(true);
      // the whole point of this fixture: two structurally-identical branches
      // mean a short suffix is never unique, so the generator must be forced
      // to join multiple " > "-separated nth-of-type segments
      expect(result.generated.selector.split(">").length).toBeGreaterThan(1);
      expect(result.generated.shadowHost).toBeNull();

      const match = await page.evaluate((sel) => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const matches = frame.contentDocument!.querySelectorAll(sel);
        return { count: matches.length, text: matches[0]?.textContent };
      }, result.generated.selector);
      expect(match.count).toBe(1);
      expect(match.text).toContain(needle);
    } finally {
      await cleanup(dir, handle);
    }
  });

  test("SVG elements get a unique selector", async ({ page }) => {
    const { dir, handle } = await startWithFixture("selector-svg.html", 4930);
    try {
      await page.goto(handle.url);

      const result = await page.evaluate(() => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const el = frame.contentDocument!.querySelectorAll("circle")[1];
        return (window as any).__generateSelector(el);
      });
      expect(result.shadowHost).toBeNull();

      const match = await page.evaluate((sel) => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const matches = frame.contentDocument!.querySelectorAll(sel);
        return { count: matches.length, cx: (matches[0] as SVGCircleElement | undefined)?.getAttribute("cx") };
      }, result.selector);
      expect(match.count).toBe(1);
      expect(match.cx).toBe("40");
    } finally {
      await cleanup(dir, handle);
    }
  });

  test("duplicate class siblings resolve to distinct, unique selectors", async ({ page }) => {
    const { dir, handle } = await startWithFixture("selector-duplicate-class.html", 4940);
    try {
      await page.goto(handle.url);

      const results = await page.evaluate(() => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const buttons = Array.from(frame.contentDocument!.querySelectorAll(".action"));
        return buttons.map((b) => (window as any).__generateSelector(b));
      });

      const selectors = results.map((r: { selector: string }) => r.selector);
      expect(new Set(selectors).size).toBe(3);

      for (let i = 0; i < selectors.length; i++) {
        const match = await page.evaluate(
          (args) => {
            const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
            const matches = frame.contentDocument!.querySelectorAll(args.sel);
            return { count: matches.length, text: matches[0]?.textContent };
          },
          { sel: selectors[i] },
        );
        expect(match.count).toBe(1);
      }
    } finally {
      await cleanup(dir, handle);
    }
  });

  test("shadow DOM element returns a two-part selector resolvable via host + shadowRoot", async ({ page }) => {
    const { dir, handle } = await startWithFixture("selector-shadow-dom.html", 4950);
    try {
      await page.goto(handle.url);

      const result = await page.evaluate(() => {
        const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
        const host = frame.contentDocument!.getElementById("shadow-host")!;
        const button = host.shadowRoot!.querySelector("button")!;
        return (window as any).__generateSelector(button);
      });

      expect(result.shadowHost).not.toBeNull();

      const resolved = await page.evaluate(
        (args) => {
          const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
          const doc = frame.contentDocument!;
          const host = doc.querySelector(args.shadowHost) as Element & { shadowRoot: ShadowRoot };
          const matches = host.shadowRoot.querySelectorAll(args.selector);
          return { count: matches.length, text: matches[0]?.textContent };
        },
        { shadowHost: result.shadowHost, selector: result.selector },
      );
      expect(resolved.count).toBe(1);
      expect(resolved.text).toBe("click me");
    } finally {
      await cleanup(dir, handle);
    }
  });
});
