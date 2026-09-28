from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is required for the browser engine contract test")
def test_browser_engine_safety_contract():
    completed = subprocess.run(
        ["node", "tests/js/engine_safety.test.js"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "engine safety contract: ok" in completed.stdout
