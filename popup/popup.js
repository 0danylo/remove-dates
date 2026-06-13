/*
 * popup.js
 *
 * Wires up the two toggles (master switch + per-site opt-out) and shows how
 * many dates were removed on the current page. Any change is persisted to
 * chrome.storage and the active tab is reloaded so it takes effect.
 */
"use strict";

var enabledEl = document.getElementById("enabled");
var siteEl = document.getElementById("siteDisabled");
var siteRow = document.getElementById("siteRow");
var hostEl = document.getElementById("host");
var countEl = document.getElementById("count");

var state = {
  enabled: true,
  disabledSites: [],
  host: null,
  tabId: null
};

function hostnameOf(url) {
  try {
    var u = new URL(url);
    // Only http(s) pages get a meaningful per-site toggle.
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u.hostname;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function render() {
  enabledEl.checked = state.enabled !== false;

  var siteDisabled =
    state.host !== null && state.disabledSites.indexOf(state.host) !== -1;
  siteEl.checked = siteDisabled;

  // The per-site row only makes sense on a real http(s) page with the master
  // switch on.
  var siteToggleUsable = state.host !== null && state.enabled !== false;
  siteEl.disabled = !siteToggleUsable;
  siteRow.style.opacity = state.host !== null ? "1" : "0.5";
  hostEl.textContent = state.host || "not available here";
}

function setCount(n) {
  if (n > 0) {
    countEl.innerHTML =
      "<strong>" + n + "</strong> date" + (n === 1 ? "" : "s") +
      " removed on this page";
  } else {
    countEl.textContent = "No dates found on this page";
  }
}

function save(changes, cb) {
  chrome.storage.local.set(changes, function () {
    if (cb) {
      cb();
    }
  });
}

function reloadActiveTab() {
  if (state.tabId !== null) {
    chrome.tabs.reload(state.tabId);
  }
  window.close();
}

enabledEl.addEventListener("change", function () {
  state.enabled = enabledEl.checked;
  render();
  save({ enabled: state.enabled }, reloadActiveTab);
});

siteEl.addEventListener("change", function () {
  if (state.host === null) {
    return;
  }
  var list = state.disabledSites.slice();
  var idx = list.indexOf(state.host);
  if (siteEl.checked && idx === -1) {
    list.push(state.host);
  } else if (!siteEl.checked && idx !== -1) {
    list.splice(idx, 1);
  }
  state.disabledSites = list;
  save({ disabledSites: list }, reloadActiveTab);
});

// Bootstrap: read settings, identify the active tab, ask it for a count.
chrome.storage.local.get(
  { enabled: true, disabledSites: [] },
  function (cfg) {
    state.enabled = cfg.enabled;
    state.disabledSites = Array.isArray(cfg.disabledSites)
      ? cfg.disabledSites
      : [];

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (tab) {
        state.tabId = tab.id;
        state.host = hostnameOf(tab.url || "");
      }
      render();

      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: "getStatus" }, function (resp) {
          if (chrome.runtime.lastError || !resp) {
            // Content script isn't running here (disabled, or a page we can't
            // touch such as chrome://).
            countEl.textContent = state.enabled
              ? "Not active on this page"
              : "Turned off";
            return;
          }
          setCount(resp.count || 0);
        });
      } else {
        countEl.textContent = "";
      }
    });
  }
);
