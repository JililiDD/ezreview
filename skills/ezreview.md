# ezreview — agent usage guide

`ezreview` closes the loop between an agent that writes HTML artifacts and a human who reviews them in a browser. The human annotates the rendered artifact directly (clicking elements, selecting text); the agent reads those annotations back as structured, Edit-ready text and either edits the file or answers a question.

This document assumes no prior knowledge of the tool beyond what's written here.

## The three commands

### `ezreview <file.html>` (no subcommand) — open a review session

Starts a local server, opens the artifact in the reviewer's browser, and prints the URL to stdout. There is no `open` subcommand — just pass the file path directly as the only argument, as shown below.

```
ezreview report.html
```

- **It is a foreground process.** It does not return until you kill it (Ctrl+C) or the server auto-exits after 1 hour with no client connected (neither a browser tab nor a blocked `wait` call). Because of this, launch it with your host's managed background-task mechanism, the same way you'd launch any long-running dev server, rather than waiting on it synchronously.
- **It is idempotent — call it as many times as you want.** If a server for this exact file is already running, running `ezreview <file.html>` again just prints the existing URL and exits immediately (exit 0); it never starts a second instance. There is no need to check "is a server already running for this file" before calling it — just call it.
- It binds to `127.0.0.1` only (no LAN/remote access).
- If `<file.html>` doesn't exist, all three commands (`ezreview <file.html>`, `wait`, `reply`) fail the same way: an `Error: File not found: <path>` message on stderr and a non-zero exit — check the path if you see this.

### `ezreview wait <file.html>` — block until the next batch of feedback

```
ezreview wait report.html
```

