"use strict";
/**
 * Rate Comps dashboard application: builds the configurator sidebar, owns the
 * UI state, re-renders charts on every change, and handles persistence
 * (config.yaml download + best-effort localStorage session mirror).
 */
(function () {
  var payload = JSON.parse(document.getElementById("rc-payload").textContent);
  var LS_KEY = "rateComps.session.v1::" + payload.meta.data_folder;

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  function defaultState() {
    var d = payload.defaults;
    var perRate = {};
    payload.rates.forEach(function (r) {
      var cfg = d.y_axis.per_rate[r.key] || {};
      perRate[r.key] = {
        auto: cfg.auto === undefined ? true : !!cfg.auto,
        min: cfg.min === undefined ? null : cfg.min,
        max: cfg.max === undefined ? null : cfg.max,
        paddingPct: cfg.padding_pct === undefined ? null : cfg.padding_pct
      };
    });
    return {
      cutoff: d.cutoff_date,
      primary: d.primary,
      labelDates: d.label_dates.slice(),
      labelLineEnds: !!d.always_label_line_ends,
      tick: { anchorMonth: d.tick.anchor_month, intervalMonths: d.tick.interval_months },
      yAxis: {
        show: !!d.y_axis.show,
        defaultPaddingPct: d.y_axis.default_padding_pct,
        perRate: perRate
      },
      chart: {
        widthPx: d.chart.width_px,
        heightPx: d.chart.height_px,
        fontFamily: d.chart.font_family,
        fontSizes: {
          title: d.chart.font_sizes.title,
          legend: d.chart.font_sizes.legend,
          axis: d.chart.font_sizes.axis,
          label: d.chart.font_sizes.label,
          caption: d.chart.font_sizes.caption
        }
      },
      forecasts: payload.forecasts.map(function (f) {
        return {
          name: f.name, file: f.file, displayName: f.display_name,
          color: f.color, dash: f.dash, enabled: !!f.enabled
        };
      }),
      export: { pngScale: d.export.png_scale, defaultFormat: d.export.default_format }
    };
  }

  var FILE_STATE = JSON.stringify(defaultState());
  var state = JSON.parse(FILE_STATE);

  function sortedUnique(list) {
    var seen = {};
    var out = [];
    list.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
    out.sort();
    return out;
  }

  function actualsMonths() {
    var months = [];
    Object.keys(payload.actuals.series).forEach(function (key) {
      months = months.concat(payload.actuals.series[key].dates);
    });
    return sortedUnique(months);
  }

  function allMonths() {
    var months = [];
    Object.keys(payload.actuals.series).forEach(function (key) {
      months = months.concat(payload.actuals.series[key].dates);
    });
    payload.forecasts.forEach(function (f) {
      Object.keys(f.series).forEach(function (key) {
        months = months.concat(f.series[key].dates);
      });
    });
    return sortedUnique(months);
  }

  var LAST_ACTUAL = actualsMonths().slice(-1)[0] || state.cutoff;

  // ------------------------------------------------------------------
  // Small DOM helpers
  // ------------------------------------------------------------------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") { node.className = attrs[k]; }
        else if (k === "text") { node.textContent = attrs[k]; }
        else if (k === "html") { node.innerHTML = attrs[k]; }
        else if (k.indexOf("on") === 0) { node.addEventListener(k.slice(2), attrs[k]); }
        else if (attrs[k] !== null && attrs[k] !== undefined) { node.setAttribute(k, attrs[k]); }
      });
    }
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function option(value, text, selected) {
    var o = el("option", { value: value, text: text });
    if (selected) { o.selected = true; }
    return o;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  var chartRegistry = []; // [{key, display, gd}]
  var renderTimer = null;

  function scheduleRender() {
    if (renderTimer) { clearTimeout(renderTimer); }
    renderTimer = setTimeout(renderAll, 120);
  }

  function renderAll() {
    renderTimer = null;
    chartRegistry.forEach(function (entry) {
      RCCharts.render(entry.gd, entry.key, displayNameFor(entry.key), state, payload);
    });
    updateMeta();
    updateDirty();
    saveSession();
  }

  function displayNameFor(rateKey) {
    for (var i = 0; i < payload.rates.length; i++) {
      if (payload.rates[i].key === rateKey) { return payload.rates[i].display_name; }
    }
    return rateKey;
  }

  // ------------------------------------------------------------------
  // Sidebar sections
  // ------------------------------------------------------------------

  function section(title, open) {
    var details = el("details", { class: "rc-section" });
    if (open) { details.open = true; }
    details.appendChild(el("summary", { text: title }));
    var body = el("div", { class: "rc-section-body" });
    details.appendChild(body);
    return { details: details, body: body };
  }

  function buildForecastSection() {
    var s = section("Forecasts", true);
    s.body.appendChild(el("div", {
      class: "rc-hint",
      text: "Radio = primary line. Checkbox = shown on charts."
    }));
    state.forecasts.forEach(function (f) {
      var radio = el("input", { type: "radio", name: "rc-primary", title: "Make this the primary forecast" });
      radio.checked = RCCharts.effectivePrimary(state) === f.name;
      radio.disabled = !f.enabled;
      radio.addEventListener("change", function () {
        if (radio.checked) { state.primary = f.name; refreshControls(); scheduleRender(); }
      });

      var check = el("input", { type: "checkbox", title: "Show / hide this forecast" });
      check.checked = f.enabled;
      check.addEventListener("change", function () {
        f.enabled = check.checked;
        refreshControls();
        scheduleRender();
      });

      var color = el("input", { type: "color", value: f.color, title: "Line color" });
      color.addEventListener("input", function () { f.color = color.value.toUpperCase(); scheduleRender(); });

      var name = el("input", { type: "text", value: f.displayName, title: "Display name (legend + Excel)" });
      name.addEventListener("input", function () {
        f.displayName = name.value || f.name;
        scheduleRender();
      });

      var row = el("div", { class: "rc-forecast-row" + (f.enabled ? "" : " rc-disabled") },
        [radio, check, color, name]);
      s.body.appendChild(row);
    });
    return s.details;
  }

  function buildTimelineSection() {
    var s = section("Cutoff & labels", true);

    var cutoffSelect = el("select", { class: "rc-grow", title: "Last month treated as actual history" });
    var months = actualsMonths();
    if (months.indexOf(state.cutoff) < 0) { months = sortedUnique(months.concat([state.cutoff])); }
    months.forEach(function (m) {
      cutoffSelect.appendChild(option(m, RCCharts.fmtTick(m), m === state.cutoff));
    });
    cutoffSelect.addEventListener("change", function () {
      state.cutoff = cutoffSelect.value;
      scheduleRender();
    });
    s.body.appendChild(el("div", { class: "rc-row" }, [el("label", { text: "Actual through" }), cutoffSelect]));

    var chips = el("div", { class: "rc-chips" });
    function rebuildChips() {
      chips.innerHTML = "";
      state.labelDates.forEach(function (d) {
        var remove = el("button", { type: "button", title: "Remove this label date", text: "\u00D7" });
        remove.addEventListener("click", function () {
          state.labelDates = state.labelDates.filter(function (x) { return x !== d; });
          rebuildChips();
          scheduleRender();
        });
        chips.appendChild(el("span", { class: "rc-chip" }, [document.createTextNode(RCCharts.fmtTick(d)), remove]));
      });
    }
    rebuildChips();
    s.body.appendChild(el("div", { class: "rc-hint", text: "Months that get markers + value labels:" }));
    s.body.appendChild(chips);

    var addSelect = el("select", { class: "rc-grow" });
    allMonths().forEach(function (m) { addSelect.appendChild(option(m, RCCharts.fmtTick(m), false)); });
    var addBtn = el("button", { class: "rc-btn rc-btn-small", type: "button", text: "Add" });
    addBtn.addEventListener("click", function () {
      if (state.labelDates.indexOf(addSelect.value) < 0) {
        state.labelDates = sortedUnique(state.labelDates.concat([addSelect.value]));
        rebuildChips();
        scheduleRender();
      }
    });
    s.body.appendChild(el("div", { class: "rc-row" }, [addSelect, addBtn]));

    var ends = el("input", { type: "checkbox" });
    ends.checked = state.labelLineEnds;
    ends.addEventListener("change", function () { state.labelLineEnds = ends.checked; scheduleRender(); });
    s.body.appendChild(el("div", { class: "rc-row" }, [ends, el("label", { text: "Label every line end" })]));
    return s.details;
  }

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  function buildAxesSection() {
    var s = section("Axes & ticks", false);

    var show = el("input", { type: "checkbox" });
    show.checked = state.yAxis.show;
    show.addEventListener("change", function () { state.yAxis.show = show.checked; scheduleRender(); });
    s.body.appendChild(el("div", { class: "rc-row" }, [show, el("label", { text: "Show y-axis" })]));

    var anchor = el("select", {});
    MONTH_NAMES.forEach(function (name, i) {
      anchor.appendChild(option(String(i + 1), name, state.tick.anchorMonth === i + 1));
    });
    anchor.addEventListener("change", function () {
      state.tick.anchorMonth = parseInt(anchor.value, 10);
      scheduleRender();
    });
    var interval = el("select", {});
    [1, 2, 3, 4, 6, 12].forEach(function (n) {
      interval.appendChild(option(String(n), n + " mo", state.tick.intervalMonths === n));
    });
    interval.addEventListener("change", function () {
      state.tick.intervalMonths = parseInt(interval.value, 10);
      scheduleRender();
    });
    s.body.appendChild(el("div", { class: "rc-row" }, [el("label", { text: "Ticks from" }), anchor, el("label", { text: "every" }), interval]));

    s.body.appendChild(el("div", { class: "rc-hint", text: "Per-chart y-axis range:" }));
    payload.rates.forEach(function (r) {
      var axis = state.yAxis.perRate[r.key];
      var block = el("div", { class: "rc-axis-block" });
      block.appendChild(el("div", { class: "rc-axis-title", text: r.display_name }));

      var auto = el("input", { type: "checkbox" });
      auto.checked = axis.auto;
      var minIn = el("input", { type: "number", step: "0.05", placeholder: "min" });
      var maxIn = el("input", { type: "number", step: "0.05", placeholder: "max" });
      var padIn = el("input", { type: "number", step: "1", placeholder: String(state.yAxis.defaultPaddingPct) });
      if (axis.min !== null) { minIn.value = axis.min; }
      if (axis.max !== null) { maxIn.value = axis.max; }
      if (axis.paddingPct !== null) { padIn.value = axis.paddingPct; }
      minIn.disabled = axis.auto;
      maxIn.disabled = axis.auto;

      auto.addEventListener("change", function () {
        axis.auto = auto.checked;
        minIn.disabled = axis.auto;
        maxIn.disabled = axis.auto;
        scheduleRender();
      });
      minIn.addEventListener("input", function () {
        axis.min = minIn.value === "" ? null : parseFloat(minIn.value);
        scheduleRender();
      });
      maxIn.addEventListener("input", function () {
        axis.max = maxIn.value === "" ? null : parseFloat(maxIn.value);
        scheduleRender();
      });
      padIn.addEventListener("input", function () {
        axis.paddingPct = padIn.value === "" ? null : parseFloat(padIn.value);
        scheduleRender();
      });

      block.appendChild(el("div", { class: "rc-row" }, [auto, el("label", { text: "Auto range" }), el("label", { text: "pad %" }), padIn]));
      block.appendChild(el("div", { class: "rc-row" }, [el("label", { text: "Manual" }), minIn, el("label", { text: "to" }), maxIn]));
      s.body.appendChild(block);
    });
    return s.details;
  }

  var PRESETS = {
    compact: { w: 820, h: 380, label: "Compact (820 x 380)" },
    standard: { w: 1000, h: 480, label: "Standard (1000 x 480)" },
    large: { w: 1200, h: 560, label: "Large (1200 x 560)" }
  };

  function currentPreset() {
    var keys = Object.keys(PRESETS);
    for (var i = 0; i < keys.length; i++) {
      var p = PRESETS[keys[i]];
      if (p.w === state.chart.widthPx && p.h === state.chart.heightPx) { return keys[i]; }
    }
    return "custom";
  }

  function buildSizeSection() {
    var s = section("Chart size", false);
    var preset = el("select", { class: "rc-grow" });
    Object.keys(PRESETS).forEach(function (key) {
      preset.appendChild(option(key, PRESETS[key].label, currentPreset() === key));
    });
    preset.appendChild(option("custom", "Custom", currentPreset() === "custom"));

    var wIn = el("input", { type: "number", step: "10", min: "480", max: "2400" });
    var hIn = el("input", { type: "number", step: "10", min: "280", max: "1400" });
    wIn.value = state.chart.widthPx;
    hIn.value = state.chart.heightPx;

    preset.addEventListener("change", function () {
      if (preset.value !== "custom") {
        state.chart.widthPx = PRESETS[preset.value].w;
        state.chart.heightPx = PRESETS[preset.value].h;
        wIn.value = state.chart.widthPx;
        hIn.value = state.chart.heightPx;
        scheduleRender();
      }
    });
    function onSize() {
      var w = parseInt(wIn.value, 10);
      var h = parseInt(hIn.value, 10);
      if (w >= 480 && w <= 2400) { state.chart.widthPx = w; }
      if (h >= 280 && h <= 1400) { state.chart.heightPx = h; }
      preset.value = currentPreset();
      scheduleRender();
    }
    wIn.addEventListener("input", onSize);
    hIn.addEventListener("input", onSize);

    s.body.appendChild(el("div", { class: "rc-row" }, [preset]));
    s.body.appendChild(el("div", { class: "rc-row" }, [el("label", { text: "W" }), wIn, el("label", { text: "H" }), hIn]));
    return s.details;
  }

  function refreshControls() {
    var container = document.getElementById("rc-controls");
    container.innerHTML = "";
    container.appendChild(buildForecastSection());
    container.appendChild(buildTimelineSection());
    container.appendChild(buildAxesSection());
    container.appendChild(buildSizeSection());
  }

  // ------------------------------------------------------------------
  // Meta, dirty flag, validation
  // ------------------------------------------------------------------

  function updateMeta() {
    var meta = document.getElementById("rc-meta");
    meta.innerHTML = "";
    meta.appendChild(el("div", { text: "Data: " + payload.meta.data_folder }));
    meta.appendChild(el("div", { text: "Actual through " + RCCharts.fmtMonthLong(state.cutoff) + " \u00B7 generated " + payload.meta.generated_at }));
  }

  function updateDirty() {
    document.getElementById("rc-dirty").hidden = JSON.stringify(state) === FILE_STATE;
  }

  function buildValidation() {
    var panel = document.getElementById("rc-validation");
    panel.innerHTML = "";
    panel.appendChild(el("h2", { text: "Validation & load report" }));
    payload.validation.forEach(function (m) {
      panel.appendChild(el("div", { class: "rc-v-line rc-v-" + m.level }, [
        el("span", { class: "rc-v-source", text: m.source }),
        el("span", { text: m.message })
      ]));
    });
    var issues = payload.validation.filter(function (m) { return m.level !== "info"; }).length;
    var badge = document.getElementById("rc-validation-badge");
    if (issues > 0) {
      badge.textContent = String(issues);
      badge.hidden = false;
      panel.hidden = false; // surface problems on first open
    }
    payload.validation.forEach(function (m) {
      var text = "[Rate Comps] " + m.source + ": " + m.message;
      if (m.level === "error") { console.error(text); }
      else if (m.level === "warning") { console.warn(text); }
      else { console.log(text); }
    });
  }

  // ------------------------------------------------------------------
  // Charts area
  // ------------------------------------------------------------------

  function buildCharts() {
    var wrap = document.getElementById("rc-charts");
    wrap.innerHTML = "";
    chartRegistry = [];
    payload.rates.forEach(function (r) {
      var gd = el("div", { class: "rc-plot", id: "rc-chart-" + r.key });
      var png = el("button", { class: "rc-btn rc-btn-small", type: "button", text: "PNG" });
      var svg = el("button", { class: "rc-btn rc-btn-small", type: "button", text: "SVG" });
      png.addEventListener("click", function () { RCExports.exportChart(gd, r.display_name, "png", state); });
      svg.addEventListener("click", function () { RCExports.exportChart(gd, r.display_name, "svg", state); });
      var card = el("div", { class: "rc-chart-card" }, [
        el("div", { class: "rc-chart-card-bar" }, [
          el("span", { class: "rc-chart-name", text: r.display_name }),
          png, svg
        ]),
        gd
      ]);
      wrap.appendChild(card);
      chartRegistry.push({ key: r.key, display: r.display_name, gd: gd });
    });
  }

  // ------------------------------------------------------------------
  // config.yaml export
  // ------------------------------------------------------------------

  function q(value) { return JSON.stringify(String(value)); }

  function numOut(n) {
    return (typeof n === "number" && isFinite(n)) ? String(n) : "null";
  }

  function emitYaml() {
    var d = payload.defaults;
    var lines = [];
    lines.push("# Rate Comps configuration");
    lines.push("# Exported from the dashboard on " + new Date().toLocaleString());
    lines.push("");
    lines.push("data_folder: " + q(payload.meta.data_folder));
    lines.push("output_path: " + q(payload.meta.output_path));
    lines.push("");
    if (state.cutoff === LAST_ACTUAL) {
      lines.push("cutoff_date: null   # follows the last month in actuals.csv");
    } else {
      lines.push("cutoff_date: " + q(state.cutoff));
    }
    var primary = RCCharts.effectivePrimary(state);
    var primaryDisplay = "";
    state.forecasts.forEach(function (f) { if (f.name === primary) { primaryDisplay = f.displayName; } });
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
    var nameKeys = Object.keys(d.rate_display_names);
    if (nameKeys.length === 0) {
      lines.push("rate_display_names: {}");
    } else {
      lines.push("rate_display_names:");
      nameKeys.forEach(function (key) {
        lines.push("  " + q(key) + ": " + q(d.rate_display_names[key]));
      });
    }
    lines.push("rate_order: [" + d.rate_order.map(q).join(", ") + "]");
    lines.push("hidden_rates: [" + d.hidden_rates.map(q).join(", ") + "]");
    lines.push("");
    lines.push("tick:");
    lines.push("  anchor_month: " + state.tick.anchorMonth);
    lines.push("  interval_months: " + state.tick.intervalMonths);
    lines.push("");
    lines.push("y_axis:");
    lines.push("  show: " + (state.yAxis.show ? "true" : "false"));
    lines.push("  default_padding_pct: " + numOut(state.yAxis.defaultPaddingPct));
    var overrides = [];
    payload.rates.forEach(function (r) {
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

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: "text/yaml" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ------------------------------------------------------------------
  // localStorage session mirror (best effort)
  // ------------------------------------------------------------------

  function saveSession() {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, state: state }));
    } catch (err) { /* storage may be unavailable (file://, private mode) */ }
  }

  function loadSession() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) { return null; }
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !parsed.state) { return null; }
      return parsed.state;
    } catch (err) {
      return null;
    }
  }

  function mergeSession(saved) {
    // Only adopt a saved session that still matches the data on disk.
    var fresh = JSON.parse(FILE_STATE);
    var byName = {};
    fresh.forecasts.forEach(function (f) { byName[f.name] = f; });
    if (!saved.forecasts || !saved.forecasts.length) { return fresh; }
    saved.forecasts.forEach(function (f) {
      var target = byName[f.name];
      if (target) {
        target.enabled = !!f.enabled;
        target.color = f.color || target.color;
        target.displayName = f.displayName || target.displayName;
        target.dash = f.dash || target.dash;
      }
    });
    ["cutoff", "primary", "labelLineEnds"].forEach(function (key) {
      if (saved[key] !== undefined && saved[key] !== null) { fresh[key] = saved[key]; }
    });
    if (Array.isArray(saved.labelDates)) { fresh.labelDates = saved.labelDates.slice(); }
    if (saved.tick) {
      fresh.tick.anchorMonth = saved.tick.anchorMonth || fresh.tick.anchorMonth;
      fresh.tick.intervalMonths = saved.tick.intervalMonths || fresh.tick.intervalMonths;
    }
    if (saved.yAxis) {
      fresh.yAxis.show = !!saved.yAxis.show;
      if (typeof saved.yAxis.defaultPaddingPct === "number") {
        fresh.yAxis.defaultPaddingPct = saved.yAxis.defaultPaddingPct;
      }
      Object.keys(fresh.yAxis.perRate).forEach(function (key) {
        if (saved.yAxis.perRate && saved.yAxis.perRate[key]) {
          fresh.yAxis.perRate[key] = saved.yAxis.perRate[key];
        }
      });
    }
    if (saved.chart) {
      if (typeof saved.chart.widthPx === "number") { fresh.chart.widthPx = saved.chart.widthPx; }
      if (typeof saved.chart.heightPx === "number") { fresh.chart.heightPx = saved.chart.heightPx; }
    }
    if (saved.export) {
      if (typeof saved.export.pngScale === "number") { fresh.export.pngScale = saved.export.pngScale; }
      if (saved.export.defaultFormat) { fresh.export.defaultFormat = saved.export.defaultFormat; }
    }
    return fresh;
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  function init() {
    document.getElementById("rc-sidebar-toggle").addEventListener("click", function () {
      document.getElementById("rc-app").classList.toggle("rc-sidebar-hidden");
    });
    document.getElementById("rc-validation-toggle").addEventListener("click", function () {
      var panel = document.getElementById("rc-validation");
      panel.hidden = !panel.hidden;
    });
    document.getElementById("rc-download-config").addEventListener("click", function () {
      downloadText("config.yaml", emitYaml());
    });
    document.getElementById("rc-reset").addEventListener("click", function () {
      state = JSON.parse(FILE_STATE);
      refreshControls();
      renderAll();
    });
    document.getElementById("rc-export-all").addEventListener("click", function () {
      RCExports.exportAll(chartRegistry, state);
    });
    document.getElementById("rc-export-excel").addEventListener("click", function () {
      RCExports.exportExcel(state, payload, payload.rates);
    });

    var saved = loadSession();
    if (saved && JSON.stringify(saved) !== FILE_STATE) {
      var restoreBtn = document.getElementById("rc-restore-session");
      restoreBtn.hidden = false;
      restoreBtn.addEventListener("click", function () {
        state = mergeSession(saved);
        restoreBtn.hidden = true;
        refreshControls();
        renderAll();
      });
    }

    buildValidation();
    buildCharts();
    refreshControls();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
