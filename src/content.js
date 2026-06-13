/*
 * content.js
 *
 * Walks the page, strips dates/times out of visible text (and a few telltale
 * attributes), and keeps doing so as the page mutates. The actual matching
 * lives in date-stripper.js, which is injected before this file.
 */
(function () {
  "use strict";

  // Don't run twice in the same frame.
  if (window.__removeDatesActive) {
    return;
  }
  window.__removeDatesActive = true;

  var stripDates = (self.DateStripper && self.DateStripper.stripDates) || null;
  if (!stripDates) {
    return;
  }

  // Containers whose text we must not touch (scripts, code, editable fields,
  // preformatted blocks where whitespace is significant).
  var SKIP_SELECTOR =
    "script,style,noscript,template,textarea,pre,code,kbd,samp,select," +
    "option,[contenteditable=''],[contenteditable=true]";
  var ATTR_SELECTOR = "[title],[aria-label],[alt],[datetime]";
  var TEXT_ATTRS = ["title", "aria-label", "alt"];
  // Quick reject: nodes with no letter or digit can't contain a date.
  var HAS_CONTENT = /[0-9A-Za-z]/;

  var total = 0; // running count of fragments removed in this frame
  var lastSent = -1;
  var flushQueued = false;

  function skipParent(parent) {
    if (!parent || parent.nodeType !== 1) {
      return !parent;
    }
    if (parent.isContentEditable) {
      return true;
    }
    return parent.closest(SKIP_SELECTOR) !== null;
  }

  function processText(node) {
    var val = node.nodeValue;
    if (!val || val.length < 2 || !HAS_CONTENT.test(val)) {
      return;
    }
    if (skipParent(node.parentNode)) {
      return;
    }
    var res = stripDates(val);
    if (res.removed > 0 && res.text !== val) {
      node.nodeValue = res.text;
      total += res.removed;
      scheduleFlush();
    }
  }

  function processAttrs(el) {
    for (var i = 0; i < TEXT_ATTRS.length; i++) {
      var name = TEXT_ATTRS[i];
      var v = el.getAttribute(name);
      if (v) {
        var res = stripDates(v);
        if (res.removed > 0 && res.text !== v) {
          el.setAttribute(name, res.text);
          total += res.removed;
          scheduleFlush();
        }
      }
    }
    // `datetime` (on <time>, <ins>, <del>) is a machine-readable date - drop it.
    if (el.hasAttribute("datetime")) {
      el.removeAttribute("datetime");
      total += 1;
      scheduleFlush();
    }
  }

  var textFilter = {
    acceptNode: function (node) {
      return skipParent(node.parentNode)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }
  };

  function processSubtree(node) {
    if (node.nodeType === 3) {
      processText(node);
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    // Skip the whole subtree if this element is a no-touch container.
    if (node.matches && node.matches(SKIP_SELECTOR)) {
      return;
    }

    // Collect text nodes first, then mutate (keeps the walker stable).
    var walker = document.createTreeWalker(
      node,
      NodeFilter.SHOW_TEXT,
      textFilter
    );
    var batch = [];
    var t;
    while ((t = walker.nextNode())) {
      batch.push(t);
    }
    for (var i = 0; i < batch.length; i++) {
      processText(batch[i]);
    }

    // Attributes on the node itself and its descendants.
    if (node.matches && node.matches(ATTR_SELECTOR)) {
      processAttrs(node);
    }
    var withAttrs = node.querySelectorAll(ATTR_SELECTOR);
    for (var j = 0; j < withAttrs.length; j++) {
      processAttrs(withAttrs[j]);
    }
  }

  // ---- badge / popup plumbing --------------------------------------------
  function scheduleFlush() {
    if (flushQueued) {
      return;
    }
    flushQueued = true;
    // Coalesce bursts of removals into a single message. Call through `window`
    // so the scheduler keeps its correct `this` binding.
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(flush);
    } else {
      window.setTimeout(flush, 0);
    }
  }

  function flush() {
    flushQueued = false;
    if (total === lastSent) {
      return;
    }
    lastSent = total;
    try {
      chrome.runtime.sendMessage({ type: "count", count: total });
    } catch (e) {
      /* extension context may be gone; ignore */
    }
  }

  function start() {
    processSubtree(document.documentElement);
    flush();

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "characterData") {
          processText(m.target);
        } else if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) {
            processSubtree(m.addedNodes[j]);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Answer the popup's status request.
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === "getStatus") {
        sendResponse({
          active: true,
          count: total,
          host: location.hostname
        });
      }
    });
  }

  // Respect the master switch and the per-site opt-out before doing anything.
  try {
    chrome.storage.local.get(
      { enabled: true, disabledSites: [] },
      function (cfg) {
        if (chrome.runtime.lastError) {
          start();
          return;
        }
        if (cfg.enabled === false) {
          return;
        }
        if (
          Array.isArray(cfg.disabledSites) &&
          cfg.disabledSites.indexOf(location.hostname) !== -1
        ) {
          return;
        }
        start();
      }
    );
  } catch (e) {
    // storage unavailable for some reason - default to active.
    start();
  }
})();
