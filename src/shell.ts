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
    --stage-bg: #f6f7f9;
    --ok-green: #3ecf7a;
    --disconnect-red: #e05a4f;
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
    background: var(--stage-bg);
    position: relative;
  }
  #artifact-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
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
    <button id="send-all">Send all (0)</button>
  </div>
  <div id="stage">
    <iframe id="artifact-frame" src="/artifact"></iframe>
  </div>
  <script>
    (function () {
      var dot = document.getElementById("status-dot");
      var statusText = document.getElementById("status-text");
      var frame = document.getElementById("artifact-frame");

      function setConnected() {
        dot.classList.remove("disconnected");
        statusText.textContent = "";
      }

      function setDisconnected() {
        dot.classList.add("disconnected");
        statusText.textContent = "Disconnected · retrying…";
      }

      var source = new EventSource("/events");
      source.onopen = setConnected;
      source.onerror = setDisconnected;
      source.addEventListener("reload", function () {
        frame.src = "/artifact?t=" + Date.now();
      });
    })();
  </script>
</body>
</html>
`;
}
