import { renderClientScript } from "./shell-client.js";

export function renderShellPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ai-review-board</title>
<style>
  :root {
    --chrome-bg: #17181c;
    --chrome-border: #2a2c33;
    --chrome-fg: #b8bcc4;
    --chrome-dim: #6f7480;
    --accent: #4f8ef7;
    --accent-soft: rgba(79, 142, 247, 0.12);
    --stage-bg: #f6f7f9;
    --ok-green: #3ecf7a;
    --disconnect-red: #e05a4f;
    --stale-amber-fg: #9a6b1f;
    --stale-amber-bg: #faf0dc;
  }
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    font-family: system-ui, "Segoe UI", sans-serif;
    font-size: 12.5px;
  }
  body {
    display: flex;
    flex-direction: column;
  }
  #toolbar {
    height: 40px;
    flex: 0 0 40px;
    background: var(--chrome-bg);
    border-bottom: 1px solid var(--chrome-border);
    color: var(--chrome-fg);
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 16px;
    box-sizing: border-box;
  }
  #file-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: ui-monospace, Consolas, monospace;
  }
  #status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok-green);
    display: inline-block;
  }
  #status-dot.disconnected {
    background: var(--disconnect-red);
  }
  #file-name {
    color: var(--chrome-fg);
  }
  #status-text {
    color: var(--disconnect-red);
    margin-left: 4px;
  }
  #spacer {
    flex: 1;
  }
  #review-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--chrome-dim);
  }
  .switch {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    background: var(--accent);
    position: relative;
    cursor: pointer;
  }
  .switch[data-on="false"] {
    background: var(--chrome-border);
  }
  .switch-knob {
    position: absolute;
    top: 2px;
    left: 16px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.15s ease;
  }
  .switch[data-on="false"] .switch-knob {
    left: 2px;
  }
  #scroll-hint {
    color: var(--chrome-dim);
    font-size: 11.5px;
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
  #confirm-document {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12.5px;
    cursor: pointer;
  }
  #send-all {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12.5px;
    cursor: pointer;
  }
  #stage {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  #artifact-pane {
    flex: 1;
    min-width: 0;
    background: var(--stage-bg);
    position: relative;
  }
  #artifact-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
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
    background: #fff;
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
    background: var(--chrome-bg);
    color: #fff;
    border: 1px solid var(--chrome-border);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    z-index: 950;
  }
  #rail-footer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 48px;
    box-sizing: border-box;
    padding: 8px 12px;
    background: #fff;
    border-top: 1px solid #e3e5e9;
    display: flex;
    align-items: center;
  }
  #rail-footer #send-all {
    width: 100%;
  }
  .bubble-thread {
    max-height: 300px;
    overflow-y: auto;
  }
</style>
</head>
<body>
  <div id="toolbar">
    <div id="file-status">
      <span id="status-dot"></span>
      <span id="file-name">artifact</span>
      <span id="status-text"></span>
    </div>
    <div id="spacer"></div>
    <div id="review-toggle">
      <span>Review</span>
      <span class="switch" id="review-switch" data-on="true"><span class="switch-knob"></span></span>
    </div>
    <span id="scroll-hint">Scroll while hovering to widen the selection</span>
    <div id="spacer-2"></div>
    <button id="confirm-document">Confirm document</button>
  </div>
  <div id="stage">
    <div id="artifact-pane">
      <iframe id="artifact-frame" src="/artifact"></iframe>
    </div>
    <div id="rail-grip"></div>
    <div id="comment-rail">
      <button id="rail-collapse" title="Collapse comments">‹</button>
      <div id="rail-scroll"></div>
      <div id="rail-footer">
        <button id="send-all">Send all (0)</button>
      </div>
    </div>
  </div>
  <script>${renderClientScript()}</script>
</body>
</html>
`;
}