- Blocks until the reviewer clicks "Submit review" in the browser, then prints one batch of annotations as structured, readable text to stdout and exits 0.
- **If a batch was already sent before you called `wait`, you still get it immediately** — nothing is lost by calling `wait` late.
- **If your shell/host kills `wait` due to a command timeout, run it again attached to the agent execution.** Feedback is durably queued server-side and consumed exactly once per `wait` call; a killed-and-rerun `wait` will still return the next unconsumed batch, never a duplicate and never a gap. Do not build custom queue recovery logic; a plain rerun is the correct recovery.
- Each annotation in the output has a stable id (e.g. `a-3`), an element `selector` and (truncated) `outerHTML` for element annotations, or `selectedText`/surrounding `context` for text-selection annotations, and the reviewer's `comment`. For a follow-up, `wait` also prints `Reply target: <root id>`; use that root id when replying.
- If there is no running session for the file (you haven't run `ezreview <file.html>` yet, or the server has since auto-exited), `wait` fails immediately with a clear error instead of hanging — run `ezreview <file.html>` first.
- Annotation ids and "has this been answered" state are durable — they survive an idle auto-exit + restart, so an id from an old `wait` batch is still valid to `reply` to even if the session restarted in between.

## Keep the agent actively waiting

Keep `ezreview wait <file.html>` attached to the current agent execution. Do not run `wait` with `&`, `nohup`, `disown`, or any plain detached shell mechanism. If your host exposes a managed long-running tool call or resumable command session, keep and reuse that handle until it returns.

`wait` returns one feedback batch, then exits. After it returns:

1. Handle every annotation in the batch.
2. Edit the artifact for change requests.
3. Run `ezreview reply` once for every annotation id and verify that each command exits successfully. Editing the artifact or triggering its automatic reload never counts as a reply.
4. Start a fresh attached `ezreview wait <file.html>`.

Continue this loop until `wait` reports that the review was confirmed complete, the human confirms in chat, or an unrecoverable error occurs. A command timeout or no output is not review completion; resume the same managed command session when possible, or start a fresh attached `wait`.

### `ezreview reply <file.html> --to <id> "<response text>"` — respond to an annotation

```
ezreview reply report.html --to a-3 "Updated the date to 08-14."
```

- Use this once for **every submitted annotation** after handling it. Questions get an answer; change requests get a concise completion summary after the file is edited.
- **Always quote `"<answer text>"` as a single shell argument.** The command only reads exactly one argument after `--to <id>` as the answer text — if you pass it unquoted, your shell will split it on whitespace and only the first word is used as the answer, with the rest silently discarded. Quote it exactly like the example above, always, even for short answers.
- The reviewer sees the response rendered directly inside the annotation bubble in the browser, without needing to reload or re-run `wait`.
- Threads support multiple rounds. For follow-ups, reply to the `Reply target` printed by `wait`; the server also normalizes a submitted child id to its root thread as a defensive fallback.
- `reply` does not touch the artifact file at all.

## Deciding: edit, then reply

Every annotation `wait` gives you is either a **change request** or a **question** — decide per annotation, not per batch (a single batch commonly mixes both). Every item still needs a final `reply`:

- **"Make this bigger", "fix the typo", "this color is wrong", "remove this section"** → use `Edit` (or equivalent) on the artifact, targeting the exact `selector`/`outerHTML` or `selectedText` it points at, then run `reply --to <id> "..."` describing the completed change.
- **A text-selection change request has a hard highlight boundary.** Use its `nearestSelector` and local before/after context to identify the selected occurrence. Do not modify anything outside the highlighted selection. Inside the selection, follow the comment literally: if it names one word, token, or phrase, change only that named text and preserve every other character unless the reviewer explicitly requests a broader rewrite. Never translate, rename, normalize, or rewrite adjacent text, and never run a document-wide replacement merely because the same text appears elsewhere. If the occurrence cannot be identified uniquely, ask for clarification via `reply` instead of editing multiple matches.
- **"Why is this here?", "what does this mean?", "is this intentional?"** → it's asking you something, not asking for a change. Use `reply --to <id>`, and leave the file alone.
- **Watch for questions that are actually change requests in disguise** — "why is this button so tiny?" or "does this really need to be red?" read grammatically as questions, but the reviewer almost always wants the thing fixed, not an explanation. If a "question" is about something visibly wrong rather than something unclear, treat it as a change request: make the fix, then `reply` briefly noting what you changed.
- Both kinds can appear in the same batch — handle each independently. Do not stop after the file edit or automatic artifact reload: the explicit, successfully completed `reply` command is what closes that annotation's waiting state. Never claim that a comment was replied to unless that command succeeded.
- If genuinely ambiguous after applying the rule above, prefer treating it as a question and asking for clarification via `reply` rather than guessing at a file change — a wrong guess costs a full round-trip, while a clarifying reply costs nothing.

Once you save an edit, the reviewer's browser refreshes the artifact automatically (you don't need to tell them or restart anything). The shell page itself (toolbar, remaining queued annotations) is unaffected by the refresh.

## Writing artifacts so annotations stay useful

The whole point of this tool is that feedback is precise enough to `Edit` directly instead of rewriting the whole file. That only works if the artifact itself is written in an Edit-friendly way:

- **Never collapse the file to one line.** Format HTML normally, with real line breaks and indentation. A one-line file makes every edit's diff cover the entire file, and makes `outerHTML` snippets in feedback much harder to locate back in the source.
- **Separate data from markup.** If the artifact renders structured data (a table, a chart, a list from an API), put the raw data in a `<script type="application/json">` block and have a small script read it — don't hand-interpolate data values into scattered HTML attributes or inline strings. This keeps both the markup and the data independently readable and independently editable.
- **Don't inline large binary assets as base64.** It bloats the file, and it makes every diff around that element unreadable. Reference external files or accept a placeholder instead.
- **Prefer a precise `Edit` (old-text → new-text) over rewriting the whole file**, even when a full rewrite would technically work. The live-reload only cares that the file changed, so a full rewrite won't break anything mechanically — but it defeats the tool's actual purpose (a reviewer can no longer see a small, focused diff of what changed) and burns far more output tokens than a targeted replacement.
