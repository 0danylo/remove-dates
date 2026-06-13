/*
 * make-icons.js
 *
 * Generates the toolbar icons (16/32/48/128 px) with no external dependencies.
 * Each icon is drawn natively at its target size with 4x4 supersampled
 * anti-aliasing, then encoded as a PNG using Node's built-in zlib.
 *
 * Run: `node tools/make-icons.js`
 *
 * The artwork is a calendar page with a red diagonal slash through it -
 * "no dates".
 */
"use strict";

var zlib = require("zlib");
var fs = require("fs");
var path = require("path");

/* ----------------------------- PNG encoding ------------------------------ */
var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var typeBuf = Buffer.from(type, "ascii");
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // raw image data: each row prefixed with a filter-type byte (0 = none)
  var stride = width * 4;
  var raw = Buffer.alloc((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  var idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ------------------------------- drawing --------------------------------- */
var BLUE = [59, 130, 246, 255];
var DARK = [30, 58, 138, 255];
var WHITE = [255, 255, 255, 255];
var DOT = [191, 203, 220, 255];
var RED = [225, 45, 38, 255];

function inRR(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) {
    return false;
  }
  var cx = Math.min(Math.max(x, x0 + r), x1 - r);
  var cy = Math.min(Math.max(y, y0 + r), y1 - r);
  var dx = x - cx;
  var dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// distance from point to line segment AB
function distSeg(px, py, ax, ay, bx, by) {
  var dx = bx - ax;
  var dy = by - ay;
  var len2 = dx * dx + dy * dy;
  var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  var qx = ax + t * dx;
  var qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

// "src over dst" alpha compositing, colors as [r,g,b,a] with a in 0..255
function over(dst, src) {
  var sa = src[3] / 255;
  var da = dst[3] / 255;
  var oa = sa + da * (1 - sa);
  if (oa === 0) {
    return [0, 0, 0, 0];
  }
  function ch(i) {
    return (src[i] * sa + dst[i] * da * (1 - sa)) / oa;
  }
  return [ch(0), ch(1), ch(2), oa * 255];
}

// Returns the composited colour at normalized point (x, y), 0..1.
function sample(x, y) {
  var c = [0, 0, 0, 0];

  // background rounded square
  if (inRR(x, y, 0.05, 0.05, 0.95, 0.95, 0.22)) {
    c = over(c, BLUE);
  }

  // binding tabs (drawn behind the body so the body covers their lower half)
  if (
    inRR(x, y, 0.33, 0.26, 0.39, 0.37, 0.03) ||
    inRR(x, y, 0.61, 0.26, 0.67, 0.37, 0.03)
  ) {
    c = over(c, DARK);
  }

  // calendar body (white)
  if (inRR(x, y, 0.24, 0.32, 0.76, 0.8, 0.05)) {
    c = over(c, WHITE);

    // header strip
    if (y <= 0.45) {
      c = over(c, DARK);
    } else {
      // day cells: 3 columns x 2 rows
      var cols = [0.34, 0.5, 0.66];
      var rows = [0.57, 0.71];
      for (var ci = 0; ci < cols.length; ci++) {
        for (var ri = 0; ri < rows.length; ri++) {
          if (
            inRR(
              x,
              y,
              cols[ci] - 0.045,
              rows[ri] - 0.045,
              cols[ci] + 0.045,
              rows[ri] + 0.045,
              0.015
            )
          ) {
            c = over(c, DOT);
          }
        }
      }
    }
  }

  // red slash with a white halo for separation
  var d = distSeg(x, y, 0.17, 0.83, 0.83, 0.17);
  if (d <= 0.085) {
    c = over(c, WHITE);
  }
  if (d <= 0.055) {
    c = over(c, RED);
  }

  return c;
}

function renderIcon(size) {
  var SS = 4; // supersampling factor per axis
  var rgba = Buffer.alloc(size * size * 4);
  for (var py = 0; py < size; py++) {
    for (var px = 0; px < size; px++) {
      var r = 0;
      var g = 0;
      var b = 0;
      var a = 0;
      for (var sy = 0; sy < SS; sy++) {
        for (var sx = 0; sx < SS; sx++) {
          var nx = (px + (sx + 0.5) / SS) / size;
          var ny = (py + (sy + 0.5) / SS) / size;
          var col = sample(nx, ny);
          r += col[0] * col[3];
          g += col[1] * col[3];
          b += col[2] * col[3];
          a += col[3];
        }
      }
      var idx = (py * size + px) * 4;
      if (a > 0) {
        rgba[idx] = Math.round(r / a);
        rgba[idx + 1] = Math.round(g / a);
        rgba[idx + 2] = Math.round(b / a);
      }
      rgba[idx + 3] = Math.round(a / (SS * SS));
    }
  }
  return encodePNG(size, size, rgba);
}

/* ------------------------------- output ---------------------------------- */
var outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach(function (size) {
  var png = renderIcon(size);
  var file = path.join(outDir, "icon" + size + ".png");
  fs.writeFileSync(file, png);
  console.log("wrote " + file + " (" + png.length + " bytes)");
});
