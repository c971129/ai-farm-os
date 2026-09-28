from __future__ import annotations

import pytest

from backend.ai_runtime.conversations import ConversationStore
from backend.ai_runtime.state import ValidationError


def provider() -> dict[str, str]:
    return {"id": "provider-1", "name": "本地测试"}


def test_duplicate_request_id_returns_same_run_without_duplicate_message() -> None:
    store = ConversationStore(now=lambda: "2026-09-19T00:00:00Z")
    conversation = store.create_conversation()

    first, created = store.create_run(str(conversation["id"]), "request-1", "棉花长势如何", "zh", provider(), "farm-test")
    second, replay = store.create_run(str(conversation["id"]), "request-1", "棉花长势如何", "zh", provider(), "farm-test")

    assert created is True
    assert replay is False
    assert first["id"] == second["id"]
    assert len(store.get_conversation_public(str(conversation["id"]))["messages"]) == 1


def test_question_limit_and_parallel_run_fail_closed() -> None:
    store = ConversationStore()
    conversation = store.create_conversation()

    with pytest.raises(ValidationError) as too_long:
        store.create_run(str(conversation["id"]), "request-long", "x" * 4001, "zh", provider(), "farm-test")
    assert too_long.value.code == "INVALID_CONFIGURATION"

    store.create_run(str(conversation["id"]), "request-active", "土壤盐分如何", "zh", provider(), "farm-test")
    another = store.create_conversation()
    with pytest.raises(ValidationError) as active:
        store.create_run(str(another["id"]), "request-other", "是否灌溉", "zh", provider(), "farm-test")
    assert active.value.code == "RUN_CAPACITY_REACHED"


def test_public_snapshot_hides_private_question_and_error_detail() -> None:
    store = ConversationStore()
    conversation = store.create_conversation()
    run, _ = store.create_run(str(conversation["id"]), "request-private", "绝不能泄露的提问", "zh", provider(), "farm-test")
    store.fail_run(str(run["id"]), "UPSTREAM_UNAVAILABLE", "private upstream stack and key")

    public = store.get_conversation_public(str(conversation["id"]))

    assert "绝不能泄露的提问" in str(public["messages"])
    assert "private upstream stack" not in repr(public)
    assert "_question" not in repr(public)


def test_conversation_exposes_safe_context_and_runtime_action_draft() -> None:
    store = ConversationStore(now=lambda: "2026-09-20T01:00:00Z")
    conversation = store.create_conversation()

    run, _ = store.create_run(
        str(conversation["id"]),
        "request-context",
        "需要巡田吗",
        "zh",
        provider(),
        "farm-test",
        {
            "plotId": "B-01",
            "plotName": "中区棉花田",
            "crop": "棉花",
            "variety": "新陆早61",
            "growthStage": "吐絮盛期",
            "questionType": "vigor",
        },
    )
    draft = store.create_action_draft(
        str(conversation["id"]),
        {"title": "核验 B-01 样方", "sourceRunId": run["id"], "evidence": "补充带时间位置的样方"},
    )

    assert store.update_action_draft(str(draft["id"]), "confirmed")["status"] == "confirmed"
    public = store.get_conversation_public(str(conversation["id"]))
    assert public["latestRun"]["context"]["plotId"] == "B-01"
    assert public["actionDrafts"][0]["status"] == "confirmed"
