from __future__ import annotations

import http.client
import ipaddress
import json
import socket
import ssl
import time
import urllib.parse
from collections.abc import Iterator


MAX_RESPONSE_BYTES = 1_048_576
MAX_COMPLETION_TEXT = 64_000


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _allow_loopback(hostname: str) -> bool:
    return hostname.casefold() in {"127.0.0.1", "localhost", "::1"}


def _validate_addresses(addresses: list[tuple[object, ...]], allow_loopback: bool) -> None:
    if not addresses:
        raise ProviderError("NETWORK_ERROR", "无法解析模型服务地址")
    for item in addresses:
        address = ipaddress.ip_address(str(item[4][0]))
        if allow_loopback and address.is_loopback:
            continue
        if not address.is_global or address.is_private or address.is_loopback or address.is_link_local or address.is_multicast or address.is_reserved or address.is_unspecified:
            raise ProviderError("INVALID_CONFIGURATION", "Base URL 不允许访问本机以外的内网地址", 400)


def _resolve(hostname: str, port: int, allow_loopback: bool) -> list[tuple[object, ...]]:
    try:
        addresses = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    except socket.gaierror as error:
        raise ProviderError("NETWORK_ERROR", "无法解析模型服务地址") from error
    _validate_addresses(addresses, allow_loopback)
    return addresses


def normalize_endpoint(base_url: str, api_format: str, *, resolve_dns: bool = True) -> str:
    if api_format not in {"openai", "anthropic"}:
        raise ProviderError("INVALID_CONFIGURATION", "不支持的 API 格式", 400)
    if not isinstance(base_url, str) or not base_url.strip():
        raise ProviderError("INVALID_CONFIGURATION", "Base URL 不能为空", 400)
    try:
        parsed = urllib.parse.urlsplit(base_url.strip())
        port = parsed.port
    except ValueError as error:
        raise ProviderError("INVALID_CONFIGURATION", "Base URL 格式无效", 400) from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ProviderError("INVALID_CONFIGURATION", "Base URL 必须使用 HTTP(S)", 400)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ProviderError("INVALID_CONFIGURATION", "Base URL 不能包含凭据、查询参数或片段", 400)
    hostname = parsed.hostname.casefold()
    loopback = _allow_loopback(hostname)
    if parsed.scheme == "http" and not loopback:
        raise ProviderError("INVALID_CONFIGURATION", "HTTP 仅允许本机模型服务", 400)
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None and not (loopback and literal.is_loopback) and not literal.is_global:
        raise ProviderError("INVALID_CONFIGURATION", "Base URL 不允许访问内网地址", 400)
    if resolve_dns:
        _resolve(hostname, port or (443 if parsed.scheme == "https" else 80), loopback)
    path = parsed.path.rstrip("/")
    if api_format == "openai" and not path.endswith("/chat/completions"):
        path += "/chat/completions"
    if api_format == "anthropic" and not path.endswith("/messages"):
        path += "/messages" if path.endswith("/v1") else "/v1/messages"
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path or "/", "", ""))


def _map_status(status: int) -> ProviderError:
    if status == 400:
        return ProviderError("UPSTREAM_INVALID_REQUEST", "模型服务拒绝了验证请求", 400)
    if status in {401, 403}:
        return ProviderError("AUTHENTICATION_FAILED", "模型服务鉴权失败", 401)
    if status == 402:
        return ProviderError("INSUFFICIENT_BALANCE", "模型服务余额不足", 402)
    if status == 404:
        return ProviderError("MODEL_NOT_FOUND", "模型名称或接口路径不存在", 400)
    if status == 422:
        return ProviderError("UPSTREAM_INVALID_PARAMETERS", "模型服务不接受当前请求参数", 400)
    if status == 429:
        return ProviderError("RATE_LIMITED", "模型服务触发限流或额度不足", 429)
    if status >= 500:
        return ProviderError("UPSTREAM_UNAVAILABLE", "模型服务暂时不可用")
    return ProviderError("INVALID_CONFIGURATION", f"模型服务拒绝请求（HTTP {status}）", 400)


def _connection(endpoint: str, timeout: float) -> tuple[http.client.HTTPConnection, urllib.parse.SplitResult]:
    target = urllib.parse.urlsplit(endpoint)
    port = target.port or (443 if target.scheme == "https" else 80)
    addresses = _resolve(str(target.hostname), port, _allow_loopback(str(target.hostname)))
    last_error: OSError | ssl.SSLError | None = None
    for family, kind, proto, _, sockaddr in addresses:
        raw: socket.socket | None = None
        try:
            raw = socket.socket(int(family), int(kind), int(proto))
            raw.settimeout(timeout)
            raw.connect(sockaddr)
            if target.scheme == "https":
                wrapped = ssl.create_default_context().wrap_socket(raw, server_hostname=target.hostname)
                conn: http.client.HTTPConnection = http.client.HTTPSConnection(str(target.hostname), port, timeout=timeout)
            else:
                wrapped = raw
                conn = http.client.HTTPConnection(str(target.hostname), port, timeout=timeout)
            conn.sock = wrapped
            return conn, target
        except (OSError, ssl.SSLError) as error:
            last_error = error
            if raw is not None:
                raw.close()
    raise ProviderError("NETWORK_ERROR", "无法连接模型服务") from last_error


