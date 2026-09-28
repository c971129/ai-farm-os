from __future__ import annotations

import json
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def provider_payload() -> dict[str, object]:
    return {
        "name": "本地测试供应商", "note": "", "baseUrl": "http://127.0.0.1:9999/v1", "apiFormat": "openai",
        "defaultModel": "farm-test", "apiKey": "secret-api-key", "mappings": {},
    }


def runtime_headers(client) -> dict[str, str]:
    token = client.get("/api/ai-runtime/session").json()["data"]["token"]
    return {"Content-Type": "application/json", "Origin": "http://testserver", "X-FarmOS-Session": token}


def test_runtime_writes_require_same_origin_json_and_session_token(locked_client) -> None:
    rejected = locked_client.post("/api/ai-runtime/providers", json=provider_payload())
    assert rejected.status_code == 403

    accepted = locked_client.post("/api/ai-runtime/providers", headers=runtime_headers(locked_client), json=provider_payload())
    assert accepted.status_code == 201
    assert "secret-api-key" not in accepted.text
    assert accepted.json()["data"]["keyConfigured"] is True


def test_runtime_write_prefix_does_not_unlock_existing_demo_writes(locked_client) -> None:
    headers = runtime_headers(locked_client)

    conversation = locked_client.post("/api/ai-runtime/conversations", headers=headers, json={})
    locked = locked_client.post("/api/tasks", headers=headers, json={"title": "仍应锁定"})

    assert conversation.status_code == 201
    assert locked.status_code == 423
    assert locked.json()["error_code"] == "DEMO_WRITES_LOCKED"


def test_context_and_action_drafts_stay_inside_ai_runtime(locked_client) -> None:
    headers = runtime_headers(locked_client)
    with fake_provider() as (base_url, _calls):
        payload = provider_payload()
        payload["baseUrl"] = base_url
        provider = locked_client.post("/api/ai-runtime/providers", headers=headers, json=payload).json()["data"]
        assert locked_client.post(f"/api/ai-runtime/providers/{provider['id']}/verify", headers=headers, json={}).status_code == 200
        assert locked_client.post(f"/api/ai-runtime/providers/{provider['id']}/default", headers=headers, json={}).status_code == 200
        conversation = locked_client.post("/api/ai-runtime/conversations", headers=headers, json={}).json()["data"]
        response = locked_client.post(
            f"/api/ai-runtime/conversations/{conversation['id']}/messages",
            headers=headers,
            json={
                "requestId": "context-1",
                "message": "需要巡田吗",
                "language": "zh",
                "context": {"plotId": "B-01", "questionType": "vigor"},
            },
        )
        assert response.status_code == 202
        draft = locked_client.post(
            f"/api/ai-runtime/conversations/{conversation['id']}/action-drafts",
            headers=headers,
            json={"title": "核验样方", "sourceRunId": response.json()["data"]["id"], "evidence": "补拍样方"},
        )

    assert draft.status_code == 201
    assert locked_client.put(f"/api/ai-runtime/action-drafts/{draft.json()['data']['id']}", headers=headers, json={"status": "confirmed"}).status_code == 200
    assert locked_client.post("/api/tasks", headers=headers, json={"title": "不应调用核心写入"}).status_code == 423


def test_report_settings_and_conversation_reads_are_memory_only(locked_client) -> None:
    headers = runtime_headers(locked_client)

    saved = locked_client.put(
        "/api/ai-runtime/report-settings",
        headers=headers,
        json={"defaultModel": "farm-test", "language": "中文", "citations": True, "manualReview": True},
    )
    created = locked_client.post("/api/ai-runtime/conversations", headers=headers, json={})

    assert saved.status_code == 200
    assert created.status_code == 201
    assert locked_client.get("/api/ai-runtime/report-settings").json()["data"]["defaultModel"] == "farm-test"
    assert len(locked_client.get("/api/ai-runtime/conversations").json()["data"]) == 1


@contextmanager
def fake_provider():
    calls: list[dict[str, object]] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            return

        def do_POST(self) -> None:
            size = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(size))
            calls.append(payload)
            if payload.get("stream"):
                body = 'data: {"choices":[{"delta":{"content":"[[PLAN]][[EXPERTS]][[REVIEW]][[FINAL]]本地假模型建议人工复核。"}}]}\n\ndata: [DONE]\n\n'.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = b'{"choices":[{"message":{"content":"ok"}}]}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", calls
    finally:
        server.shutdown()
        worker.join(timeout=2)
        server.server_close()


def test_provider_to_conversation_flow_with_local_fake_provider(locked_client) -> None:
    headers = runtime_headers(locked_client)
    with fake_provider() as (base_url, calls):
        payload = provider_payload()
        payload["baseUrl"] = base_url
        provider = locked_client.post("/api/ai-runtime/providers", headers=headers, json=payload).json()["data"]
        assert locked_client.post(f"/api/ai-runtime/providers/{provider['id']}/verify", headers=headers, json={}).status_code == 200
        assert locked_client.post(f"/api/ai-runtime/providers/{provider['id']}/default", headers=headers, json={}).status_code == 200
        conversation = locked_client.post("/api/ai-runtime/conversations", headers=headers, json={}).json()["data"]
        accepted = locked_client.post(
            f"/api/ai-runtime/conversations/{conversation['id']}/messages",
            headers=headers,
            json={"requestId": "fake-flow-001", "message": "棉花长势如何", "language": "zh"},
        )
        assert accepted.status_code == 202
        terminal = None
        for _ in range(50):
            terminal = locked_client.get(f"/api/ai-runtime/conversations/{conversation['id']}").json()["data"]["latestRun"]
            if terminal["status"] in {"completed", "failed"}:
                break
            time.sleep(0.02)
        assert terminal["status"] == "completed"
        assert terminal["answer"] == "本地假模型建议人工复核。"
        assert len(calls) == 2
