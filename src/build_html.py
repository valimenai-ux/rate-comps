"""Render the fully self-contained dashboard HTML and orchestrate a build.

The generated file inlines plotly.js, the xlsx-js-style bundle, all CSS/JS
and the JSON data payload. It makes zero network requests, so it works
behind a corporate proxy with no internet access at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from plotly.offline import get_plotlyjs

from .loader import load_config, load_dashboard
from .model import Dashboard
from .validate import ValidationReport

SRC_DIR = Path(__file__).resolve().parent


def _asset(relative: str) -> str:
    return (SRC_DIR / relative).read_text(encoding="utf-8")


def render_dashboard_html(dashboard: Dashboard) -> str:
    """Render the dashboard template with every asset inlined."""
    env = Environment(
        loader=FileSystemLoader(str(SRC_DIR / "templates")),
        autoescape=False,
        undefined=StrictUndefined,
    )
    template = env.get_template("dashboard.html.j2")
    # "</" would terminate the inline <script> block early; "<\/" is the
    # same JSON string but HTML-safe.
    payload_json = json.dumps(dashboard.to_payload(), separators=(",", ":")).replace("</", "<\\/")
    return template.render(
        title="Rate Comps",
        generated_at=dashboard.generated_at,
        payload_json=payload_json,
        plotly_js=get_plotlyjs(),
        xlsx_js=_asset("static/js/vendor/xlsx.bundle.js"),
        css=_asset("static/css/style.css"),
        labels_js=_asset("static/js/labels.js"),
        charts_js=_asset("static/js/charts.js"),
        exports_js=_asset("static/js/exports.js"),
        app_js=_asset("static/js/app.js"),
    )


@dataclass
class BuildResult:
    """What a build produced, for callers that print summaries."""

    output_path: Path
    dashboard: Dashboard
    report: ValidationReport


def build_dashboard(
    config_path: Path,
    data_folder_override: Optional[Path] = None,
    output_override: Optional[Path] = None,
) -> BuildResult:
    """Load config + data, render the HTML, and write it to disk."""
    report = ValidationReport()
    config = load_config(config_path, report)
    dashboard = load_dashboard(config, config_path.parent, report, data_folder_override)
    html = render_dashboard_html(dashboard)

    output_path = output_override if output_override is not None else Path(config.output_path)
    if not output_path.is_absolute():
        output_path = (config_path.parent / output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    return BuildResult(output_path=output_path, dashboard=dashboard, report=report)
