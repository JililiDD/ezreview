export function renderClientScript(): string {
  return `
(function () {
  var dot = document.getElementById("status-dot");
  var statusText = document.getElementById("status-text");
  var frame = document.getElementById("artifact-frame");
  var reviewSwitch = document.getElementById("review-switch");
  var commentRail = document.getElementById("comment-rail");
  var railGrip = document.getElementById("rail-grip");
  var railCollapseBtn = document.getElementById("rail-collapse");

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
    markTextAnnotationsLost();
    moveSentItemsIntoHistory();
    if (pendingSelectionRange || draftBubble) {
      hideAddCommentButton();
      closeDraftBubble();
      statusText.textContent = "Selection cleared — please reselect";
      window.setTimeout(function () {
        if (dot.classList.contains("disconnected")) return;
        statusText.textContent = "";
      }, 3000);
    }
    frame.src = "/artifact?t=" + Date.now();
  });

  source.addEventListener("reply", function (e) {
    var data = JSON.parse(e.data);
    var node = findAnnotationNodeById(data.id);
    if (!node || node.querySelector(".answer-block")) return;
    renderAnswer(node, data.text);
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
  }

  function hideHighlight() {
    highlightBox.style.display = "none";
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

  // ---- Text-selection annotation (always active, independent of Review toggle) ----

  function getIframeWindow() {
    try {
      return frame.contentWindow;
    } catch (e) {
      return null;
    }
  }

  var HIGHLIGHT_NAME = "ai-review-text";
  var HIGHLIGHT_HOVER_NAME = "ai-review-text-hover";
  var textHighlightSet = null;
  var textHighlightHoverSet = null;

  function setupTextHighlightRegistry() {
    var win = getIframeWindow();
    var doc = getIframeDoc();
    if (!win || !doc || !win.Highlight || !win.CSS || !win.CSS.highlights) return;

    var style = doc.createElement("style");
    style.textContent =
      "::highlight(" + HIGHLIGHT_NAME + ") { background-color: rgba(255,204,0,.35); }" +
      "::highlight(" + HIGHLIGHT_HOVER_NAME + ") { background-color: rgba(255,204,0,.6); }";
    doc.head.appendChild(style);

    textHighlightSet = new win.Highlight();
    textHighlightHoverSet = new win.Highlight();
    win.CSS.highlights.set(HIGHLIGHT_NAME, textHighlightSet);
    win.CSS.highlights.set(HIGHLIGHT_HOVER_NAME, textHighlightHoverSet);
  }

  var addCommentButton = document.createElement("button");
  addCommentButton.id = "add-comment-button";
  addCommentButton.textContent = "+ Add comment";
  addCommentButton.style.position = "fixed";
  addCommentButton.style.background = "var(--chrome-bg)";
  addCommentButton.style.color = "#fff";
  addCommentButton.style.border = "none";
  addCommentButton.style.borderRadius = "6px";
  addCommentButton.style.padding = "6px 10px";
  addCommentButton.style.fontSize = "12.5px";
  addCommentButton.style.cursor = "pointer";
  addCommentButton.style.zIndex = "1002";
  addCommentButton.style.display = "none";
  document.body.appendChild(addCommentButton);

  var pendingSelectionRange = null;

  function hideAddCommentButton() {
    addCommentButton.style.display = "none";
    pendingSelectionRange = null;
  }

  function showAddCommentButton(range) {
    var rect = range.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    addCommentButton.style.left = frameRect.left + rect.right - 120 + "px";
    addCommentButton.style.top = frameRect.top + rect.top - 28 + "px";
    addCommentButton.style.display = "block";
    pendingSelectionRange = range;
  }

  function onIframeMouseUp() {
    var doc = getIframeDoc();
    var sel = doc && doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.toString().length > 0 && sel.rangeCount > 0) {
      showAddCommentButton(sel.getRangeAt(0).cloneRange());
    } else {
      hideAddCommentButton();
    }
  }

  addCommentButton.addEventListener("click", function () {
    if (pendingSelectionRange) openTextDraftBubble(pendingSelectionRange);
    hideAddCommentButton();
  });

  function attachSelectionListeners() {
    var doc = getIframeDoc();
    if (!doc) return;
    doc.addEventListener("mouseup", onIframeMouseUp);
    setupTextHighlightRegistry();
  }

  // ---- Comment rail: resize + collapse ----
  // Bubbles stay position: fixed (as before the rail existed) rather than
  // becoming DOM children of #comment-rail — #comment-rail is just the
  // visual background column that reserves layout space so the iframe pane
  // shrinks to make room. Bubble horizontal placement (left/width) is
  // derived from the rail's live boundingClientRect on every layoutBubbles()
  // call, so it tracks resize/collapse without a separate sync path.

  var RAIL_MIN_WIDTH = 180;
  var RAIL_MAX_WIDTH = 480;
  var RAIL_COLLAPSED_WIDTH = 28;
  var railWidth = 280;
  var railCollapsed = false;

  function allBubbleNodes() {
    var nodes = queue.concat(sentItems).concat(historyItems).map(function (q) {
      return q.node;
    });
    if (draftBubble) nodes.push(draftBubble.node);
    return nodes;
  }

  function applyRailWidth() {
    commentRail.style.width = (railCollapsed ? RAIL_COLLAPSED_WIDTH : railWidth) + "px";
    commentRail.classList.toggle("collapsed", railCollapsed);
    railCollapseBtn.textContent = railCollapsed ? "›" : "‹";
    var nodes = allBubbleNodes();
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.display = railCollapsed ? "none" : "";
    }
    renderHistoryGroup();
    layoutBubbles();
  }

  railCollapseBtn.addEventListener("click", function () {
    railCollapsed = !railCollapsed;
    applyRailWidth();
  });

  var railResizing = false;

  // Pointer capture (not a plain document mousemove listener) — dragging the
  // grip toward the iframe pane moves the real cursor over the iframe's own
  // document, which dispatches its own events and never bubbles them to the
  // shell page's top-level document. setPointerCapture routes every
  // subsequent pointer event to the grip itself regardless of what's
  // visually underneath, so the drag keeps working across that boundary.
  railGrip.addEventListener("pointerdown", function (e) {
    if (railCollapsed) return;
    railResizing = true;
    railGrip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  railGrip.addEventListener("pointermove", function (e) {
    if (!railResizing) return;
    var newWidth = window.innerWidth - e.clientX;
    railWidth = Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, newWidth));
    applyRailWidth();
  });
  railGrip.addEventListener("pointerup", function (e) {
    railResizing = false;
    railGrip.releasePointerCapture(e.pointerId);
  });

  window.addEventListener("resize", layoutBubbles);

  // ---- Bubble queue (draft -> queue -> delete; Send all is a placeholder) ----

  var sendAllButton = document.getElementById("send-all");
  var queue = [];
  window.__annotationQueue = queue;
  var draftBubble = null;
  var nextQueueId = 1;
  var sentItems = [];
  window.__sentAnnotations = sentItems;
  var historyItems = [];
  var historyExpanded = false;

  var historyContainer = document.createElement("div");
  historyContainer.id = "history-group";
  historyContainer.style.position = "fixed";
  historyContainer.style.top = "48px";
  historyContainer.style.display = "none";
  historyContainer.style.zIndex = "890";
  document.body.appendChild(historyContainer);

  var historyHeader = document.createElement("div");
  historyHeader.id = "history-header";
  historyHeader.style.background = "#fff";
  historyHeader.style.border = "1px solid #e3e5e9";
  historyHeader.style.borderRadius = "8px";
  historyHeader.style.padding = "8px 12px";
  historyHeader.style.cursor = "pointer";
  historyHeader.style.fontSize = "13px";
  historyHeader.style.boxSizing = "border-box";
  historyContainer.appendChild(historyHeader);

  var historyList = document.createElement("div");
  historyList.id = "history-list";
  historyList.style.marginTop = "8px";
  historyContainer.appendChild(historyList);

  function renderHistoryGroup() {
    historyHeader.textContent = "Processed (" + historyItems.length + ")";
    historyContainer.style.display = !railCollapsed && historyItems.length > 0 ? "block" : "none";
    historyList.style.display = historyExpanded ? "block" : "none";
  }

  historyHeader.addEventListener("click", function () {
    historyExpanded = !historyExpanded;
    renderHistoryGroup();
  });

  function moveSentItemsIntoHistory() {
    if (sentItems.length === 0) return;
    for (var i = 0; i < sentItems.length; i++) {
      var item = sentItems[i];
      item.node.style.position = "static";
      item.node.style.top = "auto";
      item.node.style.left = "auto";
      item.node.style.width = "auto";
      item.node.style.marginBottom = "8px";
      historyList.appendChild(item.node);
      historyItems.push(item);
    }
    sentItems.length = 0;
    renderHistoryGroup();
    layoutBubbles();
  }

  function updateSendAllLabel() {
    sendAllButton.textContent = "Send all (" + queue.length + ")";
  }

  function targetAnchorY(target) {
    var rect = target.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    return frameRect.top + rect.top;
  }

  function layoutBubbles() {
    // Horizontal placement is derived from the rail's live boundingClientRect
    // on every call (not cached at creation time) so it stays correct across
    // resize/collapse without a separate sync path — layoutBubbles() already
    // runs after every mutation that could need repositioning.
    var railRect = commentRail.getBoundingClientRect();
    var bubbleLeft = railRect.left + 12;
    var bubbleWidth = Math.max(0, railRect.width - 24);

    historyContainer.style.left = bubbleLeft + "px";
    historyContainer.style.width = bubbleWidth + "px";

    // sentItems participate too (same fixed-position stacking as queue) —
    // only historyItems are excluded, since those already moved into the
    // separate, non-fixed history container on the last reload.
    var all = queue.concat(sentItems).map(function (q) {
      return { node: q.node, anchorY: q.anchorY };
    });
    if (draftBubble) {
      all.push({ node: draftBubble.node, anchorY: draftBubble.anchorY });
    }
    all.sort(function (a, b) {
      return a.anchorY - b.anchorY;
    });
    var historyHeight = historyItems.length > 0 ? historyContainer.offsetHeight + 8 : 0;
    var cursor = 48 + historyHeight;
    for (var i = 0; i < all.length; i++) {
      all[i].node.style.left = bubbleLeft + "px";
      all[i].node.style.width = bubbleWidth + "px";
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

  function findAnnotationNodeById(id) {
    var lists = [sentItems, historyItems, queue];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        if (lists[i][j].id === id) return lists[i][j].node;
      }
    }
    return null;
  }

  function renderAnswer(node, text) {
    var answerBlock = document.createElement("div");
    answerBlock.className = "answer-block";
    answerBlock.style.marginTop = "6px";
    answerBlock.style.paddingLeft = "8px";
    answerBlock.style.borderLeft = "3px solid var(--accent)";
    answerBlock.style.background = "#f4f8fe";

    var agentLabel = document.createElement("div");
    agentLabel.className = "agent-label";
    agentLabel.textContent = "AGENT";
    agentLabel.style.fontSize = "10px";
    agentLabel.style.fontWeight = "bold";
    agentLabel.style.color = "var(--accent)";
    answerBlock.appendChild(agentLabel);

    var answerText = document.createElement("div");
    answerText.className = "answer-text";
    answerText.textContent = text;
    answerBlock.appendChild(answerText);

    node.appendChild(answerBlock);

    var answeredBadge = document.createElement("span");
    answeredBadge.className = "answered-badge";
    answeredBadge.textContent = "✓ Answered";
    answeredBadge.style.display = "inline-block";
    answeredBadge.style.marginTop = "4px";
    answeredBadge.style.padding = "1px 6px";
    answeredBadge.style.borderRadius = "4px";
    answeredBadge.style.fontSize = "11px";
    answeredBadge.style.color = "#1d7a45";
    answeredBadge.style.background = "#e2f5ea";
    node.appendChild(answeredBadge);
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
    // left/width set by layoutBubbles(), called right after this returns.
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
    if (draftBubble.type === "text-annotation" && textHighlightSet) {
      textHighlightSet.delete(draftBubble.range);
    }
    draftBubble.node.remove();
    draftBubble = null;
    layoutBubbles();
  }

  function markTextAnnotationsLost() {
    // sentItems too, not just queue: a text annotation's Range is bound to
    // the pre-reload iframe document, so it goes stale the moment this
    // reload's frame.src reassignment replaces that document — regardless
    // of whether the annotation is still queued or has already been sent.
    // historyItems don't need their own pass here: an item only reaches
    // historyItems via moveSentItemsIntoHistory, which this same reload
    // handler runs right after this function — so by the time an item
    // enters historyItems, it has already been marked lost while still in
    // sentItems on that same reload.
    var lists = [queue, sentItems];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        if (lists[l][i].type === "text-annotation") {
          lists[l][i].lost = true;
        }
      }
    }
  }

  // ---- Text annotation re-anchoring after a reload ----
  //
  // A lost text annotation's original selectedText may simply have moved
  // (an unrelated edit shifted it) or may have been replaced outright by
  // the very edit the annotation asked for — in the latter case the
  // annotation should stay lost, since the text it was about is gone.
  // Both cases are told apart by anchoring on context.before/context.after
  // alone (never on the old selectedText): if the same landmarks on both
  // sides of the original selection can be found again, uniquely, with a
  // plausibly small gap between them, whatever now sits in that gap — same
  // text or edited text — is treated as this annotation's current location.

  var REANCHOR_MAX_GAP = 500;

  function buildTextIndex(root) {
    var doc = root.ownerDocument;
    var walker = doc.createTreeWalker(root, 4, null); // 4 = NodeFilter.SHOW_TEXT
    var nodes = [];
    var text = "";
    var node;
    while ((node = walker.nextNode())) {
      var start = text.length;
      text += node.nodeValue;
      nodes.push({ node: node, start: start, end: text.length });
    }
    return { text: text, nodes: nodes };
  }

  function pointAtOffset(index, offset) {
    for (var i = 0; i < index.nodes.length; i++) {
      var n = index.nodes[i];
      if (offset >= n.start && offset <= n.end) {
        return { node: n.node, offset: offset - n.start };
      }
    }
    return null;
  }

  // -1 for "not found" AND for "found more than once" — an ambiguous
  // landmark is as unusable as a missing one; the caller can't tell them
  // apart and shouldn't try to.
  function findUniqueOccurrence(haystack, needle) {
    var first = haystack.indexOf(needle);
    if (first === -1) return -1;
    if (haystack.indexOf(needle, first + 1) !== -1) return -1;
    return first;
  }

  function resolveTextAnnotationScope(item) {
    // Deliberately NOT item.nearestSelector: getTextContext climbs ancestors
    // independently (until it finds ~200 chars of surrounding text, capped
    // at <html>) to build context.before/after, so the captured context can
    // reach well outside nearestSelector's element for a short paragraph.
    // The search scope has to match that same real ceiling — the shadow
    // root boundary for shadow content (climbing can't escape it either,
    // since a shadow root has no parentElement), <html> otherwise.
    var doc = getIframeDoc();
    if (!doc) return null;
    if (item.shadowHost) {
      try {
        var host = doc.querySelector(item.shadowHost);
        if (host && host.shadowRoot) return host.shadowRoot;
      } catch (e) {
        // fall through to the top-level document
      }
    }
    return doc.documentElement || doc.body;
  }

  function tryReanchorTextAnnotation(item) {
    var scopeRoot = resolveTextAnnotationScope(item);
    if (!scopeRoot) return null;
    var index = buildTextIndex(scopeRoot);
    var text = index.text;
    var before = (item.context && item.context.before) || "";
    var after = (item.context && item.context.after) || "";

    var beforeEnd;
    if (before === "") {
      beforeEnd = 0;
    } else {
      var beforeStart = findUniqueOccurrence(text, before);
      if (beforeStart === -1) return null;
      beforeEnd = beforeStart + before.length;
    }

    var afterStart;
    if (after === "") {
      afterStart = text.length;
    } else {
      afterStart = findUniqueOccurrence(text, after);
      if (afterStart === -1) return null;
    }

    if (afterStart < beforeEnd || afterStart - beforeEnd > REANCHOR_MAX_GAP) return null;

    var startPoint = pointAtOffset(index, beforeEnd);
    var endPoint = pointAtOffset(index, afterStart);
    if (!startPoint || !endPoint) return null;

    var range = scopeRoot.ownerDocument.createRange();
    try {
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
    } catch (e) {
      return null;
    }
    return range;
  }

  function reanchorLostTextAnnotations() {
    // historyItems included here (unlike markTextAnnotationsLost above):
    // by the time this runs — after the new document has finished loading —
    // this reload's moveSentItemsIntoHistory call has already moved items
    // that were in sentItems a moment ago into historyItems.
    var lists = [queue, sentItems, historyItems];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        var item = lists[l][i];
        if (item.type !== "text-annotation" || !item.lost) continue;
        var newRange = tryReanchorTextAnnotation(item);
        if (newRange) {
          item.range = newRange;
          item.lost = false;
          setAnchorLost(item.node, false);
          if (textHighlightSet) textHighlightSet.add(newRange);
        }
      }
    }
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
    var item;
    if (draftBubble.type === "text-annotation") {
      item = {
        id: id,
        node: node,
        anchorY: draftBubble.anchorY,
        type: "text-annotation",
        selectedText: draftBubble.selectedText,
        context: draftBubble.context,
        nearestSelector: draftBubble.nearestSelectorResult.selector,
        shadowHost: draftBubble.nearestSelectorResult.shadowHost,
        comment: comment,
        range: draftBubble.range,
        lost: false,
      };
    } else {
      item = {
        id: id,
        node: node,
        anchorY: draftBubble.anchorY,
        type: "element-annotation",
        selector: draftBubble.selResult.selector,
        shadowHost: draftBubble.selResult.shadowHost,
        comment: comment,
        target: draftBubble.target,
      };
    }
    queue.push(item);
    node.setAttribute("data-annotation-id", id);

    deleteBtn.addEventListener("click", function () {
      if (item.type === "text-annotation" && textHighlightSet) {
        textHighlightSet.delete(item.range);
        textHighlightHoverSet.delete(item.range);
      }
      removeFromQueue(id);
    });

    if (item.type === "text-annotation") {
      node.addEventListener("mouseenter", function () {
        if (item.lost) {
          setAnchorLost(node, true);
          return;
        }
        setAnchorLost(node, false);
        if (textHighlightSet && textHighlightHoverSet) {
          textHighlightSet.delete(item.range);
          textHighlightHoverSet.add(item.range);
        }
      });
      node.addEventListener("mouseleave", function () {
        if (item.lost) return;
        if (textHighlightSet && textHighlightHoverSet) {
          textHighlightHoverSet.delete(item.range);
          textHighlightSet.add(item.range);
        }
      });
    } else {
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
    }

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
      type: "element-annotation",
      target: target,
      selResult: selResult,
      textarea: textarea,
    };

    addBtn.addEventListener("click", addDraftToQueue);
    cancelBtn.addEventListener("click", closeDraftBubble);

    layoutBubbles();
  }

  function nearestElementAncestor(node) {
    while (node && node.nodeType !== 1) {
      node = node.parentNode;
    }
    return node;
  }

  function getTextContext(range) {
    // Climb to an ancestor with enough surrounding text, then build
    // before/after ranges via native Range semantics (start-of-ancestor to
    // selection-start, and selection-end to end-of-ancestor). This handles
    // both text-node and element-boundary containers uniformly — Range's
    // own toString() flattens across element boundaries correctly, which a
    // manual sibling-walk over startContainer's own children would not
    // (that fails when the selection starts/ends exactly at a child index
    // with nothing earlier *inside* that same container).
    var ancestorEl = range.commonAncestorContainer;
    if (ancestorEl.nodeType !== 1) ancestorEl = ancestorEl.parentElement;
    while (ancestorEl && ancestorEl.parentElement && ancestorEl.textContent.length < 200) {
      ancestorEl = ancestorEl.parentElement;
    }
    if (!ancestorEl) return { before: "", after: "" };

    var beforeRange = range.cloneRange();
    beforeRange.collapse(true);
    beforeRange.setStart(ancestorEl, 0);
    var beforeText = beforeRange.toString();

    var afterRange = range.cloneRange();
    afterRange.collapse(false);
    afterRange.setEnd(ancestorEl, ancestorEl.childNodes.length);
    var afterText = afterRange.toString();

    return {
      before: beforeText.slice(-50),
      after: afterText.slice(0, 50),
    };
  }

  function openTextDraftBubble(range) {
    if (draftBubble) closeDraftBubble();

    var selectedText = range.toString();
    var context = getTextContext(range);
    var ancestorEl = nearestElementAncestor(range.commonAncestorContainer);
    var nearestSelectorResult = ancestorEl ? generateSelector(ancestorEl) : { selector: null, shadowHost: null };

    if (textHighlightSet) textHighlightSet.add(range);

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

    var rect = range.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();

    draftBubble = {
      node: node,
      anchorY: frameRect.top + rect.top,
      type: "text-annotation",
      range: range,
      selectedText: selectedText,
      context: context,
      nearestSelectorResult: nearestSelectorResult,
      textarea: textarea,
    };

    addBtn.addEventListener("click", addDraftToQueue);
    cancelBtn.addEventListener("click", closeDraftBubble);

    layoutBubbles();
  }

  function truncateText(text, max) {
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  function buildSubmissionPayload() {
    return queue.map(function (item) {
      if (item.type === "text-annotation") {
        return {
          id: item.id,
          type: "text-annotation",
          selectedText: item.selectedText,
          context: item.context,
          nearestSelector: item.nearestSelector,
          shadowHost: item.shadowHost,
          comment: item.comment,
        };
      }
      var outerHTML = item.target && item.target.outerHTML ? truncateText(item.target.outerHTML, 500) : "";
      return {
        id: item.id,
        type: "element-annotation",
        selector: item.selector,
        shadowHost: item.shadowHost,
        outerHTML: outerHTML,
        comment: item.comment,
      };
    });
  }

  function markBubbleSent(node) {
    var deleteBtn = node.querySelector(".bubble-delete");
    if (deleteBtn) deleteBtn.remove();
    node.classList.add("bubble-sent");
    node.style.background = "#f2f2f2";
    var badge = document.createElement("span");
    badge.className = "sent-badge";
    badge.textContent = "✓ Sent · awaiting agent edits";
    badge.style.display = "inline-block";
    badge.style.marginTop = "4px";
    badge.style.fontSize = "11px";
    badge.style.color = "#555";
    node.appendChild(badge);
  }

  function showSendFailure(message) {
    statusText.textContent = message;
    window.setTimeout(function () {
      if (dot.classList.contains("disconnected")) return;
      statusText.textContent = "";
    }, 3000);
  }

  sendAllButton.addEventListener("click", function () {
    if (queue.length === 0) return;
    var payload = buildSubmissionPayload();
    fetch("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok) {
          showSendFailure("Send failed — please retry");
          return;
        }
        for (var i = 0; i < queue.length; i++) {
          markBubbleSent(queue[i].node);
          sentItems.push(queue[i]);
        }
        queue.length = 0;
        updateSendAllLabel();
        layoutBubbles();
      })
      .catch(function () {
        showSendFailure("Send failed — network error");
      });
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
    attachSelectionListeners();
    reanchorLostTextAnnotations();
  });
  if (reviewOn) attachOverlayListeners();
  attachSelectionListeners();

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
