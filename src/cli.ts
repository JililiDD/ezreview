#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openInBrowser } from "./browser.js";
import { openIdempotently, type IdempotentOpenOptions, type IdempotentOpenResult } from "./idempotent-open.js";
import { waitForFeedback, WaitError } from "./wait.js";

export const USAGE = `Usage:
  ai-review-board <file.html>                          Open a review server
  ai-review-board wait <file.html>                      Block until the next feedback batch
  ai-review-board reply <file.html> --to <id> "<text>"  Answer a question-type annotation

Options:
  -h, --help    Show this help message
`;

export type ParsedArgs =
  | { kind: "help" }
  | { kind: "open"; file: string }
  | { kind: "wait"; file: string }
  | { kind: "reply"; file: string; to: string; text: string }
  | { kind: "error"; message: string };

export function parseCliArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      to: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    return { kind: "help" };
  }

  const [first, second, third] = positionals;

  if (first === "wait") {
    if (!second) {
      return { kind: "error", message: "wait requires <file.html>" };
    }
    return { kind: "wait", file: second };
  }

  if (first === "reply") {
    if (!second) {
      return { kind: "error", message: "reply requires <file.html>" };
    }
    if (!values.to) {
      return { kind: "error", message: "reply requires --to <id>" };
    }
    if (!third) {
      return { kind: "error", message: 'reply requires "<text>"' };
    }
    return { kind: "reply", file: second, to: values.to as string, text: third };
  }

  if (!first) {
    return { kind: "error", message: "missing required argument <file.html>" };
  }

  return { kind: "open", file: first };
}

export class CliError extends Error {}

export function validateArtifactFile(path: string): void {
  if (!existsSync(path)) {
    throw new CliError(`File not found: ${path}`);
  }
  if (!statSync(path).isFile()) {
    throw new CliError(`Not a file: ${path}`);
  }
  if (extname(path).toLowerCase() !== ".html") {
    process.stderr.write(`Warning: ${path} does not have a .html extension\n`);
  }
}

export interface OpenReviewDeps extends IdempotentOpenOptions {
  openBrowser?: (url: string) => void;
}

export async function openReview(file: string, deps: OpenReviewDeps = {}): Promise<IdempotentOpenResult> {
  const result = await openIdempotently(file, deps);
  process.stdout.write(`${result.url}\n`);
  if (!result.reused) {
    (deps.openBrowser ?? openInBrowser)(result.url);
  }
  return result;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);

  if (parsed.kind === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (parsed.kind === "error") {
    process.stderr.write(`Error: ${parsed.message}\n\n`);
    process.stderr.write(USAGE);
    return 1;
  }

  try {
    validateArtifactFile(parsed.file);
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (parsed.kind === "open") {
    // Foreground process: the open server handle keeps the event loop alive.
    await openReview(parsed.file);
    return 0;
  }

  if (parsed.kind === "wait") {
    try {
      const rendered = await waitForFeedback(parsed.file);
      process.stdout.write(`${rendered}\n`);
      return 0;
    } catch (err) {
      if (err instanceof WaitError) {
        process.stderr.write(`Error: ${err.message}\n`);
        return 1;
      }
      throw err;
    }
  }

  // reply subcommand: wired in a later story (US4).
  process.stderr.write("Error: reply is not yet implemented\n");
  return 1;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  main()
    .then((exitCode) => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch((err: Error) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    });
}
