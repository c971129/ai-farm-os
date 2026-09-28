from __future__ import annotations

import pytest

from backend.ai_runtime.state import MemoryStore, ValidationError


def provider_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "本地测试供应商",
        "note": "仅用于自动化测试",
        "baseUrl": "http://127.0.0.1:9999/v1",
        "apiFormat": "openai",
        "defaultModel": "farm-test-model",
        "apiKey": "secret-test-key",
        "mappings": {
            "dialogue": "farm-test-model",
            "knowledge": "farm-test-model",
            "report": "farm-test-model",
            "vision": "farm-test-model",
        },
    }
    payload.update(overrides)
    return payload


def test_provider_public_data_never_exposes_api_key() -> None:
    store = MemoryStore()

    created = store.create_provider(provider_payload())

    assert created["keyConfigured"] is True
    assert "apiKey" not in created
    assert "secret-test-key" not in repr(created)
    assert "secret-test-key" not in repr(store.list_providers())


def test_change_or_clear_key_resets_verification_and_default() -> None:
    store = MemoryStore()
    created = store.create_provider(provider_payload())
    store.mark_verified(str(created["id"]), "2026-09-19T00:00:00Z")
    store.set_default(str(created["id"]))

    updated = store.update_provider(str(created["id"]), provider_payload(apiKey="new-secret-key"))
    cleared = store.clear_key(str(created["id"]))

    assert (updated["verified"], updated["isDefault"]) == (False, False)
    assert cleared["keyConfigured"] is False
    assert (cleared["verified"], cleared["isDefault"]) == (False, False)


def test_multiple_verified_providers_require_explicit_default() -> None:
    store = MemoryStore()
    first = store.create_provider(provider_payload(name="供应商一"))
    second = store.create_provider(provider_payload(name="供应商二", apiKey="another-secret"))
    store.mark_verified(str(first["id"]), "2026-09-19T00:00:00Z")
    store.mark_verified(str(second["id"]), "2026-09-19T00:00:00Z")

    with pytest.raises(ValidationError) as raised:
        store.get_dialogue_credentials()

    assert raised.value.code == "DEFAULT_PROVIDER_REQUIRED"


def test_report_preferences_reject_unsupported_language() -> None:
    with pytest.raises(ValidationError) as raised:
        MemoryStore().update_report_settings(
            {"defaultModel": "farm-test-model", "language": "日文", "citations": True, "manualReview": True}
        )

    assert raised.value.code == "INVALID_CONFIGURATION"
