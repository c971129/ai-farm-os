from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _fresh_backend(monkeypatch: pytest.MonkeyPatch, db_path: Path, writes: bool):
    monkeypatch.setenv("AI_FARM_DB_PATH", str(db_path))
    monkeypatch.setenv("AI_FARM_SIMULATOR", "0")
    monkeypatch.setenv("SENOIOT_ENABLED", "0")
    monkeypatch.setenv("SENOIOT_DB_PATH", str(db_path.with_name("telemetry-" + db_path.name)))
    monkeypatch.setenv("AI_FARM_SYNC_DEMO_CONTRACT", "1")
    monkeypatch.setenv("AI_FARM_ALLOW_DEMO_WRITES", "1" if writes else "0")
    if writes:
        monkeypatch.setenv("AI_FARM_WRITE_TOKEN", "test-write-token")
    else:
        monkeypatch.delenv("AI_FARM_WRITE_TOKEN", raising=False)
    for name in ("backend.app", "backend.db"):
        sys.modules.pop(name, None)
    return importlib.import_module("backend.app")


@pytest.fixture
def locked_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[TestClient]:
    module = _fresh_backend(monkeypatch, tmp_path / "locked.db", writes=False)
    with TestClient(module.app) as client:
        yield client
    module.conn.close()
    for name in ("backend.app", "backend.db"):
        sys.modules.pop(name, None)


@pytest.fixture
def writable_backend(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    module = _fresh_backend(monkeypatch, tmp_path / "writable.db", writes=True)
    with TestClient(module.app) as client:
        yield client, module
    module.conn.close()
    for name in ("backend.app", "backend.db"):
        sys.modules.pop(name, None)
