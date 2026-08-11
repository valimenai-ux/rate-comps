"""Runs the Node harness for the label collision engine when node is available."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parent / "js" / "labels_harness.js"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_label_engine_properties() -> None:
    result = subprocess.run(
        ["node", str(HARNESS)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, "label engine harness failed:\n%s%s" % (result.stdout, result.stderr)
    assert "ok" in result.stdout
