/*
 * Integration test for content.js against a hand-rolled minimal DOM.
 *
 * jsdom isn't available, so this stubs exactly the browser APIs content.js
 * touches (TreeWalker, matches/closest/querySelectorAll, attributes,
 * isContentEditable, chrome.*) and then loads the real content script to make
 * sure the wiring - skip rules, attribute handling, <time>/datetime, etc. -
 * actually works.
 *
 * Run: `node test/content.integration.test.js`
 */
"use strict";

var assert = require("assert");
var path = require("path");

/* ------------------------------ tiny DOM --------------------------------- */
var NodeFilter = {
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3
};

function matchSimple(node, sel) {
  sel = sel.trim();
  if (sel.charAt(0) === "[") {
    var m = /^\[([^\]=]+)(?:=(?:'([^']*)'|"([^"]*)"|([^\]]*)))?\]$/.exec(sel);
    if (!m) {
      return false;
    }
    var name = m[1];
    if (!node.hasAttribute(name)) {
      return false;
    }
    var hasVal = m[2] !== undefined || m[3] !== undefined || m[4] !== undefined;
    if (!hasVal) {
      return true;
    }
    var val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    return node.getAttribute(name) === val;
  }
  return node.tagName === sel.toUpperCase();
}

function Element(tag) {
  this.nodeType = 1;
  this.tagName = tag.toUpperCase();
  this.attributes = {};
  this.childNodes = [];
  this.parentNode = null;
}
Element.prototype.appendChild = function (n) {
  n.parentNode = this;
  this.childNodes.push(n);
  return n;
};
Element.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attributes, k)
    ? this.attributes[k]
    : null;
};
Element.prototype.setAttribute = function (k, v) {
  this.attributes[k] = String(v);
};
Element.prototype.hasAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attributes, k);
};
Element.prototype.removeAttribute = function (k) {
  delete this.attributes[k];
};
Element.prototype.matches = function (selector) {
  var parts = selector.split(",");
  for (var i = 0; i < parts.length; i++) {
    if (matchSimple(this, parts[i])) {
      return true;
    }
  }
  return false;
};
Element.prototype.closest = function (selector) {
  var n = this;
  while (n && n.nodeType === 1) {
    if (n.matches(selector)) {
      return n;
    }
    n = n.parentNode;
  }
  return null;
};
Element.prototype.querySelectorAll = function (selector) {
  var parts = selector.split(",");
  var out = [];
  (function walk(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 1) {
        for (var j = 0; j < parts.length; j++) {
          if (matchSimple(c, parts[j])) {
            out.push(c);
            break;
          }
        }
        walk(c);
      }
    }
  })(this);
  return out;
};
Object.defineProperty(Element.prototype, "isContentEditable", {
  get: function () {
    var n = this;
    while (n && n.nodeType === 1) {
      if (Object.prototype.hasOwnProperty.call(n.attributes, "contenteditable")) {
        var v = n.attributes.contenteditable;
        return v === "" || v === "true";
      }
      n = n.parentNode;
    }
    return false;
  }
});

function Text(value) {
  this.nodeType = 3;
  this.nodeValue = value;
  this.parentNode = null;
}

function createTreeWalker(root, show, filter) {
  var nodes = [];
  (function collect(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 3) {
        if (show & NodeFilter.SHOW_TEXT) {
          var r = filter ? filter.acceptNode(c) : NodeFilter.FILTER_ACCEPT;
          if (r === NodeFilter.FILTER_ACCEPT) {
            nodes.push(c);
          }
        }
      } else if (c.nodeType === 1) {
        collect(c);
      }
    }
  })(root);
  var idx = -1;
  return {
    nextNode: function () {
      idx++;
      return idx < nodes.length ? nodes[idx] : null;
    }
  };
}

/* --------------------------- build a fake page --------------------------- */
function el(tag, attrs, children) {
  var e = new Element(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      e.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach(function (c) {
    e.appendChild(typeof c === "string" ? new Text(c) : c);
  });
  return e;
}

var title = el("title", null, ["News - January 1, 2024"]);
var script = el("script", null, ['var d="2024-01-01";']);
var head = el("head", null, [title, script]);

var p = el("p", null, ["Posted on January 15, 2024 at 3:45 PM"]);
var pre = el("pre", null, ["build 2024-01-01 release"]);
var editable = el("div", { contenteditable: "true" }, ["Draft 2024-02-02"]);
var time = el("time", { datetime: "2024-01-15" }, ["Jan 15, 2024"]);
var img = el("img", { alt: "Photo from 2023-05-05", title: "Taken 2 days ago" });
var code = el("code", null, ["release 2020-01-01"]);
var keep = el("p", null, ["Highway 101, room 1/2, ratio 16:9"]);
var body = el("body", null, [p, pre, editable, time, img, code, keep]);
var html = el("html", null, [head, body]);

var document = { createTreeWalker: createTreeWalker, documentElement: html };

/* ----------------------------- browser stubs ----------------------------- */
var sentCounts = [];
var chrome = {
  storage: {
    local: {
      get: function (defaults, cb) {
        cb(defaults);
      }
    }
  },
  runtime: {
    lastError: undefined,
    sendMessage: function (msg) {
      if (msg && msg.type === "count") {
        sentCounts.push(msg.count);
      }
    },
    onMessage: { addListener: function () {} }
  }
};

global.window = global;
global.self = global;
global.document = document;
global.chrome = chrome;
global.location = { hostname: "example.com" };
global.NodeFilter = NodeFilter;
global.MutationObserver = function () {
  this.observe = function () {};
  this.disconnect = function () {};
};
global.requestAnimationFrame = function (cb) {
  cb();
};

/* ------------------------- load the real scripts ------------------------- */
require(path.join(__dirname, "..", "src", "date-stripper.js"));
require(path.join(__dirname, "..", "src", "content.js"));

/* ------------------------------- assertions ------------------------------ */
var pass = 0;
var fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL: " + name);
  }
}
function text(node) {
  return node.childNodes[0].nodeValue;
}

// stripped
check("title stripped", !/2024|January/.test(text(title)));
check(
  "paragraph date+time stripped",
  !/2024|January|3:45|PM/.test(text(p)) && /Posted on/.test(text(p))
);
check("time element text stripped", !/2024|Jan/.test(text(time)));
check("time datetime attr removed", !time.hasAttribute("datetime"));
check("img alt stripped", !/2023/.test(img.getAttribute("alt")));
check(
  "img title stripped",
  !/days ago/.test(img.getAttribute("title")) &&
    !/\b2\b/.test(img.getAttribute("title"))
);

// preserved (skip rules)
check("script untouched", text(script) === 'var d="2024-01-01";');
check("pre untouched", text(pre) === "build 2024-01-01 release");
check("contenteditable untouched", text(editable) === "Draft 2024-02-02");
check("code untouched", text(code) === "release 2020-01-01");

// no false positives
check(
  "non-dates preserved",
  text(keep) === "Highway 101, room 1/2, ratio 16:9"
);

// badge plumbing fired
check("count message sent", sentCounts.length > 0 && sentCounts[sentCounts.length - 1] > 0);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) {
  process.exit(1);
}
