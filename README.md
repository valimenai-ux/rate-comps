# Rate Comps — forecast charting

Replaces the manual Excel chart process for comparing rate forecasts
(Fed Funds, SOFR, 10YR UST, ...) against actual history. It reads the CSVs in
a data folder, builds the house-style charts, and writes a **single
self-contained HTML dashboard** that opens in your browser. No server, no
internet needed to view it, nothing to install beyond Python.

---

## For teammates

1. Install Python **3.9 or newer** (company software portal, or
   [python.org/downloads](https://www.python.org/downloads/)).
2. Open the file `RateComps.py` in VS Code (with the Python extension).
3. Click **Run** (the triangle, top right).

That's everything. The first run does a one-time setup (about a minute,
needs internet once); every run after that rebuilds the charts from the
CSVs and opens the dashboard in your browser. If something goes wrong you
get a plain-English message telling you what to do — never a wall of code.

---

## What you get

`output/dashboard.html` — one chart per rate, stacked vertically, in the
house style:

- Thick solid line = actual history, continuing **dashed** past the cutoff
  with the primary forecast's values (one unbroken line).
- Thinner lines for the other forecasts; each ends where its data ends.
  A forecast that carries its own pre-cutoff history connects from that
  history (so its gap to actuals stays visible); one with no history of its
  own fans out from the last actual point via a thin connector in its style.
- Black divider with diamond caps at the actual/forecast boundary, with
  "Actual" / "Forecast" captions.
- White-filled circle markers and 2-decimal value labels at the configured
  label dates, plus a label at every line end. Value labels **never overlap
  each other** — a deterministic collision engine spreads them after every
  re-render (clamped to the plot area; the divider captions are positioned
  separately).
- Fiscal-quarter ticks ("Oct-25"), hidden y-axis, no gridlines.
- Hover shows all series for a month; drag to zoom; double-click to reset.

The collapsible **Settings** sidebar applies changes instantly: forecast
on/off, colors, display names, primary forecast, cutoff month, label dates,
y-axis show/auto/manual per chart, tick anchor/interval, chart size presets.

**Exports** (all offline, from the toolbar or per chart): PNG (~300 dpi) and
SVG per chart, "Export all charts", and "Export data to Excel" — one
formatted sheet per rate (frozen header row, mmm-yy dates, 2-decimal
numbers) plus a README sheet that records the cutoff, the primary forecast,
and exactly which hidden rates / disabled forecasts were left out.

**Keep your changes:** the sidebar is temporary until you click
**Download config.yaml** and drop the downloaded file over
`rate_comps/config.yaml`. The next build then starts from those settings.
(The browser also remembers your last session as a convenience — the
"Restore last session" button — but the YAML file is the real save.)

---

## Monthly workflow

1. Drop the new month's CSVs into the data folder (see contract below).
2. Run `RateComps.py`.
3. Review the charts; check the **Validation** panel if anything looks off.
4. Export PNGs / Excel as needed for the deck.

---

## The data contract

`config.yaml` &rarr; `data_folder` points at a folder containing:

| file | meaning |
|---|---|
| `actuals.csv` | the single source of truth for actual history |
| `<Forecast Name>.csv` | one CSV per forecast — the file name is the forecast name |

Every CSV: first column `date`, then one column per rate:

```csv
date,fed_funds,sofr,ust_10yr
2025-10-31,3.86,4.04,4.10
```

- **Dates** are monthly. `YYYY-MM-DD`, `M/D/YYYY`, and `Mon-YY` all work and
  are normalized to month-end. Two-digit years follow Excel's rule: `00-29`
  mean 20xx, `30-99` mean 19xx (write 4-digit years for anything unusual).
  Duplicate months keep the last row in file order (with a warning).
- **Numbers**: plain decimals, with or without `%`. `1,234.5`-style thousands
  separators and European decimal commas (`3,64`) are both understood;
  anything ambiguous becomes a blank and is counted in the validation panel.
  Excel lock files (`~$…csv`) are ignored; `.CSV`/`.csv` both load.
- **Rates** are matched across files case-insensitively with
  whitespace/underscore normalization (`Fed Funds` = `fed_funds`). Any new
  rate column in any file automatically gets its own chart. Chart order =
  `actuals.csv` column order, extras appended; `rate_order` / `hidden_rates`
  in config can override.
- **Mismatched spans are normal.** Forecasts may start/end anywhere; each
  line plots only where it has data. Forecast files may include their own
  pre-cutoff history — it is drawn exactly as provided, never clipped.
- **Blank cells** inside a series do not sever the chart line (a month-end
  rate series is a sampling of a continuous rate, so the line bridges the
  gap) — but no marker or value label is ever drawn at a blank month, the
  Excel export leaves the cell empty, and the validation panel reports every
  interior gap. Deliberate design decision; see AUDIT.md P2-3.
- **Malformed rows never vanish silently.** A row with *more* fields than
  the header is skipped (the values could not be matched to columns) and a
  row with *fewer* is padded with blanks — both counted and reported in the
  validation panel. Purely trailing commas are trimmed quietly.
- Up to **6 forecasts**. Config-listed files load first (in config order),
  then any extra CSVs found in the folder (alphabetically, taking unused
  colors from a reserved palette that starts `#2E8B8B`, `#7A5FA8`); beyond 6
  are skipped with a warning.
- A broken file never kills the build: it is skipped with a clear message in
  the validation panel and everything valid still renders.

---

## config.yaml reference

| key | meaning |
|---|---|
| `data_folder` | folder with the CSVs (absolute path; production points at a Windows path) |
| `output_path` | where the dashboard is written (relative to this repo) |
| `cutoff_date` | actual/forecast boundary; `null` = last month in actuals.csv |
| `primary_forecast` | which forecast continues the thick line (display name or file name) |
| `forecasts` | list in draw + legend order: `{file, display_name, color, enabled}` and optional `dash: solid\|dash\|dot` |
| `label_dates` | months that get markers + value labels on every series |
| `always_label_line_ends` | label the final point of every line |
| `rate_display_names` | chart titles per normalized rate key |
| `rate_order`, `hidden_rates` | reorder or hide charts |
| `tick` | `anchor_month` + `interval_months` (10/3 = fiscal quarters Oct/Jan/Apr/Jul) |
| `y_axis` | `show`, `default_padding_pct`, `per_rate: {auto, min, max, padding_pct}` |
| `chart` | `width_px`, `height_px`, `font_family`, `font_sizes` |
| `export` | `png_scale` (3 &asymp; 300 dpi), `default_format` for "Export all" |

---

## Setup, step by step

### macOS

1. Install Python 3.9+ — from [python.org](https://www.python.org/downloads/)
   or `brew install python`.
2. Install [VS Code](https://code.visualstudio.com) and its **Python**
   extension (Cmd+Shift+X, search "Python", install the Microsoft one).
3. Open the `rate_comps` folder in VS Code (File &rarr; Open Folder).
4. Open `RateComps.py`, click **Run** (▷ top right).

Terminal alternative:

```bash
cd rate_comps
python3 RateComps.py
```

### Windows 11

1. Install Python 3.9+ from the company software portal or
   [python.org](https://www.python.org/downloads/windows/). If the installer
   asks, ticking "Add python.exe to PATH" is convenient but not required.
2. Install [VS Code](https://code.visualstudio.com) and its **Python**
   extension.
3. Open the `rate_comps` folder in VS Code, open `RateComps.py`, click
   **Run** (▷ top right).

Terminal alternative (PowerShell):

```powershell
cd rate_comps
py RateComps.py
```

For production, edit `data_folder` in `config.yaml` to the shared drive.
Write the Windows path **plain or in single quotes** — never in double
quotes, where `\T` etc. are read as escape codes and the file fails to load:

```yaml
data_folder: C:\Treasury\RateComps_Data      # fine
data_folder: 'C:\Treasury\RateComps_Data'    # fine
data_folder: "C:\Treasury\RateComps_Data"    # BREAKS
```

### Power users

```bash
python run.py --help
python run.py --config other.yaml --data "/somewhere/else" --no-open
```

`run.py` assumes dependencies are installed — either activate the `.venv`
that `RateComps.py` creates, or `pip install -r requirements.txt`.

---

## Troubleshooting

- **"The charting libraries could not be installed"** — read the pip lines
  above the message. If they mention *certificates / SSL*, the corporate
  network re-signs secure traffic; the tool detects this and automatically
  retries once with certificate checks relaxed **for pypi.org only** (it
  says so when it happens). If it still fails, the network is blocking
  pypi.org outright: connect the VPN and retry; or set the proxy
  (PowerShell: `$env:HTTPS_PROXY = 'http://proxy.company.com:8080'`,
  cmd: `set HTTPS_PROXY=...`, macOS: `export HTTPS_PROXY=...`) and retry;
  or send the whole message to IT. This download happens once — viewing
  the dashboard needs no internet at all.
- **"This tool needs Python 3.9 or newer"** — install a newer Python, then
  re-run. (Corporate laptops on Python 3.9 are fully supported.)
- **Setup seems corrupted** — delete the `.venv` folder next to
  `RateComps.py` and run again; it rebuilds itself.
- **"Restore last session" never appears** — some browsers block
  localStorage for local files; use **Download config.yaml** instead (that's
  the durable save anyway).
- **Fonts look slightly different** — charts use Aptos Narrow when
  installed (standard with Microsoft 365) and fall back to Calibri /
  Segoe UI / Arial otherwise.

---

## For developers

```bash
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest                    # loader / dates / config / build / label / Excel / YAML tests
mypy                      # strict, python_version = 3.9
```

Node is **optional and used only by tests**: when `node` is on the PATH,
pytest additionally runs the label-engine property harness, the real
config-emitter round-trip, and the Excel-workbook XML gate (all under
`tests/js/`); without Node those three are skipped.

**Reproducible installs:** `requirements.lock` is a `pip freeze` of a known
-good venv (its header records the Python it was frozen with).
`RateComps.py` installs from the lock when the running Python's major.minor
matches, and quietly falls back to the flexible `requirements.txt` ranges
otherwise. To re-freeze after a dependency change:

```bash
.venv/bin/python -m pip freeze > requirements.lock   # then re-add the header line
```

(header line: `# frozen-with-python: 3.x` — see the current file).

Layout:

```
RateComps.py         # zero-argument bootstrap (venv setup + build + open)
run.py               # CLI: --config, --data, --no-open, --debug
config.yaml          # wired to this checkout's data folder; repoint for prod
requirements.lock    # pinned installs (preferred when the Python matches)
src/
  loader.py          # CSV/config loading, normalization, fail-soft assembly
  validate.py        # date & rate-name normalization, report, config schema
  model.py           # typed dataclasses + JSON payload serialization
  build_html.py      # jinja2 render, inlines plotly.js/ExcelJS/CSS/JS/data
  templates/         # dashboard.html.j2
  static/css|js      # app.js, charts.js, labels.js, yaml_export.js,
                     # exports.js, vendor/
tests/               # pytest suite + node harnesses (labels, YAML, Excel)
data_sample/         # tiny synthetic fixtures used by the tests
output/              # generated dashboards (gitignored)
```

Python is mypy-strict-clean at `python_version = 3.9` (every module uses
`from __future__ import annotations`; no 3.10+ syntax or stdlib). The label
collision engine (`labels.js`), the config emitter (`yaml_export.js`) and
the Excel workbook builder (`exports.js`) are pure functions tested via Node
when available.

Vendored: `ExcelJS` 4.4.0 (MIT, license alongside the bundle). plotly.js is
inlined from the `plotly` Python package at build time.

---

## Assumptions & design decisions

1. **Repo location:** this repo lives *inside* the data folder
   (`.../RateComps_Data/rate_comps/`); `data_folder` in the shipped config
   is the absolute path to the parent. The loader only reads `*.csv` at the
   top level of the data folder, so the repo doesn't interfere.
2. **Python 3.9 baseline** (corporate laptops); anything newer also works.
3. **June 5YO is dashed** via an optional `dash` key on its config entry —
   that key is the one addition to the specified config block, needed to
   match the reference charts without hard-coding forecast names.
4. The **primary forecast's own pre-cutoff history is not drawn** — the
   actuals line covers that span; the primary contributes the dashed
   continuation (starting exactly at the last actual point). Non-primary
   forecasts always draw their full span as provided; a vintage containing
   no pre-cutoff months is additionally joined to the last actual point by a
   thin connector in its own style, so every line fans out from the boundary
   like the house charts. Only the primary is the seamless thick
   solid-to-dashed line.
5. **Markers** (white-filled circles) appear at configured label dates;
   line-end labels have no marker unless the end coincides with a label
   date — this matches the reference charts.
6. The **cutoff picker** offers the months present in `actuals.csv`
   (config accepts any date and normalizes it to month-end).
7. A downloaded config writes `cutoff_date: null` whenever the chosen
   cutoff equals the last actuals month, preserving the follow-the-actuals
   behavior for the monthly refresh.
8. **Excel export** uses the vendored ExcelJS writer: the header row is
   bold + shaded **and frozen** (freeze panes), dates are `mmm-yy`, numbers
   `0.00`, columns sized. Only what the dashboard currently shows is
   exported; the README sheet names any hidden rates / disabled forecasts
   that were left out.
9. Values are treated as percents and displayed with 2 decimals everywhere
   (labels, hover, Excel).
10. If **no forecasts** are enabled/loadable, charts show the actuals line
    alone (solid, house dark blue) with no divider — the tool never blanks
    a chart because data is missing.
