"use strict";
/**
 * RCYaml - emits config.yaml text from the dashboard state.
 *
 * Pure (no DOM, no globals beyond this module) so the Node test harness can
 * run the real emitter and the Python suite can prove the output round-trips
 * through src/validate.parse_config unchanged.
 *
 * All scalar values are emitted JSON-quoted (JSON strings are valid YAML
 * double-quoted scalars, with backslashes properly escaped - Windows paths
 * survive the trip).
 *
 * emit(state, ctx) - ctx carries everything that is not UI state:
 *   dataFolder, outputPath   config identity (never editable in the browser)
 *   lastActual               last actuals month; cutoff equal to it exports
 *                            as null so the monthly refresh keeps following
 *                            the data
 *   primaryName              resolved primary forecast name ("" when none)
 *   rates                    [{key, display_name}] visible rates
 *   extraPerRate             optional {key: {auto,min,max,padding_pct}} axis
 *                            overrides for rates not visible right now
 *                            (hidden_rates) - preserved verbatim
 *   rateDisplayNames, rateOrder, hiddenRates   pass-through config values
 *   exportedAt               human-readable timestamp for the header
 */
var RCYaml = (function () {
  function q(value) { return JSON.stringify(String(value)); }

  function numOut(n) {
    return (typeof n === "number" && isFinite(n)) ? String(n) : "null";
  }

  function emit(state, ctx) {
    var lines = [];
    lines.push("# Rate Comps configuration");
    lines.push("# Exported from the dashboard on " + ctx.exportedAt);
    lines.push("");
    lines.push("data_folder: " + q(ctx.dataFolder));
    lines.push("output_path: " + q(ctx.outputPath));
    lines.push("");
    if (state.cutoff === ctx.lastActual) {
      lines.push("cutoff_date: null   # follows the last month in actuals.csv");
    } else {
      lines.push("cutoff_date: " + q(state.cutoff));
    }
    var primaryDisplay = "";
    state.forecasts.forEach(function (f) {
      if (f.name === ctx.primaryName) { primaryDisplay = f.displayName; }
    });
    lines.push("primary_forecast: " + q(primaryDisplay || ""));
    lines.push("");
    lines.push("forecasts:");
    state.forecasts.forEach(function (f) {
      var parts = "  - {file: " + q(f.file) +
        ", display_name: " + q(f.displayName) +
        ", color: " + q(f.color) +
        ", enabled: " + (f.enabled ? "true" : "false");
      if (f.dash && f.dash !== "solid") { parts += ", dash: " + q(f.dash); }
      lines.push(parts + "}");
    });
    lines.push("");
    lines.push("label_dates: [" + state.labelDates.map(q).join(", ") + "]");
    lines.push("always_label_line_ends: " + (state.labelLineEnds ? "true" : "false"));
    lines.push("");
    var nameKeys = Object.keys(ctx.rateDisplayNames);
    if (nameKeys.length === 0) {
      lines.push("rate_display_names: {}");
    } else {
      lines.push("rate_display_names:");
      nameKeys.forEach(function (key) {
        lines.push("  " + q(key) + ": " + q(ctx.rateDisplayNames[key]));
      });
    }
    lines.push("rate_order: [" + ctx.rateOrder.map(q).join(", ") + "]");
    lines.push("hidden_rates: [" + ctx.hiddenRates.map(q).join(", ") + "]");
    lines.push("");
    lines.push("tick:");
    lines.push("  anchor_month: " + state.tick.anchorMonth);
    lines.push("  interval_months: " + state.tick.intervalMonths);
    lines.push("");
    lines.push("y_axis:");
    lines.push("  show: " + (state.yAxis.show ? "true" : "false"));
    lines.push("  default_padding_pct: " + numOut(state.yAxis.defaultPaddingPct));
    var overrides = [];
    ctx.rates.forEach(function (r) {
      var a = state.yAxis.perRate[r.key];
      if (!a) { return; }
      var isDefault = a.auto && a.min === null && a.max === null && a.paddingPct === null;
      if (isDefault) { return; }
      var parts = ["auto: " + (a.auto ? "true" : "false")];
      if (a.min !== null) { parts.push("min: " + numOut(a.min)); }
      if (a.max !== null) { parts.push("max: " + numOut(a.max)); }
      if (a.paddingPct !== null) { parts.push("padding_pct: " + numOut(a.paddingPct)); }
      overrides.push("    " + q(r.key) + ": {" + parts.join(", ") + "}");
    });
    Object.keys(ctx.extraPerRate || {}).forEach(function (key) {
      var a = ctx.extraPerRate[key];
      var hasValue = function (v) { return v !== null && v !== undefined; };
      var isDefault = a.auto !== false && !hasValue(a.min) && !hasValue(a.max) && !hasValue(a.padding_pct);
      if (isDefault) { return; }
      var parts = ["auto: " + (a.auto === false ? "false" : "true")];
      if (hasValue(a.min)) { parts.push("min: " + numOut(a.min)); }
      if (hasValue(a.max)) { parts.push("max: " + numOut(a.max)); }
      if (hasValue(a.padding_pct)) { parts.push("padding_pct: " + numOut(a.padding_pct)); }
      overrides.push("    " + q(key) + ": {" + parts.join(", ") + "}");
    });
    if (overrides.length === 0) {
      lines.push("  per_rate: {}");
    } else {
      lines.push("  per_rate:");
      overrides.forEach(function (line) { lines.push(line); });
    }
    lines.push("");
    lines.push("chart:");
    lines.push("  width_px: " + state.chart.widthPx);
    lines.push("  height_px: " + state.chart.heightPx);
    lines.push("  font_family: " + q(state.chart.fontFamily));
    lines.push("  font_sizes: {title: " + state.chart.fontSizes.title +
      ", legend: " + state.chart.fontSizes.legend +
      ", axis: " + state.chart.fontSizes.axis +
      ", label: " + state.chart.fontSizes.label +
      ", caption: " + state.chart.fontSizes.caption + "}");
    lines.push("");
    lines.push("export:");
    lines.push("  png_scale: " + state.export.pngScale);
    lines.push("  default_format: " + q(state.export.defaultFormat));
    lines.push("");
    return lines.join("\n");
  }

  return { emit: emit };
})();

/* Node export used only by the automated test harness. */
if (typeof module !== "undefined" && module.exports) { module.exports = RCYaml; }
