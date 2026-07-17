import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/server.ts";
import type { ReviewServerHandle } from "../src/server.ts";

async function selectSubstring(page: import("@playwright/test").Page, elementSelector: string, needle: string) {
  await page.evaluate(
    (args) => {
      const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      const el = doc.querySelector(args.sel)!;
      const textNode = el.firstChild!;
      const full = textNode.textContent || "";
      const start = full.indexOf(args.needle);
      if (start === -1) throw new Error("needle not found in fixture text: " + args.needle);
      const range = doc.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + args.needle.length);
      const selection = doc.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { sel: elementSelector, needle },
  );
}

async function selectWholeElement(page: import("@playwright/test").Page, elementSelector: string) {
  await page.evaluate((sel) => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    const el = doc.querySelector(sel)!;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, elementSelector);
}

async function queueCurrentSelection(page: import("@playwright/test").Page, comment: string) {
  // Selecting text opens the draft bubble directly now — no intermediate
  // "+ Add comment" button to click first.
  await page.locator(".bubble-draft textarea").fill(comment);
  await page.locator(".bubble-draft .bubble-add").click();
}

let dir: string;
let artifactPath: string;
let handle: ReviewServerHandle;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-review-board-text-queue-e2e-"));
  artifactPath = join(dir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), artifactPath);
  handle = await startReviewServer({ artifactPath, basePort: 5500 });
});

test.afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test("selecting text opens a draft bubble carrying the selected text", async ({ page }) => {
  await page.goto(handle.url);
  await selectSubstring(page, "#para", "testing text selection");

  await expect(page.locator(".bubble-draft")).toBeVisible();
});

test("Add to queue stores selectedText, context, and nearestSelector correctly", async ({ page }) => {
  await page.goto(handle.url);
  await selectSubstring(page, "#para", "testing text selection");
  await queueCurrentSelection(page, "check this");

  const item = await page.evaluate(() => (window as any).__annotationQueue[0]);
  expect(item.type).toBe("text-annotation");
  expect(item.selectedText).toBe("testing text selection");
  expect(item.context.before.endsWith("sentence for ")).toBe(true);
  expect(item.context.after.startsWith(" annotation behavior")).toBe(true);
  expect(item.nearestSelector).toBe("#para");
  expect(item.comment).toBe("check this");
});

test("context is computed correctly when the selection's container is an element, not a text node", async ({ page }) => {
  // selectNodeContents(el) produces startContainer/endContainer === el
  // (an Element) with offsets that are child indices, not character
  // offsets — this exercises the element-boundary path in getTextContext,
  // which is explicitly called for by this work-item's Task 2.3 verification.
  await page.goto(handle.url);
  await selectWholeElement(page, "#mid-span");
  await queueCurrentSelection(page, "boundary case");

  const item = await page.evaluate(() => (window as any).__annotationQueue[0]);
  expect(item.selectedText).toBe("middle selectable span");
  expect(item.context.before.endsWith("Prefix text ")).toBe(true);
  expect(item.context.after.startsWith(" suffix text")).toBe(true);
});

test("the queued text annotation gets a Custom Highlight registered in the iframe document", async ({ page }) => {
  await page.goto(handle.url);
  await selectSubstring(page, "#para", "testing text selection");
  await queueCurrentSelection(page, "x");

  const highlighted = await page.evaluate(() => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const win = frame.contentWindow as any;
    const set = win.CSS.highlights.get("ai-review-text");
    if (!set) return null;
    let found = "";
    set.forEach((range: Range) => {
      found = range.toString();
    });
    return { size: set.size, text: found };
  });

  expect(highlighted).not.toBeNull();
  expect(highlighted!.size).toBe(1);
  expect(highlighted!.text).toBe("testing text selection");
});

test("Cancel removes the preview highlight without queueing anything", async ({ page }) => {
  await page.goto(handle.url);
  await selectSubstring(page, "#para", "testing text selection");
  await page.locator(".bubble-draft .bubble-cancel").click();

  const size = await page.evaluate(() => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const win = frame.contentWindow as any;
    return win.CSS.highlights.get("ai-review-text").size;
  });
  expect(size).toBe(0);

  const queueLength = await page.evaluate(() => (window as any).__annotationQueue.length);
  expect(queueLength).toBe(0);
});

test("hovering a queued (not-lost) text annotation deepens its highlight and reverts on mouseleave", async ({ page }) => {
  await page.goto(handle.url);
  await selectSubstring(page, "#para", "testing text selection");
  await queueCurrentSelection(page, "x");

  const before = await page.evaluate(() => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const win = frame.contentWindow as any;
    return { normal: win.CSS.highlights.get("ai-review-text").size, hover: win.CSS.highlights.get("ai-review-text-hover").size };
  });
  expect(before).toEqual({ normal: 1, hover: 0 });

  await page.locator(".bubble").hover();
  const during = await page.evaluate(() => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const win = frame.contentWindow as any;
    return { normal: win.CSS.highlights.get("ai-review-text").size, hover: win.CSS.highlights.get("ai-review-text-hover").size };
  });
  expect(during).toEqual({ normal: 0, hover: 1 });

  await page.mouse.move(5, 5);
  const after = await page.evaluate(() => {
    const frame = document.getElementById("artifact-frame") as HTMLIFrameElement;
    const win = frame.contentWindow as any;
    return { normal: win.CSS.highlights.get("ai-review-text").size, hover: win.CSS.highlights.get("ai-review-text-hover").size };
  });
  expect(after).toEqual({ normal: 1, hover: 0 });
});

