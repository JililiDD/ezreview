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
    // Note: an id-bearing element does NOT short-circuit here — buildPathWithinRoot
    // already returns "#id" as its first candidate, but only checking el.id up
    // front (before the shadow-root check below) would wrongly report
    // shadowHost: null for an id-bearing element that's actually inside a
    // shadow root, making it unresolvable via plain document.querySelector.
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

  // ---- Bubble queue (draft -> queue -> delete; Send all is a placeholder) ----

  var sendAllButton = document.getElementById("send-all");
  var queue = [];
  var draftBubble = null;
  var nextQueueId = 1;

  function updateSendAllLabel() {
    sendAllButton.textContent = "Send all (" + queue.length + ")";
  }

  function targetAnchorY(target) {
    var rect = target.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    return frameRect.top + rect.top;
  }

  function layoutBubbles() {
    var all = queue.map(function (q) {
      return { node: q.node, anchorY: q.anchorY };
    });
    if (draftBubble) {
      all.push({ node: draftBubble.node, anchorY: draftBubble.anchorY });
    }
    all.sort(function (a, b) {
      return a.anchorY - b.anchorY;
    });
    var cursor = 48;
    for (var i = 0; i < all.length; i++) {
      var top = Math.max(all[i].anchorY, cursor);
      all[i].node.style.top = top + "px";
      cursor = top + all[i].node.offsetHeight + 8;
    }
  }

  function resolveAnnotationElement(item) {
    var doc = getIframeDoc();
    if (!doc) return null;
    try {
      if (item.shadowHost) {
        var host = doc.querySelector(item.shadowHost);
        if (!host || !host.shadowRoot) return null;
        return host.shadowRoot.querySelector(item.selector);
      }
      return doc.querySelector(item.selector);
    } catch (e) {
      return null;
    }
  }

  function setAnchorLost(node, lost) {
    var badge = node.querySelector(".anchor-lost-badge");
    if (lost) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "anchor-lost-badge";
        badge.textContent = "⚠ Anchor lost";
        badge.style.display = "inline-block";
        badge.style.marginTop = "4px";
        badge.style.padding = "1px 6px";
        badge.style.borderRadius = "4px";
        badge.style.fontSize = "11px";
        badge.style.color = "var(--stale-amber-fg)";
        badge.style.background = "var(--stale-amber-bg)";
        node.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  function createBubbleShell() {
    var node = document.createElement("div");
    node.className = "bubble";
    node.style.position = "fixed";
    node.style.right = "12px";
    node.style.width = "250px";
    node.style.background = "#fff";
    node.style.border = "1px solid #e3e5e9";
    node.style.borderRadius = "8px";
    node.style.padding = "10px 12px";
    node.style.boxShadow = "0 1px 4px rgba(20,24,33,.08)";
    node.style.pointerEvents = "auto";
    node.style.fontSize = "13px";
    node.style.boxSizing = "border-box";
    node.style.zIndex = "900";
    document.body.appendChild(node);
    return node;
  }

  function closeDraftBubble() {
    if (!draftBubble) return;
    draftBubble.node.remove();
    draftBubble = null;
    layoutBubbles();
  }

  function addDraftToQueue() {
    if (!draftBubble) return;
    var comment = draftBubble.textarea.value;
    var node = draftBubble.node;
    node.textContent = "";
    node.className = "bubble";
    var text = document.createElement("div");
    text.className = "bubble-comment";
    text.textContent = comment;
    var deleteBtn = document.createElement("button");
    deleteBtn.className = "bubble-delete";
    deleteBtn.textContent = "Delete";
    node.appendChild(text);
    node.appendChild(deleteBtn);

    var id = "a-" + nextQueueId++;
    var item = {
      id: id,
      node: node,
      anchorY: draftBubble.anchorY,
      selector: draftBubble.selResult.selector,
      shadowHost: draftBubble.selResult.shadowHost,
      comment: comment,
      target: draftBubble.target,
    };
    queue.push(item);
    node.setAttribute("data-annotation-id", id);

    deleteBtn.addEventListener("click", function () {
      removeFromQueue(id);
    });

    node.addEventListener("mouseenter", function () {
      // Defensive: if the iframe's own scroll-triggered highlight refresh
      // still holds a stale currentHoverTarget when scrollIntoView below
      // causes a real scroll, don't let it clobber this highlight.
      currentHoverTarget = null;
      var el = resolveAnnotationElement(item);
      if (el) {
        setAnchorLost(node, false);
        positionHighlight(el);
        if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
      } else {
        setAnchorLost(node, true);
        hideHighlight();
      }
    });
    node.addEventListener("mouseleave", function () {
      hideHighlight();
    });

    draftBubble = null;
    updateSendAllLabel();
    layoutBubbles();
  }

  function removeFromQueue(id) {
    var idx = -1;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;
    queue[idx].node.remove();
    queue.splice(idx, 1);
    updateSendAllLabel();
    layoutBubbles();
  }

  function openDraftBubble(target) {
    if (draftBubble) closeDraftBubble();

    var selResult = generateSelector(target);
    var node = createBubbleShell();
    node.className = "bubble bubble-draft";

    var textarea = document.createElement("textarea");
    textarea.style.width = "100%";
    textarea.style.boxSizing = "border-box";
    textarea.rows = 3;

    var addBtn = document.createElement("button");
    addBtn.className = "bubble-add";
    addBtn.textContent = "Add to queue";
    var cancelBtn = document.createElement("button");
    cancelBtn.className = "bubble-cancel";
    cancelBtn.textContent = "Cancel";

    node.appendChild(textarea);
    node.appendChild(addBtn);
    node.appendChild(cancelBtn);

    draftBubble = {
      node: node,
      anchorY: targetAnchorY(target),
      target: target,
      selResult: selResult,
      textarea: textarea,
    };

    addBtn.addEventListener("click", addDraftToQueue);
    cancelBtn.addEventListener("click", closeDraftBubble);

    layoutBubbles();
  }

  sendAllButton.addEventListener("click", function () {
    // Placeholder for this phase: no network request, no state change.
    // Real submission wiring lands in Phase 5.
  });

  function onIframeClick(e) {
    if (!reviewOn) return;
    var doc = getIframeDoc();
    var sel = doc && doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.toString().length > 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    openDraftBubble(e.target);
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
