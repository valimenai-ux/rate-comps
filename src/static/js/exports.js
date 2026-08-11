"use strict";
/**
 * RCExports - all exports run client-side and offline.
 *
 * Images go through Plotly.downloadImage (labels/divider are annotations, so
 * they are part of the exported figure). Excel goes through the bundled
 * xlsx-js-style build (styled cells; that fork has no freeze-pane support,
 * so headers are bold + shaded instead).
 */
var RCExports = (function () {
  function stamp() { return new Date().toISOString().slice(0, 10); }

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

  var HEADER_STYLE = {
    font: { bold: true, sz: 11 },
    fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
    border: { bottom: { style: "thin", color: { rgb: "808080" } } },
    alignment: { horizontal: "right" }
  };
  var HEADER_STYLE_LEFT = {
    font: { bold: true, sz: 11 },
    fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
    border: { bottom: { style: "thin", color: { rgb: "808080" } } },
    alignment: { horizontal: "left" }
  };

  function isoToExcelDate(iso) {
    // Local noon avoids day-shift from timezone conversion inside the writer.
    return new Date(
      parseInt(iso.slice(0, 4), 10),
      parseInt(iso.slice(5, 7), 10) - 1,
      parseInt(iso.slice(8, 10), 10),
      12, 0, 0
    );
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

  function setCell(ws, r, c, cell) {
    ws[XLSX.utils.encode_cell({ r: r, c: c })] = cell;
  }

  function finishSheet(ws, rows, cols) {
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows - 1, c: cols - 1 } });
  }

  function rateSheet(rateKey, rateDisplay, state, payload) {
    var columns = [{ header: "Actuals", series: payload.actuals.series[rateKey] || null }];
    var byName = {};
    payload.forecasts.forEach(function (f) { byName[f.name] = f; });
    state.forecasts.forEach(function (f) {
      if (!f.enabled) { return; }
      var fc = byName[f.name];
      columns.push({ header: f.displayName, series: fc && fc.series[rateKey] ? fc.series[rateKey] : null });
    });

    var monthSet = {};
    columns.forEach(function (col) {
      if (!col.series) { return; }
      col.series.dates.forEach(function (d, i) {
        if (col.series.values[i] !== null && col.series.values[i] !== undefined) { monthSet[d] = true; }
      });
    });
    var months = Object.keys(monthSet).sort();

    var ws = {};
    setCell(ws, 0, 0, { v: "Date", t: "s", s: HEADER_STYLE_LEFT });
    columns.forEach(function (col, c) {
      setCell(ws, 0, c + 1, { v: col.header, t: "s", s: HEADER_STYLE });
    });
    months.forEach(function (iso, r) {
      setCell(ws, r + 1, 0, {
        v: isoToExcelDate(iso), t: "d",
        s: { numFmt: "mmm-yy", alignment: { horizontal: "left" } }
      });
      columns.forEach(function (col, c) {
        var v = null;
        if (col.series) {
          var idx = col.series.dates.indexOf(iso);
          if (idx >= 0) { v = col.series.values[idx]; }
        }
        if (v !== null && v !== undefined) {
          setCell(ws, r + 1, c + 1, { v: v, t: "n", s: { numFmt: "0.00" } });
        }
      });
    });
    finishSheet(ws, months.length + 1, columns.length + 1);
    ws["!cols"] = [{ wch: 10 }].concat(columns.map(function (col) {
      return { wch: Math.max(12, col.header.length + 2) };
    }));
    return ws;
  }

  function readmeSheet(state, payload, sheetNames) {
    var bold = { font: { bold: true, sz: 11 } };
    var title = { font: { bold: true, sz: 13 } };
    var rows = [];
    rows.push([{ v: "Rate Comps - data export", t: "s", s: title }]);
    rows.push([]);
    rows.push([{ v: "Source folder", t: "s", s: bold }, { v: payload.meta.data_folder, t: "s" }]);
    rows.push([{ v: "Actual / Forecast cutoff", t: "s", s: bold }, { v: RCCharts.fmtMonthLong(state.cutoff), t: "s" }]);
    rows.push([{ v: "Dashboard generated", t: "s", s: bold }, { v: payload.meta.generated_at, t: "s" }]);
    rows.push([{ v: "Workbook exported", t: "s", s: bold }, { v: new Date().toLocaleString(), t: "s" }]);
    var primary = RCCharts.effectivePrimary(state);
    var primaryDisplay = "";
    state.forecasts.forEach(function (f) { if (f.name === primary) { primaryDisplay = f.displayName; } });
    rows.push([{ v: "Primary forecast", t: "s", s: bold }, { v: primaryDisplay || "(none)", t: "s" }]);
    rows.push([]);
    rows.push([{ v: "Sheets", t: "s", s: bold }, { v: sheetNames.join(", "), t: "s" }]);
    rows.push([{ v: "Values", t: "s", s: bold }, { v: "Rates in percent, shown to 2 decimals. Blank cells mean the source file has no value for that month.", t: "s" }]);

    var ws = {};
    rows.forEach(function (row, r) {
      row.forEach(function (cell, c) { setCell(ws, r, c, cell); });
    });
    finishSheet(ws, rows.length, 2);
    ws["!cols"] = [{ wch: 26 }, { wch: 80 }];
    return ws;
  }

  function exportExcel(state, payload, rates) {
    var wb = XLSX.utils.book_new();
    var used = {};
    var sheetNames = [];
    rates.forEach(function (rate) {
      var name = sheetNameFor(rate.display_name, used);
      sheetNames.push(name);
      XLSX.utils.book_append_sheet(wb, rateSheet(rate.key, rate.display_name, state, payload), name);
    });
    XLSX.utils.book_append_sheet(wb, readmeSheet(state, payload, sheetNames), sheetNameFor("README", used));
    XLSX.writeFile(wb, "RateComps_Data_" + stamp() + ".xlsx");
  }

  return {
    exportChart: exportChart,
    exportAll: exportAll,
    exportExcel: exportExcel
  };
})();
