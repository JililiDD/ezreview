#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function main(argv: string[] = process.argv.slice(2)): number {
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

  process.stdout.write(`ai-review-board scaffold: would open ${parsed.file}\n`);
  return 0;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  process.exit(main());
}
