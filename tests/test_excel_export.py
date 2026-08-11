"""Excel export gate: the workbook the browser would build (via the real
RCExports.buildWorkbook + vendored ExcelJS) has a frozen header row, mmm-yy
dates, 0.00 numerics, only-relevant per-rate columns, and a README sheet that
names what was excluded. Runs the same Node-optional policy as the label test.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parent / "js" / "excel_harness.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


@pytest.fixture(scope="module")
def workbook(tmp_path_factory: pytest.TempPathFactory) -> zipfile.ZipFile:
    out = tmp_path_factory.mktemp("excel") / "export.xlsx"
    result = subprocess.run(
        ["node", str(HARNESS), str(out)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, "excel harness failed:\n%s%s" % (result.stdout, result.stderr)
    return zipfile.ZipFile(out)


def _sheet_xml(z: zipfile.ZipFile, index: int) -> str:
    return z.read("xl/worksheets/sheet%d.xml" % index).decode("utf-8")


def test_every_sheet_has_frozen_header_row(workbook: zipfile.ZipFile) -> None:
    for index in (1, 2):  # the two rate sheets
        xml = _sheet_xml(workbook, index)
        pane = re.search(r"<pane [^>]*/>", xml)
        assert pane is not None, "sheet %d has no pane element" % index
        assert 'ySplit="1"' in pane.group(0)
        assert 'topLeftCell="A2"' in pane.group(0)
        assert 'state="frozen"' in pane.group(0)


def test_number_formats(workbook: zipfile.ZipFile) -> None:
    styles = workbook.read("xl/styles.xml").decode("utf-8")
    # ExcelJS maps "mmm-yy" / "0.00" to the built-in ids 17 / 2.
    assert re.search(r'numFmtId="17"[^>]*applyNumberFormat="1"', styles)
    assert re.search(r'numFmtId="2"[^>]*applyNumberFormat="1"', styles)
    # Header style: bold font, F2F2F2 fill, thin bottom border.
    assert "<b/>" in workbook.read("xl/styles.xml").decode("utf-8")
    assert "F2F2F2" in styles
    assert '<bottom style="thin">' in styles


def test_date_serials_are_exact_integers(workbook: zipfile.ZipFile) -> None:
    # 2026-05-31 00:00 UTC == Excel serial 46173, exactly. Integer serials
    # matter: a fractional part (hidden 12:00:00) breaks MATCH/VLOOKUP/
    # EOMONTH joins against real month-end dates.
    xml = _sheet_xml(workbook, 1)
    assert "<v>46173</v>" in xml
    assert "46173.5" not in xml


def test_actuals_column_ends_at_cutoff(workbook: zipfile.ZipFile) -> None:
    # The harness actuals carry 2026-07-31 (serial 46234) beyond the cutoff
    # of 2026-06-30; the workbook must mirror the charts and drop it from
    # the Actuals column. (46234 still appears - as the forecast's month.)
    fed = _sheet_xml(workbook, 1)
    # Actuals values are 3.62 (May) and 3.63 (Jun); the post-cutoff 3.99 must
    # not appear anywhere, and July's Actuals cell (B4) must be empty even
    # though July's 9+3 forecast value exists in column C.
    assert "3.99" not in fed
    assert re.search(r'<c r="B4"[^>]*><v>', fed) is None


def test_per_rate_columns_only_for_forecasts_with_data(workbook: zipfile.ZipFile) -> None:
    shared = workbook.read("xl/sharedStrings.xml").decode("utf-8")
    assert "9+3 Forecast" in shared
    # Disabled forecast is not a data column anywhere (only in the README
    # exclusion list under its display name).
    fed = _sheet_xml(workbook, 1)
    sofr = _sheet_xml(workbook, 2)
    # Fed Funds sheet: Date + Actuals + 9+3 Forecast -> header row reaches C1.
    assert re.search(r'<c r="C1"[^>]*t="s"', fed)
    # SOFR sheet: 9+3 has no sofr series -> header row stops at B1.
    assert re.search(r'<c r="C1"', sofr) is None
    assert re.search(r'<c r="B1"[^>]*t="s"', sofr)


def test_readme_sheet_names_exclusions(workbook: zipfile.ZipFile) -> None:
    shared = workbook.read("xl/sharedStrings.xml").decode("utf-8")
    assert "hidden by the configuration and forecasts toggled off are NOT included" in shared
    assert "FY25 Old Plan" in shared  # the disabled forecast, by display name
    assert "prime_rate" in shared  # the hidden rate


def test_sheet_names_and_order(workbook: zipfile.ZipFile) -> None:
    wb_xml = workbook.read("xl/workbook.xml").decode("utf-8")
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', wb_xml)
    # "SOFR O/N" sanitizes to "SOFR O N" ("/" is illegal in sheet names).
    assert names == ["Fed Funds Effective", "SOFR O N", "README"]