def _request(config: dict[str, object], api_key: str, model: str, messages: list[dict[str, str]], *, stream: bool, timeout: float, max_tokens: int,
             extra_payload: dict[str, object] | None = None) -> tuple[http.client.HTTPConnection, http.client.HTTPResponse, str]:
    api_format, base_url = config.get("apiFormat"), config.get("baseUrl")
    if api_format not in {"openai", "anthropic"} or not isinstance(base_url, str):
        raise ProviderError("INVALID_CONFIGURATION", "模型配置不完整", 400)
    if not isinstance(api_key, str) or not api_key:
        raise ProviderError("KEY_NOT_CONFIGURED", "尚未配置 API Key", 400)
    endpoint = normalize_endpoint(base_url, str(api_format), resolve_dns=False)
    if api_format == "openai":
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "text/event-stream" if stream else "application/json"}
        payload: dict[str, object] = {"model": model, "messages": messages, "max_tokens": max_tokens, "stream": stream}
    else:
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json", "Accept": "text/event-stream" if stream else "application/json"}
        payload = {"model": model, "messages": [item for item in messages if item.get("role") != "system"], "max_tokens": max_tokens, "stream": stream}
        systems = [item["content"] for item in messages if item.get("role") == "system"]
        if systems:
            payload["system"] = systems[0]
    if extra_payload:
        payload.update(extra_payload)
    conn, target = _connection(endpoint, timeout)
    try:
        conn.request("POST", target.path or "/", body=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers)
        response = conn.getresponse()
        if not 200 <= response.status < 300:
            conn.close()
            raise _map_status(response.status)
        return conn, response, str(api_format)
    except (socket.timeout, TimeoutError) as error:
        conn.close()
        raise ProviderError("UPSTREAM_TIMEOUT", "连接模型服务超时", 504) from error
    except ProviderError:
        raise
    except (OSError, http.client.HTTPException) as error:
        conn.close()
        raise ProviderError("NETWORK_ERROR", "无法连接模型服务") from error


def _read_json(response: http.client.HTTPResponse) -> dict[str, object]:
    raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ProviderError("UPSTREAM_UNAVAILABLE", "模型服务响应超过安全限制")
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ProviderError("UPSTREAM_UNAVAILABLE", "模型服务响应格式无效") from error
    if not isinstance(value, dict):
        raise ProviderError("UPSTREAM_UNAVAILABLE", "模型服务响应格式无效")
    return value


def verify_provider(config: dict[str, object], api_key: str) -> dict[str, object]:
    model = str(config.get("defaultModel", "")).strip()
    if not model:
        raise ProviderError("INVALID_CONFIGURATION", "默认模型未配置", 400)
    extra_payload = {"thinking": {"type": "disabled"}} if config.get("apiFormat") == "openai" else None
    conn, response, _ = _request(
        config,
        api_key,
        model,
        [{"role": "user", "content": "Return exactly OK."}],
        stream=False,
        timeout=30.0,
        max_tokens=16,
        extra_payload=extra_payload,
    )
    try:
        _read_json(response)
    finally:
        conn.close()
    return {"verified": True}


def _delta(event: dict[str, object], api_format: str) -> str:
    if api_format == "openai":
        choices = event.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            delta = choices[0].get("delta", {})
            if isinstance(delta, dict) and isinstance(delta.get("content"), str):
                return str(delta["content"])
    else:
        delta = event.get("delta")
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            return str(delta["text"])
    return ""


def stream_text(config: dict[str, object], api_key: str, model: str, system_prompt: str, messages: list[dict[str, str]], timeout: float = 45.0) -> Iterator[str]:
    payload = [{"role": "system", "content": system_prompt}, *messages]
    conn, response, api_format = _request(config, api_key, model, payload, stream=True, timeout=timeout, max_tokens=4096)
    total = 0
    try:
        while True:
            raw = response.readline(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ProviderError("UPSTREAM_UNAVAILABLE", "模型服务响应超过安全限制")
            if not raw:
                break
            line = raw.decode("utf-8", errors="strict").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
            except json.JSONDecodeError as error:
                raise ProviderError("UPSTREAM_UNAVAILABLE", "模型服务流格式无效") from error
            if not isinstance(event, dict):
                continue
            value = _delta(event, api_format)
            if value:
                total += len(value)
                if total > MAX_COMPLETION_TEXT:
                    raise ProviderError("UPSTREAM_UNAVAILABLE", "模型回答超过安全限制")
                yield value
    except (socket.timeout, TimeoutError) as error:
        raise ProviderError("UPSTREAM_TIMEOUT", "连接模型服务超时", 504) from error
    finally:
        conn.close()
