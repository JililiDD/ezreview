export function renderClientScript(): string {
  return `
(function () {
  var dot = document.getElementById("status-dot");
  var statusText = document.getElementById("status-text");
  var frame = document.getElementById("artifact-frame");
  var reviewSwitch = document.getElementById("review-switch");

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
    currentHoverTarget = null;
    hideHighlight();
    frame.src = "/artifact?t=" + Date.now();
  });

  // ---- Selector generator (self-authored, D-001) ----

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function buildSegment(node) {
    var tag = node.tagName.toLowerCase();
    var parent = node.parentElement;
    if (!parent) return tag;
    var siblings = [];
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === node.tagName) siblings.push(parent.children[i]);
    }
    var index = siblings.indexOf(node) + 1;
    return tag + ":nth-of-type(" + index + ")";
  }

  function buildPathWithinRoot(el, root) {
    var segments = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.id) {
        segments.unshift("#" + cssEscape(node.id));
        break;
      }
      segments.unshift(buildSegment(node));
      if (node === root) break;
      node = node.parentElement;
      if (!node) break;
    }
    for (var i = segments.length - 1; i >= 0; i--) {
      var candidate = segments.slice(i).join(" > ");
      var matches = root.querySelectorAll(candidate);
      if (matches.length === 1 && matches[0] === el) {
        return candidate;
      }
    }
    return segments.join(" > ");
  }

  function generateSelector(el) {
    if (el.id) {
      return { selector: "#" + cssEscape(el.id), shadowHost: null };
    }
    var rootNode = el.getRootNode();
    // duck-typed, not "instanceof ShadowRoot": rootNode may come from the
    // iframe's own realm, whose ShadowRoot constructor differs from this
    // window's, so a cross-realm instanceof check silently fails here.
    var isShadow = rootNode.nodeType === 11 && !!rootNode.host;
    if (!isShadow) {
      return { selector: buildPathWithinRoot(el, document), shadowHost: null };
    }
    var hostResult = generateSelector(rootNode.host);
    return {
      selector: buildPathWithinRoot(el, rootNode),
      shadowHost: hostResult.selector,
    };
  }

  window.__generateSelector = generateSelector;

  // ---- Review overlay: hover highlight ----

  var reviewOn = reviewSwitch.getAttribute("data-on") === "true";
  var currentHoverTarget = null;
  var highlightBox = document.createElement("div");
  highlightBox.id = "element-highlight";
  highlightBox.style.position = "fixed";
  highlightBox.style.border = "2px solid var(--accent)";
  highlightBox.style.background = "var(--accent-soft)";
  highlightBox.style.pointerEvents = "none";
  highlightBox.style.zIndex = "1000";
  highlightBox.style.display = "none";
  highlightBox.style.boxSizing = "border-box";
  document.body.appendChild(highlightBox);

  var selectorLabel = document.createElement("div");
  selectorLabel.id = "selector-label";
  selectorLabel.style.position = "fixed";
  selectorLabel.style.background = "var(--chrome-bg)";
  selectorLabel.style.color = "var(--chrome-fg)";
  selectorLabel.style.font = "11px ui-monospace, Consolas, monospace";
  selectorLabel.style.padding = "2px 6px";
  selectorLabel.style.borderRadius = "4px";
  selectorLabel.style.pointerEvents = "none";
  selectorLabel.style.zIndex = "1001";
  selectorLabel.style.display = "none";
  document.body.appendChild(selectorLabel);

  function getIframeDoc() {
    try {
      return frame.contentDocument;
    } catch (e) {
      return null;
    }
  }

  function positionHighlight(target) {
    if (!target || target === getIframeDoc()) {
      hideHighlight();
      return;
    }
    var rect = target.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    var left = frameRect.left + rect.left;
    var top = frameRect.top + rect.top;
    highlightBox.style.left = left + "px";
    highlightBox.style.top = top + "px";
    highlightBox.style.width = rect.width + "px";
    highlightBox.style.height = rect.height + "px";
    highlightBox.style.display = "block";

    var result = generateSelector(target);
    selectorLabel.textContent = result.shadowHost
      ? result.shadowHost + " ⇒ " + result.selector
      : result.selector;
    selectorLabel.style.left = left + "px";
    selectorLabel.style.top = Math.max(0, top - 20) + "px";
    selectorLabel.style.display = "block";
  }

  function hideHighlight() {
    highlightBox.style.display = "none";
    selectorLabel.style.display = "none";
  }

  function refreshHighlightPosition() {
    if (reviewOn && currentHoverTarget) {
      positionHighlight(currentHoverTarget);
    }
  }

  var mouseMoveFramePending = false;

  function onIframeMouseMove(e) {
    if (!reviewOn) return;
    currentHoverTarget = e.target;
    if (mouseMoveFramePending) return;
    mouseMoveFramePending = true;
    window.requestAnimationFrame(function () {
      mouseMoveFramePending = false;
      if (reviewOn) positionHighlight(currentHoverTarget);
    });
  }

  function onIframeMouseLeave() {
    currentHoverTarget = null;
    hideHighlight();
  }

  function onIframeClick(e) {
    if (!reviewOn) return;
    var doc = getIframeDoc();
    var sel = doc && doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.toString().length > 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function attachOverlayListeners() {
    var doc = getIframeDoc();
    if (!doc) return;
    doc.addEventListener("mousemove", onIframeMouseMove);
    doc.addEventListener("mouseleave", onIframeMouseLeave);
    doc.addEventListener("click", onIframeClick, true);
    doc.addEventListener("scroll", refreshHighlightPosition, true);
  }

  function detachOverlayListeners() {
    var doc = getIframeDoc();
    if (doc) {
      doc.removeEventListener("mousemove", onIframeMouseMove);
      doc.removeEventListener("mouseleave", onIframeMouseLeave);
      doc.removeEventListener("click", onIframeClick, true);
      doc.removeEventListener("scroll", refreshHighlightPosition, true);
    }
    currentHoverTarget = null;
    hideHighlight();
  }

  frame.addEventListener("load", function () {
    if (reviewOn) attachOverlayListeners();
  });
  if (reviewOn) attachOverlayListeners();

  reviewSwitch.addEventListener("click", function () {
    reviewOn = !reviewOn;
    reviewSwitch.setAttribute("data-on", reviewOn ? "true" : "false");
    if (reviewOn) {
      attachOverlayListeners();
    } else {
      detachOverlayListeners();
    }
  });

  window.addEventListener("resize", refreshHighlightPosition);
})();
`;
}
