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
import re
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Optional, Tuple

MIN_PYTHON = (3, 9)
ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
REQUIREMENTS = ROOT / "requirements.txt"
REQUIREMENTS_LOCK = ROOT / "requirements.lock"
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


def requirements_fingerprint(requirements: Path) -> str:
    digest = hashlib.sha256()
    digest.update(requirements.name.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(requirements.read_bytes())
    return digest.hexdigest()


def lock_python_version() -> Optional[Tuple[int, int]]:
    """The Python version requirements.lock was frozen with (header line)."""
    try:
        head = REQUIREMENTS_LOCK.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"^#\s*frozen-with-python:\s*(\d+)\.(\d+)", head, re.MULTILINE)
    if match is None:
        return None
    return (int(match.group(1)), int(match.group(2)))


def pick_requirements() -> Path:
    """Prefer the pinned requirements.lock when it matches this Python."""
    if not REQUIREMENTS_LOCK.exists():
        return REQUIREMENTS
    frozen = lock_python_version()
    running = (sys.version_info[0], sys.version_info[1])
    if frozen == running:
        return REQUIREMENTS_LOCK
    if frozen is not None:
        say(
            "(requirements.lock targets Python %d.%d; this is Python %d.%d, "
            "so the flexible requirements.txt is used instead)"
            % (frozen[0], frozen[1], running[0], running[1])
        )
    return REQUIREMENTS


def create_venv(clear: bool) -> None:
    import venv

    venv.EnvBuilder(with_pip=True, clear=clear).create(str(VENV_DIR))


def venv_python_works() -> bool:
    """A venv can exist yet be broken (base Python upgraded or uninstalled:
    the redirector then fails with a cryptic 'No Python at ...')."""
    try:
        probe = subprocess.run(
            [str(venv_python()), "-c", "import sys"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return probe.returncode == 0
    except OSError:
        return False


def ensure_workspace() -> None:
    """Create .venv, healing a half-created or stale one from an interrupted
    run or a base-Python upgrade."""
    if running_inside_venv():
        return  # we ARE the venv python, so it self-evidently works
    if venv_python().exists() and venv_python_works():
        return
    say("")
    if VENV_DIR.exists():
        say("The private Python workspace (.venv) looks incomplete - an earlier")
        say("setup probably got interrupted. Rebuilding it fresh...")
    else:
        say("First run detected - one-time setup, about a minute.")
        say("Creating a private Python workspace (.venv) next to this file...")
    try:
        create_venv(clear=VENV_DIR.exists())
        if not venv_python().exists():
            create_venv(clear=True)  # "succeeded" but unusable - start over
    except Exception:
        try:
            create_venv(clear=True)  # one clean retry from scratch
        except Exception as exc:
            fail(
                "Python could not create its workspace folder",
                "Try deleting the '.venv' folder next to RateComps.py (if it",
                "exists) and running this again.",
                "",
                "Technical detail: %s" % exc,
            )
    if not venv_python().exists():
        fail(
            "Python could not create its workspace folder",
            "Delete the '.venv' folder next to RateComps.py and run this again.",
        )


def pip_available() -> bool:
    probe = subprocess.run(
        [str(venv_python()), "-m", "pip", "--version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return probe.returncode == 0


def ensure_pip() -> None:
    """Repair a venv whose pip bootstrap failed, instead of blaming the network."""
    if pip_available():
        return
    say("Repairing the workspace's package installer (pip)...")
    subprocess.run(
        [str(venv_python()), "-m", "ensurepip", "--upgrade"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not pip_available():
        fail(
            "The workspace's package installer (pip) is missing",
            "Delete the '.venv' folder next to RateComps.py and run this",
            "again (that redoes the one-time setup from scratch).",
        )


def pip_install(requirements: Path) -> int:
    command = [
        str(venv_python()),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        str(requirements),
    ]
    return subprocess.run(command).returncode


def ensure_environment() -> None:
    """Create .venv and install the libraries on first run (or after the
    requirements file changes)."""
    ensure_workspace()

    requirements = pick_requirements()
    fingerprint = requirements_fingerprint(requirements)
    try:
        if SENTINEL.exists() and SENTINEL.read_text(encoding="utf-8").strip() == fingerprint:
            return
    except (OSError, ValueError):
        pass  # unreadable/corrupted sentinel (OneDrive conflicts) - reinstall

    ensure_pip()
    say("Downloading the charting libraries (plotly, jinja2, ...)")
    say("This needs internet access once; later runs work fully offline.")
    returncode = pip_install(requirements)
    if returncode != 0 and requirements == REQUIREMENTS_LOCK:
        say("")
        say("The pinned library set could not be installed on this machine;")
        say("trying the flexible version ranges instead...")
        requirements = REQUIREMENTS
        fingerprint = requirements_fingerprint(requirements)
        returncode = pip_install(requirements)
    if returncode != 0:
        fail(
            "The charting libraries could not be installed",
            "The messages printed above (from 'pip') say why. Most often the",
            "corporate network is blocking Python's download service",
            "(pypi.org). What to try, in order:",
            "",
            "  1. If you use a VPN, connect it and run this file again.",
            "  2. If your company uses a proxy, ask IT for the proxy address,",
            "     set it in the same terminal, and run this file again:",
            "        Windows PowerShell:  $env:HTTPS_PROXY = 'http://proxy.company.com:8080'",
            "        Windows cmd:         set HTTPS_PROXY=http://proxy.company.com:8080",
            "        macOS:               export HTTPS_PROXY=http://proxy.company.com:8080",
            "  3. If the pip messages mention certificates or SSL, your",
            "     network inspects secure traffic - forward this whole",
            "     message (and the pip output) to IT.",
            "  4. Otherwise ask IT to allow access to pypi.org from Python/pip.",
        )
    try:
        SENTINEL.write_text(fingerprint, encoding="utf-8")
    except OSError:
        say("(note: could not record the setup marker; setup will re-run next time)")
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
        import webbrowser

        if webbrowser.open(result.output_path.as_uri()):
            say("Opening it in your browser now. You can close this window.")
        else:
            say("The browser could not be opened automatically - double-click")
            say("the file above (or paste its path into your browser).")


def main() -> None:
    # Best effort: never let an exotic character in a path/message crash a
    # cp1252 Windows console mid-report.
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        try:
            reconfigure(errors="replace")
        except (OSError, ValueError):
            pass
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
        # VS Code often selects .venv as the interpreter, so this is the
        # documented flow after first setup - still verify the installed
        # libraries match the requirements file before building.
        ensure_environment()
        build_and_open()
        return
    ensure_environment()
    relaunch_inside_venv()


def _crash(exc: BaseException) -> None:
    """Last-resort handler: no failure may reach the user as a raw traceback
    (AppLocker blocking .venv python, AV file locks, disk quota, ...)."""
    log_path = ROOT / "output" / "last_error.log"
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(traceback.format_exc(), encoding="utf-8")
        where = str(log_path)
    except OSError:
        where = "(the log could not be written)"
    fail(
        "Something unexpected stopped the tool",
        "Short version: %s" % exc,
        "",
        "A technical log was saved to:",
        "  %s" % where,
        "If this mentions 'Access is denied' or 'WinError 5', your company's",
        "security software may be blocking Python inside the '.venv' folder -",
        "forward the log to IT. Otherwise share it with whoever maintains",
        "this tool.",
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say("\nStopped.")
        sys.exit(130)
    except SystemExit:
        raise
    except BaseException as exc:
        _crash(exc)
