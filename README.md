<p align="center">
  <img src="./assets/favicon.svg" alt="EZREVIEW logo" width="112">
</p>

<h1 align="center">EZREVIEW</h1>

<p align="center">
  Use it with AIPilot or standalone to review AI-generated HTML in your browser.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ezreview"><img src="https://img.shields.io/npm/v/ezreview" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node.js 20 or newer">
</p>

`ezreview` is designed as the browser review companion for [AIPilot](https://github.com/JililiDD/aipilot), but you can also use it with any AI agent. It lets you comment on an AI-generated document where the problem appears, then sends structured feedback back to the agent that can act on it.

It also works as a standalone command-line interface (CLI) for any local HTML file. The review server runs on your machine and binds to `127.0.0.1`.

## See it in action

https://github.com/user-attachments/assets/7bd6ef56-d54a-4219-bffe-a27ebb4ef101

In the demo, the reviewer selects content in the browser, submits feedback, and sees the agent's edit and reply in the same review session.

## Why use EZREVIEW with AIPilot

[AIPilot](https://github.com/JililiDD/aipilot) manages a document-driven workflow from requirements and design through implementation, review, and release. `ezreview` adds a precise browser feedback loop to the stages that produce reviewable documents.

```text
AIPilot creates a document or design preview
                  ↓
EZREVIEW opens it in the browser
                  ↓
You annotate an element or select exact text
                  ↓
The agent receives structured feedback
                  ↓
The agent edits or answers, then EZREVIEW reloads the result
```

This workflow removes the need to send screenshots, describe where an issue appears, or paste Document Object Model (DOM) fragments into chat. AIPilot can render Markdown documents to temporary HTML previews, while `ezreview` anchors your comments to the rendered content.

## Features

- **Point at the exact issue**: click an element or select a text range in the rendered page
- **Send actionable context**: each annotation includes a stable ID, selector, relevant HTML, or selected text with surrounding context
- **Edit and answer in one loop**: agents can change the source for requests and reply directly to questions
- **See changes without reopening the review**: saved file edits reload in the browser
- **Continue a discussion**: each annotation supports multiple rounds of replies
- **Resume safely**: queued feedback and annotation IDs survive command timeouts and server restarts
- **Keep review data local**: the server listens only on `127.0.0.1`

## Install EZREVIEW

Install [Node.js](https://nodejs.org/) 20 or newer, then install `ezreview` globally:

```bash
npm install --global ezreview
```

Confirm the installation:

```bash
ezreview --help
```

You can also run a specific version without a global installation:

```bash
npx -y ezreview@latest your_file.html
```

## Prompt an agent to run a standalone review

AIPilot manages the continuous review loop for you. When you use `ezreview` WITHOUT AIPilot, tell your agent to keep the session active and wait after every feedback batch.

Copy this prompt and replace `your_file.html` with the artifact you want to review:

```text
Open your_file.html with ezreview. Use your managed background-task mechanism
to keep the review server running, and keep each ezreview wait attached to the
current execution. Continuously wait for submitted comments. For every comment,
decide whether it requests a change or asks a question. Apply the requested
change or answer the question, reply through ezreview for every annotation ID,
then continue waiting for more feedback. Do not treat a command timeout, empty
output, file reload, or completed feedback batch as review completion. Do not
exit until I click Approve in ezreview or explicitly confirm in chat that the
review is complete.
```

The final sentence matters because `ezreview wait` returns after one feedback batch. Without it, an agent may handle the first batch and end its turn before you submit more comments.

## Start a review

Open a local HTML file:

```bash
ezreview your_file.html
```

The command starts a local server, opens the review in your browser, and stays active while the session is running.

In a second terminal, wait for the reviewer to select **Submit review**:

```bash
ezreview wait your_file.html
```

The command returns one structured batch of annotations. A batch can contain change requests, questions, or both.

After handling each annotation, send a reply using the ID returned by `wait`:

```bash
ezreview reply your_file.html --to a-3 "Updated the heading size."
```

For a change request, save the source file before replying. The browser reloads the artifact and displays the reply inside the matching annotation.

## Use the agent review loop

An AI agent should keep `wait` attached to its current execution instead of detaching it with `&`, `nohup`, or `disown`.

For every feedback batch, the agent should:

1. Read every annotation returned by `ezreview wait`
2. Edit the artifact for change requests
3. Answer questions without changing the file unless the comment implies a fix
4. Run `ezreview reply` once for every annotation ID
5. Start a new attached `ezreview wait`
6. Continue until you select **Approve** or end the review in chat

`wait` returns one batch and exits. If a command timeout interrupts it, run it again. The durable queue returns the next unconsumed batch without duplicating feedback.

## CLI reference

### Open a review session

```bash
ezreview your_file.html
```

This command opens the browser and runs the review server in the foreground. Running it again for the same file returns the existing session URL instead of starting another server.

### Wait for feedback

```bash
ezreview wait your_file.html
```

This command blocks until the next submitted feedback batch. It returns immediately if the session already has queued feedback.

### Reply to an annotation

```bash
ezreview reply your_file.html --to annotation_id "Response text"
```

Quote the response so your shell passes it as one argument. Follow-up replies remain attached to the root annotation thread.

## Write review-friendly HTML

The agent can apply feedback more precisely when the artifact stays readable and editable:

- Keep normal line breaks and indentation instead of collapsing the file to one line
- Store structured data in a `<script type="application/json">` block when practical
- Reference large binary assets instead of embedding base64 data
- Prefer targeted edits over rewriting the entire file

## How EZREVIEW works

`ezreview` serves a browser shell that embeds your artifact and adds annotation controls. Element comments include selector and HTML context. Text comments include the selected range, nearest element, and surrounding text.

Feedback batches live in a durable queue keyed by the artifact's absolute path. Server-Sent Events (SSE) deliver file reloads, replies, and approval signals to the browser without polling. A connected browser or blocked `wait` command keeps the session active; an idle session exits after one hour.

## Related projects

- [AIPilot](https://github.com/JililiDD/aipilot): the document-driven AI development workflow that uses `ezreview` for browser-based review
- [lavish-axi](https://github.com/kunchenguid/lavish-axi): the project that inspired `ezreview`

## License

`ezreview` is available under the [MIT License](./LICENSE).
