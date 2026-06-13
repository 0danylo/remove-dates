/*
 * background.js (service worker)
 *
 * The only job here is to mirror each tab's "dates removed" count onto the
 * toolbar icon as a badge. Badges are inherently per-tab and reset when a tab
 * navigates, so there's no extra bookkeeping to do.
 */
"use strict";

chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== "count" || !sender.tab) {
    return;
  }
  var tabId = sender.tab.id;
  var text = msg.count > 0 ? String(msg.count) : "";
  chrome.action.setBadgeText({ tabId: tabId, text: text });
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#D33A2C" });
});
