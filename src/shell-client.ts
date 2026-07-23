export function renderClientScript(): string {
  return `
(function () {
  var dot = document.getElementById("status-dot");
  var statusText = document.getElementById("status-text");
  var frame = document.getElementById("artifact-frame");
  var reviewSwitch = document.getElementById("review-mode-switch");
  var commentRail = document.getElementById("comment-rail");
  var railScroll = document.getElementById("rail-scroll");
  var railGrip = document.getElementById("rail-grip");
  var railCollapseBtn = document.getElementById("rail-collapse");
  var railCollapseAllBtn = document.getElementById("rail-collapse-all");
  var railFooter = document.getElementById("rail-footer");
  var approveButton = document.getElementById("approve");
  var confirmModalBackdrop = document.getElementById("confirm-modal-backdrop");
  var confirmModalOk = document.getElementById("confirm-modal-ok");
  var confirmModalCancel = document.getElementById("confirm-modal-cancel");
  var agentStatusLabel = document.getElementById("agent-status");
  var themeToggleButton = document.getElementById("theme-toggle");
  var documentReadOnly = false;
  var documentConfirmed = false;

  // ---- Theme toggle (light/dark) ----

  var THEME_STORAGE_KEY = "ezreview-theme";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggleButton.textContent = theme === "dark" ? "☀︎" : "☾";
  }

  (function initTheme() {
    var stored = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (e) {
      // localStorage may be unavailable (privacy mode, sandboxed iframe) —
      // fall back to the server-rendered default theme silently.
    }
    if (stored === "light" || stored === "dark") applyTheme(stored);
  })();

  themeToggleButton.addEventListener("click", function () {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    var next = isDark ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (e) {
      // Best-effort persistence only — a failed write just means the choice
      // won't survive a reload, which is no worse than not persisting at all.
    }
  });

  var STALE_DISCONNECT_MS = 15000;
  var staleDisconnectTimer = null;

  function setConnected() {
    if (staleDisconnectTimer) {
      window.clearTimeout(staleDisconnectTimer);
      staleDisconnectTimer = null;
    }
    dot.classList.remove("disconnected");
    statusText.textContent = "";
    agentStatusLabel.textContent = "Agent connected";
  }

  function setDisconnected() {
    dot.classList.add("disconnected");
    if (documentConfirmed) {
      agentStatusLabel.textContent = "Agent disconnected";
      statusText.textContent = "";
      return;
    }
    agentStatusLabel.textContent = "Agent connected";
    statusText.textContent = "Disconnected · retrying…";
    // The browser's own EventSource keeps retrying on its own — this is just
    // upgrading the message once a retry storm has gone on long enough that
    // it's more likely the server process itself exited (e.g. idle auto-exit)
    // than a transient network blip, since a manual "reconnect" button
    // couldn't do anything a still-alive server's own retry wouldn't already.
    if (!staleDisconnectTimer) {
      staleDisconnectTimer = window.setTimeout(function () {
        staleDisconnectTimer = null;
        if (dot.classList.contains("disconnected") && !documentConfirmed) {
          statusText.textContent = "Server may have stopped — ask the agent to reopen";
        }
      }, STALE_DISCONNECT_MS);
    }
  }

  var source = new EventSource("/events");
  source.onopen = setConnected;
  source.onerror = setDisconnected;
  source.addEventListener("confirmed", function () {
    documentConfirmed = true;
  });
  source.addEventListener("reload", function () {
    currentHoverTarget = null;
    hideHighlight();
    markTextAnnotationsLost();
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
    var rootId = threadRootById[data.id] || data.id;
    delete pendingReplyIds[rootId];
    updateReplySpinner();
    var node = findAnnotationNodeById(rootId);
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
      return { selector: buildPathWithinRoot(el, el.ownerDocument), shadowHost: null };
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
  highlightBox.style.zIndex = "var(--z-review-element)";
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

  function getReviewTarget(target) {
    var doc = getIframeDoc();
    if (!target || !doc || target === doc || target === doc.documentElement || target === doc.body) {
      return null;
    }
    return target;
  }

  function positionHighlight(target) {
    target = getReviewTarget(target);
    if (!target) {
      hideHighlight();
      return;
    }
    var rect = target.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    var left = frameRect.left + rect.left;
    var top = frameRect.top + rect.top;
    var right = left + rect.width;
    var bottom = top + rect.height;
    if (
      right <= frameRect.left ||
      left >= frameRect.right ||
      bottom <= frameRect.top ||
      top >= frameRect.bottom
    ) {
      hideHighlight();
      return;
    }
    var clipTop = Math.max(0, frameRect.top - top);
    var clipRight = Math.max(0, right - frameRect.right);
    var clipBottom = Math.max(0, bottom - frameRect.bottom);
    var clipLeft = Math.max(0, frameRect.left - left);
    highlightBox.style.left = left + "px";
    highlightBox.style.top = top + "px";
    highlightBox.style.width = rect.width + "px";
    highlightBox.style.height = rect.height + "px";
    highlightBox.style.clipPath =
      "inset(" + clipTop + "px " + clipRight + "px " + clipBottom + "px " + clipLeft + "px)";
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
    currentHoverTarget = getReviewTarget(e.target);
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

  // CSS Custom Highlight supplies the translucent fill behind the glyphs,
  // while this shell-owned overlay adds a two-tone edge around each rendered
  // line box. Keeping the edge outside the iframe makes it independent of an
  // artifact's theme, CSP, stacking contexts, transforms, and pointer events.
  var textHighlightOverlayRoot = document.createElement("div");
  textHighlightOverlayRoot.id = "text-highlight-overlay";
  textHighlightOverlayRoot.setAttribute("aria-hidden", "true");
  textHighlightOverlayRoot.style.position = "fixed";
  textHighlightOverlayRoot.style.pointerEvents = "none";
  textHighlightOverlayRoot.style.overflow = "hidden";
  textHighlightOverlayRoot.style.zIndex = "var(--z-review-text)";
  textHighlightOverlayRoot.style.display = "none";
  document.body.appendChild(textHighlightOverlayRoot);

  var textHighlightOverlayFrameId = null;

  function clearTextHighlightOverlay() {
    if (textHighlightOverlayFrameId !== null) {
      window.cancelAnimationFrame(textHighlightOverlayFrameId);
      textHighlightOverlayFrameId = null;
    }
    textHighlightOverlayRoot.textContent = "";
    textHighlightOverlayRoot.style.display = "none";
  }

  function appendTextHighlightEdges(highlightSet, state) {
    if (!highlightSet || !highlightSet.forEach) return;
    var seenRects = {};
    highlightSet.forEach(function (range) {
      if (!range || !range.getClientRects) return;
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        var rect = rects[i];
        if (rect.width <= 0 || rect.height <= 0) continue;
        var key = [
          Math.round(rect.left * 10),
          Math.round(rect.top * 10),
          Math.round(rect.width * 10),
          Math.round(rect.height * 10),
        ].join(":");
        if (seenRects[key]) continue;
        seenRects[key] = true;

        var edge = document.createElement("div");
        edge.className = "text-highlight-edge text-highlight-edge-" + state;
        edge.style.position = "absolute";
        edge.style.left = rect.left - 2 + "px";
        edge.style.top = rect.top - 1 + "px";
        edge.style.width = rect.width + 4 + "px";
        edge.style.height = rect.height + 2 + "px";
        edge.style.boxSizing = "border-box";
        edge.style.border = "1px solid rgba(255,255,255,.96)";
        edge.style.borderRadius = "2px";
        edge.style.boxShadow = state === "hover"
          ? "0 0 0 2px rgba(0,0,0,.94)"
          : "0 0 0 1px rgba(0,0,0,.88)";
        textHighlightOverlayRoot.appendChild(edge);
      }
    });
  }

  function refreshTextHighlightOverlay() {
    textHighlightOverlayFrameId = null;
    var frameRect = frame.getBoundingClientRect();
    textHighlightOverlayRoot.style.left = frameRect.left + "px";
    textHighlightOverlayRoot.style.top = frameRect.top + "px";
    textHighlightOverlayRoot.style.width = frameRect.width + "px";
    textHighlightOverlayRoot.style.height = frameRect.height + "px";
    textHighlightOverlayRoot.textContent = "";
    appendTextHighlightEdges(textHighlightSet, "normal");
    appendTextHighlightEdges(textHighlightHoverSet, "hover");
    textHighlightOverlayRoot.style.display = textHighlightOverlayRoot.childNodes.length ? "block" : "none";
  }

  function scheduleTextHighlightOverlayRefresh() {
    if (textHighlightOverlayFrameId !== null) return;
    textHighlightOverlayFrameId = window.requestAnimationFrame(refreshTextHighlightOverlay);
  }

  function addTextHighlight(range) {
    if (!textHighlightSet) return;
    textHighlightSet.add(range);
    scheduleTextHighlightOverlayRefresh();
  }

  function removeTextHighlight(range) {
    if (textHighlightSet) textHighlightSet.delete(range);
    if (textHighlightHoverSet) textHighlightHoverSet.delete(range);
    scheduleTextHighlightOverlayRefresh();
  }

  function setTextHighlightHovered(range, hovered) {
    if (!textHighlightSet || !textHighlightHoverSet) return;
    if (hovered) {
      textHighlightSet.delete(range);
      textHighlightHoverSet.add(range);
    } else {
      textHighlightHoverSet.delete(range);
      textHighlightSet.add(range);
    }
    scheduleTextHighlightOverlayRefresh();
  }

  // Tracks which iframe *document* the registry was last built for — a real
  // frame reload gets a brand-new document (needs a fresh registry), but a
  // Review-toggle re-attach on the same still-loaded document must not
  // recreate it: that would replace textHighlightSet/textHighlightHoverSet
  // with new, empty Highlight() instances, silently dropping every range
  // already added for queued/sent text annotations.
  var textHighlightRegistryDoc = null;

  function setupTextHighlightRegistry() {
    var win = getIframeWindow();
    var doc = getIframeDoc();
    if (!win || !doc || !win.Highlight || !win.CSS || !win.CSS.highlights) return;
    if (doc === textHighlightRegistryDoc) return;
    clearTextHighlightOverlay();
    textHighlightRegistryDoc = doc;

    var style = doc.createElement("style");
    style.setAttribute("data-ezreview-text-highlight", "");
    style.textContent =
      // Fill locates the selected text; the shell-level black/white edge
      // carries contrast across light, dark, saturated, and mixed artwork.
      "::highlight(" + HIGHLIGHT_NAME + ") { background-color: rgba(255,196,0,.28); }" +
      "::highlight(" + HIGHLIGHT_HOVER_NAME + ") { background-color: rgba(255,196,0,.58); }";
    doc.head.appendChild(style);

    textHighlightSet = new win.Highlight();
    textHighlightHoverSet = new win.Highlight();
    win.CSS.highlights.set(HIGHLIGHT_NAME, textHighlightSet);
    win.CSS.highlights.set(HIGHLIGHT_HOVER_NAME, textHighlightHoverSet);
    doc.addEventListener("scroll", scheduleTextHighlightOverlayRefresh, true);
    win.addEventListener("resize", scheduleTextHighlightOverlayRefresh);
    scheduleTextHighlightOverlayRefresh();
  }

  function onIframeMouseUp() {
    if (!reviewOn) return;
    var doc = getIframeDoc();
    var sel = doc && doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.toString().length > 0 && sel.rangeCount > 0) {
      openTextDraftBubble(sel.getRangeAt(0).cloneRange());
    }
  }

  // setupTextHighlightRegistry() runs unconditionally on every frame load —
  // it only prepares the CSS Custom Highlight API registry that already-
  // queued/sent text annotations render into (and reanchorLostTextAnnotations,
  // called right after, needs it ready regardless of the Review toggle).
  // Only the mouseup listener that STARTS a new draft is Review-gated, mirroring
  // onIframeClick's element-annotation equivalent (listener attach/detach here,
  // plus the internal reviewOn guard above as defense in depth).
  function attachSelectionListeners() {
    var doc = getIframeDoc();
    if (!doc) return;
    doc.addEventListener("mouseup", onIframeMouseUp);
    setupTextHighlightRegistry();
  }

  function detachSelectionListeners() {
    var doc = getIframeDoc();
    if (doc) doc.removeEventListener("mouseup", onIframeMouseUp);
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
    // The collapsed rail is too narrow (28px) to fit both this and
    // #rail-collapse without overlapping, and there is nothing to collapse
    // when every bubble is already hidden anyway.
    railCollapseAllBtn.style.display = railCollapsed ? "none" : "block";
    if (railCollapsed) hideSourceTooltip();
    else if (activeSourceTooltip) positionSourceTooltip(activeSourceTooltip.help, activeSourceTooltip.tooltip);
    scheduleTextHighlightOverlayRefresh();
  }

  railCollapseBtn.addEventListener("click", function () {
    railCollapsed = !railCollapsed;
    applyRailWidth();
  });

  // Toggles based on current majority state — if any bubble is expanded,
  // the next click collapses everything; only once all are already
  // collapsed does it switch to expanding everything.
  railCollapseAllBtn.addEventListener("click", function () {
    var anyExpanded = false;
    for (var i = 0; i < sentItems.length; i++) {
      if (!sentItems[i].node.classList.contains("bubble-collapsed")) {
        anyExpanded = true;
        break;
      }
    }
    for (var j = 0; j < sentItems.length; j++) {
      setBubbleCollapsed(sentItems[j].node, anyExpanded);
    }
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
    var maxWidth = Math.max(RAIL_MAX_WIDTH, window.innerWidth / 2);
    railWidth = Math.max(RAIL_MIN_WIDTH, Math.min(maxWidth, newWidth));
    applyRailWidth();
  });
  railGrip.addEventListener("pointerup", function (e) {
    railResizing = false;
    railGrip.releasePointerCapture(e.pointerId);
  });

  // ---- Bubble queue (draft -> queue -> delete; Submit review is a placeholder) ----

  var submitReviewButton = document.getElementById("submit-review");
  var replySpinner = document.getElementById("reply-spinner");
  var queue = [];
  window.__annotationQueue = queue;
  var draftBubble = null;
  var sentItems = [];
  window.__sentAnnotations = sentItems;
  // Defensive client-side child -> root lookup. Fixed servers always emit
  // root ids, but retaining this mapping prevents a child-id reply event
  // from becoming invisible if it comes from an older or malformed server.
  var threadRootById = {};
  // Root ids (never a follow-up's own id — replies always target the
  // thread root) still awaiting at least one reply from the most recent
  // Submit review batch. The spinner shows while this is non-empty.
  var pendingReplyIds = {};
  var annotationPageId = window.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  var nextAnnotationNumber = 1;

  function newAnnotationId() {
    // Annotation ids outlive this page: the server persists thread mappings
    // across reloads and idle restarts. Namespace the readable counter with
    // a random per-page token so a reload cannot reuse the previous page's
    // ids and make a new root inherit an old follow-up's thread mapping.
    return "a-" + annotationPageId + "-" + nextAnnotationNumber++;
  }

  function bubbleClickTargetsControl(event) {
    var target = event.target;
    return !!(target && target.closest && target.closest("button, textarea, input, select, a"));
  }

  function updateReplySpinner() {
    replySpinner.classList.toggle("visible", Object.keys(pendingReplyIds).length > 0);
  }

  function updateSubmitReviewLabel() {
    submitReviewButton.textContent = "Submit review (" + queue.length + ")";
    if (!documentReadOnly) submitReviewButton.disabled = queue.length === 0;
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
    var lists = [sentItems, queue];
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
      // markBubbleSent (which appends the Reply button / follow-up controls)
      // runs at send time, before any agent reply exists — so this container
      // is often created afterward and would otherwise land ABOVE those
      // controls in the DOM. appendChild on an already-attached node moves
      // it, so re-appending puts the controls back below the thread, always
      // at the bubble's bottom-right regardless of creation order.
      var existingReplyControls = node.querySelector(".followup-reply-btn, .followup-controls");
      if (existingReplyControls) {
        var controlsRoot = existingReplyControls.className === "followup-reply-btn"
          ? existingReplyControls.parentNode
          : existingReplyControls;
        node.appendChild(controlsRoot);
      }
      if (node.classList.contains("bubble-collapsed")) container.style.display = "none";
    }
    return container;
  }

  function appendAnswerToThread(node, text) {
    var container = getOrCreateThreadContainer(node);
    var answerBlock = document.createElement("div");
    answerBlock.className = "answer-block";
    answerBlock.style.marginTop = "6px";
    answerBlock.style.paddingTop = "4px";
    answerBlock.style.paddingBottom = "4px";
    answerBlock.style.paddingLeft = "8px";
    answerBlock.style.borderLeft = "3px solid var(--accent)";
    answerBlock.style.background = "var(--accent-soft)";

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

  // Mirrors answerBlock's visual language (left accent bar + role label)
  // for human messages — "bubble-comment" stays the text node's own class
  // (existing tests assert its exact textContent, with no label mixed in).
  function buildMeBlock(text) {
    var meBlock = document.createElement("div");
    meBlock.className = "me-block";
    meBlock.style.paddingTop = "4px";
    meBlock.style.paddingBottom = "4px";
    meBlock.style.paddingLeft = "8px";
    meBlock.style.borderLeft = "3px solid var(--disconnect-red)";
    meBlock.style.background = "var(--danger-soft)";

    var meLabel = document.createElement("div");
    meLabel.className = "me-label";
    meLabel.textContent = "ME";
    meLabel.style.fontSize = "10px";
    meLabel.style.fontWeight = "bold";
    meLabel.style.color = "var(--disconnect-red)";
    meBlock.appendChild(meLabel);

    var commentText = document.createElement("div");
    commentText.className = "bubble-comment";
    commentText.textContent = text;
    meBlock.appendChild(commentText);

    return meBlock;
  }

  function appendFollowUpToThread(node, text) {
    var container = getOrCreateThreadContainer(node);
    var meBlock = buildMeBlock(text);
    meBlock.style.marginTop = "6px";
    container.appendChild(meBlock);
    container.scrollTop = container.scrollHeight;
  }

  var TEXT_SOURCE_NOT_FOUND_DETAIL =
    "The original selection not found because its text and the surrounding text changed.";
  var ELEMENT_SOURCE_NOT_FOUND_DETAIL =
    "The referenced element not found because it was removed or its element structure changed.";

  var activeSourceTooltip = null;

  function positionSourceTooltip(help, tooltip) {
    var railRect = railScroll.getBoundingClientRect();
    var helpRect = help.getBoundingClientRect();
    var tooltipWidth = Math.max(120, Math.min(220, railRect.width - 16));
    tooltip.style.width = tooltipWidth + "px";
    var tooltipRect = tooltip.getBoundingClientRect();
    var left = Math.min(
      Math.max(helpRect.left, railRect.left + 8),
      railRect.right - tooltipRect.width - 8,
    );
    var below = helpRect.bottom + 6;
    var above = helpRect.top - tooltipRect.height - 6;
    var top = below + tooltipRect.height <= railRect.bottom - 8
      ? below
      : Math.max(railRect.top + 8, above);
    tooltip.style.left = Math.round(left) + "px";
    tooltip.style.top = Math.round(top) + "px";
  }

  function showSourceTooltip(help, tooltip) {
    hideSourceTooltip();
    tooltip.classList.add("visible");
    activeSourceTooltip = { help: help, tooltip: tooltip };
    positionSourceTooltip(help, tooltip);
  }

  function hideSourceTooltip(tooltip) {
    var target = tooltip || (activeSourceTooltip && activeSourceTooltip.tooltip);
    if (target) target.classList.remove("visible");
    if (!tooltip || (activeSourceTooltip && activeSourceTooltip.tooltip === tooltip)) {
      activeSourceTooltip = null;
    }
  }

  function removeSourceNotFoundBadge(node) {
    var badge = node.querySelector(".anchor-lost-badge");
    if (!badge) return;
    var help = badge.querySelector(".anchor-lost-help");
    var tooltipId = help && help.getAttribute("aria-describedby");
    var tooltip = tooltipId && document.getElementById(tooltipId);
    if (tooltip) {
      hideSourceTooltip(tooltip);
      tooltip.remove();
    }
    badge.remove();
  }

  function setAnchorLost(node, lost, detail) {
    var badge = node.querySelector(".anchor-lost-badge");
    if (lost) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "anchor-lost-badge";

        var label = document.createElement("span");
        label.className = "anchor-lost-label";
        label.textContent = "Source not found";
        label.setAttribute("role", "status");
        badge.appendChild(label);

        var tooltipId = "source-not-found-" + node.getAttribute("data-annotation-id");
        var help = document.createElement("button");
        help.type = "button";
        help.className = "anchor-lost-help";
        help.textContent = "?";
        help.setAttribute("aria-label", "Why the source could not be found");
        help.setAttribute("aria-describedby", tooltipId);
        badge.appendChild(help);

        var tooltip = document.createElement("span");
        tooltip.id = tooltipId;
        tooltip.className = "anchor-lost-tooltip";
        tooltip.setAttribute("role", "tooltip");
        tooltip.textContent = detail || "The source changed, so this comment can no longer be linked to it.";
        node.appendChild(badge);
        document.body.appendChild(tooltip);

        help.addEventListener("mouseenter", function () {
          showSourceTooltip(help, tooltip);
        });
        help.addEventListener("mouseleave", function () {
          if (document.activeElement !== help) hideSourceTooltip(tooltip);
        });
        help.addEventListener("focus", function () {
          showSourceTooltip(help, tooltip);
        });
        help.addEventListener("blur", function () {
          hideSourceTooltip(tooltip);
        });
      } else {
        var existingHelp = badge.querySelector(".anchor-lost-help");
        var existingTooltipId = existingHelp && existingHelp.getAttribute("aria-describedby");
        var existingTooltip = existingTooltipId && document.getElementById(existingTooltipId);
        if (existingTooltip && detail) existingTooltip.textContent = detail;
      }
    } else {
      removeSourceNotFoundBadge(node);
    }
  }

  railScroll.addEventListener("scroll", function () {
    if (activeSourceTooltip) positionSourceTooltip(activeSourceTooltip.help, activeSourceTooltip.tooltip);
  });

  // Drafts float over the content near where the user just clicked/selected
  // (position: fixed, appended to document.body) rather than appearing in
  // the rail right away — only once "Add to queue" commits it does the same
  // node move into #rail-scroll (see addDraftToQueue). createBubbleShell is
  // only ever called to start a fresh draft, never reused for an
  // already-queued bubble, so it's safe to always build the floating form.
  function createBubbleShell() {
    var node = document.createElement("div");
    node.className = "bubble";
    node.style.background = "var(--card-bg)";
    node.style.color = "var(--card-fg)";
    node.style.border = "1px solid var(--card-border)";
    node.style.borderRadius = "8px";
    node.style.padding = "10px 12px";
    node.style.boxShadow = "var(--card-shadow)";
    node.style.fontSize = "13px";
    node.style.boxSizing = "border-box";
    node.style.marginBottom = "8px";
    node.style.position = "fixed";
    node.style.width = "260px";
    // Above the review highlights — a floating draft opened right
    // where the hover highlight box currently sits must never be covered by
    // it.
    node.style.zIndex = "var(--z-review-draft)";
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
    textarea.style.border = "1px solid var(--card-border)";
    textarea.style.borderRadius = "6px";
    textarea.style.padding = "6px 8px";
    textarea.style.fontSize = "13px";
    textarea.style.fontFamily = "inherit";
    textarea.style.resize = "vertical";
    textarea.style.background = "var(--draft-input-bg)";
    textarea.style.color = "var(--card-fg)";
    textarea.rows = 3;

    var footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.marginTop = "8px";

    var addBtn = document.createElement("button");
    addBtn.className = "bubble-add";
    addBtn.textContent = "Add";
    // Same look as the toolbar's Submit review button (var(--accent) fill).
    addBtn.style.background = "var(--accent)";
    addBtn.style.color = "var(--accent-ink)";
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
    if (draftBubble.type === "text-annotation") {
      removeTextHighlight(draftBubble.range);
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
    var lists = [queue, sentItems];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        if (lists[l][i].type === "text-annotation") {
          lists[l][i].lost = true;
        }
      }
    }
    if (textHighlightSet && textHighlightSet.clear) textHighlightSet.clear();
    if (textHighlightHoverSet && textHighlightHoverSet.clear) textHighlightHoverSet.clear();
    clearTextHighlightOverlay();
  }

  // ---- Text annotation re-anchoring after a reload ----
  //
  // Re-anchor inside nearestSelector first. An unchanged selectedText must
  // be unique within that element; if it was edited or appears more than
  // once, the locally captured before/after landmarks must identify exactly
  // one gap. There is no arbitrary character limit: the element itself is
  // the structural boundary. If the selector disappeared, only a globally
  // unique unchanged selectedText is safe enough to recover — never guess a
  // replacement from document-wide context.

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

  function resolveTextAnnotationRoot(item) {
    var doc = getIframeDoc();
    if (!doc) return null;
    if (item.shadowHost) {
      try {
        var host = doc.querySelector(item.shadowHost);
        if (host && host.shadowRoot) return host.shadowRoot;
        return null;
      } catch (e) {
        return null;
      }
    }
    return doc.documentElement || doc.body;
  }

  function resolveTextAnnotationScope(item, searchRoot) {
    if (!searchRoot || !item.nearestSelector) return null;
    try {
      var queryRoot = item.shadowHost ? searchRoot : searchRoot.ownerDocument;
      return queryRoot && queryRoot.querySelector(item.nearestSelector);
    } catch (e) {
      return null;
    }
  }

  function rangeFromOffsets(scopeRoot, index, start, end) {
    var startPoint = pointAtOffset(index, start);
    var endPoint = pointAtOffset(index, end);
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

  function occurrenceStarts(text, needle) {
    if (needle === "") return [0];
    var starts = [];
    var from = 0;
    var found;
    while ((found = text.indexOf(needle, from)) !== -1) {
      starts.push(found);
      from = found + Math.max(needle.length, 1);
    }
    return starts;
  }

  function findUniqueContextGap(text, context) {
    var before = (context && context.before) || "";
    var after = (context && context.after) || "";
    var beforeStarts = occurrenceStarts(text, before);
    var afterStarts = after === "" ? [text.length] : occurrenceStarts(text, after);
    var match = null;
    for (var i = 0; i < beforeStarts.length; i++) {
      var start = beforeStarts[i] + before.length;
      for (var j = 0; j < afterStarts.length; j++) {
        var end = afterStarts[j];
        if (end < start) continue;
        if (match) return null;
        match = { start: start, end: end };
      }
    }
    return match;
  }

  function captureLocalOffsets(range, scopeRoot) {
    if (!scopeRoot) return null;
    try {
      var beforeRange = range.cloneRange();
      beforeRange.collapse(true);
      beforeRange.setStart(scopeRoot, 0);
      var afterRange = range.cloneRange();
      afterRange.collapse(false);
      afterRange.setEnd(scopeRoot, scopeRoot.childNodes.length);
      return {
        start: beforeRange.toString().length,
        endFromScopeEnd: afterRange.toString().length,
      };
    } catch (e) {
      return null;
    }
  }

  function rangeFromWeakContextBoundary(item, scopeRoot, index) {
    var offsets = item.localOffsets;
    var context = item.localContext;
    if (!offsets || !context) return null;
    var before = context.before || "";
    var after = context.after || "";
    var beforeIsWeak = before.trim() === "";
    var afterIsWeak = after.trim() === "";
    var start;
    var end;

    // An edge selection may have only whitespace on one side. Use its saved
    // offset only when the opposite landmark is unique and the edge is still
    // whitespace-only; structural edits must remain lost rather than guessed.
    if (beforeIsWeak && !afterIsWeak) {
      end = findUniqueOccurrence(index.text, after);
      start = offsets.start;
      if (
        end === -1 ||
        index.text.slice(0, start).trim() !== "" ||
        index.text.slice(Math.max(0, start - before.length), start) !== before
      ) return null;
    } else if (afterIsWeak && !beforeIsWeak) {
      var beforeStart = findUniqueOccurrence(index.text, before);
      start = beforeStart === -1 ? -1 : beforeStart + before.length;
      end = index.text.length - offsets.endFromScopeEnd;
      if (
        start === -1 ||
        index.text.slice(end).trim() !== "" ||
        index.text.slice(end, end + after.length) !== after
      ) return null;
    } else {
      return null;
    }

    if (start < 0 || end < start || end > index.text.length) return null;
    return rangeFromOffsets(scopeRoot, index, start, end);
  }

  function tryReanchorTextAnnotation(item) {
    var searchRoot = resolveTextAnnotationRoot(item);
    if (!searchRoot) return null;
    var scopeRoot = resolveTextAnnotationScope(item, searchRoot);

    if (scopeRoot) {
      var localIndex = buildTextIndex(scopeRoot);
      var exactStart = findUniqueOccurrence(localIndex.text, item.selectedText || "");
      if (exactStart !== -1) {
        return rangeFromOffsets(scopeRoot, localIndex, exactStart, exactStart + item.selectedText.length);
      }

      if (item.localContext) {
        var gap = findUniqueContextGap(localIndex.text, item.localContext);
        if (gap) return rangeFromOffsets(scopeRoot, localIndex, gap.start, gap.end);
        var weakBoundaryRange = rangeFromWeakContextBoundary(item, scopeRoot, localIndex);
        if (weakBoundaryRange) return weakBoundaryRange;
      }
      return null;
    }

    var globalIndex = buildTextIndex(searchRoot);
    var globalStart = findUniqueOccurrence(globalIndex.text, item.selectedText || "");
    if (globalStart === -1) return null;
    return rangeFromOffsets(searchRoot, globalIndex, globalStart, globalStart + item.selectedText.length);
  }

  function reanchorLostTextAnnotations() {
    var lists = [queue, sentItems];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        var item = lists[l][i];
        if (item.type !== "text-annotation" || !item.lost) continue;
        var newRange = tryReanchorTextAnnotation(item);
        if (newRange) {
          item.range = newRange;
          item.lost = false;
          setAnchorLost(item.node, false);
          addTextHighlight(newRange);
        } else {
          setAnchorLost(item.node, true, TEXT_SOURCE_NOT_FOUND_DETAIL);
        }
      }
    }
  }

  function refreshSourceNotFoundStatuses() {
    var lists = [queue, sentItems];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        var item = lists[l][i];
        if (item.type === "text-annotation") {
          setAnchorLost(item.node, item.lost, TEXT_SOURCE_NOT_FOUND_DETAIL);
        } else if (item.type === "element-annotation") {
          setAnchorLost(item.node, !resolveAnnotationElement(item), ELEMENT_SOURCE_NOT_FOUND_DETAIL);
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
    var meBlock = buildMeBlock(comment);
    meBlock.style.paddingRight = "18px";
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
    node.appendChild(meBlock);
    node.appendChild(deleteBtn);

    var id = newAnnotationId();
    var item;
    if (draftBubble.type === "text-annotation") {
      item = {
        id: id,
        node: node,
        anchorY: draftBubble.anchorY,
        type: "text-annotation",
        selectedText: draftBubble.selectedText,
        context: draftBubble.context,
        localContext: draftBubble.localContext,
        localOffsets: draftBubble.localOffsets,
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
      if (item.type === "text-annotation") {
        removeTextHighlight(item.range);
      }
      removeFromQueue(id);
    });

    if (item.type === "text-annotation") {
      node.addEventListener("mouseenter", function () {
        currentHoverTarget = null;
        hideHighlight();
        if (item.lost) {
          setAnchorLost(node, true, TEXT_SOURCE_NOT_FOUND_DETAIL);
          return;
        }
        setAnchorLost(node, false);
        setTextHighlightHovered(item.range, true);
      });
      node.addEventListener("click", function (event) {
        if (bubbleClickTargetsControl(event) || item.lost) return;
        var anchorEl = nearestElementAncestor(item.range.commonAncestorContainer);
        if (anchorEl && anchorEl.scrollIntoView) anchorEl.scrollIntoView({ block: "center" });
      });
      node.addEventListener("mouseleave", function () {
        if (item.lost) return;
        setTextHighlightHovered(item.range, false);
      });
    } else {
      node.addEventListener("mouseenter", function () {
        currentHoverTarget = null;
        var el = resolveAnnotationElement(item);
        if (el) {
          setAnchorLost(node, false);
          positionHighlight(el);
        } else {
          setAnchorLost(node, true, ELEMENT_SOURCE_NOT_FOUND_DETAIL);
          hideHighlight();
        }
      });
      node.addEventListener("mouseleave", function () {
        hideHighlight();
      });
      node.addEventListener("click", function (event) {
        if (bubbleClickTargetsControl(event)) return;
        currentHoverTarget = null;
        var el = resolveAnnotationElement(item);
        if (!el) {
          setAnchorLost(node, true, ELEMENT_SOURCE_NOT_FOUND_DETAIL);
          hideHighlight();
          return;
        }
        setAnchorLost(node, false);
        if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
        positionHighlight(el);
      });
    }

    draftBubble = null;
    updateSubmitReviewLabel();
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
    removeSourceNotFoundBadge(queue[idx].node);
    queue[idx].node.remove();
    queue.splice(idx, 1);
    updateSubmitReviewLabel();
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

  function getTextContextWithin(range, ancestorEl) {
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

    return getTextContextWithin(range, ancestorEl);
  }

  function openTextDraftBubble(range) {
    if (draftBubble) closeDraftBubble();

    var selectedText = range.toString();
    var ancestorEl = nearestElementAncestor(range.commonAncestorContainer);
    var context = getTextContext(range);
    var localContext = getTextContextWithin(range, ancestorEl);
    var localOffsets = captureLocalOffsets(range, ancestorEl);
    var nearestSelectorResult = ancestorEl ? generateSelector(ancestorEl) : { selector: null, shadowHost: null };

    addTextHighlight(range);

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
      localContext: localContext,
      localOffsets: localOffsets,
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
          localContext: item.localContext,
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

    var replyBtnRow = document.createElement("div");
    replyBtnRow.className = "followup-reply-row";
    replyBtnRow.style.display = "flex";
    replyBtnRow.style.justifyContent = "flex-end";
    replyBtnRow.style.marginTop = "8px";

    var replyBtn = document.createElement("button");
    replyBtn.className = "followup-reply-btn";
    replyBtn.textContent = "Reply";
    replyBtn.style.background = "var(--accent)";
    replyBtn.style.color = "var(--accent-ink)";
    replyBtn.style.border = "none";
    replyBtn.style.borderRadius = "6px";
    replyBtn.style.padding = "4px 12px";
    replyBtn.style.fontSize = "12px";
    replyBtn.style.cursor = "pointer";
    replyBtnRow.appendChild(replyBtn);
    node.appendChild(replyBtnRow);
    if (node.classList.contains("bubble-collapsed")) replyBtnRow.style.display = "none";

    replyBtn.addEventListener("click", function () {
      if (documentReadOnly) return;
      replyBtnRow.remove();

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
      if (node.classList.contains("bubble-collapsed")) {
        wrap.style.display = "none";
      } else {
        controls.textarea.focus();
      }
    });
  }

  function queueFollowUp(rootId, text, node) {
    var id = newAnnotationId();
    threadRootById[id] = rootId;
    var item = {
      id: id,
      node: null,
      type: "follow-up",
      replyToId: rootId,
      comment: text,
    };
    queue.push(item);
    appendFollowUpToThread(node, text);
    updateSubmitReviewLabel();
  }

  // Collapsing a sent bubble hides everything except the original "ME"
  // comment at the top — the thread history and the reply controls
  // (whichever of the collapsed Reply button or the expanded textarea is
  // currently showing). Direct style.display toggling, not a CSS class,
  // matching this file's existing show/hide convention (e.g. applyRailWidth)
  // — a class-based rule would be overridden by inline styles already set
  // on these same elements (e.g. .followup-reply-row's own display: flex).
  function setBubbleCollapsed(node, collapsed) {
    // A class purely as a state flag (queried, not styled by CSS) — lets
    // thread/reply-control elements created or recreated *while* collapsed
    // (a new agent reply, cancelling out of an expanded follow-up form)
    // start out hidden too, instead of only the elements alive at toggle time.
    node.classList.toggle("bubble-collapsed", collapsed);
    var thread = node.querySelector(".bubble-thread");
    var replyRow = node.querySelector(".followup-reply-row");
    var controls = node.querySelector(".followup-controls");
    if (thread) thread.style.display = collapsed ? "none" : "block";
    if (replyRow) replyRow.style.display = collapsed ? "none" : "flex";
    if (controls) controls.style.display = collapsed ? "none" : "block";
    var toggleBtn = node.querySelector(".bubble-collapse-toggle");
    if (toggleBtn) toggleBtn.textContent = collapsed ? "+" : "−";
  }

  function markBubbleSent(node) {
    var deleteBtn = node.querySelector(".bubble-delete");
    if (deleteBtn) deleteBtn.remove();
    node.classList.add("bubble-sent");
    node.style.background = "var(--card-sent-bg)";
    addFollowUpControls(node, node.getAttribute("data-annotation-id"));

    var collapseBtn = document.createElement("button");
    collapseBtn.className = "bubble-collapse-toggle";
    collapseBtn.title = "Collapse this comment";
    collapseBtn.textContent = "−";
    collapseBtn.style.position = "absolute";
    collapseBtn.style.top = "6px";
    collapseBtn.style.right = "6px";
    collapseBtn.style.width = "20px";
    collapseBtn.style.height = "20px";
    collapseBtn.style.lineHeight = "18px";
    collapseBtn.style.border = "none";
    collapseBtn.style.background = "transparent";
    collapseBtn.style.color = "var(--chrome-dim)";
    collapseBtn.style.fontSize = "16px";
    collapseBtn.style.cursor = "pointer";
    collapseBtn.style.borderRadius = "4px";
    collapseBtn.style.padding = "0";
    collapseBtn.addEventListener("click", function () {
      setBubbleCollapsed(node, collapseBtn.textContent === "−");
    });
    node.appendChild(collapseBtn);
  }

  function showSendFailure(message) {
    statusText.textContent = message;
    window.setTimeout(function () {
      if (dot.classList.contains("disconnected")) return;
      statusText.textContent = "";
    }, 3000);
  }

  submitReviewButton.addEventListener("click", function () {
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
          var item = queue[i];
          // A follow-up's own id never receives a reply — the agent always
          // replies to the thread's root id — so track that instead.
          pendingReplyIds[item.type === "follow-up" ? item.replyToId : item.id] = true;
          // Follow-up items have no bubble of their own (queueFollowUp
          // already rendered the message inline into the root bubble's
          // thread) — only new-annotation items go through the normal
          // sent/history bubble lifecycle.
          if (item.type === "follow-up") continue;
          markBubbleSent(item.node);
          sentItems.push(item);
        }
        queue.length = 0;
        updateSubmitReviewLabel();
        updateReplySpinner();
        layoutBubbles();
      })
      .catch(function () {
        showSendFailure("Send failed — network error");
      });
  });

  function enterReadOnlyMode() {
    documentReadOnly = true;
    documentConfirmed = true;
    approveButton.disabled = true;
    approveButton.textContent = "Confirmed";
    submitReviewButton.disabled = true;
    if (reviewOn) {
      reviewOn = false;
      reviewSwitch.setAttribute("data-on", "false");
      detachOverlayListeners();
      detachSelectionListeners();
    }
    reviewSwitch.style.pointerEvents = "none";
    reviewSwitch.style.opacity = "0.5";
  }

  approveButton.addEventListener("click", function () {
    if (queue.length > 0) {
      showSendFailure("Send or clear the queue first");
      return;
    }
    confirmModalBackdrop.classList.add("visible");
  });

  confirmModalCancel.addEventListener("click", function () {
    confirmModalBackdrop.classList.remove("visible");
  });

  confirmModalOk.addEventListener("click", function () {
    confirmModalBackdrop.classList.remove("visible");
    fetch("/confirm-document", { method: "POST" })
      .then(function (res) {
        if (!res.ok) {
          showSendFailure("Confirm failed — please retry");
          return;
        }
        enterReadOnlyMode();
      })
      .catch(function () {
        showSendFailure("Confirm failed — network error");
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
    var target = getReviewTarget(e.target);
    if (!target) return;
    openDraftBubble(target, e.clientX, e.clientY);
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
    refreshSourceNotFoundStatuses();
  });
  if (reviewOn) attachOverlayListeners();
  attachSelectionListeners();

  reviewSwitch.addEventListener("click", function () {
    reviewOn = !reviewOn;
    reviewSwitch.setAttribute("data-on", reviewOn ? "true" : "false");
    if (reviewOn) {
      attachOverlayListeners();
      attachSelectionListeners();
    } else {
      detachOverlayListeners();
      detachSelectionListeners();
    }
  });

  window.addEventListener("resize", function () {
    refreshHighlightPosition();
    if (activeSourceTooltip) positionSourceTooltip(activeSourceTooltip.help, activeSourceTooltip.tooltip);
    scheduleTextHighlightOverlayRefresh();
  });
})();
`;
}
