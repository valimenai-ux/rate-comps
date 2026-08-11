"use strict";
/**
 * RCExports - all exports run client-side and offline.
 *
 * Images go through Plotly.downloadImage (labels/divider are annotations, so
 * they are part of the exported figure). Excel goes through the vendored
 * ExcelJS bundle: real frozen header row, styled header cells, mmm-yy dates,
 * 0.00 numerics, sized columns, and a README sheet that states exactly what
 * was (and was not) exported.
 *
 * buildWorkbook() is pure (no DOM, no download) so the Node test harness can
 * generate a workbook and the test suite can inspect the resulting XML.
 */
var RCExports = (function () {
  function stamp() {
    // Local date, not UTC: an evening export must not be dated "tomorrow".
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function exportChart(gd, rateDisplay, format, state) {
    return Plotly.downloadImage(gd, {
      format: format,
      width: state.chart.widthPx,
      height: state.chart.heightPx,
      scale: format === "svg" ? 1 : state.export.pngScale,
      filename: RCCharts.fileNameFor(rateDisplay)
    });
  }

  function exportAll(charts, state) {
    // Sequential with a small delay so the browser accepts every download.
    var chain = Promise.resolve();
    charts.forEach(function (entry) {
      chain = chain.then(function () {
        return exportChart(entry.gd, entry.display, state.export.defaultFormat, state);
      }).then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 400); });
      });
    });
    return chain;
  }

  // ------------------------------------------------------------------
  // Excel
  // ------------------------------------------------------------------

  var HEADER_FONT = { bold: true, size: 11 };
  var HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  var HEADER_BORDER = { bottom: { style: "thin", color: { argb: "FF808080" } } };

  function styleHeaderCell(cell, horizontal) {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = HEADER_BORDER;
    cell.alignment = { horizontal: horizontal };
  }

  function isoToExcelDate(iso) {
    // ExcelJS converts dates to serials with pure UTC math, so UTC midnight
    // yields an exact integer serial in every timezone. Integers matter:
    // a fractional serial (a hidden 12:00:00) breaks MATCH/VLOOKUP/EOMONTH
    // joins against real month-end dates and shows up in pivot tables.
    return new Date(Date.UTC(
      parseInt(iso.slice(0, 4), 10),
      parseInt(iso.slice(5, 7), 10) - 1,
      parseInt(iso.slice(8, 10), 10)
    ));
  }

  function sheetNameFor(displayName, used) {
    var name = String(displayName).replace(/[\[\]\*\?:\/\\]/g, " ").replace(/\s+/g, " ").trim();
    if (!name) { name = "Rate"; }
    name = name.slice(0, 31);
    var candidate = name;
    var n = 2;
    while (used[candidate.toLowerCase()]) {
      var suffix = " (" + n + ")";
      candidate = name.slice(0, 31 - suffix.length) + suffix;
      n += 1;
    }
    used[candidate.toLowerCase()] = true;
    return candidate;
  }

  function cutoffFiltered(series, cutoff) {
    // The workbook mirrors the charts: actual history ends at the cutoff.
    if (!series) { return null; }
    var out = { dates: [], values: [] };
    series.dates.forEach(function (d, i) {
      if (d <= cutoff) { out.dates.push(d); out.values.push(series.values[i]); }
    });
    return out.dates.length ? out : null;
  }

  function fillRateSheet(ws, rateKey, state, payload) {
    var columns = [{
      header: "Actuals",
      series: cutoffFiltered(payload.actuals.series[rateKey] || null, state.cutoff)
    }];
    var byName = {};
    payload.forecasts.forEach(function (f) { byName[f.name] = f; });
    state.forecasts.forEach(function (f) {
      if (!f.enabled) { return; }
      var fc = byName[f.name];
      if (!fc || !fc.series[rateKey]) { return; } // no data for this rate
      columns.push({ header: f.displayName, series: fc.series[rateKey] });
    });

    var monthSet = {};
    columns.forEach(function (col) {
      if (!col.series) { return; }
      col.series.dates.forEach(function (d, i) {
        if (col.series.values[i] !== null && col.series.values[i] !== undefined) { monthSet[d] = true; }
      });
    });
    var months = Object.keys(monthSet).sort();

    var head = ws.getCell(1, 1);
    head.value = "Date";
    styleHeaderCell(head, "left");
    columns.forEach(function (col, c) {
      var cell = ws.getCell(1, c + 2);
      cell.value = col.header;
      styleHeaderCell(cell, "right");
    });

    months.forEach(function (iso, r) {
      var dateCell = ws.getCell(r + 2, 1);
      dateCell.value = isoToExcelDate(iso);
      dateCell.numFmt = "mmm-yy";
      dateCell.alignment = { horizontal: "left" };
      columns.forEach(function (col, c) {
        var v = null;
        if (col.series) {
          var idx = col.series.dates.indexOf(iso);
          if (idx >= 0) { v = col.series.values[idx]; }
        }
        if (v !== null && v !== undefined) {
          var cell = ws.getCell(r + 2, c + 2);
          cell.value = v;
          cell.numFmt = "0.00";
        }
      });
    });

    ws.getColumn(1).width = 10;
    columns.forEach(function (col, c) {
      ws.getColumn(c + 2).width = Math.max(12, col.header.length + 2);
    });
  }

  function fillReadmeSheet(ws, state, payload, sheetNames) {
    var rows = [];
    function push(label, value) { rows.push([label, value]); }
    push("Rate Comps - data export", null);
    push(null, null);
    push("Source folder", payload.meta.data_folder);
    push("Actual / Forecast cutoff", RCCharts.fmtMonthLong(state.cutoff));
    push("Dashboard generated", payload.meta.generated_at);
    push("Workbook exported", new Date().toLocaleString());
    var primary = RCCharts.effectivePrimary(state);
    var primaryDisplay = "";
    state.forecasts.forEach(function (f) { if (f.name === primary) { primaryDisplay = f.displayName; } });
    push("Primary forecast", primaryDisplay || "(none)");
    push(null, null);
    push("Sheets", sheetNames.join(", "));
    push("Values", "Rates in percent, shown to 2 decimals. Blank cells mean the source file has no value for that month.");
    push("Scope", "This workbook contains only what the dashboard currently shows: rates hidden by the configuration and forecasts toggled off are NOT included. The Actuals column ends at the cutoff month above; forecast columns carry each file's full span.");
    var disabled = state.forecasts.filter(function (f) { return !f.enabled; })
      .map(function (f) { return f.displayName; });
    push("Forecasts excluded (toggled off)", disabled.length ? disabled.join(", ") : "(none)");
    var hidden = (payload.defaults.hidden_rates || []).slice();
    push("Rates excluded (hidden by config)", hidden.length ? hidden.join(", ") : "(none)");

    rows.forEach(function (row, r) {
      if (row[0] !== null) {
        var label = ws.getCell(r + 1, 1);
        label.value = row[0];
        label.font = r === 0 ? { bold: true, size: 13 } : { bold: true, size: 11 };
      }
      if (row[1] !== null && row[1] !== undefined) {
        ws.getCell(r + 1, 2).value = row[1];
        ws.getCell(r + 1, 2).alignment = { wrapText: false };
      }
    });
    ws.getColumn(1).width = 32;
    ws.getColumn(2).width = 90;
  }

  /** Pure workbook construction - shared by the browser and the Node tests. */
  function buildWorkbook(state, payload, rates) {
    var wb = new ExcelJS.Workbook();
    wb.creator = "Rate Comps";
    var used = {};
    var sheetNames = [];
    var pending = [];
    rates.forEach(function (rate) {
      var name = sheetNameFor(rate.display_name, used);
      sheetNames.push(name);
      pending.push({ name: name, key: rate.key });
    });
    pending.forEach(function (p) {
      var ws = wb.addWorksheet(p.name, {
        views: [{ state: "frozen", ySplit: 1 }]  // real frozen header row
      });
      fillRateSheet(ws, p.key, state, payload);
    });
    var readme = wb.addWorksheet(sheetNameFor("README", used));
    fillReadmeSheet(readme, state, payload, sheetNames);
    return wb;
  }

  function exportExcel(state, payload, rates) {
    var wb = buildWorkbook(state, payload, rates);
    return wb.xlsx.writeBuffer().then(function (buffer) {
      var blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "RateComps_Data_" + stamp() + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    });
  }

  return {
    exportChart: exportChart,
    exportAll: exportAll,
    exportExcel: exportExcel,
    buildWorkbook: buildWorkbook
  };
})();

/* Node export used only by the automated test harness. */
if (typeof module !== "undefined" && module.exports) { module.exports = RCExports; }
