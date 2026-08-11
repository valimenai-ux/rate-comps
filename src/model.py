"""Typed data model for the Rate Comps dashboard.

The generator parses config + CSVs into these dataclasses, then serializes a
single JSON payload (``Dashboard.to_payload``) that is embedded in the
generated HTML. Everything the browser needs lives in that payload.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

#: A cell value: ``None`` means "row exists but no number for this rate".
Number = Optional[float]


@dataclass(frozen=True)
class ValidationMessage:
    """One line of the validation report (in-page panel + console)."""

    level: str  #: "info" | "warning" | "error"
    source: str  #: file name or "config"
    message: str

    def to_payload(self) -> Dict[str, str]:
        return {"level": self.level, "source": self.source, "message": self.message}


@dataclass
class Series:
    """One rate's data within one file, as parallel date/value arrays.

    Dates are canonical ISO month-end strings (``YYYY-MM-DD``), ascending and
    unique within the file. A ``None`` value breaks the line at that month.
    """

    dates: List[str] = field(default_factory=list)
    values: List[Number] = field(default_factory=list)

    def has_data(self) -> bool:
        """True if at least one non-null value exists."""
        return any(v is not None for v in self.values)

    def to_payload(self) -> Dict[str, Any]:
        return {"dates": list(self.dates), "values": list(self.values)}


@dataclass
class SourceTable:
    """A parsed CSV file: one :class:`Series` per canonical rate key."""

    file_name: str
    series: Dict[str, Series] = field(default_factory=dict)
    #: Rate keys in the order the columns appeared in the file.
    rate_keys: List[str] = field(default_factory=list)
    #: Original column headers, for display-name fallbacks.
    original_headers: Dict[str, str] = field(default_factory=dict)
    row_count: int = 0
    date_min: Optional[str] = None
    date_max: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "file": self.file_name,
            "series": {key: s.to_payload() for key, s in self.series.items()},
        }


@dataclass
class ForecastSlot:
    """A forecast file joined with its config entry (identity + styling)."""

    name: str  #: file stem; the forecast's stable identity
    display_name: str
    color: str
    dash: str  #: "solid" | "dash" | "dot"
    enabled: bool
    table: SourceTable

    def to_payload(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "file": self.table.file_name,
            "display_name": self.display_name,
            "color": self.color,
            "dash": self.dash,
            "enabled": self.enabled,
            "series": {key: s.to_payload() for key, s in self.table.series.items()},
        }


@dataclass(frozen=True)
class RateInfo:
    """A chart: canonical key plus the title shown above it."""

    key: str
    display_name: str

    def to_payload(self) -> Dict[str, str]:
        return {"key": self.key, "display_name": self.display_name}


# --------------------------------------------------------------------------
# Configuration model (parsed + defaulted view of config.yaml)
# --------------------------------------------------------------------------


@dataclass
class ForecastEntry:
    """One item of the ``forecasts:`` list in config.yaml."""

    file: str
    display_name: Optional[str] = None
    color: Optional[str] = None
    enabled: bool = True
    dash: str = "solid"


@dataclass
class RateAxis:
    """Per-rate y-axis override."""

    auto: bool = True
    min: Optional[float] = None
    max: Optional[float] = None
    padding_pct: Optional[float] = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "auto": self.auto,
            "min": self.min,
            "max": self.max,
            "padding_pct": self.padding_pct,
        }


@dataclass
class YAxisConfig:
    show: bool = False
    default_padding_pct: float = 8.0
    per_rate: Dict[str, RateAxis] = field(default_factory=dict)

    def to_payload(self) -> Dict[str, Any]:
        return {
            "show": self.show,
            "default_padding_pct": self.default_padding_pct,
            "per_rate": {k: v.to_payload() for k, v in self.per_rate.items()},
        }


@dataclass
class TickConfig:
    anchor_month: int = 10
    interval_months: int = 3

    def to_payload(self) -> Dict[str, int]:
        return {"anchor_month": self.anchor_month, "interval_months": self.interval_months}


@dataclass
class FontSizes:
    title: int = 18
    legend: int = 12
    axis: int = 12
    label: int = 11
    caption: int = 11

    def to_payload(self) -> Dict[str, int]:
        return {
            "title": self.title,
            "legend": self.legend,
            "axis": self.axis,
            "label": self.label,
            "caption": self.caption,
        }


@dataclass
class ChartConfig:
    width_px: int = 1000
    height_px: int = 480
    font_family: str = "Aptos Narrow, Aptos, Calibri, Segoe UI, Arial, sans-serif"
    font_sizes: FontSizes = field(default_factory=FontSizes)

    def to_payload(self) -> Dict[str, Any]:
        return {
            "width_px": self.width_px,
            "height_px": self.height_px,
            "font_family": self.font_family,
            "font_sizes": self.font_sizes.to_payload(),
        }


@dataclass
class ExportConfig:
    png_scale: int = 3
    default_format: str = "png"

    def to_payload(self) -> Dict[str, Any]:
        return {"png_scale": self.png_scale, "default_format": self.default_format}


@dataclass
class AppConfig:
    """Fully parsed and defaulted config.yaml."""

    data_folder: str
    output_path: str = "output/dashboard.html"
    cutoff_date: Optional[str] = None  #: raw string from config; None = auto
    primary_forecast: Optional[str] = None
    forecasts: List[ForecastEntry] = field(default_factory=list)
    label_dates: List[str] = field(default_factory=list)
    always_label_line_ends: bool = True
    rate_display_names: Dict[str, str] = field(default_factory=dict)
    rate_order: List[str] = field(default_factory=list)
    hidden_rates: List[str] = field(default_factory=list)
    tick: TickConfig = field(default_factory=TickConfig)
    y_axis: YAxisConfig = field(default_factory=YAxisConfig)
    chart: ChartConfig = field(default_factory=ChartConfig)
    export: ExportConfig = field(default_factory=ExportConfig)


# --------------------------------------------------------------------------
# The assembled dashboard
# --------------------------------------------------------------------------


@dataclass
class Dashboard:
    """Everything the browser needs, ready for JSON serialization."""

    data_folder: str
    output_path: str  #: as written in config (kept for config round-trips)
    generated_at: str
    cutoff_date: str  #: resolved ISO month-end
    cutoff_is_auto: bool  #: True when cutoff came from "last actuals date"
    primary: Optional[str]  #: forecast name (file stem), or None if none enabled
    label_dates: List[str]
    always_label_line_ends: bool
    rates: List[RateInfo]
    actuals: SourceTable
    forecasts: List[ForecastSlot]
    rate_order_config: List[str]
    hidden_rates: List[str]
    rate_display_names: Dict[str, str]
    tick: TickConfig
    y_axis: YAxisConfig
    chart: ChartConfig
    export: ExportConfig
    validation: List[ValidationMessage]

    def to_payload(self) -> Dict[str, Any]:
        return {
            "meta": {
                "data_folder": self.data_folder,
                "output_path": self.output_path,
                "generated_at": self.generated_at,
            },
            "rates": [r.to_payload() for r in self.rates],
            "actuals": self.actuals.to_payload(),
            "forecasts": [f.to_payload() for f in self.forecasts],
            "defaults": {
                "cutoff_date": self.cutoff_date,
                "cutoff_is_auto": self.cutoff_is_auto,
                "primary": self.primary,
                "label_dates": list(self.label_dates),
                "always_label_line_ends": self.always_label_line_ends,
                "tick": self.tick.to_payload(),
                "y_axis": self.y_axis.to_payload(),
                "chart": self.chart.to_payload(),
                "export": self.export.to_payload(),
                "rate_order": list(self.rate_order_config),
                "hidden_rates": list(self.hidden_rates),
                "rate_display_names": dict(self.rate_display_names),
            },
            "validation": [m.to_payload() for m in self.validation],
        }
