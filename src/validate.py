"""Normalization and validation primitives.

Hosts the pieces the loader (and tests) lean on:

* date parsing / month-end normalization,
* rate-name canonicalization,
* the fail-soft :class:`ValidationReport`,
* config.yaml parsing into a typed :class:`~src.model.AppConfig`.
"""

from __future__ import annotations

import calendar
import datetime as dt
import re
from typing import Any, Dict, List, Optional

from .model import (
    AppConfig,
    ChartConfig,
    ExportConfig,
    FontSizes,
    ForecastEntry,
    RateAxis,
    TickConfig,
    ValidationMessage,
    YAxisConfig,
)


class ConfigError(Exception):
    """A configuration problem with a user-readable message."""


# --------------------------------------------------------------------------
# Dates
# --------------------------------------------------------------------------

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_RE_ISO = re.compile(r"^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ].*)?$")
_RE_MDY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$")
_RE_MON_YY = re.compile(r"^([A-Za-z]{3,9})[- ]?(\d{2}|\d{4})$")


def month_end(year: int, month: int) -> dt.date:
    """Last calendar day of the given month."""
    return dt.date(year, month, calendar.monthrange(year, month)[1])


def _expand_year(y: int) -> int:
    """Excel's two-digit-year rule: 00-29 -> 2000s, 30-99 -> 1900s.

    Without the pivot, a legacy row like '10/31/99' would become 2099 and
    silently drag the auto-cutoff (last actuals month) seventy years out.
    """
    if y >= 100:
        return y
    return y + 2000 if y < 30 else y + 1900


def parse_date_to_month_end(token: str) -> Optional[dt.date]:
    """Parse a date token and normalize it to month-end.

    Accepted formats: ISO ``YYYY-MM-DD`` (or ``YYYY-MM``, with an optional
    time suffix), US ``M/D/YYYY`` (2- or 4-digit year), and ``Mon-YY``
    (also ``Mon YYYY``). Returns ``None`` when the token is unparseable.
    """
    s = str(token).strip()
    if not s:
        return None

    m = _RE_ISO.match(s)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        return month_end(year, month) if 1 <= month <= 12 else None

    m = _RE_MDY.match(s)
    if m:
        month, year = int(m.group(1)), _expand_year(int(m.group(3)))
        return month_end(year, month) if 1 <= month <= 12 else None

    m = _RE_MON_YY.match(s)
    if m:
        month_num = _MONTHS.get(m.group(1)[:3].lower())
        if month_num is None:
            return None
        return month_end(_expand_year(int(m.group(2))), month_num)

    return None


def iso(d: dt.date) -> str:
    """ISO string for a date (payload canonical form)."""
    return d.isoformat()


# --------------------------------------------------------------------------
# Rate names
# --------------------------------------------------------------------------


def normalize_rate_key(name: str) -> str:
    """Canonical rate key: trimmed, lowercased, whitespace/underscore runs
    collapsed to single underscores. ``"Fed Funds"``, ``"fed_funds"`` and
    ``"FED  FUNDS"`` all map to ``"fed_funds"``.
    """
    return re.sub(r"[\s_]+", "_", str(name).strip().lower())


# --------------------------------------------------------------------------
# Validation report
# --------------------------------------------------------------------------


class ValidationReport:
    """Collects info/warning/error lines while loading, fail-soft style."""

    def __init__(self) -> None:
        self.messages: List[ValidationMessage] = []

    def info(self, source: str, message: str) -> None:
        self.messages.append(ValidationMessage("info", source, message))

    def warning(self, source: str, message: str) -> None:
        self.messages.append(ValidationMessage("warning", source, message))

    def error(self, source: str, message: str) -> None:
        self.messages.append(ValidationMessage("error", source, message))

    def count(self, level: str) -> int:
        return sum(1 for m in self.messages if m.level == level)

    def format_console(self) -> str:
        """Plain-text report block for the terminal."""
        if not self.messages:
            return "Validation: nothing to report."
        tags = {"info": "[ok]  ", "warning": "[warn]", "error": "[ERROR]"}
        lines = ["Validation report:"]
        for m in self.messages:
            lines.append("  %s %s - %s" % (tags.get(m.level, "[?]"), m.source, m.message))
        lines.append(
            "  %d note(s), %d warning(s), %d error(s)"
            % (self.count("info"), self.count("warning"), self.count("error"))
        )
        return "\n".join(lines)


# --------------------------------------------------------------------------
# config.yaml parsing
# --------------------------------------------------------------------------

_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

#: Colors handed to forecasts discovered on disk but not listed in config
#: (slots 5-6 first, then spares).
EXTRA_FORECAST_COLORS = ["#2E8B8B", "#7A5FA8", "#C55A11", "#548235", "#7F7F7F", "#4472C4"]

