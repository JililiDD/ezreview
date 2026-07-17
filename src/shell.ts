import { renderClientScript } from "./shell-client.js";

export function renderShellPage(): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<title>ezreview</title>
<style>
  :root[data-theme="dark"] {
    --chrome-bg: rgba(18, 24, 38, 0.72);
    --chrome-bg-solid: #0f1420;
    --chrome-border: rgba(120, 200, 255, 0.25);
    --chrome-fg: #dce8f5;
    --chrome-dim: #6f8299;
    --accent: #4ee6c4;
    --accent-soft: rgba(78, 230, 196, 0.15);
    --accent-ink: #06231c;
    --stage-bg: #06080d;
    --stage-glow: radial-gradient(circle at 50% 0%, #0c1220, var(--stage-bg) 70%);
    --bg-glow-1: rgba(78, 230, 196, 0.06);
    --bg-glow-2: rgba(157, 123, 255, 0.08);
    --ok-green: #4ee6c4;
    --disconnect-red: #ff7a90;
    --stale-amber-fg: #e0c578;
    --stale-amber-bg: rgba(224, 197, 120, 0.12);
    --agent-fg: #f0e3bd;
    --agent-soft: rgba(224, 197, 120, 0.09);
    --agent-border: rgba(224, 197, 120, 0.3);
    --agent-label: #e0c578;
    --title-fg: #fff;
    --body-fg: #c3d0e0;
    --card-bg: #0f1420;
    --card-sent-bg: #141b2b;
    --card-border: rgba(120, 200, 255, 0.18);
    --card-fg: #dce8f5;
    --card-shadow: 0 0 0 1px rgba(255, 255, 255, 0.02), 0 8px 20px -8px rgba(0, 0, 0, 0.6);
    --draft-input-bg: rgba(255, 255, 255, 0.03);
    --danger-soft: rgba(255, 122, 144, 0.1);
    --modal-bg: #0f1420;
    --modal-fg: #dce8f5;
    --modal-cancel-bg: rgba(120, 200, 255, 0.12);
    --modal-cancel-fg: #dce8f5;
  }
  :root[data-theme="light"] {
    --chrome-bg: rgba(255, 255, 255, 0.78);
    --chrome-bg-solid: #ffffff;
    --chrome-border: rgba(20, 90, 110, 0.18);
    --chrome-fg: #1c2b33;
    --chrome-dim: #64798a;
    --accent: #0f9e82;
    --accent-soft: rgba(15, 158, 130, 0.12);
    --accent-ink: #ffffff;
    --stage-bg: #eef2f6;
    --stage-glow: radial-gradient(circle at 50% 0%, #ffffff, var(--stage-bg) 70%);
    --bg-glow-1: rgba(15, 158, 130, 0.07);
    --bg-glow-2: rgba(120, 110, 230, 0.06);
    --ok-green: #0f9e82;
    --disconnect-red: #c23b52;
    --stale-amber-fg: #6b5312;
    --stale-amber-bg: rgba(168, 120, 31, 0.12);
    --agent-fg: #6b5312;
    --agent-soft: rgba(168, 120, 31, 0.1);
    --agent-border: rgba(168, 120, 31, 0.3);
    --agent-label: #a8781f;
    --title-fg: #10202a;
    --body-fg: #35454e;
    --card-bg: #ffffff;
    --card-sent-bg: #f2f5f7;
    --card-border: rgba(20, 90, 110, 0.14);
    --card-fg: #1c2b33;
    --card-shadow: 0 0 0 1px rgba(0, 0, 0, 0.02), 0 8px 20px -8px rgba(20, 40, 50, 0.12);
    --draft-input-bg: rgba(0, 0, 0, 0.02);
    --danger-soft: rgba(194, 59, 82, 0.08);
    --modal-bg: #ffffff;
    --modal-fg: #1c2b33;
    --modal-cancel-bg: rgba(20, 90, 110, 0.08);
    --modal-cancel-fg: #1c2b33;
  }
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    font-family: -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
  }
  body {
    display: flex;
    flex-direction: column;
    background: var(--stage-bg);
    color: var(--chrome-fg);
    background-image:
      radial-gradient(circle at 15% 15%, var(--bg-glow-1), transparent 40%),
      radial-gradient(circle at 85% 80%, var(--bg-glow-2), transparent 45%);
  }
  #toolbar {
    height: 48px;
    flex: 0 0 48px;
    background: var(--chrome-bg);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--chrome-border);
    color: var(--chrome-fg);
    display: flex;
    align-items: center;
    padding: 0 18px;
    gap: 16px;
    box-sizing: border-box;
    position: relative;
  }
  #wordmark {
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--chrome-dim);
    border-right: 1px solid var(--chrome-border);
    padding-right: 14px;
  }
  #file-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 13px;
  }
  #status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok-green);
    box-shadow: 0 0 8px var(--ok-green), 0 0 2px var(--ok-green);
    display: inline-block;
  }
  #status-dot.disconnected {
    background: var(--disconnect-red);
    box-shadow: 0 0 8px var(--disconnect-red), 0 0 2px var(--disconnect-red);
  }
  #file-name {
    color: var(--chrome-fg);
  }
  #status-text {
    color: var(--disconnect-red);
    margin-left: 4px;
    font-weight: 400;
  }
  #spacer {
    flex: 1;
  }
  #review-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--chrome-dim);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .switch {
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    position: relative;
    cursor: pointer;
  }
  .switch[data-on="false"] {
    background: transparent;
    border-color: var(--chrome-border);
  }
  .switch-knob {
    position: absolute;
    top: 1px;
    left: 17px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    transition: left 0.15s ease;
  }
  .switch[data-on="false"] .switch-knob {
    left: 1px;
    background: var(--chrome-dim);
    box-shadow: none;
  }
  #scroll-hint {
    color: var(--chrome-dim);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12.5px;
    /* visibility, not display: the review toggle's own position must never
       shift when this shows/hides — its box stays reserved either way. */
    visibility: hidden;
  }
  #scroll-hint.visible {
    visibility: visible;
  }
  #spacer-2 {
    flex: 1;
  }
  #theme-toggle {
    background: transparent;
    border: 1px solid var(--chrome-border);
    color: var(--chrome-dim);
    border-radius: 4px;
    width: 30px;
    height: 30px;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #theme-toggle:hover {
    color: var(--chrome-fg);
    border-color: var(--accent);
  }
  #confirm-document {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 6px 14px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    letter-spacing: 0.03em;
  }
  #confirm-document:hover {
    background: var(--accent-soft);
  }
  #confirm-document:disabled {
    background: transparent;
    color: var(--chrome-dim);
    border-color: var(--chrome-border);
    cursor: default;
  }
  #send-all {
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: 6px;
    padding: 9px 12px;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
  }
  #send-all:disabled {
    background: var(--chrome-border);
    color: var(--chrome-dim);
    cursor: default;
  }
  #stage {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  #artifact-pane {
    flex: 1;
    min-width: 0;
    background: var(--stage-glow);
    position: relative;
    padding-left: 16px;
    box-sizing: border-box;
  }
  #artifact-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    /* The artifact document is arbitrary, uncontrolled HTML — many pages
       have no explicit background at all, which defaults to transparent,
       not white. Force the iframe element itself opaque so the pane's own
       (now dark-mode-aware) background never shows through unstyled
       artifact content, regardless of what that content does or doesn't set. */
    background: #fff;
  }
  #rail-grip {
    width: 6px;
    flex: 0 0 6px;
    cursor: col-resize;
    background: var(--chrome-border);
  }
  #comment-rail {
    flex: 0 0 auto;
    width: 280px;
    background: var(--chrome-bg);
    backdrop-filter: blur(12px);
    border-left: 1px solid var(--chrome-border);
    position: relative;
    overflow: hidden;
  }
  #comment-rail.collapsed {
    border-left-color: transparent;
  }
  #rail-scroll {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 48px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 40px 12px 12px;
    box-sizing: border-box;
  }
  #rail-collapse {
    position: absolute;
    top: 8px;
    left: 6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--chrome-bg-solid);
    color: var(--chrome-fg);
    border: 1px solid var(--chrome-border);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    z-index: 950;
  }
  #rail-collapse-all {
    position: absolute;
    top: 8px;
    right: 6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--chrome-bg-solid);
    color: var(--chrome-fg);
    border: 1px solid var(--chrome-border);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    z-index: 950;
  }
  #rail-footer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 56px;
    box-sizing: border-box;
    padding: 8px 14px;
    background: var(--chrome-bg-solid);
    border-top: 1px solid var(--chrome-border);
    display: flex;
    align-items: center;
  }
  #rail-footer #send-all {
    width: 100%;
  }
  #reply-spinner {
    display: none;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    margin-right: 8px;
    border: 2px solid var(--chrome-border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: reply-spinner-spin 0.8s linear infinite;
  }
  #reply-spinner.visible {
    display: block;
  }
  @keyframes reply-spinner-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .bubble-thread {
    max-height: 300px;
    overflow-y: auto;
  }
  #confirm-modal-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2000;
    align-items: center;
    justify-content: center;
  }
  #confirm-modal-backdrop.visible {
    display: flex;
  }
  #confirm-modal {
    background: var(--modal-bg);
    border: 1px solid var(--chrome-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    padding: 20px 22px;
    width: 320px;
    font-family: -apple-system, "Segoe UI", sans-serif;
    color: var(--modal-fg);
  }
  #confirm-modal p {
    margin: 0 0 18px;
    font-size: 13.5px;
    line-height: 1.5;
  }
  #confirm-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  #confirm-modal-actions button {
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  #confirm-modal-cancel {
    background: var(--modal-cancel-bg);
    color: var(--modal-cancel-fg);
  }
  #confirm-modal-ok {
    background: var(--accent);
    color: var(--accent-ink);
  }
