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

<p align="center">
  <b>English</b> | <a href="./locales/README.zh-CN.md">简体中文</a> | <a href="./locales/README.ja.md">日本語</a> | <a href="./locales/README.es.md">Español</a>
</p>

`ezreview` is a browser review companion for the AI development workflow plugin [AIPilot](https://github.com/JililiDD/aipilot), though it works with any AI agent. It allows you to leave contextual inline comments directly on AI-generated pages and sends structured feedback so agents can target and fix exact locations in the source document.

It also works as a standalone command-line interface (CLI) for any local HTML file. The review server runs on your machine and binds to `127.0.0.1:4400`.

## See it in action

https://github.com/user-attachments/assets/f0a7700b-70dd-41da-8b16-f2aa0bdc6f56

## Features

- **Point at the exact issue**: click an element or select a text range in the rendered page
- **Send actionable context**: each annotation includes a stable ID, selector, relevant HTML, or selected text with surrounding context
- **Edit and answer in one loop**: agents can change the source for requests and reply directly to questions
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

## CLI reference

### Open a review session

```bash
ezreview your_file.html
```

Starts a local review server, opens the HTML artifact in your browser, and stays active while the session is running. Running it again for the same file returns the existing session URL instead of starting another server.

### Wait for feedback

```bash
ezreview wait your_file.html
```

Blocks until the reviewer submits a feedback batch (or returns immediately if queued feedback exists). Each batch contains structured change requests, questions, or both. If a command timeout interrupts it, run it again—the durable queue returns the next unconsumed batch without duplicating feedback.

### Reply to an annotation

```bash
ezreview reply your_file.html --to a-1 "Updated the heading size."
```

Sends a reply back to a specific annotation thread using the ID returned by `wait`. For a change request, save the source file before replying; the browser reloads the artifact and displays your reply inside the matching annotation.

For multiline responses containing escaped line breaks (`\n`), add `--decode-newlines`:

```bash
ezreview reply your_file.html --to a-1 --decode-newlines "First paragraph\n\nSecond paragraph"
```

The browser preserves real line breaks and paragraph spacing. Decoding is opt-in so code examples containing a literal `\n` remain unchanged by default.

## Use the agent review loop

An AI agent should run `ezreview wait` as a standard foreground/blocking command rather than detaching it with `&`, `nohup`, or `disown`. This ensures the agent blocks until feedback arrives and consumes the result immediately.

For every feedback batch, the agent should:

1. Read every annotation returned by `ezreview wait`
2. Edit the artifact for change requests
3. Answer questions without changing the file unless the comment implies a fix
4. Run `ezreview reply` once for every annotation ID
5. Start a new attached `ezreview wait`
6. Continue until you select **Approve** or end the review in chat

## Why use EZREVIEW with AIPilot

[AIPilot](https://github.com/JililiDD/aipilot) drives an AI development workflow through structured markdown documents. `ezreview` provides the interactive browser feedback loop, allowing you to review rendered UI previews and design documents in real time.

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

You no longer need to take screenshots or manually describe where an issue is in chat. `ezreview` anchors your comments directly to rendered HTML previews generated by AIPilot, giving the agent exact element and text references to act on.

## Related projects

- [AIPilot](https://github.com/JililiDD/aipilot): the document-driven AI development workflow that uses `ezreview` for browser-based review
- [lavish-axi](https://github.com/kunchenguid/lavish-axi): the project that inspired `ezreview`
