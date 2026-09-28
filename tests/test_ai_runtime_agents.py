from __future__ import annotations

import time

from backend.ai_runtime.agents import SYSTEM_PROMPT, SingleStreamOrchestrator, StreamMarkerParser
from backend.ai_runtime.conversations import ConversationStore
from backend.ai_runtime.state import MemoryStore


def _store() -> MemoryStore:
    store = MemoryStore()
    provider = store.create_provider(
        {
            "name": "本地测试", "note": "", "baseUrl": "http://127.0.0.1:9999/v1", "apiFormat": "openai",
            "defaultModel": "farm-test", "apiKey": "test-key", "mappings": {},
        }
    )
    store.mark_verified(str(provider["id"]), "2026-09-19T00:00:00Z")
    return store


def test_marker_parser_emits_only_final_text_after_ordered_markers() -> None:
    stages: list[str] = []
    answer: list[str] = []
    parser = StreamMarkerParser(stages.append, answer.append)

    parser.feed("[[PLAN]][[EXPERTS]][[REVIEW]][[FINAL]]最终建议")

    assert parser.finish() == "最终建议"
    assert stages == ["planning", "experts", "reviewing", "summarizing"]
    assert "".join(answer) == "最终建议"


def test_system_prompt_requires_traceable_agronomy_answer_sections() -> None:
    for heading in ("判断", "依据", "风险与限制", "建议行动", "待补证据"):
        assert heading in SYSTEM_PROMPT


def test_single_stream_call_completes_all_stages_once() -> None:
    calls: list[object] = []

    def fake_stream(*_args: object, **_kwargs: object):
        calls.append(object())
        yield "[[PLAN]][[EXPERTS]][[REVIEW]][[FINAL]]仅提供文本建议，等待人工复核。"

    conversations = ConversationStore()
    conversation = conversations.create_conversation()
    orchestrator = SingleStreamOrchestrator(_store(), conversations, stream=fake_stream)
    accepted = orchestrator.start(
        str(conversation["id"]),
        "request-1",
        "棉花灌溉要注意什么",
        "zh",
        {"plotId": "B-01", "plotName": "中区棉花田", "questionType": "irrigation"},
    )
    try:
        for _ in range(100):
            latest = conversations.get_conversation_public(str(conversation["id"]))["latestRun"]
            if latest and latest["status"] in {"completed", "failed"}:
                break
            time.sleep(0.01)
        latest = conversations.get_conversation_public(str(conversation["id"]))["latestRun"]
        assert accepted["status"] in {"queued", "planning"}
        assert latest["status"] == "completed"
        assert latest["callCount"] == 1
        assert latest["completedStages"] == ["planning", "experts", "reviewing", "summarizing"]
        assert latest["answer"] == "仅提供文本建议，等待人工复核。"
        assert latest["context"]["plotId"] == "B-01"
        assert len(calls) == 1
    finally:
        orchestrator.close()
