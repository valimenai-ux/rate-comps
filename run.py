"""Rate Comps - power-user command line.

Assumes the dependencies are already installed (either activate the .venv
that RateComps.py creates, or ``pip install -r requirements.txt`` into your
own environment).

Examples:
    python run.py
    python run.py --config other_config.yaml --no-open
    python run.py --data "/path/to/RateComps_Data"
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path
from typing import Optional, Sequence

ROOT = Path(__file__).resolve().parent


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="run.py",
        description="Generate the Rate Comps dashboard from config + CSVs.",
    )
    parser.add_argument(
        "--config",
        default=str(ROOT / "config.yaml"),
        help="Path to config.yaml (default: the one next to run.py).",
    )
    parser.add_argument(
        "--data",
        default=None,
        help="Data folder override (takes precedence over config data_folder).",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Do not open the generated dashboard in a browser.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Show full tracebacks instead of friendly messages.",
    )
    args = parser.parse_args(argv)

    sys.path.insert(0, str(ROOT))
    try:
        from src.build_html import build_dashboard
        from src.validate import ConfigError
    except ImportError as exc:
        print(
            "Dependencies are not installed in this Python environment (%s).\n"
            "Either run RateComps.py once (it sets everything up), or run:\n"
            "  pip install -r requirements.txt" % exc,
            file=sys.stderr,
        )
        return 1

    config_path = Path(args.config).expanduser().resolve()
    data_override = Path(args.data).expanduser().resolve() if args.data else None

    try:
        result = build_dashboard(config_path, data_folder_override=data_override)
    except ConfigError as exc:
        if args.debug:
            raise
        print("ERROR: %s" % exc, file=sys.stderr)
        return 1
    except Exception as exc:
        if args.debug:
            raise
        print(
            "ERROR: unexpected failure while building (%s).\n"
            "Re-run with --debug for the full traceback." % exc,
            file=sys.stderr,
        )
        return 1

    print(result.report.format_console())
    print("Dashboard: %s" % result.output_path)
    if not args.no_open:
        webbrowser.open(result.output_path.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
