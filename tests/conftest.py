"""Shared test fixtures: puts the repo root on sys.path and offers CSV helpers."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def repo_root() -> Path:
    return ROOT


@pytest.fixture()
def sample_folder() -> Path:
    return ROOT / "data_sample"


@pytest.fixture()
def write_csv(tmp_path: Path):
    """Factory fixture: write_csv("name.csv", "date,x\\n...") -> Path."""

    def _write(name: str, content: str) -> Path:
        path = tmp_path / name
        path.write_text(content, encoding="utf-8")
        return path

    return _write
