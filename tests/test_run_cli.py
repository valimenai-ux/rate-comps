"""Smoke tests for the power-user CLI (run.py): exit codes and overrides."""

from __future__ import annotations

from pathlib import Path

import run as run_cli


def test_run_builds_with_overrides(repo_root: Path, sample_folder: Path, tmp_path: Path, capsys) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        "data_folder: %s\noutput_path: %s\n" % (sample_folder, tmp_path / "dash.html"),
        encoding="utf-8",
    )
    code = run_cli.main(["--config", str(config), "--no-open"])
    assert code == 0
    assert (tmp_path / "dash.html").exists()
    out = capsys.readouterr().out
    assert "Validation report:" in out
    assert "Dashboard:" in out


def test_run_reports_config_errors_cleanly(tmp_path: Path, capsys) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("data_folder: %s\n" % (tmp_path / "missing"), encoding="utf-8")
    code = run_cli.main(["--config", str(config), "--no-open"])
    assert code == 1
    err = capsys.readouterr().err
    assert "ERROR:" in err
    assert "Traceback" not in err


def test_run_data_override_takes_precedence(repo_root: Path, sample_folder: Path, tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        "data_folder: %s\noutput_path: %s\n" % (tmp_path / "nonexistent", tmp_path / "dash.html"),
        encoding="utf-8",
    )
    code = run_cli.main(["--config", str(config), "--data", str(sample_folder), "--no-open"])
    assert code == 0
