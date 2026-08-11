# Rate Comps — Audit (2026-08-10)

Four-role audit (staff financial engineer / Plotly front-end specialist /
platform & release engineer / QA lead) of the working production tool, followed
by implementation. Every first-party file was read in full; findings below cite
file:line as of the pre-fix tree. Status is updated per finding as fixes land;
verification-gate outputs are appended at the bottom.

Severity: **P1** blocker · **P2** should-fix · **P3** polish.

---

## 1. Findings

### P1-1 · Excel export has no frozen header row *(mandated)*
- **Evidence:** `src/static/js/exports.js:5-9` ("that fork has no freeze-pane
  support, so headers are bold + shaded instead"); README.md:257-259 admits it
  (assumption #8). `xlsx-js-style` 1.2.0 (SheetJS CE fork) cannot write
  `<pane .../>` sheet views.
- **Impact:** every exported workbook loses the header row on scroll — the one
  thing Treasury users do with a 25-month sheet.
- **Fix:** replace the vendored `xlsx-js-style` with a vendored **ExcelJS
  4.4.0** browser bundle (MIT, UMD — also loadable by the Node test harness).
  Verified before adoption: a probe workbook written by the bundle contains
  `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`,
  `mmm-yy` → built-in numFmtId 17, `0.00` → numFmtId 2, bold font + F2F2F2
  fill + thin bottom border, and the bundle contains no `</script>` sequence
  (safe to inline). Old vendor + Apache-2.0 license removed; MIT license kept
  alongside the new bundle. Formatting quality preserved (bold shaded header,
  mmm-yy dates, 0.00 numerics, column widths, README sheet).
- **Status:** FIXED (see Changes §3).

### P1-2 · Malformed CSV rows vanish silently *(mandated)*
- **Evidence:** `src/loader.py:70-81` — both read paths use
  `on_bad_lines="skip"`. Reproduced with pandas 2.3.3: a row with *extra*
  fields is dropped with no trace (no ValidationReport entry, no console line);
  a row with *fewer* fields than the header is silently NA-filled (with
  `keep_default_na=False` the missing cells surface as `""`), also unreported.
- **Impact:** a fat-fingered comma in a forecast CSV deletes a month of data
  with zero indication — unacceptable for a Treasury tool.
- **Fix:** CSV parsing rewritten on stdlib `csv` (structural change S1 below).
  Rows with extra fields are **skipped and counted** (warning with count +
  first offending line numbers); rows with missing fields are **padded with
  blanks and counted** (warning). Both appear in the validation panel and the
  console report. Tests added.
- **Status:** FIXED.

### P1-3 · `"NaN"`/`"inf"` cell text produces invalid JSON → blank dashboard
- **Evidence:** `src/loader.py:84-91` — `_parse_number` accepts anything
  `float()` accepts, including `nan`, `inf`, `-inf` (Excel occasionally writes
  `NaN` into CSVs). A non-finite float flows into the payload and
  `json.dumps` (`src/build_html.py:39`, default `allow_nan=True`) emits bare
  `NaN`/`Infinity` — **invalid JSON**. `JSON.parse` in `app.js:8` throws and
  the entire dashboard renders blank.
- **Impact:** one bad cell in any CSV bricks the whole page, with no message.
- **Fix:** `_parse_number` now rejects non-finite values (counted in the
  existing "non-numeric value(s) treated as blanks" warning), and
  `build_html.py` serializes with `allow_nan=False` as a belt-and-braces
  guard (a future leak fails the build loudly instead of shipping a broken
  page). Test added.
- **Status:** FIXED.

### P2-1 · Half-created `.venv` is not healed *(mandated)*
- **Evidence:** `RateComps.py:72-87` — rebuild path only triggers when
  `venv_python()` is missing and then calls `EnvBuilder(clear=False)`, which
  does not reliably repair a partially-created tree (e.g. `Scripts/` exists
  but `python.exe` was never copied, or `pyvenv.cfg` is truncated).
- **Fix:** when the `.venv` directory exists but its python is missing, the
  bootstrap now says so in plain English and rebuilds with `clear=True`; a
  failed first `create()` is retried once with `clear=True` before giving up.
  Messages stay friendly.
- **Status:** FIXED.

### P2-2 · Missing `pip` inside the venv loops into a misleading network error
- **Evidence:** `RateComps.py:95-118` — if venv creation succeeded but the
  `ensurepip` step failed (it can, on locked-down machines), every subsequent
  run executes `python -m pip install …`, which fails with "No module named
  pip", and the user is told to check the corporate proxy — forever.
- **Fix:** the bootstrap probes `python -m pip --version` first and runs
  `python -m ensurepip --upgrade` when pip is absent, before falling through
  to the existing friendly failure.
- **Status:** FIXED.

### P2-3 · Interior null months break lines *(mandated decision)*
- **Evidence:** `src/static/js/charts.js:297-311` — line traces do not set
  `connectgaps`; Plotly's default (`false`) fragments a series at any interior
  null month. `src/model.py:34` documents this as intended ("A None value
  breaks the line at that month") but it was never a deliberate product
  decision.
- **Decision (implemented):** **`connectgaps: true`** on line traces. A
  month-end rate series is a sampling of a continuous rate; an interior blank
  means "no value recorded", not "the rate ceased to exist", and the house
  Excel charts these replace draw one continuous line per series. A broken
  segment reads as a rendering bug to the deck audience. Integrity is
  preserved on three fronts: (a) markers and value labels still skip null
  months, so no fabricated point is ever labeled; (b) the loader now emits an
  info-level validation message when a series has interior gaps, so the
  bridge is disclosed; (c) the Excel export leaves those cells blank (already
  documented on the README sheet). Documented in README.
- **Status:** FIXED (documented choice).

### P2-4 · Python 3.9 floor consistency *(mandated verification)*
- **Verified:** `RateComps.py:22` (`MIN_PYTHON = (3, 9)`), README:13/181/222,
  `pyproject.toml:6` (`python_version = "3.9"`), `requirements-dev.txt:4`
  (mypy `<1.19` pinned because newer mypy drops the 3.9 target — correct).
  All modules use `from __future__ import annotations`; grep found no 3.10+
  syntax (no `match`, no `X | Y` at runtime, no `zoneinfo`), and mypy strict
  at `python_version = 3.9` passes (gate 1).
- **One real inconsistency found:** `requirements.txt` allowed `pandas>=2.0`,
  whose transitive **numpy** floor is the actual 3.9 risk (numpy ≥2.1 requires
  Python ≥3.10; pip must resolve numpy 2.0.x on a 3.9 laptop — usually works
  but is the fragile edge of the range). Resolved decisively by structural
  change S1: pandas (and therefore numpy) is no longer a dependency at all.
  Remaining deps all support 3.9: PyYAML 6, plotly 5.18–6.x, Jinja2 3.1.
- **Status:** VERIFIED / FIXED (dependency removed; docs updated).

### P2-5 · `config.yaml` read with strict UTF-8
- **Evidence:** `src/loader.py:56` — `path.read_text(encoding="utf-8")`. A
  config saved by Windows Notepad as ANSI with any non-ASCII character (e.g. a
  user name in the data path) raises `UnicodeDecodeError`, which bypasses the
  friendly `ConfigError` path and lands in the generic "unexpected" handler.
- **Fix:** read as `utf-8-sig` (also tolerates the Notepad BOM), falling back
  to `cp1252`, then `latin-1` (never fails), mirroring the CSV reader.
- **Status:** FIXED.

### P2-6 · Exact-duplicate CSV headers become a bogus new rate
- **Evidence:** `src/loader.py:120-138` — the dedup check compares normalized
  keys, but pandas has already mangled exact duplicates to `col.1` before the
  loader sees them, so `fed_funds` + `fed_funds` yields a phantom rate
  `fed_funds.1` with its own chart, no warning.
- **Fix:** the stdlib-csv reader (S1) sees the raw headers, so exact
  duplicates now hit the existing "same rate after normalization; keeping
  first" warning path. Test added.
- **Status:** FIXED (by S1).

### P3-1 · Modebar camera bakes a stale date into the filename *(mandated)*
- **Evidence:** `src/static/js/charts.js:562-567,577-581` —
  `toImageButtonOptions.filename` is computed at **render** time; a dashboard
  left open past midnight downloads with yesterday's date. Worse, the stamp
  uses `toISOString()` (UTC), so any evening download in the Americas is
  dated **tomorrow**. Same UTC bug in `exports.js:11` (Excel filename).
- **Fix:** the built-in camera button is replaced by a custom modebar button
  that routes through `RCExports.exportChart`, which computes the filename at
  click time; the stamp helper now formats the **local** date. One code path
  for all image exports (modebar, per-chart buttons, "Export all").
- **Status:** FIXED.

### P3-2 · Excel export silently omits hidden rates and disabled forecasts *(mandated)*
- **Evidence:** `payload.rates` excludes `hidden_rates` at build time
  (`src/loader.py:377-381`) and `exports.js:90-94` skips disabled forecasts —
  correct behavior, but the workbook never says so.
- **Fix:** the README sheet now states the scope rule and **lists by name**
  any disabled forecasts and hidden rates that were excluded at export time.
- **Status:** FIXED.

### P3-3 · No `requirements.lock` / reproducible install *(mandated)*
- **Evidence:** `requirements.txt:1-7` uses deliberately loose ranges; two
  corporate laptops bootstrapped a month apart can resolve different trees.
- **Fix:** `requirements.lock` added (pip-freeze of the working venv, header
  records the freezing Python version). `RateComps.py` prefers the lock when
  present **and** the running interpreter's major.minor matches the recorded
  one; otherwise it says so in one line and uses the flexible ranges. If a
  lock install fails, it falls back to `requirements.txt` with a friendly
  message rather than dead-ending. The sentinel fingerprint covers whichever
  file was used.
- **Caveat for a human:** the lock shipped here was frozen on macOS/CPython
  3.14 (this dev machine). For byte-identical installs on the corporate
  laptops, re-freeze once from a laptop's venv (`.venv\Scripts\python -m pip
  freeze > requirements.lock` after a successful run) and commit that. The
  version-match guard makes the shipped lock safe either way.
- **Status:** FIXED (with documented caveat).

### P3-4 · Windows path guidance in YAML *(mandated)*
- **Evidence:** `config.yaml:6-8` and README:159-160 show `C:\Treasury\…`
  without warning that **double-quoted** YAML turns `\T` into an escape error
  (`"C:\Treasury"` fails to parse; plain or single-quoted scalars are safe).
- **Fix:** comments in `config.yaml` and the README now show the two safe
  spellings (`C:\Treasury\RateComps_Data` plain, or `'C:\Treasury\…'`
  single-quoted) and name the double-quote trap. Note: the dashboard's own
  YAML exporter double-quotes **with** proper `\\` escaping (JSON-style), which
  is valid YAML — verified by the round-trip test — so downloaded configs are
  unaffected.
- **Status:** FIXED.

### P3-5 · Per-rate sheets carry empty columns for forecasts without that rate
- **Evidence:** `src/static/js/exports.js:90-94` — every enabled forecast gets
  a column on every rate sheet even when it has no series for that rate,
  which reads as "this vintage forecasts blank" rather than "not applicable".
- **Fix:** columns are emitted only for forecasts that carry the sheet's rate.
- **Status:** FIXED.

### P3-6 · Self-containment test has gaps
- **Evidence:** `tests/test_build_html.py:24-27` covers `<script src>`,
  `<link href>`, `@import` — but not CSS `url(http…)`, `<img src>`,
  `<iframe>`, or protocol-relative `src="//…"` references.
- **Fix:** the test now also rejects those (verification gate 3). Note on
  interpretation: the plotly bundle legitimately contains `http://…` inside
  string literals (SVG/XML namespaces); the gate is about **references the
  browser would fetch**, which is what the test asserts.
- **Status:** FIXED.

### P3-7 · Config round-trip test is hand-synced with the JS emitter
- **Evidence:** `tests/test_config_roundtrip.py:47-48` — "Mirrors the exact
  format app.js emitYaml() produces (keep the two in sync)". Nothing fails if
  the two drift.
- **Fix:** the YAML emitter is extracted into a pure module
  (`src/static/js/yaml_export.js`, structural change S3) and a Node harness
  (`tests/js/yaml_harness.js`) emits YAML from a mutated state; pytest parses
  that output with the real `parse_config` and asserts the state survives
  (verification gate 4). The hand-synced fixture test is kept as a
  node-free fallback. Same skip policy as the label-engine test (Node
  optional, tests only).
- **Status:** FIXED.

### P3-8 · Windows console encoding hardening
- **Evidence:** `RateComps.py:29-30` — `print` of validation lines that can
  contain non-ASCII file names can raise `UnicodeEncodeError` on a cp1252
  console (older Win10 shells; VS Code is UTF-8 so low likelihood).
- **Fix:** best-effort `sys.stdout.reconfigure(errors="replace")` at startup.
- **Status:** FIXED.

---

## 1b. Second-wave findings (multi-agent review, adversarially verified)

A four-role reviewer fleet (14 agents) swept the pre-fix tree; 45 raw findings
were deduplicated, the top 10 adversarially verified (9 confirmed, 1 refuted),
and the remainder triaged by hand. Everything below cites the pre-fix tree.

### Confirmed and fixed

- **P1 · Bootstrap had no catch-all** (`RateComps.py:202-207`) — only
  `KeyboardInterrupt` was caught, so realistic corporate failures
  (AppLocker/WDAC blocking `.venv\Scripts\python.exe` → `PermissionError
  [WinError 5]`; AV/OneDrive corrupting `.deps-ok` → `UnicodeDecodeError`;
  disk quota on sentinel write) surfaced as a raw traceback in a console that
  closes instantly — breaking the "never a wall of code" contract. **Fixed:**
  `__main__` now routes any unexpected exception through a `_crash()` handler
  (log to `output/last_error.log`, plain-English message naming the
  AppLocker case, `pause_if_interactive`); the sentinel read tolerates
  `ValueError` (decode errors), the sentinel write failure downgrades to a
  friendly note.
- **P2 · Primary continuation triggered by null-only post-cutoff points**
  (`charts.js:115-127`) — `after` was filtered by date only, so a primary
  forecast whose post-cutoff cells are all blank still claimed the
  continuation: the Actuals line lost its legend entry and end label, a
  phantom dashed legend entry appeared, and no line was drawn (reported
  independently by two roles). **Fixed:** continuation now requires a real
  post-cutoff value; the joining segment became a hover-silent bridge trace,
  which also fixes the boundary month's hover mis-attributing the last
  actual value to the forecast.
- **P2 · Excel date serials carried a hidden 12:00:00** (`exports.js`) —
  UTC-noon construction wrote serial N + 0.5; the `mmm-yy` format hid it, but
  `MATCH`/`VLOOKUP`/`EOMONTH` joins against real month-end dates return
  `#N/A` and pivots show a 12:00 timestamp. **Fixed:** UTC-midnight
  construction (ExcelJS converts with pure UTC math) yields exact integer
  serials in every timezone; gate test asserts `<v>46173</v>` with no `.5`.
- **P2 · Two-digit years always mapped to 20xx** (`validate.py:54-55`) — one
  legacy `10/31/99` row would silently drag the auto-cutoff to 2099.
  **Fixed:** Excel's pivot (00-29 → 2000s, 30-99 → 1900s), documented in the
  README, tested.
- **P2 · Opening the dashboard destroyed the saved session**
  (`app.js:renderAll → saveSession`) — the initial render wrote the pristine
  default state over the stored session, so "Restore last session" only
  survived a single page load. **Fixed:** the mirror never persists a state
  identical to the file state; an explicit "Reset to file config" now also
  clears the stored session. (Known lingering quirk, accepted: manually
  returning every control to the default leaves the previous session stored,
  so a stale Restore offer may appear on the next load.)
- **P2 · Dependency refresh bypassed in the documented VS Code flow**
  (`RateComps.py:195-197`) — when VS Code selects `.venv` as interpreter,
  `running_inside_venv()` short-circuited straight to the build, so
  requirements changes never triggered a reinstall. **Fixed:**
  `ensure_environment()` (a cheap sentinel check) now runs on every path.
- **P2 · Stale venv after a base-Python upgrade** (`RateComps.py:124`) — the
  venv redirector exists but fails with a cryptic "No Python at ..." and the
  tool exited with its code, silently. **Fixed:** the workspace check probes
  that the venv python actually runs (skipped when we *are* the venv python)
  and rebuilds cleanly when it does not.
- **P2 · Every pip failure blamed the network** (`RateComps.py:106-118`) —
  TLS-interception, wheel and long-path failures got proxy advice; the
  `set HTTPS_PROXY=` remediation is also a no-op in PowerShell, the default
  Windows 11 shell. **Fixed:** message now points at the pip output first,
  gives PowerShell *and* cmd forms, and names the SSL-inspection case.

### Refuted

- "UnicodeEncodeError when stdout is a pipe (cp1252)" — the verifier could
  not reproduce a crash path; the `sys.stdout.reconfigure(errors="replace")`
  hardening (P3-8) covers the residual risk regardless.

### Triage of the 35 unverified lower-priority findings

**Fixed** (each with a test where testable):

| finding | fix |
|---|---|
| Excel owner/lock files (`~$*.csv`) loaded as forecasts | discovery skips `~$*` and dotfiles |
| `.CSV` invisible on macOS/Linux (case-sensitive glob) | `iterdir()` + `suffix.lower()` |
| `cutoff_date` outside actuals range accepted silently | warning naming the range |
| European decimal commas misparsed 100× (`3,64` → 364) | `3,64` → 3.64; `1,234.5` thousands; ambiguous → reported blank |
| CSV fallback encoding: cp1252 attempt added before latin-1 | matches the config.yaml chain |
| Quoted `enabled: "false"` coerced to True | `_as_bool` with warning, applied to all config booleans |
| y-axis min/max/padding fell back to 0.0 silently | `_as_opt_float` warns + ignores |
| Download config.yaml dropped per-rate overrides for hidden rates | passed through verbatim (`extraPerRate`), round-trip-tested |
| Primary selection emitted as `""` when all forecasts toggled off | falls back to the remembered `state.primary` |
| Tick-interval select misdisplayed valid values (5,7,…) | current value injected into the choices |
| Sidebar rebuild collapsed open sections / dropped focus context | open/closed state remembered across rebuilds |
| Display names injected unescaped into legend/hover | `escapeHtml` applied |
| Hover at boundary month attributed actuals value to primary | bridge-trace fix above |
| Excel export ignored the cutoff for actuals | Actuals column now ends at the cutoff; README sheet says so |
| `output_path` never `expanduser()`ed | added |
| `webbrowser.open()` result ignored | failure now prints the file path to open manually |
| README: "labels never overlap" / "2 reserved colors" / "pre-wired for sample data" inaccuracies | reworded |
| Round-trip test hand-synced; self-containment gaps; no Excel/loader tests; run.py untested; shipped-config test pinned a dev path | all covered by the new test suite (see §3) |

**Rejected** (reasoning recorded):

- *Duplicate months keep the last row in file order* — deterministic and
  documented; "keep the newest by original day-of-month" would need day
  information that month-end normalization deliberately discards.
- *Pinned cutoff equal to the last actuals month exports as `null`* —
  intentional (README assumption #7): the monthly refresh must keep
  following the data.
- *`toFixed` vs Excel `0.00` tie-rounding* — divergence only on exact
  half-cent floats, which two-decimal rate data does not produce; not worth
  a custom formatter on both sides.
- *Concurrency guard for two simultaneous first runs* — real but rare;
  a lock file adds its own stale-lock failure modes. The venv self-repair
  path now recovers the aftermath, which is the part that matters.
- *JS tests skip silently without Node* — Node-optional is a hard project
  constraint; the README states the skip behavior explicitly. CI, when it
  exists, should install Node — noted for a human.

---

## 2. Structural proposals

### S1 · Replace pandas CSV parsing with stdlib `csv` — **ACCEPTED, implemented**
- **Rationale:** (1) P1-2 requires exact malformed-row accounting; pandas'
  C parser can only skip-and-count *extra*-field rows via a callable (python
  engine), and cannot report short rows at all — stdlib `csv` sees every raw
  row, so nothing can vanish unreported. (2) pandas was used for exactly one
  thing (reading small CSVs as strings); it drags in numpy, whose version
  floor is the single biggest Python-3.9 reproducibility hazard (P2-4), and
  ~70 MB / most of the "about a minute" first-run install. (3) The loader's
  16 existing tests pin the observable behavior; all pass unchanged.
- **Risk:** pandas' parser is more battle-tested against exotic files.
  Mitigated: encoding fallback chain kept (utf-8-sig → latin-1), `csv` module
  natively handles quoting/embedded newlines/`\r\n`, ragged rows now have
  *defined* semantics (extra → skip+count, short → pad+count), and per-file
  fail-soft (`read_table` returns None with an error) is unchanged.
- **Non-breaking:** data contract, validation messages, and payload are
  unchanged except for the new warnings.

### S2 · Vendor ExcelJS, drop xlsx-js-style — **ACCEPTED, implemented** (P1-1)
- Bundle grows 425 KB → 948 KB (dashboard is ~3.6 MB → ~4.1 MB; acceptable
  for real freeze panes + a maintained MIT writer). UMD build doubles as the
  Node test target, enabling gate 5 automation.

### S3 · Extract the YAML emitter into a pure `RCYaml` module — **ACCEPTED, implemented**
- Enables the real round-trip test (P3-7) and keeps `app.js` focused on state
  and DOM. `app.js` passes context (meta, defaults, last-actual month,
  resolved primary, timestamp) so the module stays side-effect-free.

### S4 · Extract Excel workbook construction into a pure `buildWorkbook` — **ACCEPTED, implemented**
- Same motive as S3: `tests/js/excel_harness.js` builds a workbook under Node
  and pytest inspects the raw sheet XML (pane, formats, columns) — gate 5.

### S5 · Replace the modebar camera with a custom button — **ACCEPTED, implemented** (P3-1)
- One export code path; fresh click-time filename.

### Rejected proposals (with reasoning)
- **R1 · Bundle the Aptos font into the HTML** — rejected: not redistributable
  (Microsoft license), and the fallback chain (Calibri/Segoe UI/Arial) is the
  documented behavior. Fidelity on M365 machines is already exact.
- **R2 · Replace the localStorage session mirror with the File System Access
  API** — rejected: permission prompts per session, blocked by some corporate
  Edge policies, and the YAML download flow is the documented durable save.
- **R3 · Auto-write config.yaml back from the browser** — rejected: impossible
  from `file://` without R2's downsides; the download-and-replace flow stands.
- **R4 · Introduce a JS bundler/TypeScript** — rejected: violates the
  "no runtime node/npm" constraint's spirit for a tool teammates run from
  source; plain ES5 files inlined by Jinja are the right weight.
- **R5 · Switch the CSV fallback encoding from latin-1 to cp1252** — rejected:
  latin-1 cannot fail (all 256 bytes map), which preserves fail-soft; cp1252
  raises on five undefined bytes. For numeric rate CSVs the difference only
  affects header display text. (config.yaml *does* get the cp1252 step,
  P2-5, because paths matter there and latin-1 remains the final net.)
- **R6 · Excel column layout identical across sheets** (keep empty columns,
  contra P3-5) — rejected: "blank because not applicable" misreads as "blank
  forecast"; per-sheet relevant columns with the README-sheet scope note is
  clearer for the deck workflow.

---

## 3. What changed (implementation log)

**Python**
- `src/loader.py` — CSV parsing rewritten on stdlib `csv` (S1): exact
  malformed-row accounting (extra fields → skip + count + line numbers;
  short rows → pad + count; trailing commas → silent trim); encoding chain
  utf-8-sig → cp1252 → latin-1 for CSVs *and* config.yaml; `_parse_number`
  rejects non-finite values and handles thousands separators vs decimal
  commas explicitly; interior-gap disclosure (info); duplicate-header
  first-wins warning now actually reachable; discovery skips `~$` lock files
  and dotfiles, matches `.CSV` case-insensitively; out-of-range cutoff warns.
- `src/validate.py` — Excel two-digit-year pivot; `_as_bool` (string
  booleans warn instead of silently truthy); `_as_opt_float` (bad axis
  numbers warn + ignore instead of silently 0.0).
- `src/build_html.py` — `json.dumps(..., allow_nan=False)`; ExcelJS +
  `yaml_export.js` inlined; `output_path` expanduser.
- `RateComps.py` — venv self-repair (`clear=True` on half-created trees,
  probe for stale redirectors, one clean retry); `ensurepip` repair;
  requirements.lock support with Python-version guard and graceful fallback;
  dependency check now also runs when launched inside the venv; catch-all
  crash handler (log + friendly message, never a raw traceback); stdout
  `errors="replace"`; pip failure message covers PowerShell/SSL cases;
  `webbrowser.open` failure handled.
- `requirements.txt` / `requirements-dev.txt` / `pyproject.toml` — pandas
  (and numpy) removed; `requirements.lock` added.

**Front-end**
- `src/static/js/exports.js` — rewritten on vendored ExcelJS 4.4.0: real
  frozen header row on every sheet, integer date serials (UTC midnight),
  header styling preserved, per-rate columns only where the forecast has
  data, actuals end at the cutoff, README sheet gains scope + exclusion
  lists; pure `buildWorkbook()` exported for the Node harness; filename
  stamp is local-date.
- `src/static/js/charts.js` — `connectgaps: true` (documented decision);
  primary continuation requires a real post-cutoff value; hover-silent
  bridge for the joining segment; custom modebar camera (click-time
  filename); local-date filename stamp; display names escaped.
- `src/static/js/yaml_export.js` (new) — pure config emitter extracted from
  app.js; preserves hidden-rate axis overrides.
- `src/static/js/app.js` — session mirror never clobbered by pristine state;
  reset clears the stored session; sidebar sections remember open state;
  tick-interval select honors any config value; primary name preserved when
  everything is toggled off.
- `src/static/js/vendor/` — `exceljs.bundle.js` + `exceljs.LICENSE.txt`
  (MIT) replace `xlsx.bundle.js` + `xlsx-js-style.LICENSE.txt`.

**Tests** (24 → 72; Node harnesses run when `node` exists, same policy as before)
- `tests/test_loader.py` — +10: ragged rows (both kinds), trailing commas,
  NaN/inf text + strict-JSON payload, duplicate headers, interior gaps,
  decimal commas/thousands, lock files + `.CSV`, cutoff range.
- `tests/test_dates.py` — two-digit-year pivot cases.
- `tests/test_config_roundtrip.py` — real-emitter round-trip via Node
  (gate 4), incl. Windows path and hidden-rate override fidelity; shipped
  config assertion no longer pins a developer path.
- `tests/test_excel_export.py` (new, gate 5) — builds a workbook through the
  real `buildWorkbook` under Node and asserts on the raw OOXML: frozen pane
  per sheet, numFmt ids 17/2, header styles, integer serials, cutoff-
  filtered actuals, per-rate columns, README exclusions, sheet names.
- `tests/test_build_html.py` — self-containment extended to `<img>`,
  `<iframe>`, protocol-relative and `url(http…)` references (gate 3);
  vendor assertions updated.
- `tests/test_run_cli.py` (new) — run.py exit codes, `--data` override,
  clean error output.
- `tests/js/yaml_harness.js`, `tests/js/excel_harness.js` (new).

**Docs**
- `config.yaml` — Windows-path quoting guidance with the three spellings.
- `README.md` — freeze panes + export scope; malformed-row and gap policy;
  two-digit-year rule; number parsing; ExcelJS vendoring; requirements.lock
  workflow; label-overlap claim precise; reserved-colors wording; Windows
  path YAML block; assumption #8 rewritten.

---

## 4. Verification gates — outputs

### Gate 1 · pytest + mypy --strict

```
$ .venv/bin/python -m pytest
........................................................................ [100%]
72 passed

$ .venv/bin/python -m mypy --strict
Success: no issues found in 7 source files
```

### Gate 2 · Fresh-machine simulation (`rm -rf .venv && python3 RateComps.py`)

```
First run detected - one-time setup, about a minute.
Creating a private Python workspace (.venv) next to this file...
Downloading the charting libraries (plotly, jinja2, ...)
This needs internet access once; later runs work fully offline.
[pip installs the 6 pinned packages from requirements.lock]
Setup finished.

Building the Rate Comps dashboard...
Validation report:
  [ok]   folder - /Users/valimenai/Documents/RateComps_Data - 5 CSV file(s) found.
  [ok]   actuals.csv - 9 month(s), Oct-2025 to Jun-2026, rates: fed_funds, sofr, ust_10yr
  [ok]   FY26 Plan 10-16.csv - 13 month(s), Oct-2025 to Oct-2026, ...
  [ok]   8+4 Forecast.csv - 16 month(s), Jul-2026 to Oct-2027, ...
  [ok]   9+3 Forecast.csv - 16 month(s), Jul-2026 to Oct-2027, ...
  [ok]   June 5YO Rates.csv - 25 month(s), Oct-2025 to Oct-2027, ...
  6 note(s), 0 warning(s), 0 error(s)
Dashboard written to: .../rate_comps/output/dashboard.html
Opening it in your browser now. You can close this window.
```

Also exercised: the venv **self-repair** path — with
`.venv/bin/python*` deleted, the next run prints "The private Python
workspace (.venv) looks incomplete - an earlier setup probably got
interrupted. Rebuilding it fresh..." and completes end-to-end.

### Gate 3 · Self-containment

`test_build_writes_selfcontained_html` (in the 72 above) rejects `<script
src>`, `<link href>`, `<img src>`, `<iframe>`, `@import`, and
`url(//…| http…)` in the generated file. Interpretation note: the plotly
bundle contains `http://` inside string literals (XML namespaces) — the
gate is about references the browser would *fetch*, which is what is
asserted.

### Gate 4 · Config round-trip

`test_real_emitter_round_trips_through_parse_config` runs the actual
`RCYaml.emit` under Node with a non-default state (pinned cutoff, disabled
forecast, dash style, y-axis override incl. one for a hidden rate, resized
chart, `C:\Treasury\…` data folder) and reloads it through the real
`parse_config`: every value survives, zero warnings. A node-free fixture
fallback test remains.

### Gate 5 · Excel

`tests/test_excel_export.py` builds the workbook through the real
`RCExports.buildWorkbook` + vendored ExcelJS and inspects the raw OOXML:

- every rate sheet: `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`
- `mmm-yy` → built-in numFmtId 17, `0.00` → numFmtId 2, both applied
- header cells: bold font, `F2F2F2` solid fill, thin bottom border
- date serials are exact integers (`<v>46173</v>`, no hidden 12:00)
- Actuals column ends at the cutoff; forecasts without a rate get no column
- README sheet names the excluded (disabled/hidden) items

### Gate 6 · Visual checklist (Browser, file:// — Edge-equivalent Chromium)

| check | result |
|---|---|
| 10YR Jul-26 cluster 4.75 / 4.49 / 4.44 / 4.39 | ✅ all four labels present, cleanly separated, no overlaps |
| FY26 Plan line + end label stop at Oct-26 | ✅ gray line ends at Oct-26 with its end label (4.47 on 10YR / 2.83 Fed Funds / 2.93 SOFR) |
| June 5YO visibly diverges before the divider | ✅ yellow dash departs from the actuals pack at May–Jun-26, left of the divider |
| Cutoff moved back a month → divider + dash transition move instantly | ✅ divider x moved 2026-07-15 → 2026-06-15, actuals trace truncated to 2026-05-31, thick line dashes from the new boundary; select change → re-render < 200 ms |
| Legend order matches config | ✅ `FY26 Plan (10/16), 8+4 Forecast, 9+3 Forecast, June 5YO` |
| Exported PNG contains labels, markers, divider, captions | ✅ verified on the actual `Plotly.toImage` output (rendered and inspected): labels, white-filled markers, diamond-capped divider, "Actual/Forecast" captions all present |

Note: no reference screenshot files exist in the repo; the checklist was
verified against the values and house-style description in the brief and
README.

---

## 5. CHANGES — summary

**Improved**
- Excel export: real frozen header row (vendored ExcelJS 4.4.0, MIT),
  integer date serials that join cleanly in Excel, cutoff-aligned actuals,
  self-describing README sheet — formatting quality preserved.
- Zero silent data loss in the loader: every malformed row is counted and
  reported; `NaN`-text can no longer brick the whole dashboard; European
  decimal commas no longer misparse 100×; Excel lock files and `.CSV`
  casing handled.
- Bootstrap hardened for the corporate laptop: half-created/stale venvs
  self-heal, pip self-repairs, dependency refresh works in the VS Code
  in-venv flow, every failure path ends in a plain-English message
  (catch-all), reproducible installs via `requirements.lock`.
- Chart semantics: interior gaps bridge deliberately (and are disclosed);
  a null-only "continuation" can no longer mislabel the actuals line;
  boundary-month hover attributes values correctly; image filenames are
  fresh and local-dated.
- Config round-trip: the real emitter is tested end-to-end; hidden-rate
  overrides and the primary selection survive edge cases; string booleans
  and bad numbers warn instead of silently coercing.
- Test suite tripled (24 → 72) with automated gates for self-containment,
  round-trip, and Excel content; pandas/numpy dropped from the runtime
  (smaller, faster, and the main Python-3.9 reproducibility hazard gone).

**Rejected** (details in §1b/§2): Aptos font embedding, File System Access
API persistence, browser-side config write-back, JS build tooling,
duplicate-month ordering change, auto-null cutoff export change,
tie-rounding harmonization, venv concurrency lock, forcing Node.

**Needs a human decision**
1. `requirements.lock` was frozen on this dev machine (CPython 3.14/macOS).
   Re-freeze once from a corporate laptop (`.venv\Scripts\python -m pip
   freeze > requirements.lock`, keep the `# frozen-with-python:` header) so
   the pinned set matches the fleet's Python; until then the version guard
   makes the shipped lock a safe no-op there.
2. Two-digit years now follow Excel's 00-29/30-99 pivot. If anyone feeds
   forecasts dated `Mon-YY` beyond 2029 (e.g. `Oct-45` meaning 2045), they
   must write 4-digit years — README says so, but confirm this matches how
   the team labels long-dated files.
3. The Excel workbook now mirrors the dashboard (actuals cut at the cutoff,
   hidden/disabled series omitted but named on the README sheet). If anyone
   downstream expected the workbook to be a *full* data dump, that is a
   behavior change to sign off.

