"""config.yaml contract tests: the shipped file and the dashboard's exporter
format both parse into the expected typed configuration."""

from __future__ import annotations

from pathlib import Path

import yaml

from src.validate import ValidationReport, parse_config


def test_shipped_config_parses(repo_root: Path) -> None:
    report = ValidationReport()
    raw = yaml.safe_load((repo_root / "config.yaml").read_text(encoding="utf-8"))
    config = parse_config(raw, report)

    assert config.data_folder == "/Users/valimenai/Documents/RateComps_Data"
    assert config.output_path == "output/dashboard.html"
    assert config.cutoff_date is None
    assert config.primary_forecast == "9+3 Forecast"

    assert [f.file for f in config.forecasts] == [
        "FY26 Plan 10-16.csv",
        "8+4 Forecast.csv",
        "9+3 Forecast.csv",
        "June 5YO Rates.csv",
    ]
    assert [f.color for f in config.forecasts] == ["#BFBFBF", "#8FAADC", "#2F5597", "#FFC000"]
    assert config.forecasts[3].dash == "dash"
    assert all(f.enabled for f in config.forecasts)

    assert config.label_dates == ["2026-07-31", "2026-10-31", "2027-10-31"]
    assert config.always_label_line_ends is True
    assert config.rate_display_names["fed_funds"] == "Fed Funds Effective"
    assert config.tick.anchor_month == 10
    assert config.tick.interval_months == 3
    assert config.y_axis.show is False
    assert config.chart.width_px == 1000
    assert config.export.png_scale == 3

    # The shipped file should parse without complaints.
    assert report.count("warning") == 0
    assert report.count("error") == 0


# Mirrors the exact format app.js emitYaml() produces (keep the two in sync).
EXPORTED = """\
# Rate Comps configuration
# Exported from the dashboard on 8/10/2026, 10:00:00 PM

data_folder: "C:\\\\Treasury\\\\RateComps_Data"
output_path: "output/dashboard.html"

cutoff_date: "2026-05-31"
primary_forecast: "9+3 Forecast"

forecasts:
  - {file: "FY26 Plan 10-16.csv", display_name: "FY26 Plan (10/16)", color: "#BFBFBF", enabled: false}
  - {file: "8+4 Forecast.csv", display_name: "8+4 Forecast", color: "#8FAADC", enabled: true}
  - {file: "9+3 Forecast.csv", display_name: "9+3 Forecast", color: "#2F5597", enabled: true}
  - {file: "June 5YO Rates.csv", display_name: "June 5YO", color: "#FFC000", enabled: true, dash: "dash"}

label_dates: ["2026-07-31", "2027-10-31"]
always_label_line_ends: false

rate_display_names:
  "fed_funds": "Fed Funds Effective"
  "sofr": "SOFR O/N"
rate_order: []
hidden_rates: []

tick:
  anchor_month: 10
  interval_months: 3

y_axis:
  show: true
  default_padding_pct: 8
  per_rate:
    "fed_funds": {auto: false, min: 2.5, max: 5, padding_pct: 10}

chart:
  width_px: 1200
  height_px: 560
  font_family: "Aptos Narrow, Aptos, Calibri, Segoe UI, Arial, sans-serif"
  font_sizes: {title: 18, legend: 12, axis: 12, label: 11, caption: 11}

export:
  png_scale: 3
  default_format: "png"
"""


def test_dashboard_export_format_round_trips() -> None:
    report = ValidationReport()
    config = parse_config(yaml.safe_load(EXPORTED), report)

    assert config.data_folder == "C:\\Treasury\\RateComps_Data"
    assert config.cutoff_date == "2026-05-31"
    assert config.forecasts[0].enabled is False
    assert config.forecasts[3].dash == "dash"
    assert config.label_dates == ["2026-07-31", "2027-10-31"]
    assert config.always_label_line_ends is False
    assert config.y_axis.show is True
    axis = config.y_axis.per_rate["fed_funds"]
    assert axis.auto is False
    assert axis.min == 2.5
    assert axis.max == 5.0
    assert axis.padding_pct == 10.0
    assert config.chart.width_px == 1200
    assert report.count("warning") == 0
    assert report.count("error") == 0
