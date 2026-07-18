# ezreview

Local-first review and feedback for HTML documents — built for humans and AI agents to work through together.

`ezreview` closes the feedback loop on any HTML file — a report, a prototype, a spec, agent-written or hand-authored — between the human reviewing it and the AI (or person) who'll act on the feedback. The human annotates the rendered document directly in the browser — clicking elements or selecting text to mark exactly what needs to change — and the agent reads those annotations back as structured, `Edit`-ready feedback, then either edits the file or replies with an answer. Both the edit and the reply show up back in the same tool, right where the annotation was made. No screenshots, no copy-pasting DOM snippets, no manual back-and-forth.

## Features

- **Click-to-annotate** — comment on any element or text selection directly in the rendered page.
- **Structured feedback** — each annotation resolves to a stable id, a CSS selector / `outerHTML` (or selected text + surrounding context), and the reviewer's comment.
- **Question vs. change-request triage** — annotations are handled per-item; agents answer questions, edit change requests, and reply on the same annotation id when each item is complete.
- **Live reload** — saved edits to the artifact file are picked up and reflected in the browser automatically.
- **Multi-round Q&A threads** — reply to an annotation any number of times; the reviewer sees the answer rendered inline, no reload needed.
- **Idempotent sessions** — calling `open` for a file that already has a running session just returns the existing URL.
- **Durable queue** — feedback batches and annotation ids survive process restarts and idle auto-exit; a killed `wait` can simply be rerun.
- **Local-only** — the server binds to `127.0.0.1`; nothing leaves your machine.

## Installation

```
npm install -g ezreview
```

Requires Node.js >= 20.

## Quickstart

```
# 1. Open the document for review — starts a local server and opens your browser
ezreview <your-file>.html

# 2. Block until the reviewer clicks "Send all" in the browser
ezreview wait <your-file>.html

# 3. Respond to each submitted annotation after handling it
# `a-3` is the annotation id printed by `wait`, e.g. "a-3: ..."
ezreview reply <your-file>.html --to a-3 "Updated the date to 08-14."
```

For a change request, edit the artifact first—the browser refreshes automatically once you save—then reply using that annotation's id so the review can close it.

## CLI reference

### `ezreview <file.html>` — open a review session

Starts a local server, opens the artifact in the reviewer's browser, and prints the URL to stdout.

- Foreground process: it doesn't return until you kill it (Ctrl+C), or the server auto-exits after 1 hour idle (no browser tab and no blocked `wait` call).
- Idempotent: calling it again for the same file just prints the existing URL and exits 0 — never starts a second server.
- Binds to `127.0.0.1` only.

### `ezreview wait <file.html>` — block until the next feedback batch

Blocks until the reviewer clicks "Submit reviews", then prints one batch of annotations as structured text and exits 0.

- If a batch was already sent before `wait` was called, it returns immediately — nothing is lost by calling late.
- Safe to rerun after a timeout/kill: each batch is consumed exactly once, so a rerun returns the next unconsumed batch — never a duplicate, never a gap.
- Fails immediately with a clear error if there's no running session for the file (run `open` first).

Each annotation includes a stable id (e.g. `a-3`), plus either an element's `selector`/`outerHTML` or a text selection's `selectedText`/`context`, and the reviewer's comment. Follow-ups also include `Reply target: <root id>`; use that id with `reply`.

### `ezreview reply <file.html> --to <id> "<response text>"` — respond to an annotation

Sends a response that renders inline in the browser, inside the bubble for that annotation.

- Quote `"<answer text>"` as a single argument — an unquoted answer gets split by the shell and truncated.
- Supports multiple rounds per thread (the reviewer can keep the conversation going).
- A submitted follow-up child id is normalized to its root thread, and the CLI reports the actual root id used.
- Does not touch the artifact file.

Run `ezreview --help` for the full usage summary.

## Workflow: edit and reply

Every annotation is either a **change request** or a **question**, and every submitted annotation needs a response:

| Annotation reads like... | Action |
|---|---|
| "Make this bigger", "fix the typo", "this color is wrong" | Edit the artifact file at the given `selector`/`outerHTML`/`selectedText`, then `ezreview reply --to <id> "..."` with what changed |
| "Why is this here?", "what does this mean?" | `ezreview reply --to <id> "..."` |
| "Why is this button so tiny?" (a question in form, a fix in intent) | Treat as a change request — fix it, then reply noting what changed |

Both kinds can appear in the same batch — handle each independently. For a change request, save the edit before sending the response so the reviewer sees both the updated artifact and the completion message.

## Writing artifacts that stay Edit-friendly

To keep feedback precise enough to act on directly:

- **Don't collapse the file to one line.** Keep real line breaks and indentation so diffs stay small and `outerHTML` snippets are locatable.
- **Separate data from markup.** Put structured data in a `<script type="application/json">` block instead of hand-interpolating values into HTML.
- **Don't inline large binary assets as base64.** Reference external files or use a placeholder.
- **Prefer a targeted edit over a full rewrite.** Live reload doesn't care either way, but a full rewrite destroys the reviewer's ability to see a focused diff.

## How it works

`ezreview open` starts a local HTTP server that serves a review "shell" page embedding the artifact, plus a comment rail for annotations. Feedback batches are appended to a durable, per-session queue on disk (keyed by the artifact's absolute path), so `wait`/`reply` state survives idle restarts. Server-Sent Events push live reload, new replies, and session-confirmation signals to the browser without polling.

## Development

```
npm install
npm run build        # compile TypeScript to dist/
npm test              # run the unit/integration test suite
npm run test:browser  # run Playwright end-to-end tests
```

Project layout:

```
src/     CLI, server, feedback queue, and shell-page rendering
test/    unit and integration tests (node:test)
e2e/     Playwright end-to-end specs
skills/  agent-facing usage guide (ezreview.md)
```

## Related projects

`ezreview` pairs well with [aipilot](https://github.com/JililiDD/aipilot), a spec/design/plan/build/review workflow plugin for AI agents — `ezreview` slots in as the review step for any HTML artifact the workflow produces (design mockups, specs, etc.). The two are independent and don't depend on each other; use `ezreview` standalone for any agent/HTML review loop.

Inspired by [lavish-axi](https://github.com/kunchenguid/lavish-axi) (MIT).

## License

See [LICENSE](LICENSE).