test("a text annotation queued before a reload is marked lost after the reload", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-text-queue-reload-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5510 });

  try {
    await page.goto(localHandle.url);
    await selectSubstring(page, "#para", "testing text selection");
    await queueCurrentSelection(page, "x");

    writeFileSync(localArtifact, "<html><body><p>totally different</p></body></html>");
    await page.waitForTimeout(1200);

    const bubble = page.locator(".bubble");
    await bubble.hover();
    await expect(bubble.locator(".anchor-lost-badge")).toBeVisible();
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("a text annotation that was already Sent before a reload is also marked lost on hover (not silently inert)", async ({ page }) => {
  // Regression: markTextAnnotationsLost() previously only scanned the queue,
  // so a text annotation already moved into sentItems by Send all kept
  // lost === false forever. Its Range still pointed at the pre-reload
  // iframe document, so hovering it neither highlighted anything (the
  // Range's nodes are gone) nor showed the Anchor lost badge — a silent,
  // confusing dead end a real reviewer hit manually.
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-text-sent-reload-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5520 });

  try {
    await page.goto(localHandle.url);
    await selectSubstring(page, "#para", "testing text selection");
    await queueCurrentSelection(page, "x");

    await page.locator("#send-all").click();
    await expect(page.locator(".bubble.bubble-sent")).toBeVisible();

    writeFileSync(localArtifact, "<html><body><p>totally different</p></body></html>");
    await page.waitForTimeout(1200);

    const bubble = page.locator(".bubble");
    await bubble.hover();
    await expect(bubble.locator(".anchor-lost-badge")).toBeVisible();
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("a text annotation survives a reload that only edited an unrelated part of the page", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-text-reanchor-unrelated-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5530 });

  try {
    await page.goto(localHandle.url);
    await selectSubstring(page, "#para", "testing text selection");
    await queueCurrentSelection(page, "x");

    // Targeted replace (like a real Edit call) — only the unrelated
    // #mid-span text changes; everything else, including surrounding
    // whitespace, stays byte-for-byte identical so context.before/after
    // still match verbatim.
    const original = readFileSync(localArtifact, "utf-8");
    writeFileSync(localArtifact, original.replace("middle selectable span", "a completely rewritten middle span"));
    await page.waitForTimeout(1200);

    const bubble = page.locator(".bubble");
    await bubble.hover();
    await expect(bubble.locator(".anchor-lost-badge")).toHaveCount(0);
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("a text annotation whose selected text was itself edited re-anchors to the replacement text", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-text-reanchor-replaced-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  copyFileSync(join(import.meta.dirname, "fixtures", "text-selection.html"), localArtifact);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5540 });

  try {
    await page.goto(localHandle.url);
    await selectSubstring(page, "#para", "testing text selection");
    await queueCurrentSelection(page, "x");

    // Targeted replace of just the selected words with "CHANGED" — the
    // surrounding context.before/after text and whitespace are untouched,
    // matching what a real Edit call on the exact selected span would do.
    const original = readFileSync(localArtifact, "utf-8");
    writeFileSync(localArtifact, original.replace("testing text selection", "CHANGED"));
    await page.waitForTimeout(1200);

    const bubble = page.locator(".bubble");
    await bubble.hover();
    await expect(bubble.locator(".anchor-lost-badge")).toHaveCount(0);

    const highlightedText = await page.evaluate(() => {
      const item = (window as any).__annotationQueue[0];
      return item.range.toString();
    });
    expect(highlightedText).toBe("CHANGED");
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("a text annotation stays lost when its context landmarks are now ambiguous (found more than once)", async ({ page }) => {
  const localDir = mkdtempSync(join(tmpdir(), "ai-review-board-text-reanchor-ambiguous-e2e-"));
  const localArtifact = join(localDir, "demo.html");
  // A paragraph long enough (>200 chars) that getTextContext's ancestor
  // climb stops at #para itself, so before/after are plain sentence text —
  // this keeps the test independent of exactly how far the shared
  // text-selection.html fixture's short paragraph happens to climb.
  const longSentence =
    "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua before " +
    "TARGETWORD" +
    " after ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
  writeFileSync(localArtifact, `<html><body><p id="para">${longSentence}</p></body></html>`);
  const localHandle = await startReviewServer({ artifactPath: localArtifact, basePort: 5550 });

  try {
    await page.goto(localHandle.url);
    await selectSubstring(page, "#para", "TARGETWORD");
    await queueCurrentSelection(page, "x");

    // Duplicate the whole paragraph verbatim elsewhere in the page — its
    // before/after context now matches in two places, so the re-anchor must
    // refuse the ambiguous match rather than guess which one is "it".
    const original = readFileSync(localArtifact, "utf-8");
    writeFileSync(localArtifact, original.replace("</body>", `<p>${longSentence}</p></body>`));
    await page.waitForTimeout(1200);

    const bubble = page.locator(".bubble");
    await bubble.hover();
    await expect(bubble.locator(".anchor-lost-badge")).toBeVisible();
  } finally {
    await localHandle.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});
