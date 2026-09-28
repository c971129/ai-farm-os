from __future__ import annotations

import asyncio

import httpx


SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store",
}


def test_health_declares_honest_partial_demo_mode(locked_client):
    response = locked_client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data_mode"] == "demo"
    assert payload["business_api"] == "partial"
    assert payload["control_mode"] == "simulation_locked"
    assert payload["simulator"] == "disabled"
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_expert_council_is_read_only_and_preserves_each_no_go(locked_client):
    council = locked_client.get("/api/agents/council")
    assert council.status_code == 200
    payload = council.json()
    assert payload["non_executable"] is True
    assert payload["no_device_control"] is True
    assert len(payload["agents"]) == 10
    assert all("独立" in item["isolation"] and item["hard_stops"] for item in payload["agents"])

    preview = locked_client.get("/api/agents/council/review", params={"goal": "B-01 跨专业证据复核"})
    assert preview.status_code == 200
    result = preview.json()
    assert result["executable"] is False
    assert result["device_command_count"] == 0
    assert result["independent_agents"] == 10
    assert all(item["independent"] is True and item["gate"].startswith("NO_GO") for item in result["outputs"])
    assert "不生成工单" in result["coordinator"]["rule"]


def test_all_demo_writes_are_locked_by_default(locked_client):
    response = locked_client.post("/api/tasks", json={"title": "不应写入"})
    assert response.status_code == 423
    assert response.json()["error_code"] == "DEMO_WRITES_LOCKED"
    assert response.headers["cache-control"] == "no-store"


def test_token_is_required_when_demo_writes_are_enabled(writable_backend):
    client, _ = writable_backend
    response = client.post("/api/tasks", json={"title": "不应写入"})
    assert response.status_code == 401
    assert response.json()["error_code"] == "AUTH_REQUIRED"


def test_irrigation_no_go_is_idempotent_and_does_not_change_observation(writable_backend):
    client, module = writable_backend
    headers = {"X-AI-Farm-Token": "test-write-token", "Idempotency-Key": "irrigation-B-01-001"}
    before = next(item for item in client.get("/api/lands").json() if item["code"] == "B-01")
    plans_before = module.one(
        "SELECT COUNT(*) AS n FROM irrigation_plans WHERE land_code = ?", ("B-01",)
    )["n"]
    first = client.post("/api/irrigation/apply?land_code=B-01", headers=headers)
    second = client.post("/api/irrigation/apply?land_code=B-01", headers=headers)
    after = next(item for item in client.get("/api/lands").json() if item["code"] == "B-01")

    assert first.status_code == 200
    assert first.json()["decision"] == "NO_GO"
    assert first.json()["executable"] is False
    assert first.json()["command_id"] is None
    assert second.json()["idempotent_replay"] is True
    assert before["moisture"] == after["moisture"]
    assert before["pest_risk"] == after["pest_risk"]
    assert module.one("SELECT COUNT(*) AS n FROM audit_events WHERE request_id = ?", ("irrigation-B-01-001",))["n"] == 1
    plans_after = module.one(
        "SELECT COUNT(*) AS n FROM irrigation_plans WHERE land_code = ?", ("B-01",)
    )["n"]
    assert plans_after == plans_before + 1


def test_input_validation_and_unknown_device_fail_closed(writable_backend):
    client, _ = writable_backend
    headers = {"X-AI-Farm-Token": "test-write-token"}
    invalid = client.post("/api/devices/register", headers=headers, json={"code": '\"></select><img onerror=alert(1)>', "device_type": "drone"})
    missing = client.post("/api/devices/99999/control", headers=headers, json={"action": "start"})
    illegal_action = client.post("/api/devices/1/control", headers=headers, json={"action": "explode"})
    assert invalid.status_code == 422
    assert missing.status_code == 404
    assert illegal_action.status_code == 422