_KNOWN_TOP_KEYS = {
    "data_folder", "output_path", "cutoff_date", "primary_forecast", "forecasts",
    "label_dates", "always_label_line_ends", "rate_display_names", "rate_order",
    "hidden_rates", "tick", "y_axis", "chart", "export",
}

_DASH_VALUES = {"solid", "dash", "dot"}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ConfigError(message)


def _as_str_list(value: Any, key: str) -> List[str]:
    if value is None:
        return []
    _require(isinstance(value, list), "config.yaml: '%s' must be a list." % key)
    return [str(v) for v in value]


def _as_float(value: Any, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_opt_float(value: Any, key: str, report: ValidationReport) -> Optional[float]:
    """Float or None - never a silent default (warn-on-degrade contract)."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        report.warning("config", "%s value %r is not a number; ignored." % (key, value))
        return None


_TRUE_STRINGS = {"true", "yes", "on", "1"}
_FALSE_STRINGS = {"false", "no", "off", "0"}


def _as_bool(value: Any, default: bool, key: str, report: ValidationReport) -> bool:
    """Tolerant boolean: YAML gives real bools, but quoted strings like
    "false" must not silently coerce to True (bool("false") is True)."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        s = value.strip().lower()
        if s in _TRUE_STRINGS:
            return True
        if s in _FALSE_STRINGS:
            return False
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    report.warning(
        "config",
        "%s value %r is not true/false; using %s." % (key, value, default),
    )
    return default


def _parse_forecast_entry(raw: Any, index: int, report: ValidationReport) -> Optional[ForecastEntry]:
    if not isinstance(raw, dict) or "file" not in raw:
        report.warning(
            "config",
            "forecasts[%d] is not a mapping with a 'file' key; entry ignored." % index,
        )
        return None
    entry = ForecastEntry(file=str(raw["file"]))
    if raw.get("display_name") is not None:
        entry.display_name = str(raw["display_name"])
    color = raw.get("color")
    if color is not None:
        if _COLOR_RE.match(str(color)):
            entry.color = str(color)
        else:
            report.warning(
                "config",
                "forecasts[%d] color %r is not a #RRGGBB value; using an automatic color."
                % (index, color),
            )
    entry.enabled = _as_bool(raw.get("enabled"), True, "forecasts[%d].enabled" % index, report)
    dash = str(raw.get("dash", "solid")).strip().lower()
    if dash not in _DASH_VALUES:
        report.warning(
            "config",
            "forecasts[%d] dash %r is not one of solid/dash/dot; using solid." % (index, dash),
        )
        dash = "solid"
    entry.dash = dash
    return entry


def _parse_tick(raw: Any, report: ValidationReport) -> TickConfig:
    tick = TickConfig()
    if isinstance(raw, dict):
        anchor = raw.get("anchor_month", tick.anchor_month)
        interval = raw.get("interval_months", tick.interval_months)
        try:
            anchor = int(anchor)
            interval = int(interval)
        except (TypeError, ValueError):
            report.warning("config", "tick values must be whole numbers; using defaults.")
            return TickConfig()
        if 1 <= anchor <= 12:
            tick.anchor_month = anchor
        else:
            report.warning("config", "tick.anchor_month must be 1-12; using 10.")
        if 1 <= interval <= 12:
            tick.interval_months = interval
        else:
            report.warning("config", "tick.interval_months must be 1-12; using 3.")
    elif raw is not None:
        report.warning("config", "'tick' must be a mapping; using defaults.")
    return tick


def _parse_y_axis(raw: Any, report: ValidationReport) -> YAxisConfig:
    y = YAxisConfig()
    if raw is None:
        return y
    if not isinstance(raw, dict):
        report.warning("config", "'y_axis' must be a mapping; using defaults.")
        return y
    y.show = _as_bool(raw.get("show"), False, "y_axis.show", report)
    y.default_padding_pct = _as_float(raw.get("default_padding_pct"), 8.0)
    per_rate = raw.get("per_rate")
    if isinstance(per_rate, dict):
        for rate_key, spec in per_rate.items():
            key = normalize_rate_key(str(rate_key))
            if not isinstance(spec, dict):
                report.warning("config", "y_axis.per_rate.%s must be a mapping; ignored." % key)
                continue
            axis = RateAxis()
            axis.auto = _as_bool(spec.get("auto"), True, "y_axis.per_rate.%s.auto" % key, report)
            axis.min = _as_opt_float(spec.get("min"), "y_axis.per_rate.%s.min" % key, report)
            axis.max = _as_opt_float(spec.get("max"), "y_axis.per_rate.%s.max" % key, report)
            axis.padding_pct = _as_opt_float(
                spec.get("padding_pct"), "y_axis.per_rate.%s.padding_pct" % key, report
            )
            y.per_rate[key] = axis
    elif per_rate is not None:
        report.warning("config", "y_axis.per_rate must be a mapping; ignored.")
    return y


def _parse_chart(raw: Any, report: ValidationReport) -> ChartConfig:
    chart = ChartConfig()
    if raw is None:
        return chart
    if not isinstance(raw, dict):
        report.warning("config", "'chart' must be a mapping; using defaults.")
        return chart
    try:
        chart.width_px = int(raw.get("width_px", chart.width_px))
        chart.height_px = int(raw.get("height_px", chart.height_px))
    except (TypeError, ValueError):
        report.warning("config", "chart.width_px/height_px must be whole numbers; using defaults.")
        chart.width_px, chart.height_px = 1000, 480
    chart.width_px = max(480, min(2400, chart.width_px))
    chart.height_px = max(280, min(1400, chart.height_px))
    if raw.get("font_family") is not None:
        chart.font_family = str(raw["font_family"])
    sizes = raw.get("font_sizes")
    if isinstance(sizes, dict):
        fs = FontSizes()
        for name in ("title", "legend", "axis", "label", "caption"):
            if sizes.get(name) is not None:
                try:
                    setattr(fs, name, int(sizes[name]))
                except (TypeError, ValueError):
                    report.warning("config", "chart.font_sizes.%s must be a whole number." % name)
        chart.font_sizes = fs
    return chart


def _parse_export(raw: Any, report: ValidationReport) -> ExportConfig:
    export = ExportConfig()
    if raw is None:
        return export
    if not isinstance(raw, dict):
        report.warning("config", "'export' must be a mapping; using defaults.")
        return export
    try:
        export.png_scale = max(1, min(6, int(raw.get("png_scale", export.png_scale))))
    except (TypeError, ValueError):
        report.warning("config", "export.png_scale must be a whole number; using 3.")
    fmt = str(raw.get("default_format", export.default_format)).strip().lower()
    if fmt in ("png", "svg"):
        export.default_format = fmt
    else:
        report.warning("config", "export.default_format must be png or svg; using png.")
    return export


def parse_config(raw: Any, report: ValidationReport) -> AppConfig:
    """Turn the raw YAML document into a typed, defaulted :class:`AppConfig`.

    Raises :class:`ConfigError` for problems that make generation impossible;
    everything else degrades to defaults with a warning in the report.
    """
    _require(isinstance(raw, dict), "config.yaml does not contain a settings mapping at the top level.")
    assert isinstance(raw, dict)  # for the type-checker

    for key in raw:
        if key not in _KNOWN_TOP_KEYS:
            report.warning("config", "Unknown setting '%s' ignored." % key)

    data_folder = raw.get("data_folder")
    _require(
        isinstance(data_folder, str) and str(data_folder).strip() != "",
        "config.yaml: 'data_folder' is missing. Point it at the folder that "
        "contains actuals.csv and the forecast CSVs.",
    )

    config = AppConfig(data_folder=str(data_folder).strip())

    if raw.get("output_path") is not None:
        config.output_path = str(raw["output_path"]).strip()

    cutoff = raw.get("cutoff_date")
    if cutoff is not None:
        config.cutoff_date = str(cutoff).strip()

    if raw.get("primary_forecast") is not None:
        config.primary_forecast = str(raw["primary_forecast"]).strip()

    forecasts_raw = raw.get("forecasts")
    if forecasts_raw is None:
        forecasts_raw = []
    _require(isinstance(forecasts_raw, list), "config.yaml: 'forecasts' must be a list.")
    assert isinstance(forecasts_raw, list)
    for i, item in enumerate(forecasts_raw):
        entry = _parse_forecast_entry(item, i, report)
        if entry is not None:
            config.forecasts.append(entry)

    for token in _as_str_list(raw.get("label_dates"), "label_dates"):
        parsed = parse_date_to_month_end(token)
        if parsed is None:
            report.warning("config", "label_dates entry %r is not a recognizable date; ignored." % token)
        else:
            config.label_dates.append(iso(parsed))
    config.label_dates = sorted(set(config.label_dates))

    config.always_label_line_ends = _as_bool(
        raw.get("always_label_line_ends"), True, "always_label_line_ends", report
    )

    names = raw.get("rate_display_names")
    if isinstance(names, dict):
        for k, v in names.items():
            config.rate_display_names[normalize_rate_key(str(k))] = str(v)
    elif names is not None:
        report.warning("config", "'rate_display_names' must be a mapping; ignored.")

    config.rate_order = [normalize_rate_key(k) for k in _as_str_list(raw.get("rate_order"), "rate_order")]
    config.hidden_rates = [normalize_rate_key(k) for k in _as_str_list(raw.get("hidden_rates"), "hidden_rates")]

    config.tick = _parse_tick(raw.get("tick"), report)
    config.y_axis = _parse_y_axis(raw.get("y_axis"), report)
    config.chart = _parse_chart(raw.get("chart"), report)
    config.export = _parse_export(raw.get("export"), report)
    return config
