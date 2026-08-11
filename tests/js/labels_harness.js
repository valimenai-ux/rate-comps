"use strict";
/**
 * Node harness for the RCLabels collision engine (run by test_js_labels.py).
 * Exits non-zero with a FAIL message when any property is violated.
 */
var path = require("path");
var RCLabels = require(path.join(__dirname, "..", "..", "src", "static", "js", "labels.js"));

var failures = 0;
function check(condition, message) {
  if (!condition) {
    console.error("FAIL: " + message);
    failures += 1;
  }
}

var BOUNDS = { left: 0, right: 800, top: 0, bottom: 400 };
var GAP = 3;

function overlapCount(boxes, centers) {
  var n = boxes.length;
  var count = 0;
  for (var i = 0; i < n; i++) {
    for (var j = i + 1; j < n; j++) {
      var dx = Math.abs(centers[i].cx - centers[j].cx);
      var dy = Math.abs(centers[i].cy - centers[j].cy);
      var overlapX = dx < (boxes[i].w + boxes[j].w) / 2 - 0.5;
      var overlapY = dy < (boxes[i].h + boxes[j].h) / 2 - 0.5;
      if (overlapX && overlapY) { count += 1; }
    }
  }
  return count;
}

function inBounds(boxes, centers) {
  return centers.every(function (c, i) {
    return c.cy >= BOUNDS.top + boxes[i].h / 2 - 0.5 &&
      c.cy <= BOUNDS.bottom - boxes[i].h / 2 + 0.5 &&
      c.cx >= BOUNDS.left + boxes[i].w / 2 - 0.5 &&
      c.cx <= BOUNDS.right - boxes[i].w / 2 + 0.5;
  });
}

// 1. Five identical labels stacked on the same point: worst-case pileup.
var pile = [];
for (var i = 0; i < 5; i++) {
  pile.push({ x: 300, y: 200, w: 30, h: 14, kind: "point" });
}
var out1 = RCLabels.layout(pile, BOUNDS, { gap: GAP });
var out2 = RCLabels.layout(pile, BOUNDS, { gap: GAP });
check(JSON.stringify(out1) === JSON.stringify(out2), "same input must give identical output");
check(overlapCount(pile, out1) === 0, "pileup: no residual overlaps");
check(inBounds(pile, out1), "pileup: everything inside plot bounds");

// 2. Converging line ends near the right edge (the classic Excel failure).
var ends = [
  { x: 700, y: 100, w: 40, h: 14, kind: "end" },
  { x: 700, y: 104, w: 40, h: 14, kind: "end" },
  { x: 700, y: 108, w: 40, h: 14, kind: "end" },
  { x: 700, y: 112, w: 40, h: 14, kind: "end" }
];
var outEnds = RCLabels.layout(ends, BOUNDS, { gap: GAP });
check(overlapCount(ends, outEnds) === 0, "line ends: no overlaps");
check(inBounds(ends, outEnds), "line ends: clamped inside bounds");
for (var k = 1; k < outEnds.length; k++) {
  check(outEnds[k].cy > outEnds[k - 1].cy, "line ends: vertical order preserved");
}

// 3. Cluster jammed against the top bound must be pushed down, in order.
var top = [
  { x: 500, y: 6, w: 30, h: 14, kind: "point" },
  { x: 500, y: 8, w: 30, h: 14, kind: "point" },
  { x: 500, y: 10, w: 30, h: 14, kind: "point" }
];
var outTop = RCLabels.layout(top, BOUNDS, { gap: GAP });
check(overlapCount(top, outTop) === 0, "top clamp: no overlaps");
check(inBounds(top, outTop), "top clamp: inside bounds");

// 4. Mixed kinds at the same x: point labels and an end label share a cluster.
var mixed = [
  { x: 400, y: 200, w: 32, h: 14, kind: "point" },
  { x: 396, y: 205, w: 32, h: 14, kind: "point" },
  { x: 404, y: 210, w: 32, h: 14, kind: "end" },
  { x: 400, y: 215, w: 32, h: 14, kind: "point" }
];
var outMixed = RCLabels.layout(mixed, BOUNDS, { gap: GAP });
check(overlapCount(mixed, outMixed) === 0, "mixed kinds: no overlaps");

// 5. Far-apart labels stay at their preferred spots (no needless nudging).
var lonely = [
  { x: 100, y: 100, w: 30, h: 14, kind: "point" },
  { x: 600, y: 300, w: 30, h: 14, kind: "point" }
];
var outLonely = RCLabels.layout(lonely, BOUNDS, { gap: GAP });
check(outLonely[0].cy === 100 - RCLabels.POINT_GAP - 7, "lonely labels keep the default above position");
check(outLonely[1].cx === 600, "lonely labels are not shifted horizontally");

// 6. Labels wider than the remaining right margin are pulled inside.
var edge = [{ x: 795, y: 200, w: 40, h: 14, kind: "end" }];
var outEdge = RCLabels.layout(edge, BOUNDS, { gap: GAP });
check(inBounds(edge, outEdge), "edge label clamped horizontally");

// 7. Seam scenario: near-identical anchors (two exactly tied), mid-plot so
// bounds don't interfere - labels must split above/below and no point label
// may sit across its own marker.
var seam = [
  { x: 400, y: 176, w: 32, h: 18, kind: "point" },
  { x: 400, y: 185, w: 32, h: 18, kind: "point" },
  { x: 400, y: 185, w: 32, h: 18, kind: "point" }
];
var outSeam = RCLabels.layout(seam, BOUNDS, { gap: GAP });
check(overlapCount(seam, outSeam) === 0, "seam: no overlaps");
outSeam.forEach(function (c, i) {
  var clearsAnchor = Math.abs(c.cy - seam[i].y) >= seam[i].h / 2 + 4;
  check(clearsAnchor, "seam: label " + i + " does not sit across its own marker");
});
check(outSeam[1].cy < seam[1].y && outSeam[2].cy > seam[2].y,
  "seam: tied anchors split above and below");

if (failures > 0) {
  process.exit(1);
}
console.log("ok - all label engine properties hold");
