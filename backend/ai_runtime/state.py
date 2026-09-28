from __future__ import annotations

from copy import deepcopy
from threading import RLock
from uuid import uuid4


class ValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _text(payload: dict[str, object], key: str, *, required: bool, limit: int) -> str:
    value = payload.get(key, "")
    if not isinstance(value, str):
        raise ValidationError("INVALID_CONFIGURATION", f"{key} 格式无效")
    value = value.strip()
    if required and not value:
        raise ValidationError("INVALID_CONFIGURATION", f"{key} 不能为空")
    if len(value) > limit:
        raise ValidationError("INVALID_CONFIGURATION", f"{key} 长度超过限制")
    return value


def validate_provider_payload(payload: dict[str, object]) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ValidationError("INVALID_CONFIGURATION", "配置必须是 JSON 对象")
    api_format = _text(payload, "apiFormat", required=True, limit=32)
    if api_format not in {"openai", "anthropic"}:
        raise ValidationError("INVALID_CONFIGURATION", "不支持的 API 格式")
    default_model = _text(payload, "defaultModel", required=True, limit=200)
    raw_mappings = payload.get("mappings", {})
    if not isinstance(raw_mappings, dict):
        raise ValidationError("INVALID_CONFIGURATION", "模型映射必须是对象")
    mappings: dict[str, str] = {}
    for name in ("dialogue", "knowledge", "report", "vision"):
        value = raw_mappings.get(name, default_model)
        if not isinstance(value, str):
            raise ValidationError("INVALID_CONFIGURATION", f"{name} 模型格式无效")
        value = value.strip() or default_model
        if len(value) > 200:
            raise ValidationError("INVALID_CONFIGURATION", f"{name} 模型长度超过限制")
        mappings[name] = value
    api_key = payload.get("apiKey", "")
    if api_key is None:
        api_key = ""
    if not isinstance(api_key, str) or len(api_key.strip()) > 4096:
        raise ValidationError("INVALID_CONFIGURATION", "API Key 格式无效")
    return {
        "name": _text(payload, "name", required=True, limit=100),
        "note": _text(payload, "note", required=False, limit=300),
        "baseUrl": _text(payload, "baseUrl", required=True, limit=2048),
        "apiFormat": api_format,
        "defaultModel": default_model,
        "apiKey": api_key.strip(),
        "mappings": mappings,
    }


def sanitize_provider(provider: dict[str, object]) -> dict[str, object]:
    data = deepcopy({key: value for key, value in provider.items() if not key.startswith("_")})
    data.pop("apiKey", None)
    data["keyConfigured"] = bool(provider.get("_api_key"))
    return data


class MemoryStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._providers: dict[str, dict[str, object]] = {}
        self._report_settings: dict[str, object] = {
            "defaultModel": "",
            "language": "中文",
            "citations": True,
            "manualReview": True,
        }

    def _require(self, provider_id: str) -> dict[str, object]:
        provider = self._providers.get(provider_id)
        if provider is None:
            raise ValidationError("PROVIDER_NOT_FOUND", "模型供应商不存在")
        return provider

    def create_provider(self, payload: dict[str, object]) -> dict[str, object]:
        values = validate_provider_payload(payload)
        with self._lock:
            if len(self._providers) >= 20:
                raise ValidationError("PROVIDER_LIMIT_REACHED", "本地最多配置 20 个模型供应商")
            provider_id = str(uuid4())
            provider: dict[str, object] = {
                "id": provider_id,
                "name": values["name"],
                "note": values["note"],
                "baseUrl": values["baseUrl"],
                "apiFormat": values["apiFormat"],
                "defaultModel": values["defaultModel"],
                "mappings": values["mappings"],
                "verified": False,
                "verifiedAt": "",
                "isDefault": False,
                "_api_key": values["apiKey"],
            }
            self._providers[provider_id] = provider
            return sanitize_provider(provider)

    def update_provider(self, provider_id: str, payload: dict[str, object]) -> dict[str, object]:
        values = validate_provider_payload(payload)
        with self._lock:
            provider = self._require(provider_id)
            mutable = ("name", "note", "baseUrl", "apiFormat", "defaultModel", "mappings")
            changed = any(provider[key] != values[key] for key in mutable)
            for key in mutable:
                provider[key] = values[key]
            if values["apiKey"]:
                changed = changed or provider.get("_api_key") != values["apiKey"]
                provider["_api_key"] = values["apiKey"]
            if changed:
                provider["verified"] = False
                provider["verifiedAt"] = ""
                provider["isDefault"] = False
            return sanitize_provider(provider)

    def list_providers(self) -> list[dict[str, object]]:
        with self._lock:
            return [sanitize_provider(item) for item in self._providers.values()]

    def get_credentials(self, provider_id: str) -> tuple[dict[str, object], str]:
        with self._lock:
            provider = self._require(provider_id)
            api_key = str(provider.get("_api_key", ""))
            if not api_key:
                raise ValidationError("KEY_NOT_CONFIGURED", "尚未配置 API Key")
            return sanitize_provider(provider), api_key

    def get_dialogue_credentials(self) -> tuple[dict[str, object], str, str]:
        with self._lock:
            verified = [item for item in self._providers.values() if item.get("verified") and item.get("_api_key")]
            defaults = [item for item in verified if item.get("isDefault")]
            if defaults:
                provider = defaults[0]
            elif len(verified) == 1:
                provider = verified[0]
            elif len(verified) > 1:
                raise ValidationError("DEFAULT_PROVIDER_REQUIRED", "存在多个已验证供应商，请先设置默认供应商")
            else:
                raise ValidationError("VERIFIED_PROVIDER_REQUIRED", "请先配置并验证模型供应商")
            mappings = provider.get("mappings", {})
            model = str(mappings.get("dialogue", "") if isinstance(mappings, dict) else "").strip()
            model = model or str(provider.get("defaultModel", "")).strip()
            if not model:
                raise ValidationError("INVALID_CONFIGURATION", "对话模型未配置")
            return sanitize_provider(provider), str(provider["_api_key"]), model

    def mark_verified(self, provider_id: str, verified_at: str) -> dict[str, object]:
        with self._lock:
            provider = self._require(provider_id)
            if not provider.get("_api_key"):
                raise ValidationError("KEY_NOT_CONFIGURED", "尚未配置 API Key")
            provider["verified"] = True
            provider["verifiedAt"] = verified_at
            return sanitize_provider(provider)

    def set_default(self, provider_id: str) -> dict[str, object]:
        with self._lock:
            provider = self._require(provider_id)
            if not provider.get("verified"):
                raise ValidationError("PROVIDER_NOT_VERIFIED", "请先验证连接")
            for item in self._providers.values():
                item["isDefault"] = False
            provider["isDefault"] = True
            return sanitize_provider(provider)

    def clear_key(self, provider_id: str) -> dict[str, object]:
        with self._lock:
            provider = self._require(provider_id)
            provider["_api_key"] = ""
            provider["verified"] = False
            provider["verifiedAt"] = ""
            provider["isDefault"] = False
            return sanitize_provider(provider)

    def get_report_settings(self) -> dict[str, object]:
        with self._lock:
            return deepcopy(self._report_settings)

    def update_report_settings(self, payload: dict[str, object]) -> dict[str, object]:
        if not isinstance(payload, dict):
            raise ValidationError("INVALID_CONFIGURATION", "报告配置必须是对象")
        model, language = payload.get("defaultModel"), payload.get("language")
        citations, manual_review = payload.get("citations"), payload.get("manualReview")
        if not isinstance(model, str) or not model.strip() or len(model.strip()) > 200:
            raise ValidationError("INVALID_CONFIGURATION", "默认报告模型无效")
        if language not in {"中文", "英文", "俄文", "哈萨克文"}:
            raise ValidationError("INVALID_CONFIGURATION", "报告语言无效")
        if not isinstance(citations, bool) or not isinstance(manual_review, bool):
            raise ValidationError("INVALID_CONFIGURATION", "报告开关必须是布尔值")
        with self._lock:
            self._report_settings = {"defaultModel": model.strip(), "language": language, "citations": citations, "manualReview": manual_review}
            return deepcopy(self._report_settings)
