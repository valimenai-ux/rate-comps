"""Build smoke tests: the generated HTML is complete and fully self-contained."""

from __future__ import annotations

import json
import re
from pathlib import Path

from src.build_html import build_dashboard


def _build(repo_root: Path, sample_folder: Path, tmp_path: Path):
    return build_dashboard(
        repo_root / "config.yaml",
        data_folder_override=sample_folder,
        output_override=tmp_path / "dashboard.html",
    )


def test_build_writes_selfcontained_html(repo_root: Path, sample_folder: Path, tmp_path: Path) -> None:
    result = _build(repo_root, sample_folder, tmp_path)
    html = result.output_path.read_text(encoding="utf-8")

    # Everything inlined, nothing fetched.
    assert re.search(r"<script[^>]+\bsrc\s*=", html) is None
    assert re.search(r"<link[^>]+\bhref\s*=", html) is None
    assert "@import" not in html

    # The big pieces are actually present.
    assert 'id="rc-payload"' in html
    assert "RCLabels" in html
    assert "RCCharts" in html
    assert "RCExports" in html
    assert "XLSX" in html
    assert len(html) > 3_000_000  # plotly.js alone is ~3.5 MB


def test_payload_structure(repo_root: Path, sample_folder: Path, tmp_path: Path) -> None:
    result = _build(repo_root, sample_folder, tmp_path)
    html = result.output_path.read_text(encoding="utf-8")

    raw = html.split('<script id="rc-payload" type="application/json">')[1].split("</script>")[0]
    payload = json.loads(raw)  # "<\/" is a valid JSON escape, no un-escaping needed

    assert set(payload.keys()) == {"meta", "rates", "actuals", "forecasts", "defaults", "validation"}
    assert payload["meta"]["output_path"] == "output/dashboard.html"
    assert [r["key"] for r in payload["rates"]] == ["fed_funds", "sofr", "prime_rate"]
    assert payload["defaults"]["cutoff_date"] == "2026-02-28"
    assert payload["defaults"]["tick"] == {"anchor_month": 10, "interval_months": 3}
    assert payload["defaults"]["label_dates"] == ["2026-07-31", "2026-10-31", "2027-10-31"]

    # Sample-folder forecasts are the two discovered CSVs, in name order.
    names = [f["name"] for f in payload["forecasts"]]
    assert names == ["Alpha Forecast", "Beta Forecast"]
    series = payload["forecasts"][0]["series"]
    assert "prime_rate" in series
    assert series["prime_rate"]["dates"][0] == "2026-03-31"

    # Validation messages made it into the page.
    assert any(m["level"] == "warning" for m in payload["validation"])


def test_output_dir_created_and_report_attached(repo_root: Path, sample_folder: Path, tmp_path: Path) -> None:
    out = tmp_path / "nested" / "deep" / "dash.html"
    result = build_dashboard(
        repo_root / "config.yaml",
        data_folder_override=sample_folder,
        output_override=out,
    )
    assert result.output_path == out
    assert out.exists()
    assert result.report.count("error") == 0
    console = result.report.format_console()
    assert "Validation report:" in console
