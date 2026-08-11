"use strict";
/**
 * Node harness for the RCYaml config emitter (run by test_config_roundtrip.py).
 * Emits, on stdout, the exact YAML the dashboard's "Download config.yaml"
 * button would produce for a deliberately non-default state; the Python side
 * parses it with the real parse_config and asserts the state survives.
 */
var path = require("path");
var RCYaml = require(path.join(__dirname, "..", "..", "src", "static", "js", "yaml_export.js"));

var state = {
  cutoff: "2026-05-31", // != lastActual, so it must be exported explicitly
  primary: "9+3 Forecast",
  labelDates: ["2026-07-31", "2027-10-31"],
  labelLineEnds: false,
  tick: { anchorMonth: 10, intervalMonths: 3 },
  yAxis: {
    show: true,
    defaultPaddingPct: 8,
    perRate: {
      fed_funds: { auto: false, min: 2.5, max: 5, paddingPct: 10 },
      sofr: { auto: true, min: null, max: null, paddingPct: null },
      ust_10yr: { auto: true, min: null, max: null, paddingPct: null }
    }
  },
  chart: {
    widthPx: 1200,
    heightPx: 560,
    fontFamily: "Aptos Narrow, Aptos, Calibri, Segoe UI, Arial, sans-serif",
    fontSizes: { title: 18, legend: 12, axis: 12, label: 11, caption: 11 }
  },
  forecasts: [
    { name: "FY26 Plan 10-16", file: "FY26 Plan 10-16.csv", displayName: "FY26 Plan (10/16)", color: "#BFBFBF", dash: "solid", enabled: false },
    { name: "8+4 Forecast", file: "8+4 Forecast.csv", displayName: "8+4 Forecast", color: "#8FAADC", dash: "solid", enabled: true },
    { name: "9+3 Forecast", file: "9+3 Forecast.csv", displayName: "9+3 Forecast", color: "#2F5597", dash: "solid", enabled: true },
    { name: "June 5YO Rates", file: "June 5YO Rates.csv", displayName: "June 5YO", color: "#FFC000", dash: "dash", enabled: true }
  ],
  export: { pngScale: 3, defaultFormat: "png" }
};

var ctx = {
  dataFolder: "C:\\Treasury\\RateComps_Data", // Windows path must survive
  outputPath: "output/dashboard.html",
  lastActual: "2026-06-30",
  primaryName: "9+3 Forecast",
  rates: [
    { key: "fed_funds", display_name: "Fed Funds Effective" },
    { key: "sofr", display_name: "SOFR O/N" },
    { key: "ust_10yr", display_name: "10YR UST" }
  ],
  rateDisplayNames: { fed_funds: "Fed Funds Effective", sofr: "SOFR O/N", ust_10yr: "10YR UST" },
  rateOrder: [],
  hiddenRates: ["prime_rate"],
  // Axis override for a hidden rate: must survive the export untouched.
  extraPerRate: { prime_rate: { auto: false, min: 6.0, max: 8.0, padding_pct: null } },
  exportedAt: "TEST-RUN"
};

process.stdout.write(RCYaml.emit(state, ctx));
