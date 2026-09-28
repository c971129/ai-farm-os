from __future__ import annotations

import pytest

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.ai_runtime.providers import ProviderError, normalize_endpoint, verify_provider


@pytest.mark.parametrize(
    "base_url",
    [
        "http://192.168.1.10/v1",
        "https://10.0.0.8/v1",
        "https://user:pass@example.com/v1",
        "https://example.com/v1?extra=1",
        "https://example.com/v1#fragment",
    ],
)
def test_normalize_endpoint_rejects_unsafe_provider_urls(base_url: str) -> None:
    with pytest.raises(ProviderError) as raised:
        normalize_endpoint(base_url, "openai", resolve_dns=False)

    assert raised.value.code == "INVALID_CONFIGURATION"


def test_loopback_http_is_allowed_and_gets_openai_completion_path() -> None:
    endpoint = normalize_endpoint("http://127.0.0.1:9999/v1", "openai", resolve_dns=False)

    assert endpoint == "http://127.0.0.1:9999/v1/chat/completions"


def test_anthropic_endpoint_uses_messages_path() -> None:
    endpoint = normalize_endpoint("https://api.anthropic.com", "anthropic", resolve_dns=False)

    assert endpoint == "https://api.anthropic.com/v1/messages"


@contextmanager
def verification_provider(status: int = 200):
    requests: list[dict[str, object]] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            return

        def do_POST(self) -> None:
            size = int(self.headers.get("Content-Length", "0"))
            requests.append(json.loads(self.rfile.read(size)))
            body = b'{"choices":[{"message":{"content":"OK"}}]}' if status == 200 else b'{"error":{"message":"bad request"}}'
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests
    finally:
        server.shutdown()
        worker.join(timeout=2)
        server.server_close()


def test_verify_provider_uses_a_small_non_thinking_request() -> None:
    with verification_provider() as (base_url, requests):
        assert verify_provider(
            {"baseUrl": base_url, "apiFormat": "openai", "defaultModel": "farm-test"},
            "test-key",
        ) == {"verified": True}

    assert requests == [{
        "model": "farm-test",
        "messages": [{"role": "user", "content": "Return exactly OK."}],
        "max_tokens": 16,
        "stream": False,
        "thinking": {"type": "disabled"},
    }]


def test_verify_provider_labels_upstream_bad_request() -> None:
    with verification_provider(400) as (base_url, _requests):
        with pytest.raises(ProviderError) as raised:
            verify_provider(
                {"baseUrl": base_url, "apiFormat": "openai", "defaultModel": "farm-test"},
                "test-key",
            )

    assert raised.value.code == "UPSTREAM_INVALID_REQUEST"
    assert raised.value.status == 400
