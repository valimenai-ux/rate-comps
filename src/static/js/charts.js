"use strict";
/**
 * RCCharts - builds Plotly traces/layout from (payload, state) and renders.
 *
 * Everything is client-side so configurator changes re-render instantly.
 * Data labels and the Actual/Forecast divider are Plotly annotations, which
 * keeps them inside PNG/SVG exports; RCLabels nudges the labels apart after
 * every render in pixel space.
 */
var RCCharts = (function () {
  var DEFAULT_PRIMARY_COLOR = "#2F5597";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ------------------------------------------------------------------
  // Date helpers (all UTC string math; no timezone surprises)
  // ------------------------------------------------------------------

  function ms(iso) { return Date.parse(iso + "T00:00:00Z"); }

  function monthIndex(iso) {
    return parseInt(iso.slice(0, 4), 10) * 12 + (parseInt(iso.slice(5, 7), 10) - 1);
  }

  function monthEndIso(index) {
    var y = Math.floor(index / 12);
    var m = index % 12; // 0-based
    var d = new Date(Date.UTC(y, m + 1, 0));
    return d.toISOString().slice(0, 10);
  }

  function fmtTick(iso) {
    return MONTHS[parseInt(iso.slice(5, 7), 10) - 1] + "-" + iso.slice(2, 4);
  }

  function fmtMonthLong(iso) {
    return MONTHS[parseInt(iso.slice(5, 7), 10) - 1] + "-" + iso.slice(0, 4);
  }

  function midpointStamp(isoA, isoB) {
    var mid = new Date((ms(isoA) + ms(isoB)) / 2);
    return mid.toISOString().slice(0, 19).replace("T", " ");
  }

  function shiftDays(iso, days) {
    var d = new Date(ms(iso) + days * 86400000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  // ------------------------------------------------------------------
  // Series helpers
  // ------------------------------------------------------------------

  function seriesPoints(series) {
    var pts = [];
    if (!series) { return pts; }
    for (var i = 0; i < series.dates.length; i++) {
      pts.push({ d: series.dates[i], v: series.values[i] });
    }
    return pts;
  }

  function lastNonNull(points) {
    for (var i = points.length - 1; i >= 0; i--) {
      if (points[i].v !== null && points[i].v !== undefined) { return points[i]; }
    }
    return null;
  }

  function valueAt(points, iso) {
    for (var i = 0; i < points.length; i++) {
      if (points[i].d === iso) {
        return points[i].v === undefined ? null : points[i].v;
      }
    }
    return null;
  }

  function effectivePrimary(state) {
    var enabled = state.forecasts.filter(function (f) { return f.enabled; });
    if (enabled.length === 0) { return null; }
    for (var i = 0; i < enabled.length; i++) {
      if (enabled[i].name === state.primary) { return enabled[i].name; }
    }
    return enabled[0].name;
  }

  /**
   * The drawable pieces of one chart. Each piece is one visual line:
   *   {id, label, color, dash, width, points, domain: "actual"|"forecast"|"full",
   *    isPrimaryGroup, showLegend}
   */
  function buildPieces(rateKey, state, payload) {
    var primaryName = effectivePrimary(state);
    var byName = {};
    payload.forecasts.forEach(function (f) { byName[f.name] = f; });

    var primaryState = null;
    state.forecasts.forEach(function (f) { if (f.name === primaryName) { primaryState = f; } });
    var primaryColor = primaryState ? primaryState.color : DEFAULT_PRIMARY_COLOR;

    var actualPoints = seriesPoints(payload.actuals.series[rateKey]).filter(function (p) {
      return p.d <= state.cutoff;
    });
    var lastActual = lastNonNull(actualPoints);

    var pieces = [];
    var primaryHasContinuation = false;

    state.forecasts.forEach(function (f, idx) {
      if (!f.enabled) { return; }
      var fc = byName[f.name];
      if (!fc || !fc.series[rateKey]) { return; }
      var all = seriesPoints(fc.series[rateKey]);
      if (f.name === primaryName) {
        var after = all.filter(function (p) { return p.d > state.cutoff; });
        // A continuation needs a real value after the cutoff - null-only
        // post-cutoff rows must not hijack the Actuals legend entry.
        var firstReal = null;
        for (var j = 0; j < after.length; j++) {
          if (after[j].v !== null && after[j].v !== undefined) { firstReal = after[j]; break; }
        }
        if (firstReal) {
          primaryHasContinuation = true;
          pieces.push({
            id: "fc:" + f.name, label: f.displayName, color: f.color, dash: "dash",
            width: 3.6, points: after, labelPoints: after, domain: "forecast",
            // The joining segment back to the last actual is a hover-silent
            // bridge trace, so the boundary month's hover keeps attributing
            // that value to Actuals rather than to the forecast.
            bridge: lastActual
              ? [{ d: lastActual.d, v: lastActual.v }, { d: firstReal.d, v: firstReal.v }]
              : null,
            group: "primary", legendRank: 1000 + idx, showLegend: true
          });
        }
      } else {
        var hasPreCutoff = all.some(function (p) {
          return p.v !== null && p.v !== undefined && p.d <= state.cutoff;
        });
        var firstAfter = null;
        for (var k = 0; k < all.length; k++) {
          if (all[k].v !== null && all[k].v !== undefined && all[k].d > state.cutoff) {
            firstAfter = all[k];
            break;
          }
        }
        // House style: a vintage that carries no history of its own fans out
        // from the last actual point via a thin connector in its own style.
        // Vintages with real pre-cutoff history connect from that history
        // instead, keeping their divergence from actuals visible.
        var bridge = (!hasPreCutoff && lastActual && firstAfter)
          ? [{ d: lastActual.d, v: lastActual.v }, { d: firstAfter.d, v: firstAfter.v }]
          : null;
        pieces.push({
          id: "fc:" + f.name, label: f.displayName, color: f.color,
          dash: f.dash === "solid" ? "solid" : f.dash, width: 1.6,
          points: all, labelPoints: all, domain: "full", bridge: bridge,
          group: "fc:" + f.name, legendRank: 1000 + idx, showLegend: true
        });
      }
    });

    var actualsPiece = null;
    if (actualPoints.length > 0) {
      actualsPiece = {
        id: "actuals", label: "Actuals", color: primaryColor, dash: "solid",
        width: 3.6, points: actualPoints, labelPoints: actualPoints, domain: "actual",
        group: primaryName && primaryHasContinuation ? "primary" : "actuals",
        legendRank: 999,
        showLegend: !(primaryName && primaryHasContinuation),
        isActuals: true,
        endsOpen: primaryHasContinuation // its line visually continues
      };
    }

    return {
      pieces: pieces,
      actualsPiece: actualsPiece,
      lastActual: lastActual,
      primaryName: primaryName
    };
  }

  // ------------------------------------------------------------------
  // Axis computations
  // ------------------------------------------------------------------

  function computeTicks(minIso, maxIso, anchorMonth, intervalMonths) {
    var lo = monthIndex(minIso);
    var hi = monthIndex(maxIso);
    var anchor = anchorMonth - 1; // 0-based month
    var vals = [];
    var texts = [];
    for (var idx = lo; idx <= hi; idx++) {
      var rel = idx - anchor;
      if (((rel % intervalMonths) + intervalMonths) % intervalMonths === 0) {
        var iso = monthEndIso(idx);
        vals.push(iso);
        texts.push(fmtTick(iso));
      }
    }
    return { vals: vals, texts: texts };
  }

  function dataDateRange(drawList) {
    var min = null;
    var max = null;
    drawList.forEach(function (piece) {
      piece.points.forEach(function (p) {
        if (p.v === null || p.v === undefined) { return; }
        if (min === null || p.d < min) { min = p.d; }
        if (max === null || p.d > max) { max = p.d; }
      });
    });
    return { min: min, max: max };
  }

  function computeYRange(rateKey, state, drawList) {
    var axis = state.yAxis.perRate[rateKey] || { auto: true, min: null, max: null, paddingPct: null };
    var lo = null;
    var hi = null;
    drawList.forEach(function (piece) {
      piece.points.forEach(function (p) {
        if (p.v === null || p.v === undefined) { return; }
        if (lo === null || p.v < lo) { lo = p.v; }
        if (hi === null || p.v > hi) { hi = p.v; }
      });
    });
    if (lo === null) { lo = 0; hi = 1; }
    var span = hi - lo;
    var pct = axis.paddingPct !== null && axis.paddingPct !== undefined
      ? axis.paddingPct : state.yAxis.defaultPaddingPct;
    var pad = span > 0 ? span * (pct / 100) : Math.max(0.1, Math.abs(hi) * 0.05);
    var autoLo = lo - pad;
    var autoHi = hi + pad;
    if (axis.auto) { return [autoLo, autoHi]; }
    return [
      axis.min === null || axis.min === undefined ? autoLo : axis.min,
      axis.max === null || axis.max === undefined ? autoHi : axis.max
    ];
  }

  // ------------------------------------------------------------------
  // Text measurement (deterministic per font)
  // ------------------------------------------------------------------

  var _canvas = null;
  function measureLabel(text, sizePx, family) {
    if (!_canvas) { _canvas = document.createElement("canvas"); }
    var ctx = _canvas.getContext("2d");
    ctx.font = sizePx + "px " + family;
    var width = ctx.measureText(text).width;
    if (!width || width <= 0) { width = text.length * sizePx * 0.6; }
    return { w: width + 2, h: sizePx * 1.35 };
  }

  // ------------------------------------------------------------------
  // Figure assembly
  // ------------------------------------------------------------------

  function labelAnnotation(meta, xshift, yshift, state) {
    return {
      x: meta.x, y: meta.y, xref: "x", yref: "y",
      text: meta.text, showarrow: false,
      font: {
        size: state.chart.fontSizes.label,
        family: state.chart.fontFamily,
        color: "#000000"
      },
      xanchor: "center", yanchor: "middle",
      xshift: xshift, yshift: yshift
    };
  }

  function defaultShifts(meta) {
    if (meta.kind === "end") {
      return { xshift: RCLabels.END_GAP + meta.w / 2, yshift: 0 };
    }
    return { xshift: 0, yshift: RCLabels.POINT_GAP + meta.h / 2 };
  }

  function buildFigure(rateKey, rateDisplay, state, payload) {
    var built = buildPieces(rateKey, state, payload);
    var drawList = [];
    if (built.actualsPiece) { drawList.push(built.actualsPiece); }
    drawList = drawList.concat(built.pieces);

    var range = dataDateRange(drawList);
    var traces = [];
    var labelMeta = [];
    var staticAnns = [];
    var shapes = [];

    if (range.min === null) {
      // Nothing to draw for this rate with the current configuration.
      return {
        traces: [],
        layout: emptyLayout(rateDisplay, state),
        labelMeta: [],
        staticAnns: []
      };
    }

    // --- line traces (draw order: actuals first, then config order) ---
    // connectgaps: a month-end rate series is a sampling of a continuous
    // rate, so an interior blank month must not visually sever the line
    // (markers/labels still skip it, and the loader reports every gap).
    drawList.forEach(function (piece) {
      piece.traceIndex = traces.length;
      traces.push({
        type: "scatter",
        mode: "lines",
        connectgaps: true,
        x: piece.points.map(function (p) { return p.d; }),
        y: piece.points.map(function (p) { return p.v; }),
        name: escapeHtml(piece.label),
        legendgroup: piece.group,
        legendrank: piece.legendRank,
        showlegend: piece.showLegend,
        line: { color: piece.color, width: piece.width, dash: piece.dash },
        hovertemplate: "%{y:.2f}<extra>" + escapeHtml(piece.label) + "</extra>"
      });
      if (piece.bridge) {
        traces.push({
          type: "scatter",
          mode: "lines",
          x: piece.bridge.map(function (p) { return p.d; }),
          y: piece.bridge.map(function (p) { return p.v; }),
          name: escapeHtml(piece.label),
          legendgroup: piece.group,
          showlegend: false,
          line: { color: piece.color, width: piece.width, dash: piece.dash },
          hoverinfo: "skip"
        });
      }
    });

    // --- markers at configured label dates (white fill, series border) ---
    drawList.forEach(function (piece) {
      var mx = [];
      var my = [];
      state.labelDates.forEach(function (d) {
        if (piece.domain === "actual" && d > state.cutoff) { return; }
        if (piece.domain === "forecast" && d <= state.cutoff) { return; }
        var v = valueAt(piece.labelPoints, d);
        if (v !== null) { mx.push(d); my.push(v); }
      });
      if (mx.length > 0) {
        traces.push({
          type: "scatter",
          mode: "markers",
          x: mx, y: my,
          marker: {
            symbol: "circle", size: 7, color: "#FFFFFF",
            line: { color: piece.color, width: 1.5 }
          },
          legendgroup: piece.group,
          showlegend: false,
          hoverinfo: "skip"
        });
      }
    });

    // --- label metadata (positions resolved after render by RCLabels) ---
    drawList.forEach(function (piece) {
      var endPoint = state.labelLineEnds && !piece.endsOpen ? lastNonNull(piece.points) : null;
      state.labelDates.forEach(function (d) {
        if (piece.domain === "actual" && d > state.cutoff) { return; }
        if (piece.domain === "forecast" && d <= state.cutoff) { return; }
        var v = valueAt(piece.labelPoints, d);
        if (v === null) { return; }
        if (endPoint && endPoint.d === d) { return; } // end label covers it
        pushLabel(labelMeta, piece, d, v, "point", state);
      });
      if (endPoint && endPoint.v !== null) {
        pushLabel(labelMeta, piece, endPoint.d, endPoint.v, "end", state);
      }
    });

    // --- divider between actual history and forecasts ---
    var firstForecast = null;
    built.pieces.forEach(function (piece) {
      piece.points.forEach(function (p) {
        if (p.v === null || p.d <= state.cutoff) { return; }
        if (firstForecast === null || p.d < firstForecast) { firstForecast = p.d; }
      });
    });
    if (built.lastActual && firstForecast) {
      var xMid = midpointStamp(built.lastActual.d, firstForecast);
      shapes.push({
        type: "line", x0: xMid, x1: xMid, xref: "x",
        y0: 0, y1: 0.92, yref: "paper",
        line: { color: "#000000", width: 1 }
      });
      var diamondFont = { size: 9, color: "#000000", family: state.chart.fontFamily };
      staticAnns.push(
        { x: xMid, xref: "x", y: 0, yref: "paper", text: "\u25C6", showarrow: false, font: diamondFont, xanchor: "center", yanchor: "middle" },
        { x: xMid, xref: "x", y: 0.92, yref: "paper", text: "\u25C6", showarrow: false, font: diamondFont, xanchor: "center", yanchor: "middle" },
        {
          x: xMid, xref: "x", y: 0.035, yref: "paper", text: "Actual", showarrow: false,
          font: { size: state.chart.fontSizes.caption, color: "#404040", family: state.chart.fontFamily },
          xanchor: "right", yanchor: "bottom", xshift: -7
        },
        {
          x: xMid, xref: "x", y: 0.035, yref: "paper", text: "Forecast", showarrow: false,
          font: { size: state.chart.fontSizes.caption, color: "#404040", family: state.chart.fontFamily },
          xanchor: "left", yanchor: "bottom", xshift: 7
        }
      );
    }

    // --- layout ---
    var ticks = computeTicks(range.min, range.max, state.tick.anchorMonth, state.tick.intervalMonths);
    var yRange = computeYRange(rateKey, state, drawList);
    var initialAnns = staticAnns.concat(labelMeta.map(function (m) {
      var s = defaultShifts(m);
      return labelAnnotation(m, s.xshift, s.yshift, state);
    }));

    var layout = {
      width: state.chart.widthPx,
      height: state.chart.heightPx,
      font: { family: state.chart.fontFamily, size: state.chart.fontSizes.axis, color: "#000000" },
      title: {
        text: "<b>" + escapeHtml(rateDisplay) + "</b>",
        font: { size: state.chart.fontSizes.title, family: state.chart.fontFamily, color: "#000000" },
        x: 0.5, xanchor: "center"
      },
      showlegend: true,
      legend: {
        orientation: "h", x: 0.5, xanchor: "center", y: 1.02, yanchor: "bottom",
        font: { size: state.chart.fontSizes.legend, family: state.chart.fontFamily },
        itemsizing: "trace"
      },
      margin: { l: state.yAxis.show ? 56 : 26, r: 26, t: 92, b: 54 },
      xaxis: {
        type: "date",
        range: [shiftDays(range.min, -20), shiftDays(range.max, 55)],
        tickvals: ticks.vals,
        ticktext: ticks.texts,
        tickfont: { size: state.chart.fontSizes.axis, family: state.chart.fontFamily },
        showgrid: false, zeroline: false,
        showline: true, linecolor: "#000000", linewidth: 1,
        ticks: "outside", ticklen: 4, tickcolor: "#000000",
        hoverformat: "%b-%y"
      },
      yaxis: {
        visible: state.yAxis.show,
        range: yRange,
        tickformat: ".2f",
        tickfont: { size: state.chart.fontSizes.axis, family: state.chart.fontFamily },
        showgrid: false, zeroline: false,
        showline: state.yAxis.show, linecolor: "#000000", linewidth: 1,
        ticks: state.yAxis.show ? "outside" : "", ticklen: 4, tickcolor: "#000000"
      },
      hovermode: "x unified",
      hoverlabel: {
        bgcolor: "#FFFFFF", bordercolor: "#C7CEDA",
        font: { size: 12, family: state.chart.fontFamily, color: "#1F2937" }
      },
      plot_bgcolor: "#FFFFFF",
      paper_bgcolor: "#FFFFFF",
      shapes: shapes,
      annotations: initialAnns,
      uirevision: "rc-" + state.chart.widthPx + "x" + state.chart.heightPx
    };

    return { traces: traces, layout: layout, labelMeta: labelMeta, staticAnns: staticAnns };
  }

  function pushLabel(labelMeta, piece, d, v, kind, state) {
    var text = Number(v).toFixed(2);
    var size = measureLabel(text, state.chart.fontSizes.label, state.chart.fontFamily);
    labelMeta.push({
      x: d, y: v, text: text, kind: kind,
      w: size.w, h: size.h, traceIndex: piece.traceIndex
    });
  }

  function emptyLayout(rateDisplay, state) {
    return {
      width: state.chart.widthPx,
      height: Math.min(240, state.chart.heightPx),
      font: { family: state.chart.fontFamily, size: state.chart.fontSizes.axis },
      title: {
        text: "<b>" + escapeHtml(rateDisplay) + "</b><br><span style='font-size:12px'>No data for the current configuration</span>",
        x: 0.5, xanchor: "center"
      },
      xaxis: { visible: false }, yaxis: { visible: false },
      annotations: [], shapes: [],
      plot_bgcolor: "#FFFFFF", paper_bgcolor: "#FFFFFF"
    };
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ------------------------------------------------------------------
  // Rendering + label pass
  // ------------------------------------------------------------------

  function runLabelPass(gd) {
    var rc = gd.__rc;
    if (!rc || !gd._fullLayout) { return; }
    var xa = gd._fullLayout.xaxis;
    var ya = gd._fullLayout.yaxis;
    if (!xa || !ya || typeof xa.d2c !== "function") { return; }

    var bounds = {
      left: xa._offset + 2,
      right: xa._offset + xa._length - 2,
      top: ya._offset + 2,
      bottom: ya._offset + ya._length - 2
    };

    var live = [];
    rc.labels.forEach(function (m) {
      var trace = gd.data[m.traceIndex];
      if (trace && trace.visible !== undefined && trace.visible !== true) { return; }
      var px = xa._offset + xa.l2p(xa.d2c(m.x));
      var py = ya._offset + ya.l2p(ya.d2c(m.y));
      if (!isFinite(px) || !isFinite(py)) { return; }
      if (px < bounds.left - 4 || px > bounds.right + 4) { return; }
      if (py < bounds.top - 40 || py > bounds.bottom + 40) { return; }
      live.push({ m: m, px: px, py: py });
    });

    var boxes = live.map(function (item) {
      return { x: item.px, y: item.py, w: item.m.w, h: item.m.h, kind: item.m.kind };
    });
    var centers = RCLabels.layout(boxes, bounds, { gap: 3 });

    var anns = rc.staticAnns.slice();
    live.forEach(function (item, idx) {
      anns.push(labelAnnotation(
        item.m,
        centers[idx].cx - item.px,
        item.py - centers[idx].cy,
        rc.state
      ));
    });

    gd.__rcGuard = true;
    Plotly.relayout(gd, { annotations: anns }).then(
      function () { gd.__rcGuard = false; },
      function () { gd.__rcGuard = false; }
    );
  }

  function bindOnce(gd) {
    if (gd.__rcBound) { return; }
    gd.__rcBound = true;
    gd.on("plotly_relayout", function (evt) {
      if (gd.__rcGuard || !evt) { return; }
      var keys = Object.keys(evt);
      var affectsAxes = keys.some(function (k) {
        return k.indexOf("xaxis.") === 0 || k.indexOf("yaxis.") === 0;
      });
      if (affectsAxes) { runLabelPass(gd); }
    });
    gd.on("plotly_restyle", function () {
      if (!gd.__rcGuard) { runLabelPass(gd); }
    });
  }

  function render(gd, rateKey, rateDisplay, state, payload) {
    var fig = buildFigure(rateKey, rateDisplay, state, payload);
    gd.__rc = { labels: fig.labelMeta, staticAnns: fig.staticAnns, state: state };
    var config = {
      responsive: false,
      displaylogo: false,
      // The built-in camera bakes its filename at render time (stale date
      // after midnight); this custom button routes through RCExports, which
      // stamps the name at click time - one code path for every image export.
      modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
      modeBarButtonsToAdd: [{
        name: "rc-download-image",
        title: "Download chart (" + state.export.defaultFormat.toUpperCase() + ")",
        icon: Plotly.Icons.camera,
        click: function (g) {
          RCExports.exportChart(g, rateDisplay, state.export.defaultFormat, state);
        }
      }],
      doubleClick: "reset"
    };
    return Plotly.react(gd, fig.traces, fig.layout, config).then(function () {
      bindOnce(gd);
      runLabelPass(gd);
      return gd;
    });
  }

  /** Safe file name shared with exports.js; local-date stamp (not UTC, so an
   *  evening download in the Americas is not dated "tomorrow"). */
  function RCExportsFileName(name) {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    var safe = String(name).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
    return (safe || "chart") + "_" + stamp;
  }

  return {
    render: render,
    runLabelPass: runLabelPass,
    effectivePrimary: effectivePrimary,
    fmtTick: fmtTick,
    fmtMonthLong: fmtMonthLong,
    monthIndex: monthIndex,
    monthEndIso: monthEndIso,
    fileNameFor: RCExportsFileName
  };
})();
