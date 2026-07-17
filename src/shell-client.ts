export function renderClientScript(): string {
  return `
(function () {
  var dot = document.getElementById("status-dot");
  var statusText = document.getElementById("status-text");
  var frame = document.getElementById("artifact-frame");
  var reviewSwitch = document.getElementById("review-switch");
  var scrollHint = document.getElementById("scroll-hint");
  var commentRail = document.getElementById("comment-rail");
  var railScroll = document.getElementById("rail-scroll");
  var railGrip = document.getElementById("rail-grip");
  var railCollapseBtn = document.getElementById("rail-collapse");
  var railFooter = document.getElementById("rail-footer");
  var confirmDocumentButton = document.getElementById("confirm-document");

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
    if (draftBubble) {
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
    if (!node) return;
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
  // "Select a wider element" while hovering: scroll wheel walks up the
  // ancestor chain from whatever's directly under the cursor. Free for
  // table cells specifically (td -> tr -> table are already ancestors — no
  // table-specific code needed), and generalizes to any nested markup.
  var hoverBaseTarget = null;
  var hoverLevel = 0;
  var HOVER_LEVEL_MAX = 6;

  function climbAncestors(el, n) {
    var node = el;
    for (var i = 0; i < n; i++) {
      var parent = node.parentElement;
      // Stop before escaping to <body>/<html> — annotating the whole page
      // body is never a meaningful target. Also naturally stops at a shadow
      // root's own boundary: a direct child of a ShadowRoot has
      // parentElement === null (ShadowRoot isn't an Element), so climbing
      // can't escape a shadow tree this way either.
      if (!parent || parent.tagName === "BODY" || parent.tagName === "HTML") break;
      node = parent;
    }
    return node;
  }

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
    if (e.target !== hoverBaseTarget) {
      // A genuinely different hover start — reset the climb level, so it
      // doesn't carry over confusingly from whatever was hovered before.
      hoverBaseTarget = e.target;
      hoverLevel = 0;
    }
    currentHoverTarget = climbAncestors(hoverBaseTarget, hoverLevel);
    if (mouseMoveFramePending) return;
    mouseMoveFramePending = true;
    window.requestAnimationFrame(function () {
      mouseMoveFramePending = false;
      if (reviewOn) positionHighlight(currentHoverTarget);
    });
  }

  function onIframeMouseLeave() {
    currentHoverTarget = null;
    hoverBaseTarget = null;
    hoverLevel = 0;
    hideHighlight();
  }

  function onIframeWheel(e) {
    if (!reviewOn || !hoverBaseTarget) return;
    e.preventDefault();
    hoverLevel = Math.max(0, Math.min(HOVER_LEVEL_MAX, hoverLevel + (e.deltaY > 0 ? 1 : -1)));
    currentHoverTarget = climbAncestors(hoverBaseTarget, hoverLevel);
    positionHighlight(currentHoverTarget);
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
      // At rest: a neutral gray wash — just enough to mark "this text has an
      // annotation" without fighting for attention. On hover: the warmer
      // yellow, so the color itself changes (not just its opacity), giving
      // a clearer "you're now pointing at this one" signal than deepening
      // the same hue would.
      "::highlight(" + HIGHLIGHT_NAME + ") { background-color: rgba(60,64,72,.12); }" +
      "::highlight(" + HIGHLIGHT_HOVER_NAME + ") { background-color: rgba(255,204,0,.8); }";
    doc.head.appendChild(style);

    textHighlightSet = new win.Highlight();
    textHighlightHoverSet = new win.Highlight();
    win.CSS.highlights.set(HIGHLIGHT_NAME, textHighlightSet);
    win.CSS.highlights.set(HIGHLIGHT_HOVER_NAME, textHighlightHoverSet);
  }

  function onIframeMouseUp() {
    var doc = getIframeDoc();
    var sel = doc && doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.toString().length > 0 && sel.rangeCount > 0) {
      openTextDraftBubble(sel.getRangeAt(0).cloneRange());
    }
  }

  function attachSelectionListeners() {
    var doc = getIframeDoc();
    if (!doc) return;
    doc.addEventListener("mouseup", onIframeMouseUp);
    setupTextHighlightRegistry();
  }

  // ---- Comment rail: resize + collapse ----
  // Bubbles are real DOM children of #rail-scroll in normal document flow
  // (not position: fixed) — #rail-scroll is a plain overflow-y: auto box, so
  // the browser's native scrollbar handles the "too many comments to fit"
  // case for free, and horizontal placement is pure CSS (left/right on
  // .bubble) that adapts to any rail width with zero JS involvement.

  var RAIL_MIN_WIDTH = 180;
  var RAIL_MAX_WIDTH = 480;
  var RAIL_COLLAPSED_WIDTH = 28;
  var railWidth = 280;
  var railCollapsed = false;

  function applyRailWidth() {
    commentRail.style.width = (railCollapsed ? RAIL_COLLAPSED_WIDTH : railWidth) + "px";
    commentRail.classList.toggle("collapsed", railCollapsed);
    railCollapseBtn.textContent = railCollapsed ? "›" : "‹";
    railScroll.style.display = railCollapsed ? "none" : "block";
    railFooter.style.display = railCollapsed ? "none" : "flex";
    renderHistoryGroup();
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

  // historyContainer is the first child ever appended to #rail-scroll, so it
  // always renders above the queue/sent bubbles that follow it, regardless
  // of insertion order after this point — normal document flow, no z-index
  // or absolute-position bookkeeping needed.
  var historyContainer = document.createElement("div");
  historyContainer.id = "history-group";
  historyContainer.style.display = "none";
  historyContainer.style.marginBottom = "8px";
  railScroll.appendChild(historyContainer);

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
      item.node.style.marginBottom = "8px";
      historyList.appendChild(item.node);
      historyItems.push(item);
    }
    sentItems.length = 0;
    renderHistoryGroup();
  }

  function updateSendAllLabel() {
    sendAllButton.textContent = "Send all (" + queue.length + ")";
  }

  function targetAnchorY(target) {
    // Purely a sort key now (reading-order position at creation time), not a
    // pixel coordinate anything gets positioned at — bubbles live in normal
    // document flow inside #rail-scroll, ordered by this value, not placed
    // at an absolute Y. Keeps the "roughly near its source, top to bottom"
    // correlation the rail is meant to preserve, without pixel-exact
    // alignment (which stopped being viable the moment scrolling was added:
    // with many comments, pixel alignment and a working scrollbar can't
    // both hold at once).
    var rect = target.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    return frameRect.top + rect.top;
  }

  function layoutBubbles() {
    // Sort by reading-order position, then re-append in that order — append
    // on an already-attached node reorders it. Horizontal placement and
    // spacing are pure CSS (.bubble's left/right/margin-bottom); the
    // rail's own overflow-y: auto handles anything that doesn't fit.
    // draftBubble is deliberately excluded — it floats over the content
    // near where it was opened until addDraftToQueue moves it in.
    var all = queue.concat(sentItems);
    all.sort(function (a, b) {
      return a.anchorY - b.anchorY;
    });
    for (var i = 0; i < all.length; i++) {
      railScroll.appendChild(all[i].node);
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

  // The thread container is a single capped-height, internally scrolling box
  // (DAC-2) — a thread has no message-count limit, so left ungrown it would
  // push every other bubble in the rail out of reach.
  function getOrCreateThreadContainer(node) {
    var container = node.querySelector(".bubble-thread");
    if (!container) {
      container = document.createElement("div");
      container.className = "bubble-thread";
      node.appendChild(container);
    }
    return container;
  }

  function appendAnswerToThread(node, text) {
    var container = getOrCreateThreadContainer(node);
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

    container.appendChild(answerBlock);
    container.scrollTop = container.scrollHeight;
  }

  // Kept as the public name used by the /events "reply" handler below —
  // multi-round threads have no "first answer only" special case anymore,
  // every reply (first or Nth) appends the same way.
  function renderAnswer(node, text) {
    appendAnswerToThread(node, text);
  }

  function appendFollowUpToThread(node, text) {
    var container = getOrCreateThreadContainer(node);
    var followUp = document.createElement("div");
    followUp.className = "bubble-comment";
    followUp.style.marginTop = "6px";
    followUp.textContent = text;
    container.appendChild(followUp);
    container.scrollTop = container.scrollHeight;
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

  // Drafts float over the content near where the user just clicked/selected
  // (position: fixed, appended to document.body) rather than appearing in
  // the rail right away — only once "Add to queue" commits it does the same
  // node move into #rail-scroll (see addDraftToQueue). createBubbleShell is
  // only ever called to start a fresh draft, never reused for an
  // already-queued bubble, so it's safe to always build the floating form.
  function createBubbleShell() {
    var node = document.createElement("div");
    node.className = "bubble";
    node.style.background = "#fff";
    node.style.border = "1px solid #e3e5e9";
    node.style.borderRadius = "8px";
    node.style.padding = "10px 12px";
    node.style.boxShadow = "0 1px 4px rgba(20,24,33,.08)";
    node.style.fontSize = "13px";
    node.style.boxSizing = "border-box";
    node.style.marginBottom = "8px";
    node.style.position = "fixed";
    node.style.width = "260px";
    // Above highlightBox's z-index (1000) — a floating draft opened right
    // where the hover highlight box currently sits must never be covered by
    // it.
    node.style.zIndex = "1100";
    document.body.appendChild(node);
    return node;
  }

  // Shared by openDraftBubble/openTextDraftBubble — draft controls (textarea
  // + Add + a close "x") look the same regardless of which kind of
  // annotation is being drafted.
  function buildDraftControls(node) {
    var closeBtn = document.createElement("button");
    closeBtn.className = "bubble-cancel";
    closeBtn.textContent = "×";
    closeBtn.title = "Cancel";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "6px";
    closeBtn.style.right = "6px";
    closeBtn.style.width = "20px";
    closeBtn.style.height = "20px";
    closeBtn.style.lineHeight = "18px";
    closeBtn.style.border = "none";
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "var(--chrome-dim)";
    closeBtn.style.fontSize = "16px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.borderRadius = "4px";
    closeBtn.style.padding = "0";

    var textarea = document.createElement("textarea");
    textarea.style.display = "block";
    textarea.style.width = "100%";
    textarea.style.boxSizing = "border-box";
    textarea.style.marginTop = "16px";
    textarea.style.border = "1px solid #e3e5e9";
    textarea.style.borderRadius = "6px";
    textarea.style.padding = "6px 8px";
    textarea.style.fontSize = "13px";
    textarea.style.fontFamily = "inherit";
    textarea.style.resize = "vertical";
    textarea.rows = 3;

    var footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.marginTop = "8px";

    var addBtn = document.createElement("button");
    addBtn.className = "bubble-add";
    addBtn.textContent = "Add";
    // Same look as the toolbar's Send all button (var(--accent) fill).
    addBtn.style.background = "var(--accent)";
    addBtn.style.color = "#fff";
    addBtn.style.border = "none";
    addBtn.style.borderRadius = "6px";
    addBtn.style.padding = "6px 14px";
    addBtn.style.fontSize = "12.5px";
    addBtn.style.cursor = "pointer";
    footer.appendChild(addBtn);

    node.appendChild(closeBtn);
    node.appendChild(textarea);
    node.appendChild(footer);

    closeBtn.addEventListener("click", closeDraftBubble);
    addBtn.addEventListener("click", addDraftToQueue);

    return { textarea: textarea };
  }

  function positionFloatingBubble(node, pageX, pageY) {
    var width = 260;
    // Estimated height (textarea + Add/Cancel buttons) — the real height
    // isn't known until the browser lays it out, but clamping needs a
    // number now so the bubble's *bottom* stays on-screen too, not just
    // its top-left corner.
    var estimatedHeight = 160;
    var maxLeft = Math.max(12, window.innerWidth - width - 12);
    node.style.left = Math.min(Math.max(pageX, 12), maxLeft) + "px";
    var maxTop = Math.max(48, window.innerHeight - estimatedHeight - 12);
    node.style.top = Math.min(Math.max(pageY, 48), maxTop) + "px";
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
    // Clear the floating-draft positioning — layoutBubbles() below moves
    // this node into #rail-scroll, where it should behave like any other
    // rail bubble (normal document flow), not still be pinned to whatever
    // fixed viewport position it was opened at. Kept relative (not cleared
    // to static) so the "x" delete button below still anchors to this
    // bubble's own corner instead of escaping to a positioned ancestor.
    node.style.position = "relative";
    node.style.left = "";
    node.style.top = "";
    node.style.width = "";
    node.style.zIndex = "";
    var text = document.createElement("div");
    text.className = "bubble-comment";
    text.textContent = comment;
    text.style.paddingRight = "18px";
    var deleteBtn = document.createElement("button");
    deleteBtn.className = "bubble-delete";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Delete";
    deleteBtn.style.position = "absolute";
    deleteBtn.style.top = "6px";
    deleteBtn.style.right = "6px";
    deleteBtn.style.width = "20px";
    deleteBtn.style.height = "20px";
    deleteBtn.style.lineHeight = "18px";
    deleteBtn.style.border = "none";
    deleteBtn.style.background = "transparent";
    deleteBtn.style.color = "var(--chrome-dim)";
    deleteBtn.style.fontSize = "16px";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.style.borderRadius = "4px";
    deleteBtn.style.padding = "0";
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

  function openDraftBubble(target, clickX, clickY) {
    if (draftBubble) closeDraftBubble();

    var selResult = generateSelector(target);
    var node = createBubbleShell();
    node.className = "bubble bubble-draft";

    var controls = buildDraftControls(node);

    var frameRect = frame.getBoundingClientRect();
    positionFloatingBubble(node, frameRect.left + clickX, frameRect.top + clickY);
    controls.textarea.focus();

    draftBubble = {
      node: node,
      anchorY: targetAnchorY(target),
      type: "element-annotation",
      target: target,
      selResult: selResult,
      textarea: controls.textarea,
    };
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
      before: beforeText.slice(-25),
      after: afterText.slice(0, 25),
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

    var controls = buildDraftControls(node);

    var rect = range.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();

    positionFloatingBubble(node, frameRect.left + rect.left, frameRect.top + rect.bottom + 6);
    controls.textarea.focus();

    draftBubble = {
      node: node,
      anchorY: frameRect.top + rect.top,
      type: "text-annotation",
      range: range,
      selectedText: selectedText,
      context: context,
      nearestSelectorResult: nearestSelectorResult,
      textarea: controls.textarea,
    };
  }

  function truncateText(text, max) {
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  function buildSubmissionPayload() {
    return queue.map(function (item) {
      if (item.type === "follow-up") {
        return {
          id: item.id,
          replyToId: item.replyToId,
          comment: item.comment,
        };
      }
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

  // Follow-up input is persistent, not click-to-expand (DAC-1) — reuses
  // buildDraftControls' textarea/Add/× visual language, but submitting it
  // queues a { replyToId } item instead of opening a fresh draft bubble.
  // Collapsed behind a "Reply" button by default — only expanding into the
  // textarea once clicked, not shown open-ended on every sent bubble.
  function addFollowUpControls(node, rootId) {
    if (node.querySelector(".followup-controls") || node.querySelector(".followup-reply-btn")) return;

    var replyBtn = document.createElement("button");
    replyBtn.className = "followup-reply-btn";
    replyBtn.textContent = "Reply";
    replyBtn.style.marginTop = "8px";
    replyBtn.style.background = "transparent";
    replyBtn.style.border = "1px solid #e3e5e9";
    replyBtn.style.borderRadius = "6px";
    replyBtn.style.padding = "4px 10px";
    replyBtn.style.fontSize = "12px";
    replyBtn.style.color = "var(--chrome-dim)";
    replyBtn.style.cursor = "pointer";
    node.appendChild(replyBtn);

    replyBtn.addEventListener("click", function () {
      replyBtn.remove();

      var wrap = document.createElement("div");
      wrap.className = "followup-controls";
      wrap.style.position = "relative";
      wrap.style.marginTop = "8px";

      var controls = buildDraftControls(wrap);
      // buildDraftControls wires its own close/add buttons assuming a
      // floating draft bubble — a follow-up box lives inline in a sent
      // bubble, so those default bindings are replaced below.
      var closeBtn = wrap.querySelector(".bubble-cancel");
      var addBtn = wrap.querySelector(".bubble-add");
      var newCloseBtn = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
      var newAddBtn = addBtn.cloneNode(true);
      addBtn.parentNode.replaceChild(newAddBtn, addBtn);

      newCloseBtn.addEventListener("click", function () {
        wrap.remove();
        addFollowUpControls(node, rootId);
      });
      newAddBtn.addEventListener("click", function () {
        var text = controls.textarea.value;
        if (!text) return;
        queueFollowUp(rootId, text, node);
        wrap.remove();
        addFollowUpControls(node, rootId);
      });

      node.appendChild(wrap);
      controls.textarea.focus();
    });
  }

  function queueFollowUp(rootId, text, node) {
    var id = "a-" + nextQueueId++;
    var item = {
      id: id,
      node: null,
      type: "follow-up",
      replyToId: rootId,
      comment: text,
    };
    queue.push(item);
    appendFollowUpToThread(node, text);
    updateSendAllLabel();
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
    addFollowUpControls(node, node.getAttribute("data-annotation-id"));
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
          // Follow-up items have no bubble of their own (queueFollowUp
          // already rendered the message inline into the root bubble's
          // thread) — only new-annotation items go through the normal
          // sent/history bubble lifecycle.
          if (queue[i].type === "follow-up") continue;
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

  confirmDocumentButton.addEventListener("click", function () {
    if (queue.length > 0) {
      showSendFailure("Send or clear the queue first");
      return;
    }
    if (!window.confirm("Confirm this document is done? All feedback history will be deleted.")) {
      return;
    }
    fetch("/confirm-document", { method: "POST" }).catch(function () {});
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
    // currentHoverTarget reflects any wheel-escalated level, not just the
    // raw click target — a real mousemove always precedes a click, but fall
    // back to e.target defensively in case it somehow doesn't.
    openDraftBubble(currentHoverTarget || e.target, e.clientX, e.clientY);
  }

  function attachOverlayListeners() {
    var doc = getIframeDoc();
    if (!doc) return;
    doc.addEventListener("mousemove", onIframeMouseMove);
    doc.addEventListener("mouseleave", onIframeMouseLeave);
    doc.addEventListener("click", onIframeClick, true);
    doc.addEventListener("scroll", refreshHighlightPosition, true);
    doc.addEventListener("wheel", onIframeWheel, { passive: false });
    scrollHint.classList.add("visible");
  }

  function detachOverlayListeners() {
    var doc = getIframeDoc();
    if (doc) {
      doc.removeEventListener("mousemove", onIframeMouseMove);
      doc.removeEventListener("mouseleave", onIframeMouseLeave);
      doc.removeEventListener("click", onIframeClick, true);
      doc.removeEventListener("scroll", refreshHighlightPosition, true);
      doc.removeEventListener("wheel", onIframeWheel);
    }
    currentHoverTarget = null;
    hoverBaseTarget = null;
    hoverLevel = 0;
    hideHighlight();
    scrollHint.classList.remove("visible");
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
