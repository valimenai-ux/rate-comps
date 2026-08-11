"""Load config.yaml and the data folder into a :class:`~src.model.Dashboard`.

Fail-soft philosophy: a broken forecast file is skipped with a clear message
and everything valid still renders. Only problems that make generation
impossible (unreadable config, missing data folder, unusable actuals.csv)
raise :class:`~src.validate.ConfigError`.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import pandas as pd
import yaml

from .model import (
    AppConfig,
    Dashboard,
    ForecastEntry,
    ForecastSlot,
    RateInfo,
    Series,
    SourceTable,
)
from .validate import (
    EXTRA_FORECAST_COLORS,
    ConfigError,
    ValidationReport,
    iso,
    normalize_rate_key,
    parse_config,
    parse_date_to_month_end,
)

MAX_FORECASTS = 6

ACTUALS_FILE_NAME = "actuals.csv"


def fmt_month(iso_date: str) -> str:
    """``2026-06-30`` -> ``Jun-2026`` (for human-readable messages)."""
    d = dt.date.fromisoformat(iso_date)
    return d.strftime("%b-%Y")


def load_config(path: Path, report: ValidationReport) -> AppConfig:
    """Read and parse config.yaml with user-readable failure messages."""
    if not path.exists():
        raise ConfigError(
            "Could not find the settings file %s.\n"
            "It should sit next to RateComps.py." % path
        )
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(
            "config.yaml could not be read (YAML syntax problem):\n  %s\n"
            "Tip: values containing '#' or ':' must be wrapped in quotes." % exc
        )
    return parse_config(raw, report)


# --------------------------------------------------------------------------
# CSV reading
# --------------------------------------------------------------------------


def _read_csv_text(path: Path) -> pd.DataFrame:
    """Read a CSV as strings, tolerating Excel BOMs and legacy encodings."""
    try:
        return pd.read_csv(
            path, dtype=str, encoding="utf-8-sig", keep_default_na=False,
            skip_blank_lines=True, on_bad_lines="skip",
        )
    except UnicodeDecodeError:
        return pd.read_csv(
            path, dtype=str, encoding="latin-1", keep_default_na=False,
            skip_blank_lines=True, on_bad_lines="skip",
        )


def _parse_number(token: str) -> Optional[float]:
    s = token.strip().replace(",", "").replace("%", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def read_table(path: Path, report: ValidationReport) -> Optional[SourceTable]:
    """Parse one CSV into a :class:`SourceTable`. Returns ``None`` (with an
    error in the report) when the file is unusable."""
    source = path.name
    try:
        df = _read_csv_text(path)
    except Exception as exc:  # pandas raises several parser/IO error types
        report.error(source, "File skipped - could not be read as a CSV (%s)." % exc)
        return None

    if df.shape[1] < 2:
        report.error(
            source,
            "File skipped - expected a 'date' column plus at least one rate column.",
        )
        return None

    columns = [str(c) for c in df.columns]
    date_header = columns[0]
    if normalize_rate_key(date_header) != "date":
        report.warning(
            source,
            "First column is named %r (expected 'date'); treating it as the date column."
            % date_header,
        )

    # Map rate columns to canonical keys, keeping the first occurrence of dupes.
    rate_keys: List[str] = []
    original_headers: Dict[str, str] = {}
    col_for_key: Dict[str, str] = {}
    for header in columns[1:]:
        key = normalize_rate_key(header)
        if not key:
            report.warning(source, "A rate column has an empty header; column ignored.")
            continue
        if key in col_for_key:
            report.warning(
                source,
                "Columns %r and %r are the same rate after normalization; keeping %r."
                % (col_for_key[key], header, col_for_key[key]),
            )
            continue
        col_for_key[key] = header
        original_headers[key] = header.strip()
        rate_keys.append(key)

    if not rate_keys:
        report.error(source, "File skipped - no usable rate columns found.")
        return None

    # Parse rows: date first, then one value per rate column.
    rows: Dict[dt.date, Dict[str, Optional[float]]] = {}
    bad_dates: List[str] = []
    bad_numbers: Dict[str, int] = {}
    duplicate_months: List[str] = []
    for _, row in df.iterrows():
        token = str(row.iloc[0])
        date = parse_date_to_month_end(token)
        if date is None:
            if token.strip():
                bad_dates.append(token.strip())
            continue
        values: Dict[str, Optional[float]] = {}
        for key in rate_keys:
            raw_value = str(row[col_for_key[key]])
            value = _parse_number(raw_value)
            if value is None and raw_value.strip():
                bad_numbers[key] = bad_numbers.get(key, 0) + 1
            values[key] = value
        if date in rows:
            duplicate_months.append(fmt_month(iso(date)))
        rows[date] = values  # duplicates: last occurrence wins

    if bad_dates:
        examples = ", ".join(repr(t) for t in bad_dates[:3])
        report.warning(
            source,
            "%d row(s) had unparseable dates and were skipped (e.g. %s)."
            % (len(bad_dates), examples),
        )
    if duplicate_months:
        report.warning(
            source,
            "Duplicate month(s) %s - kept the last row for each."
            % ", ".join(sorted(set(duplicate_months))),
        )
    for key, count in bad_numbers.items():
        report.warning(source, "Column '%s': %d non-numeric value(s) treated as blanks." % (key, count))

    if not rows:
        report.error(source, "File skipped - no rows with recognizable dates.")
        return None

    ordered_dates = sorted(rows)
    table = SourceTable(
        file_name=source,
        rate_keys=list(rate_keys),
        original_headers=original_headers,
        row_count=len(ordered_dates),
        date_min=iso(ordered_dates[0]),
        date_max=iso(ordered_dates[-1]),
    )
    for key in rate_keys:
        series = Series(
            dates=[iso(d) for d in ordered_dates],
            values=[rows[d][key] for d in ordered_dates],
        )
        if series.has_data():
            table.series[key] = series
        else:
            report.info(source, "Column '%s' has no values in this file; ignored." % key)
            table.original_headers.pop(key, None)
    table.rate_keys = [k for k in table.rate_keys if k in table.series]

    if not table.series:
        report.error(source, "File skipped - all rate columns are empty.")
        return None

    report.info(
        source,
        "%d month(s), %s to %s, rates: %s"
        % (
            table.row_count,
            fmt_month(table.date_min or ""),
            fmt_month(table.date_max or ""),
            ", ".join(table.rate_keys),
        ),
    )
    return table


# --------------------------------------------------------------------------
# Folder discovery and dashboard assembly
# --------------------------------------------------------------------------


def _resolve_data_folder(config: AppConfig, config_dir: Path, override: Optional[Path]) -> Path:
    folder = override if override is not None else Path(config.data_folder).expanduser()
    if not folder.is_absolute():
        folder = (config_dir / folder).resolve()
    if not folder.is_dir():
        raise ConfigError(
            "The data folder does not exist:\n  %s\n"
            "Open config.yaml and point 'data_folder' at the folder that "
            "contains actuals.csv and the forecast CSVs." % folder
        )
    return folder


def _find_actuals(folder: Path, csv_files: List[Path]) -> Path:
    for path in csv_files:
        if path.name.lower() == ACTUALS_FILE_NAME:
            return path
    found = ", ".join(p.name for p in csv_files[:10]) or "none"
    raise ConfigError(
        "actuals.csv was not found in the data folder:\n  %s\n"
        "CSV files found there: %s" % (folder, found)
    )


def _forecast_candidates(
    config: AppConfig, csv_files: List[Path], actuals_path: Path, report: ValidationReport
) -> List[Tuple[ForecastEntry, Path]]:
    """Config-listed files first (config order), then unlisted CSVs found on
    disk (alphabetically) with automatic colors."""
    by_lower: Dict[str, Path] = {p.name.lower(): p for p in csv_files}
    candidates: List[Tuple[ForecastEntry, Path]] = []
    claimed: Set[str] = {actuals_path.name.lower()}

    for entry in config.forecasts:
        lower = entry.file.lower()
        if not lower.endswith(".csv"):
            lower += ".csv"
        path = by_lower.get(lower)
        if path is None:
            report.warning(
                "config", "Forecast file %r is listed in config.yaml but was not found; skipped." % entry.file
            )
            continue
        if path.name.lower() in claimed:
            report.warning("config", "Forecast file %r appears twice in config.yaml; second entry ignored." % entry.file)
            continue
        claimed.add(path.name.lower())
        candidates.append((entry, path))

    discovered = sorted(
        (p for p in csv_files if p.name.lower() not in claimed),
        key=lambda p: p.name.lower(),
    )
    for path in discovered:
        report.info(path.name, "New forecast CSV discovered (not listed in config.yaml); added automatically.")
        candidates.append((ForecastEntry(file=path.name), path))
    return candidates


def _assign_color(entry: ForecastEntry, used: Set[str]) -> str:
    if entry.color is not None:
        return entry.color
    for color in EXTRA_FORECAST_COLORS:
        if color.lower() not in used:
            return color
    return "#999999"


def _resolve_primary(config: AppConfig, slots: List[ForecastSlot], report: ValidationReport) -> Optional[str]:
    enabled = [s for s in slots if s.enabled]
    if not enabled:
        report.warning("config", "No forecasts are enabled; charts show actual history only.")
        return None

    target = config.primary_forecast
    if target:
        wanted = normalize_rate_key(target[:-4] if target.lower().endswith(".csv") else target)
        for slot in slots:
            aliases = {
                normalize_rate_key(slot.name),
                normalize_rate_key(slot.display_name),
                normalize_rate_key(slot.table.file_name[:-4]),
            }
            if wanted in aliases:
                if slot.enabled:
                    return slot.name
                report.warning(
                    "config",
                    "primary_forecast %r is disabled; using %r as the primary instead."
                    % (target, enabled[0].display_name),
                )
                return enabled[0].name
        report.warning(
            "config",
            "primary_forecast %r does not match any loaded forecast; using %r."
            % (target, enabled[0].display_name),
        )
    else:
        report.warning("config", "No primary_forecast set; using %r." % enabled[0].display_name)
    return enabled[0].name


def _check_overlaps(actuals: SourceTable, slots: List[ForecastSlot], report: ValidationReport) -> None:
    """Warn when a forecast shares no months with any other file (usually a
    sign of wrong dates)."""
    months_by_name: Dict[str, Set[str]] = {}
    for slot in slots:
        months: Set[str] = set()
        for series in slot.table.series.values():
            months.update(series.dates)
        months_by_name[slot.name] = months
    actual_months: Set[str] = set()
    for series in actuals.series.values():
        actual_months.update(series.dates)

    for slot in slots:
        others: Set[str] = set(actual_months)
        for other in slots:
            if other.name != slot.name:
                others.update(months_by_name[other.name])
        if others and not (months_by_name[slot.name] & others):
            report.warning(
                slot.table.file_name,
                "This forecast shares no months with any other file - check its dates.",
            )


def _rate_union(
    config: AppConfig, actuals: SourceTable, slots: List[ForecastSlot], report: ValidationReport
) -> List[RateInfo]:
    ordered: List[str] = list(actuals.rate_keys)
    for slot in slots:
        for key in slot.table.rate_keys:
            if key not in ordered:
                ordered.append(key)
                report.info(
                    slot.table.file_name,
                    "New rate '%s' discovered; it gets its own chart." % key,
                )

    if config.rate_order:
        unknown = [k for k in config.rate_order if k not in ordered]
        for key in unknown:
            report.warning("config", "rate_order mentions unknown rate '%s'; ignored." % key)
        listed = [k for k in config.rate_order if k in ordered]
        ordered = listed + [k for k in ordered if k not in listed]

    hidden = set(config.hidden_rates)
    shown = [k for k in ordered if k not in hidden]
    for key in ordered:
        if key in hidden:
            report.info("config", "Rate '%s' is hidden by config." % key)

    def display_name(key: str) -> str:
        if key in config.rate_display_names:
            return config.rate_display_names[key]
        if key in actuals.original_headers:
            return actuals.original_headers[key]
        for slot in slots:
            if key in slot.table.original_headers:
                return slot.table.original_headers[key]
        return key

    return [RateInfo(key=k, display_name=display_name(k)) for k in shown]


def _resolve_cutoff(config: AppConfig, actuals: SourceTable, report: ValidationReport) -> Tuple[str, bool]:
    last_actual = actuals.date_max
    assert last_actual is not None  # actuals always has rows by this point
    if config.cutoff_date:
        parsed = parse_date_to_month_end(config.cutoff_date)
        if parsed is None:
            report.warning(
                "config",
                "cutoff_date %r is not a recognizable date; using the last actuals month (%s)."
                % (config.cutoff_date, fmt_month(last_actual)),
            )
            return last_actual, True
        return iso(parsed), False
    return last_actual, True


def load_dashboard(
    config: AppConfig,
    config_dir: Path,
    report: ValidationReport,
    data_folder_override: Optional[Path] = None,
) -> Dashboard:
    """Discover, parse and assemble everything the dashboard needs."""
    folder = _resolve_data_folder(config, config_dir, data_folder_override)
    csv_files = sorted(folder.glob("*.csv"), key=lambda p: p.name.lower())
    report.info("folder", "%s - %d CSV file(s) found." % (folder, len(csv_files)))

    actuals_path = _find_actuals(folder, csv_files)
    actuals = read_table(actuals_path, report)
    if actuals is None:
        raise ConfigError(
            "actuals.csv could not be used - see the messages above. "
            "It must have a 'date' column plus one column per rate."
        )

    candidates = _forecast_candidates(config, csv_files, actuals_path, report)
    if len(candidates) > MAX_FORECASTS:
        skipped = ", ".join(path.name for _, path in candidates[MAX_FORECASTS:])
        report.warning(
            "folder",
            "%d forecasts found but only %d are supported; skipped: %s"
            % (len(candidates), MAX_FORECASTS, skipped),
        )
        candidates = candidates[:MAX_FORECASTS]

    slots: List[ForecastSlot] = []
    used_colors: Set[str] = set()
    for entry, path in candidates:
        table = read_table(path, report)
        if table is None:
            continue  # fail-soft: message already recorded
        color = _assign_color(entry, used_colors)
        used_colors.add(color.lower())
        slots.append(
            ForecastSlot(
                name=path.stem,
                display_name=entry.display_name or path.stem,
                color=color,
                dash=entry.dash,
                enabled=entry.enabled,
                table=table,
            )
        )

    if not slots:
        report.warning("folder", "No forecast files could be loaded; charts show actual history only.")

    _check_overlaps(actuals, slots, report)
    rates = _rate_union(config, actuals, slots, report)
    cutoff, cutoff_is_auto = _resolve_cutoff(config, actuals, report)
    primary = _resolve_primary(config, slots, report)

    return Dashboard(
        data_folder=str(folder),
        output_path=config.output_path,
        generated_at=dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        cutoff_date=cutoff,
        cutoff_is_auto=cutoff_is_auto,
        primary=primary,
        label_dates=list(config.label_dates),
        always_label_line_ends=config.always_label_line_ends,
        rates=rates,
        actuals=actuals,
        forecasts=slots,
        rate_order_config=list(config.rate_order),
        hidden_rates=list(config.hidden_rates),
        rate_display_names=dict(config.rate_display_names),
        tick=config.tick,
        y_axis=config.y_axis,
        chart=config.chart,
        export=config.export,
        validation=report.messages,
    )
