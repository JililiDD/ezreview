#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startReviewServer, type ReviewServerHandle } from "./server.js";
import { openInBrowser } from "./browser.js";

export const USAGE = `Usage: ai-review-board <file.html>

Opens a local review server for the given HTML artifact.

Options:
  -h, --help    Show this help message
`;

export interface ParsedOpenArgs {
  help: boolean;
  file?: string;
}

export function parseCliArgs(argv: string[]): ParsedOpenArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  return {
    help: values.help ?? false,
    file: positionals[0],
  };
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

export interface OpenReviewDeps {
  openBrowser?: (url: string) => void;
}

export async function openReview(file: string, deps: OpenReviewDeps = {}): Promise<ReviewServerHandle> {
  const handle = await startReviewServer({ artifactPath: file });
  process.stdout.write(`${handle.url}\n`);
  (deps.openBrowser ?? openInBrowser)(handle.url);
  return handle;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);

  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (!parsed.file) {
    process.stderr.write("Error: missing required argument <file.html>\n\n");
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

  // Foreground process: the open server handle keeps the event loop alive.
  await openReview(parsed.file);
  return 0;
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