def test_cors_rejects_untrusted_origin(locked_client):
    response = locked_client.options(
        "/api/health",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_large_api_payload_is_rejected_before_parsing(locked_client):
    response = locked_client.post(
        "/api/ai/chat",
        content=b"x" * 65_537,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413, response.text
    assert response.json()["error_code"] == "PAYLOAD_TOO_LARGE"


def test_streamed_payload_without_content_length_is_also_limited(writable_backend):
    _, module = writable_backend

    async def send_streamed_request():
        async def chunks():
            yield b'{"question":"' + (b"x" * 40_000)
            yield (b"x" * 30_000) + b'"}'

        transport = httpx.ASGITransport(app=module.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.post(
                "/api/ai/chat",
                headers={"Content-Type": "application/json", "X-AI-Farm-Token": "test-write-token"},
                content=chunks(),
            )

    response = asyncio.run(send_streamed_request())
    assert response.status_code == 413, response.text
    assert response.json()["error_code"] == "PAYLOAD_TOO_LARGE"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_dashboard_priority_is_fail_closed_and_targets_are_labeled(locked_client):
    dashboard = locked_client.get("/api/dashboard").json()
    assert dashboard["kpis"]["metric_status"] == "demo_targets_unverified"
    assert "目标场景" in " ".join(item["text"] for item in dashboard["alerts"])
    assert dashboard["priority"]["executable"] is False
    assert dashboard["priority"]["decision"] in {"NO_GO", "REVIEW"}
    assert dashboard["data_meta"]["quality_code"] == "DEMO_UNVERIFIED"
    assert dashboard["data_meta"]["observed_at"] is None
    assert all(item["data_origin"] == "SEED_SNAPSHOT" and item["observed_at"] is None for item in dashboard["lands"])
    assert all(item["production_connected"] is False and item["quality_code"] == "DEMO_UNVERIFIED" for item in dashboard["devices"])


def test_demo_geometry_is_explicit_and_closed(locked_client):
    twin = locked_client.get("/api/twin").json()
    assert twin["geometry_meta"]["coordinate_space"] == "screen_demo"
    assert twin["geometry_meta"]["crs"] is None
    for land in twin["lands"]:
        ring = land["geojson"]["coordinates"][0]
        assert ring[0] == ring[-1]


def test_irrigation_board_never_computes_dose_from_demo_moisture(locked_client):
    payload = locked_client.get("/api/irrigation").json()
    assert payload["data_meta"]["mode"] == "demo"
    assert payload["suggestions"]
    assert all(item["decision"] == "NO_GO" and item["executable"] is False for item in payload["suggestions"])
    assert all(
        item["water_mm"] is None
        and item["calculation_status"] == "NOT_CALCULATED"
        and "不生成" in item["fertilizer"]
        for item in payload["suggestions"]
    )


def test_sandbox_task_and_device_records_are_explicitly_non_production(writable_backend):
    client, _ = writable_backend
    headers = {"X-AI-Farm-Token": "test-write-token"}
    task = client.post(
        "/api/tasks",
        headers={**headers, "Idempotency-Key": "task-demo-001"},
        json={"title": "证据核验", "land_code": "B-01"},
    )
    device = client.post(
        "/api/devices/register",
        headers={**headers, "Idempotency-Key": "device-demo-001"},
        json={"code": "DEMO-NEW-001", "name": "沙箱探针", "device_type": "sensor", "location": "B-01", "vendor_id": "meter"},
    )
    assert task.status_code == 200
    assert task.json()["status"] == "待人工确认"
    assert task.json()["simulated"] is True and task.json()["executable"] is False
    assert device.status_code == 200
    assert device.json()["production_connected"] is False
    assert device.json()["status"] == "沙箱待联调"


def test_expert_audit_requires_declared_identity_qualification_and_evidence(writable_backend):
    client, _ = writable_backend
    headers = {"X-AI-Farm-Token": "test-write-token"}
    task = next(item for item in client.get("/api/tasks?role=expert").json() if item["status"] == "待审核")

    missing = client.post(
        f"/api/tasks/{task['id']}/audit",
        headers=headers,
        json={"approved": True, "comment": "缺少身份与证据"},
    )
    assert missing.status_code == 422

    reviewed = client.post(
        f"/api/tasks/{task['id']}/audit",
        headers={**headers, "Idempotency-Key": "expert-audit-001"},
        json={
            "approved": True,
            "comment": "仅记录初审意见，不构成设备执行放行",
            "reviewer_id": "EX-102",
            "qualification_scope": "综合农艺复核",
            "credential_ref": "CRED-2026-102",
            "evidence_refs": ["REC-FIELD-001", "FILE-WX-001"],
        },
    )
    assert reviewed.status_code == 200
    payload = reviewed.json()
    assert payload["audit_by"] == "EX-102"
    assert payload["identity_assurance"] == "DECLARED_UNVERIFIED"
    assert payload["gate_scope"] == "ADVISORY_ONLY"
    assert payload["executable"] is False
