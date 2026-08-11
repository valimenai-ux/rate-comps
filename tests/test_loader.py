"""Loader tests: discovery, normalization, unions, spans, fail-soft behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.loader import load_dashboard
from src.model import AppConfig, ForecastEntry
from src.validate import ConfigError, ValidationReport


def _load(folder: Path, config: AppConfig):
    report = ValidationReport()
    dashboard = load_dashboard(config, folder, report)
    return dashboard, report


def _warnings(report: ValidationReport) -> str:
    return "\n".join(m.message for m in report.messages if m.level == "warning")


ACTUALS = "date,fed_funds,sofr\n2026-01-31,3.5,3.6\n2026-02-28,3.4,3.5\n2026-03-31,3.3,3.4\n"


def test_sample_folder_end_to_end(sample_folder: Path) -> None:
    config = AppConfig(data_folder=str(sample_folder))
    dashboard, report = _load(sample_folder, config)

    # Rate union: actuals column order first, extras appended.
    assert [r.key for r in dashboard.rates] == ["fed_funds", "sofr", "prime_rate"]

    # Discovered forecasts (none listed in config) get the reserved colors.
    assert [f.name for f in dashboard.forecasts] == ["Alpha Forecast", "Beta Forecast"]
    assert [f.color for f in dashboard.forecasts] == ["#2E8B8B", "#7A5FA8"]

    # Case-insensitive header matching: Beta's "FED FUNDS" joins fed_funds.
    beta = dashboard.forecasts[1]
    assert "fed_funds" in beta.table.series
    # Mon-YY and M/D/YYYY dates normalized to ISO month-ends.
    assert beta.table.series["fed_funds"].dates == ["2026-03-31", "2026-04-30"]

    # Cutoff resolves to the last actuals month; a fallback primary is chosen.
    assert dashboard.cutoff_date == "2026-02-28"
    assert dashboard.cutoff_is_auto is True
    assert dashboard.primary == "Alpha Forecast"


def test_mismatched_spans_are_never_clipped(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv(
        "Vintage.csv",
        "date,fed_funds\n2025-11-30,3.9\n2025-12-31,3.8\n2026-01-31,3.55\n2026-04-30,3.2\n",
    )
    dashboard, _ = _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    vintage = dashboard.forecasts[0]
    # Pre-cutoff history is preserved exactly as provided.
    assert vintage.table.series["fed_funds"].dates[0] == "2025-11-30"
    assert vintage.table.date_min == "2025-11-30"
    assert vintage.table.date_max == "2026-04-30"


def test_duplicate_months_keep_last_and_warn(write_csv, tmp_path: Path) -> None:
    write_csv(
        "actuals.csv",
        "date,fed_funds\n2026-01-31,3.5\n2026-01-15,9.9\n2026-02-28,3.4\n",
    )
    write_csv("F.csv", "date,fed_funds\n2026-03-31,3.0\n")
    dashboard, report = _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    series = dashboard.actuals.series["fed_funds"]
    assert series.dates == ["2026-01-31", "2026-02-28"]
    assert series.values[0] == 9.9  # last row for the duplicated month wins
    assert "Duplicate month" in _warnings(report)


def test_more_than_six_forecasts_warns_and_caps(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    for i in range(7):
        write_csv("Forecast %d.csv" % i, "date,fed_funds\n2026-04-30,3.%d\n" % i)
    dashboard, report = _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    assert len(dashboard.forecasts) == 6
    assert "only 6 are supported" in _warnings(report)
    assert "Forecast 6.csv" in _warnings(report)


def test_bad_file_is_skipped_but_rest_renders(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv("Broken.csv", "date\n2026-01-31\n")  # no rate columns
    write_csv("Good.csv", "date,fed_funds\n2026-04-30,3.2\n")
    dashboard, report = _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    assert [f.name for f in dashboard.forecasts] == ["Good"]
    errors = [m for m in report.messages if m.level == "error"]
    assert any("Broken.csv" in m.source for m in errors)


def test_missing_actuals_raises_config_error(write_csv, tmp_path: Path) -> None:
    write_csv("Only Forecast.csv", "date,fed_funds\n2026-04-30,3.2\n")
    with pytest.raises(ConfigError) as excinfo:
        _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    assert "actuals.csv" in str(excinfo.value)


def test_missing_data_folder_raises_config_error(tmp_path: Path) -> None:
    config = AppConfig(data_folder=str(tmp_path / "nope"))
    with pytest.raises(ConfigError) as excinfo:
        _load(tmp_path, config)
    assert "data folder" in str(excinfo.value)


def test_rate_order_and_hidden_rates(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv("F.csv", "date,fed_funds,prime\n2026-04-30,3.2,6.5\n")
    config = AppConfig(data_folder=str(tmp_path))
    config.rate_order = ["sofr"]
    config.hidden_rates = ["prime"]
    dashboard, _ = _load(tmp_path, config)
    assert [r.key for r in dashboard.rates] == ["sofr", "fed_funds"]


def test_primary_matches_display_name_and_disabled_falls_back(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv("A.csv", "date,fed_funds\n2026-04-30,3.2\n")
    write_csv("B.csv", "date,fed_funds\n2026-04-30,3.1\n")
    config = AppConfig(data_folder=str(tmp_path))
    config.forecasts = [
        ForecastEntry(file="A.csv", display_name="Plan Alpha"),
        ForecastEntry(file="B.csv", display_name="Plan Beta"),
    ]
    config.primary_forecast = "plan beta"  # case-insensitive display-name match
    dashboard, _ = _load(tmp_path, config)
    assert dashboard.primary == "B"

    config.forecasts[1].enabled = False
    dashboard, report = _load(tmp_path, config)
    assert dashboard.primary == "A"
    assert "disabled" in _warnings(report)


def test_forecast_listed_but_missing_is_skipped_with_warning(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv("Real.csv", "date,fed_funds\n2026-04-30,3.2\n")
    config = AppConfig(data_folder=str(tmp_path))
    config.forecasts = [
        ForecastEntry(file="Ghost.csv"),
        ForecastEntry(file="Real.csv"),
    ]
    dashboard, report = _load(tmp_path, config)
    assert [f.name for f in dashboard.forecasts] == ["Real"]
    assert "Ghost.csv" in _warnings(report)


def test_no_overlap_forecast_warns(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv("Far Future.csv", "date,fed_funds\n2031-01-31,2.0\n")
    _, report = _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    assert "shares no months" in _warnings(report)


def test_blank_cells_break_series_but_keep_rows(write_csv, tmp_path: Path) -> None:
    write_csv("actuals.csv", ACTUALS)
    write_csv("Gaps.csv", "date,fed_funds,sofr\n2026-04-30,3.2,\n2026-05-31,,3.1\n")
    dashboard, _ = _load(tmp_path, AppConfig(data_folder=str(tmp_path)))
    gaps = dashboard.forecasts[0].table.series
    assert gaps["fed_funds"].values == [3.2, None]
    assert gaps["sofr"].values == [None, 3.1]
