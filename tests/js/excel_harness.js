"use strict";
/**
 * Node harness for the Excel export (run by test_excel_export.py).
 * Builds a workbook through the real RCExports.buildWorkbook against the
 * vendored ExcelJS bundle and writes it to the path given as argv[2]; the
 * Python side unzips it and asserts on the raw OOXML (frozen pane, number
 * formats, per-rate columns, README scope notes).
 */
var path = require("path");
var fs = require("fs");
var root = path.join(__dirname, "..", "..");

global.ExcelJS = require(path.join(root, "src", "static", "js", "vendor", "exceljs.bundle.js"));
// exports.js touches RCCharts only for two helpers; stub them (same logic).
global.RCCharts = {
  fmtMonthLong: function (iso) { return iso; },
  effectivePrimary: function (state) {
    var enabled = state.forecasts.filter(function (f) { return f.enabled; });
    if (enabled.length === 0) { return null; }
    for (var i = 0; i < enabled.length; i++) {
      if (enabled[i].name === state.primary) { return enabled[i].name; }
    }
    return enabled[0].name;
  }
};
var RCExports = require(path.join(root, "src", "static", "js", "exports.js"));

var payload = {
  meta: { data_folder: "C:\\Treasury\\RateComps_Data", generated_at: "2026-08-11 09:00" },
  defaults: { hidden_rates: ["prime_rate"] },
  actuals: {
    series: {
      // 3.99 sits past the cutoff (2026-06-30): it must NOT be exported.
      fed_funds: { dates: ["2026-05-31", "2026-06-30", "2026-07-31"], values: [3.62, 3.63, 3.99] },
      sofr: { dates: ["2026-05-31", "2026-06-30"], values: [3.62, 3.62] }
    }
  },
  forecasts: [
    {
      name: "9+3 Forecast",
      series: { fed_funds: { dates: ["2026-07-31", "2026-08-31"], values: [3.63, 3.63] } }
      // note: no sofr series - the SOFR sheet must NOT get a 9+3 column
    },
    {
      name: "Old Plan",
      series: { fed_funds: { dates: ["2026-07-31"], values: [3.1] } }
    }
  ]
};

var state = {
  cutoff: "2026-06-30",
  primary: "9+3 Forecast",
  forecasts: [
    { name: "9+3 Forecast", displayName: "9+3 Forecast", enabled: true },
    { name: "Old Plan", displayName: "FY25 Old Plan", enabled: false }
  ]
};

var rates = [
  { key: "fed_funds", display_name: "Fed Funds Effective" },
  { key: "sofr", display_name: "SOFR O/N" }
];

var out = process.argv[2];
if (!out) {
  console.error("usage: node excel_harness.js <output.xlsx>");
  process.exit(2);
}

var wb = RCExports.buildWorkbook(state, payload, rates);
wb.xlsx.writeBuffer().then(function (buffer) {
  fs.writeFileSync(out, Buffer.from(buffer));
  console.log("ok - workbook written");
}).catch(function (err) {
  console.error("FAIL: " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