</style>
</head>
<body>
  <div id="toolbar">
    <span id="wordmark">ezreview</span>
    <div id="file-status">
      <span id="status-dot"></span>
      <span id="file-name">Agent connected</span>
      <span id="status-text"></span>
    </div>
    <div id="spacer"></div>
    <div id="review-toggle">
      <span>REVIEW MODE</span>
      <span class="switch" id="review-switch" data-on="true"><span class="switch-knob"></span></span>
    </div>
    <span id="scroll-hint">Scroll while hovering to widen the selection</span>
    <div id="spacer-2"></div>
    <button id="theme-toggle" title="Toggle light/dark theme">☀︎</button>
    <button id="confirm-document">Approve</button>
  </div>
  <div id="stage">
    <div id="artifact-pane">
      <iframe id="artifact-frame" src="/artifact"></iframe>
    </div>
    <div id="rail-grip"></div>
    <div id="comment-rail">
      <button id="rail-collapse" title="Collapse comments">‹</button>
      <button id="rail-collapse-all" title="Collapse/expand all comments">≡</button>
      <div id="rail-scroll"></div>
      <div id="rail-footer">
        <span id="reply-spinner" title="Waiting for the agent to reply"></span>
        <button id="send-all">Submit review (0)</button>
      </div>
    </div>
  </div>
  <div id="confirm-modal-backdrop">
    <div id="confirm-modal">
      <p>Confirm this document is done? All feedback history will be deleted.</p>
      <div id="confirm-modal-actions">
        <button id="confirm-modal-cancel">Cancel</button>
        <button id="confirm-modal-ok">OK</button>
      </div>
    </div>
  </div>
  <script>${renderClientScript()}</script>
</body>
</html>
`;
}
