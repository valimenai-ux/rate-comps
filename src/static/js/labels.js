"use strict";
/**
 * RCLabels - deterministic pixel-space label layout (the collision engine).
 *
 * Pure geometry: no DOM, no Plotly, no randomness. The same input always
 * produces the same output, so re-renders are stable.
 *
 * A label is a rectangle tied to an anchor point (its data point in pixels):
 *   kind "point": sits above the anchor by default, may flip below;
 *   kind "end":   sits to the right of the anchor, vertically centered.
 *
 * layout(boxes, bounds, opts):
 *   boxes  - [{x, y, w, h, kind}] anchor pixel coords + measured box size
 *   bounds - {left, right, top, bottom} plot area in pixels
 *   opts   - {gap} minimum vertical clearance between boxes (default 3)
 *   returns [{cx, cy}] final box centers, same order as `boxes`.
 *
 * Algorithm: cluster labels whose horizontal extents overlap, choose
 * above/below per label against the cluster's median anchor (top half up,
 * bottom half down - mirrors how the house Excel charts spread values),
 * then run a three-pass min-gap sweep on box centers, clamped to the plot.
 */
var RCLabels = (function () {
  var POINT_GAP = 9; // px between a data point and its label box edge
  var END_GAP = 8;   // px between a line end and its label box edge

  function clamp(v, lo, hi) {
    if (hi < lo) { return lo; }
    return Math.min(hi, Math.max(lo, v));
  }

  function defaultCenter(box) {
    if (box.kind === "end") {
      return { cx: box.x + END_GAP + box.w / 2, cy: box.y };
    }
    return { cx: box.x, cy: box.y - POINT_GAP - box.h / 2 };
  }

  /** Group indices whose horizontal intervals [cx-w/2, cx+w/2] overlap. */
  function clusterize(boxes, centers) {
    var order = boxes.map(function (_, i) { return i; });
    order.sort(function (a, b) {
      var la = centers[a].cx - boxes[a].w / 2;
      var lb = centers[b].cx - boxes[b].w / 2;
      if (la !== lb) { return la - lb; }
      if (boxes[a].y !== boxes[b].y) { return boxes[a].y - boxes[b].y; }
      return a - b;
    });
    var clusters = [];
    var current = null;
    var right = -Infinity;
    for (var k = 0; k < order.length; k++) {
      var i = order[k];
      var left = centers[i].cx - boxes[i].w / 2;
      if (current === null || left > right + 2) {
        current = [];
        clusters.push(current);
        right = -Infinity;
      }
      current.push(i);
      right = Math.max(right, centers[i].cx + boxes[i].w / 2);
    }
    return clusters;
  }

  /**
   * Deterministic min-gap solve for one cluster (vertical dimension).
   *
   * Point labels split into an "above" half and a "below" half by anchor
   * rank (ties break by input order, so identical anchors still split evenly
   * instead of piling on one side). Each half stacks *away* from the data so
   * labels never march across their own markers; end labels keep their
   * anchor height. A final three-pass sweep enforces the minimum gap and the
   * plot bounds while preserving vertical order.
   */
  function solveCluster(indices, boxes, centers, bounds, gap) {
    var ranked = indices.slice().sort(function (a, b) {
      if (boxes[a].y !== boxes[b].y) { return boxes[a].y - boxes[b].y; }
      return a - b;
    });
    var splitAt = Math.ceil(ranked.length / 2);
    var sideOf = {};
    ranked.forEach(function (i, rank) { sideOf[i] = rank < splitAt ? "above" : "below"; });

    // Stack the "above" group upward from each label's cap (just above its
    // anchor), and the "below" group downward from each label's floor.
    var desiredOf = {};
    var above = ranked.filter(function (i) { return sideOf[i] === "above"; });
    var below = ranked.filter(function (i) { return sideOf[i] === "below"; });

    function capFor(i) {
      var b = boxes[i];
      return b.kind === "end" ? b.y : b.y - POINT_GAP - b.h / 2;
    }
    function floorFor(i) {
      var b = boxes[i];
      return b.kind === "end" ? b.y : b.y + POINT_GAP + b.h / 2;
    }

    above.sort(function (a, b) { return capFor(b) - capFor(a) || b - a; });
    var prevUp = null;
    above.forEach(function (i) {
      var cy = capFor(i);
      if (prevUp !== null) {
        cy = Math.min(cy, prevUp.cy - (prevUp.h + boxes[i].h) / 2 - gap);
      }
      desiredOf[i] = cy;
      prevUp = { cy: cy, h: boxes[i].h };
    });

    below.sort(function (a, b) { return floorFor(a) - floorFor(b) || a - b; });
    var prevDown = null;
    below.forEach(function (i) {
      var cy = floorFor(i);
      if (prevDown !== null) {
        cy = Math.max(cy, prevDown.cy + (prevDown.h + boxes[i].h) / 2 + gap);
      }
      desiredOf[i] = cy;
      prevDown = { cy: cy, h: boxes[i].h };
    });

    var items = indices.map(function (i) {
      return { i: i, h: boxes[i].h, anchorY: boxes[i].y, desired: desiredOf[i] };
    });
    items.sort(function (a, b) {
      if (a.desired !== b.desired) { return a.desired - b.desired; }
      if (a.anchorY !== b.anchorY) { return a.anchorY - b.anchorY; }
      return a.i - b.i;
    });

    var n = items.length;
    var pos = new Array(n);
    var k;

    // Pass 1: push down to enforce the minimum gap, preserving order.
    pos[0] = items[0].desired;
    for (k = 1; k < n; k++) {
      pos[k] = Math.max(items[k].desired, pos[k - 1] + (items[k - 1].h + items[k].h) / 2 + gap);
    }
    // Pass 2: pull the chain back inside the bottom bound.
    var maxLast = bounds.bottom - items[n - 1].h / 2;
    if (pos[n - 1] > maxLast) {
      pos[n - 1] = maxLast;
      for (k = n - 2; k >= 0; k--) {
        pos[k] = Math.min(pos[k], pos[k + 1] - (items[k].h + items[k + 1].h) / 2 - gap);
      }
    }
    // Pass 3: respect the top bound (may re-push downward; a cluster taller
    // than the plot keeps its order and overflows the bottom, never scrambles).
    var minFirst = bounds.top + items[0].h / 2;
    if (pos[0] < minFirst) {
      pos[0] = minFirst;
      for (k = 1; k < n; k++) {
        pos[k] = Math.max(pos[k], pos[k - 1] + (items[k - 1].h + items[k].h) / 2 + gap);
      }
    }

    for (k = 0; k < n; k++) {
      centers[items[k].i].cy = pos[k];
    }
  }

  function layout(boxes, bounds, opts) {
    var gap = opts && typeof opts.gap === "number" ? opts.gap : 3;
    var centers = boxes.map(function (box) {
      var c = defaultCenter(box);
      c.cx = clamp(c.cx, bounds.left + box.w / 2, bounds.right - box.w / 2);
      return c;
    });
    var clusters = clusterize(boxes, centers);
    for (var c = 0; c < clusters.length; c++) {
      var cluster = clusters[c];
      if (cluster.length === 1) {
        var i = cluster[0];
        centers[i].cy = clamp(centers[i].cy, bounds.top + boxes[i].h / 2, bounds.bottom - boxes[i].h / 2);
      } else {
        solveCluster(cluster, boxes, centers, bounds, gap);
      }
    }
    return centers;
  }

  return { layout: layout, POINT_GAP: POINT_GAP, END_GAP: END_GAP };
})();

/* Node export used only by the automated test harness. */
if (typeof module !== "undefined" && module.exports) { module.exports = RCLabels; }
