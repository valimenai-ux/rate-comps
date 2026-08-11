"""Rate Comps - one-click launcher.

Open this file in VS Code and click Run. That's it.

On the first run it quietly creates a private Python workspace (a ".venv"
folder next to this file) and downloads the charting libraries into it -
about a minute. After that, every run just rebuilds the dashboard from the
CSVs and opens it in your browser.

Power users: see run.py for command-line options.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import traceback
from pathlib import Path

MIN_PYTHON = (3, 9)
ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
REQUIREMENTS = ROOT / "requirements.txt"
SENTINEL = VENV_DIR / ".deps-ok"


def say(message: str) -> None:
    print(message, flush=True)


def pause_if_interactive() -> None:
    try:
        if sys.stdin is not None and sys.stdin.isatty():
            input("\nPress Enter to close...")
    except (EOFError, OSError):
        pass


def fail(title: str, *lines: str) -> None:
    say("")
    say("=" * 64)
    say("PROBLEM: %s" % title)
    say("=" * 64)
    for line in lines:
        say(line)
    pause_if_interactive()
    sys.exit(1)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def running_inside_venv() -> bool:
    try:
        return Path(sys.prefix).resolve() == VENV_DIR.resolve()
    except OSError:
        return False


def requirements_fingerprint() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def ensure_environment() -> None:
    """Create .venv and install the libraries on first run (or after the
    requirements file changes)."""
    if not venv_python().exists():
        say("")
        say("First run detected - one-time setup, about a minute.")
        say("Creating a private Python workspace (.venv) next to this file...")
        try:
            import venv

            venv.EnvBuilder(with_pip=True, clear=False).create(str(VENV_DIR))
        except Exception as exc:
            fail(
                "Python could not create its workspace folder",
                "Try deleting the '.venv' folder next to RateComps.py (if it",
                "exists) and running this again.",
                "",
                "Technical detail: %s" % exc,
            )

    fingerprint = requirements_fingerprint()
    if SENTINEL.exists() and SENTINEL.read_text(encoding="utf-8").strip() == fingerprint:
        return

    say("Downloading the charting libraries (pandas, plotly, ...)")
    say("This needs internet access once; later runs work fully offline.")
    command = [
        str(venv_python()),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        str(REQUIREMENTS),
    ]
    result = subprocess.run(command)
    if result.returncode != 0:
        fail(
            "The charting libraries could not be downloaded",
            "This usually means the corporate network is blocking Python's",
            "download service (pypi.org). What to try, in order:",
            "",
            "  1. If you use a VPN, connect it and run this file again.",
            "  2. If your company uses a proxy, ask IT for the proxy address,",
            "     then run this in the same terminal and try again:",
            "        macOS:       export HTTPS_PROXY=http://proxy.company.com:8080",
            "        Windows:     set HTTPS_PROXY=http://proxy.company.com:8080",
            "  3. Forward this whole message to IT and ask them to allow",
            "     access to pypi.org from Python/pip.",
        )
    SENTINEL.write_text(fingerprint, encoding="utf-8")
    say("Setup finished.")


def relaunch_inside_venv() -> None:
    result = subprocess.run([str(venv_python()), str(Path(__file__).resolve())])
    sys.exit(result.returncode)


def build_and_open() -> None:
    sys.path.insert(0, str(ROOT))
    try:
        from src.build_html import build_dashboard
        from src.validate import ConfigError
    except Exception as exc:
        fail(
            "The charting libraries did not load correctly",
            "Try deleting the '.venv' folder next to RateComps.py and running",
            "this file again (that redoes the one-time setup).",
            "",
            "Technical detail: %s" % exc,
        )
        return  # unreachable; keeps type-checkers happy

    say("")
    say("Building the Rate Comps dashboard...")
    try:
        result = build_dashboard(ROOT / "config.yaml")
    except ConfigError as exc:
        fail("The dashboard could not be built", str(exc))
        return
    except Exception:
        log_path = ROOT / "output" / "last_error.log"
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_path.write_text(traceback.format_exc(), encoding="utf-8")
            where = str(log_path)
        except OSError:
            where = "(the log could not be written)"
        fail(
            "Something unexpected went wrong while building the charts",
            "A technical log was saved to:",
            "  %s" % where,
            "Share that file with whoever maintains this tool.",
        )
        return

    say("")
    say(result.report.format_console())
    say("")
    say("Dashboard written to: %s" % result.output_path)
    if os.environ.get("RATECOMPS_NO_OPEN"):
        say("(browser not opened because RATECOMPS_NO_OPEN is set)")
    else:
        say("Opening it in your browser now. You can close this window.")
        import webbrowser

        webbrowser.open(result.output_path.as_uri())


def main() -> None:
    if sys.version_info < MIN_PYTHON:
        fail(
            "This tool needs Python %d.%d or newer" % MIN_PYTHON,
            "This computer is running Python %s." % sys.version.split()[0],
            "",
            "Install a newer Python from your company software portal or",
            "https://www.python.org/downloads/ , then open this file in",
            "VS Code again and click Run.",
        )
    if not REQUIREMENTS.exists():
        fail(
            "A file named requirements.txt is missing",
            "It belongs next to RateComps.py. Restore the full rate_comps",
            "folder (for example from source control) and run this again.",
        )
    if running_inside_venv():
        build_and_open()
        return
    ensure_environment()
    relaunch_inside_venv()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say("\nStopped.")
        sys.exit(130)
