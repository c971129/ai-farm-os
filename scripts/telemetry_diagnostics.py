#!/usr/bin/env python3
"""Print safe vendor-telemetry health diagnostics without contacting the vendor."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.senoiot import from_environment, load_env  # noqa: E402


def report() -> dict:
    load_env()
    service = from_environment()
    status = service.status()
    devices = service.store.snapshot(service.stale_seconds)
    return {
        "page_healthy": not status.get("errors") and not status.get("history_errors"),
        "service_status": status.get("status"),
        "configured": status.get("configured"),
        "devices": len(devices),
        "readings": sum(len(device["readings"]) for device in devices),
        "rejected_samples": status.get("rejected_samples", []),
        "history_warnings": status.get("history_warnings", []),
        "errors": status.get("errors", []),
        "history_errors": status.get("history_errors", []),
    }


if __name__ == "__main__":
    print(json.dumps(report(), ensure_ascii=False))
