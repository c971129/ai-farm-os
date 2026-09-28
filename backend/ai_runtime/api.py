from __future__ import annotations

import hmac
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .agents import OrchestrationError, SingleStreamOrchestrator
from .conversations import ConversationStore
from .providers import ProviderError, verify_provider
from .state import MemoryStore, ValidationError


class RuntimeService:
    def __init__(self) -> None:
        self.store = MemoryStore()
        self.conversations = ConversationStore()
        self.orchestrator = SingleStreamOrchestrator(self.store, self.conversations)
        self.session_token = secrets.token_urlsafe(32)

    def close(self) -> None:
        self.orchestrator.close()


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": {"code": code, "message": message}})


def _exception(error: Exception) -> JSONResponse:
    if isinstance(error, ValidationError):
        status = 404 if error.code in {"PROVIDER_NOT_FOUND", "CONVERSATION_NOT_FOUND", "RUN_NOT_FOUND"} else 409 if error.code in {"PROVIDER_LIMIT_REACHED", "CONVERSATION_LIMIT_REACHED", "RUN_CAPACITY_REACHED"} else 400
        return _error(status, error.code, str(error))
    if isinstance(error, ProviderError):
        messages = {
            "AUTHENTICATION_FAILED": "模型服务鉴权失败",
            "INSUFFICIENT_BALANCE": "模型服务余额不足",
            "MODEL_NOT_FOUND": "模型名称或接口路径不存在",
            "RATE_LIMITED": "模型服务触发限流或额度不足",
            "UPSTREAM_TIMEOUT": "连接模型服务超时",
            "UPSTREAM_INVALID_REQUEST": "模型服务拒绝了验证请求，请检查接口格式和模型参数",
            "UPSTREAM_INVALID_PARAMETERS": "模型服务不接受当前请求参数，请检查接口格式和模型参数",
        }
        return _error(error.status, error.code, messages.get(error.code, "模型服务暂时不可用"))
    if isinstance(error, OrchestrationError):
        return _error(502, error.code, "模型流式协作失败")
    return _error(500, "AI_RUNTIME_ERROR", "本地 AI 服务处理失败")


def _allowed_origins(request: Request) -> set[str]:
    host = (request.headers.get("host") or "").casefold()
    self_origin = f"{request.url.scheme}://{host}" if host else ""
    configured = {
        item.strip()
        for item in os.getenv("AI_FARM_ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    }
    if self_origin:
        configured.add(self_origin)
    return configured


def _write_allowed(request: Request, service: RuntimeService) -> Optional[JSONResponse]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
    if content_type != "application/json":
        return _error(415, "INVALID_CONTENT_TYPE", "写请求必须使用 JSON")
    origin = (request.headers.get("origin") or "").strip()
    allowed = {item.casefold() for item in _allowed_origins(request)}
    if origin.casefold() not in allowed:
        return _error(403, "ORIGIN_REJECTED", "拒绝跨域请求")
    token = request.headers.get("X-FarmOS-Session", "")
    if not hmac.compare_digest(token, service.session_token):
        return _error(403, "SESSION_INVALID", "本地页面会话无效")
    return None


def create_ai_runtime_router(service: RuntimeService) -> APIRouter:
    router = APIRouter(prefix="/api/ai-runtime")

    @router.get("/health")
    async def health() -> Dict[str, object]:
        return {"ok": True, "data": {"status": "ok", "storage": "memory", "textOnly": True}}

    @router.get("/session")
    async def session() -> Dict[str, object]:
        return {"ok": True, "data": {"token": service.session_token, "storage": "memory"}}

    @router.get("/providers")
    async def providers() -> Dict[str, object]:
        return {"ok": True, "data": service.store.list_providers()}

    @router.get("/report-settings")
    async def report_settings() -> Dict[str, object]:
        return {"ok": True, "data": service.store.get_report_settings()}

    @router.get("/conversations")
    async def conversations() -> Dict[str, object]:
        return {"ok": True, "data": service.conversations.list_conversations_public()}

    @router.get("/conversations/{conversation_id}")
    async def conversation(conversation_id: str) -> JSONResponse:
        try:
            return JSONResponse({"ok": True, "data": service.conversations.get_conversation_public(conversation_id)})
        except Exception as error:
            return _exception(error)

    async def write(request: Request) -> Optional[JSONResponse]:
        return _write_allowed(request, service)

    @router.post("/providers", status_code=201)
    async def create_provider(request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse(status_code=201, content={"ok": True, "data": service.store.create_provider(payload)})
        except Exception as error:
            return _exception(error)

    @router.put("/providers/{provider_id}")
    async def update_provider(provider_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse({"ok": True, "data": service.store.update_provider(provider_id, payload)})
        except Exception as error:
            return _exception(error)

    @router.post("/providers/{provider_id}/verify")
    async def verify(provider_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            provider, api_key = service.store.get_credentials(provider_id)
            verify_provider(provider, api_key)
            verified_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            return JSONResponse({"ok": True, "data": service.store.mark_verified(provider_id, verified_at)})
        except Exception as error:
            return _exception(error)

    @router.post("/providers/{provider_id}/default")
    async def set_default(provider_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse({"ok": True, "data": service.store.set_default(provider_id)})
        except Exception as error:
            return _exception(error)

    @router.delete("/providers/{provider_id}/key")
    async def clear_key(provider_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse({"ok": True, "data": service.store.clear_key(provider_id)})
        except Exception as error:
            return _exception(error)

    @router.put("/report-settings")
    async def update_report_settings(request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse({"ok": True, "data": service.store.update_report_settings(payload)})
        except Exception as error:
            return _exception(error)

    @router.post("/conversations", status_code=201)
    async def create_conversation(request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse(status_code=201, content={"ok": True, "data": service.conversations.create_conversation()})
        except Exception as error:
            return _exception(error)

    @router.post("/conversations/{conversation_id}/messages", status_code=202)
    async def send_message(conversation_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            request_id, message, language, context = payload.get("requestId"), payload.get("message"), payload.get("language"), payload.get("context")
            if not isinstance(request_id, str) or not isinstance(message, str) or not isinstance(language, str):
                raise ValidationError("INVALID_CONFIGURATION", "请求参数无效")
            run = service.orchestrator.start(conversation_id, request_id, message, language, context)
            return JSONResponse(status_code=202, content={"ok": True, "data": run})
        except Exception as error:
            return _exception(error)

    @router.post("/conversations/{conversation_id}/action-drafts", status_code=201)
    async def create_action_draft(conversation_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse(status_code=201, content={"ok": True, "data": service.conversations.create_action_draft(conversation_id, payload)})
        except Exception as error:
            return _exception(error)

    @router.put("/action-drafts/{draft_id}")
    async def update_action_draft(draft_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
        if denied := await write(request):
            return denied
        try:
            return JSONResponse({"ok": True, "data": service.conversations.update_action_draft(draft_id, payload.get("status"))})
        except Exception as error:
            return _exception(error)

    return router
