# ezreview — agent usage guide

`ezreview` closes the loop between an agent that writes HTML artifacts and a human who reviews them in a browser. The human annotates the rendered artifact directly (clicking elements, selecting text); the agent reads those annotations back as structured, Edit-ready text and either edits the file or answers a question.

This document assumes no prior knowledge of the tool beyond what's written here.

## The three commands

### `ezreview <file.html>` (no subcommand) — open a review session

Starts a local server, opens the artifact in the reviewer's browser, and prints the URL to stdout. There is no `open` subcommand — just pass the file path directly as the only argument, as shown below.

```
ezreview report.html
```

- **It is a foreground process.** It does not return until you kill it (Ctrl+C) or the server auto-exits after 1 hour with no client connected (neither a browser tab nor a blocked `wait` call). Because of this, launch it with your host's background-task mechanism (the same way you'd launch any long-running dev server) rather than waiting on it synchronously.
- **It is idempotent — call it as many times as you want.** If a server for this exact file is already running, running `open` again just prints the existing URL and exits immediately (exit 0); it never starts a second instance. There is no need to check "is a server already running for this file" before calling it — just call it.
- It binds to `127.0.0.1` only (no LAN/remote access).
- If `<file.html>` doesn't exist, all three commands (`open`, `wait`, `reply`) fail the same way: an `Error: File not found: <path>` message on stderr and a non-zero exit — check the path if you see this.

### `ezreview wait <file.html>` — block until the next batch of feedback

```
ezreview wait report.html
```

- Blocks until the reviewer clicks "Send all" in the browser, then prints one batch of annotations as structured, readable text to stdout and exits 0.
- **If a batch was already sent before you called `wait`, you still get it immediately** — nothing is lost by calling `wait` late.
- **If your shell/host kills `wait` due to a command timeout, just run it again.** Feedback is durably queued server-side and consumed exactly once per `wait` call; a killed-and-rerun `wait` will still return the next unconsumed batch, never a duplicate and never a gap. Do not build your own retry/backoff logic around this — a plain rerun is the correct and complete recovery.
- Each annotation in the output has a stable id (e.g. `a-3`), an element `selector` and (truncated) `outerHTML` for element annotations, or `selectedText`/surrounding `context` for text-selection annotations, and the reviewer's `comment`. Use the id when replying (see below).
- If there is no running session for the file (you haven't called `open` yet, or the server has since auto-exited), `wait` fails immediately with a clear error instead of hanging — run `open` first.
- Annotation ids and "has this been answered" state are durable — they survive an idle auto-exit + restart, so an id from an old `wait` batch is still valid to `reply` to even if the session restarted in between.

### `ezreview reply <file.html> --to <id> "<answer text>"` — answer a question

```
ezreview reply report.html --to a-3 "It's the API's required timezone format, not a bug."
```

- Use this for annotations that are **questions**, not change requests — see the triage rule below.
- **Always quote `"<answer text>"` as a single shell argument.** The command only reads exactly one argument after `--to <id>` as the answer text — if you pass it unquoted, your shell will split it on whitespace and only the first word is used as the answer, with the rest silently discarded. Quote it exactly like the example above, always, even for short answers.
- The reviewer sees the answer rendered directly inside the bubble they wrote the question in, in the browser, without needing to reload or re-run `wait`.
- **One answer per annotation, ever.** A second `reply --to <same id>` is rejected (non-zero exit, error printed) — there is no follow-up/threaded conversation. If the reviewer wants to say more, they'll create a new annotation with a new id.
- `reply` does not touch the artifact file at all.

## Deciding: edit the file, or `reply`?

Every annotation `wait` gives you is either a **change request** or a **question** — decide per annotation, not per batch (a single batch commonly mixes both):

- **"Make this bigger", "fix the typo", "this color is wrong", "remove this section"** → it's asking you to change something. Use `Edit` (or equivalent) on the artifact file, targeting the exact `selector`/`outerHTML` or `selectedText` the annotation points at.
- **"Why is this here?", "what does this mean?", "is this intentional?"** → it's asking you something, not asking for a change. Use `reply --to <id>`, and leave the file alone.
- **Watch for questions that are actually change requests in disguise** — "why is this button so tiny?" or "does this really need to be red?" read grammatically as questions, but the reviewer almost always wants the thing fixed, not an explanation. If a "question" is about something visibly wrong rather than something unclear, treat it as a change request: make the fix, and optionally also `reply` briefly noting what you changed.
- Both kinds can appear in the same batch — handle each independently. Editing the file and replying to a question are not mutually exclusive within one round.
- If genuinely ambiguous after applying the rule above, prefer treating it as a question and asking for clarification via `reply` rather than guessing at a file change — a wrong guess costs a full round-trip, while a clarifying reply costs nothing.

Once you save an edit, the reviewer's browser refreshes the artifact automatically (you don't need to tell them or restart anything). The shell page itself (toolbar, remaining queued annotations) is unaffected by the refresh.

## Writing artifacts so annotations stay useful

The whole point of this tool is that feedback is precise enough to `Edit` directly instead of rewriting the whole file. That only works if the artifact itself is written in an Edit-friendly way:

- **Never collapse the file to one line.** Format HTML normally, with real line breaks and indentation. A one-line file makes every edit's diff cover the entire file, and makes `outerHTML` snippets in feedback much harder to locate back in the source.
- **Separate data from markup.** If the artifact renders structured data (a table, a chart, a list from an API), put the raw data in a `<script type="application/json">` block and have a small script read it — don't hand-interpolate data values into scattered HTML attributes or inline strings. This keeps both the markup and the data independently readable and independently editable.
- **Don't inline large binary assets as base64.** It bloats the file, and it makes every diff around that element unreadable. Reference external files or accept a placeholder instead.
- **Prefer a precise `Edit` (old-text → new-text) over rewriting the whole file**, even when a full rewrite would technically work. The live-reload only cares that the file changed, so a full rewrite won't break anything mechanically — but it defeats the tool's actual purpose (a reviewer can no longer see a small, focused diff of what changed) and burns far more output tokens than a targeted replacement.
