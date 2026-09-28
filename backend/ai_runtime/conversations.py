from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from typing import Callable
from uuid import uuid4

from .state import ValidationError


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ConversationStore:
    MAX_CONVERSATIONS = 20
    MAX_MESSAGES = 100
    MAX_QUESTION_CHARS = 4_000
    MAX_HISTORY_MESSAGES = 12
    MAX_HISTORY_CHARS = 24_000
    MAX_STREAM_ANSWER_CHARS = 64_000
    ACTIVE = frozenset({"queued", "planning", "experts", "reviewing", "summarizing"})
    STAGES = ("planning", "experts", "reviewing", "summarizing")
    CONTEXT_LIMITS = {
        "plotId": 100,
        "plotName": 160,
        "crop": 100,
        "variety": 100,
        "growthStage": 100,
        "questionType": 48,
    }
    DRAFT_STATUSES = frozenset({"pending", "confirmed", "revoked"})

    def __init__(self, *, now: Callable[[], str] | None = None) -> None:
        self._lock = RLock()
        self._now = now or utc_now
        self._conversations: dict[str, dict[str, object]] = {}
        self._runs: dict[str, dict[str, object]] = {}
        self._action_drafts: dict[str, dict[str, object]] = {}
        self._active_run_id = ""

    def _conversation(self, conversation_id: str) -> dict[str, object]:
        value = self._conversations.get(conversation_id)
        if value is None:
            raise ValidationError("CONVERSATION_NOT_FOUND", "会话不存在")
        return value

    def _run(self, run_id: str) -> dict[str, object]:
        value = self._runs.get(run_id)
        if value is None:
            raise ValidationError("RUN_NOT_FOUND", "会话运行不存在")
        return value

    @staticmethod
    def _public_run(run: dict[str, object]) -> dict[str, object]:
        return {
            "id": run["id"], "conversationId": run["conversationId"], "requestId": run["requestId"],
            "language": run["language"], "providerId": run["provider"]["id"], "providerName": run["provider"]["name"],
            "model": run["model"], "status": run["status"], "stage": run["stage"], "failedStage": run["failedStage"],
            "lastActiveStage": run["lastActiveStage"], "completedStages": list(run["completedStages"]),
            "selectedAgents": list(run["selectedAgents"]), "agentAssignments": deepcopy(run["agentAssignments"]),
            "agentResults": deepcopy(run["agentResults"]), "callCount": run["calls"], "answer": run["answer"],
            "errorCode": run["errorCode"], "context": deepcopy(run["context"]), "createdAt": run["createdAt"], "updatedAt": run["updatedAt"],
        }

    @staticmethod
    def _public_draft(draft: dict[str, object]) -> dict[str, object]:
        return {
            "id": draft["id"], "conversationId": draft["conversationId"], "sourceRunId": draft["sourceRunId"],
            "title": draft["title"], "evidence": draft["evidence"], "status": draft["status"],
            "createdAt": draft["createdAt"], "updatedAt": draft["updatedAt"],
        }

    @classmethod
    def _validate_context(cls, context: object) -> dict[str, str]:
        if context is None:
            return {}
        if not isinstance(context, dict):
            raise ValidationError("INVALID_CONFIGURATION", "田间上下文必须是对象")
        unknown = set(context) - set(cls.CONTEXT_LIMITS)
        if unknown:
            raise ValidationError("INVALID_CONFIGURATION", "田间上下文包含不支持字段")
        cleaned: dict[str, str] = {}
        for key, limit in cls.CONTEXT_LIMITS.items():
            value = context.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or len(value.strip()) > limit:
                raise ValidationError("INVALID_CONFIGURATION", "田间上下文字段无效")
            if value.strip():
                cleaned[key] = value.strip()
        return cleaned

    def _public_conversation(self, conversation: dict[str, object], *, messages: bool) -> dict[str, object]:
        active = str(conversation["activeRunId"])
        latest = str(conversation["lastRunId"])
        output: dict[str, object] = {
            "id": conversation["id"], "title": conversation["title"], "createdAt": conversation["createdAt"],
            "updatedAt": conversation["updatedAt"], "activeRun": self._public_run(self._runs[active]) if active else None,
            "latestRun": self._public_run(self._runs[latest]) if latest else None,
            "actionDrafts": [self._public_draft(self._action_drafts[str(draft_id)]) for draft_id in conversation["actionDraftIds"] if str(draft_id) in self._action_drafts],
        }
        if messages:
            output["messages"] = deepcopy(conversation["messages"])
        return output

    def _touch(self, conversation: dict[str, object]) -> None:
        conversation["updatedAt"] = self._now()

    def create_conversation(self) -> dict[str, object]:
        with self._lock:
            if len(self._conversations) >= self.MAX_CONVERSATIONS:
                inactive = [item for item in self._conversations.values() if not item["activeRunId"]]
                if not inactive:
                    raise ValidationError("CONVERSATION_LIMIT_REACHED", "本地会话容量已满")
                oldest = min(inactive, key=lambda item: str(item["updatedAt"]))
                for run_id in oldest["runIds"]:
                    self._runs.pop(str(run_id), None)
                for draft_id in oldest["actionDraftIds"]:
                    self._action_drafts.pop(str(draft_id), None)
                self._conversations.pop(str(oldest["id"]), None)
            now = self._now()
            conversation: dict[str, object] = {"id": str(uuid4()), "title": "新会话", "createdAt": now, "updatedAt": now, "activeRunId": "", "lastRunId": "", "messages": [], "runIds": [], "actionDraftIds": [], "requests": {}}
            self._conversations[str(conversation["id"])] = conversation
            return self._public_conversation(conversation, messages=True)

    def list_conversations_public(self) -> list[dict[str, object]]:
        with self._lock:
            values = sorted(self._conversations.values(), key=lambda item: str(item["updatedAt"]), reverse=True)
            return [self._public_conversation(item, messages=False) for item in values]

    def get_conversation_public(self, conversation_id: str) -> dict[str, object]:
        with self._lock:
            return self._public_conversation(self._conversation(conversation_id), messages=True)

    def create_run(self, conversation_id: str, request_id: str, question: str, language: str, provider: dict[str, str], model: str, context: object = None) -> tuple[dict[str, object], bool]:
        if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 100:
            raise ValidationError("INVALID_CONFIGURATION", "请求标识无效")
        if not isinstance(question, str) or not 1 <= len(question.strip()) <= self.MAX_QUESTION_CHARS:
            raise ValidationError("INVALID_CONFIGURATION", "问题长度必须为 1 至 4000 个字符")
        if language not in {"zh", "en", "ru", "kk"}:
            raise ValidationError("INVALID_CONFIGURATION", "对话语言无效")
        if not provider.get("id") or not provider.get("name") or not model:
            raise ValidationError("INVALID_CONFIGURATION", "供应商或模型无效")
        safe_context = self._validate_context(context)
        with self._lock:
            conversation = self._conversation(conversation_id)
            existing = conversation["requests"].get(request_id)
            if existing:
                return self._public_run(self._run(str(existing))), False
            if self._active_run_id:
                raise ValidationError("RUN_CAPACITY_REACHED", "已有模型请求正在运行")
            now = self._now()
            run_id = str(uuid4())
            run: dict[str, object] = {"id": run_id, "conversationId": conversation_id, "requestId": request_id, "language": language, "provider": deepcopy(provider), "model": model, "status": "queued", "stage": "planning", "failedStage": "", "lastActiveStage": "", "completedStages": [], "selectedAgents": [], "agentAssignments": [], "agentResults": [], "calls": 0, "answer": "", "errorCode": "", "context": safe_context, "createdAt": now, "updatedAt": now, "_question": question.strip()}
            conversation["requests"][request_id] = run_id
            conversation["runIds"].append(run_id)
            conversation["activeRunId"] = run_id
            conversation["lastRunId"] = run_id
            conversation["title"] = question.strip()[:80]
            conversation["messages"].append({"id": str(uuid4()), "role": "user", "text": question.strip(), "createdAt": now, "runId": run_id, "status": "completed"})
            del conversation["messages"][:-self.MAX_MESSAGES]
            self._runs[run_id] = run
            self._active_run_id = run_id
            self._touch(conversation)
            return self._public_run(run), True

    def create_action_draft(self, conversation_id: str, payload: object) -> dict[str, object]:
        if not isinstance(payload, dict):
            raise ValidationError("INVALID_CONFIGURATION", "建议草稿必须是对象")
        title = payload.get("title")
        source_run_id = payload.get("sourceRunId")
        evidence = payload.get("evidence", "")
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 160:
            raise ValidationError("INVALID_CONFIGURATION", "建议草稿标题无效")
        if not isinstance(source_run_id, str) or not source_run_id:
            raise ValidationError("INVALID_CONFIGURATION", "建议草稿来源无效")
        if not isinstance(evidence, str) or len(evidence.strip()) > 1_000:
            raise ValidationError("INVALID_CONFIGURATION", "建议草稿证据无效")
        with self._lock:
            conversation = self._conversation(conversation_id)
            run = self._run(source_run_id)
            if str(run["conversationId"]) != conversation_id:
                raise ValidationError("RUN_NOT_FOUND", "建议草稿来源不属于当前会话")
            now = self._now()
            draft: dict[str, object] = {"id": str(uuid4()), "conversationId": conversation_id, "sourceRunId": source_run_id, "title": title.strip(), "evidence": evidence.strip(), "status": "pending", "createdAt": now, "updatedAt": now}
            self._action_drafts[str(draft["id"])] = draft
            conversation["actionDraftIds"].append(str(draft["id"]))
            self._touch(conversation)
            return self._public_draft(draft)

    def update_action_draft(self, draft_id: str, status: object) -> dict[str, object]:
        if not isinstance(status, str) or status not in self.DRAFT_STATUSES - {"pending"}:
            raise ValidationError("INVALID_CONFIGURATION", "建议草稿状态无效")
        with self._lock:
            draft = self._action_drafts.get(draft_id)
            if draft is None:
                raise ValidationError("RUN_NOT_FOUND", "建议草稿不存在")
            if draft["status"] != "pending":
                raise ValidationError("INVALID_CONFIGURATION", "建议草稿已处理")
            draft["status"] = status
            draft["updatedAt"] = self._now()
            self._touch(self._conversation(str(draft["conversationId"])))
            return self._public_draft(draft)

    def runtime_inputs(self, run_id: str) -> tuple[dict[str, str], str, str, dict[str, str]]:
        with self._lock:
            run = self._run(run_id)
            conversation = self._conversation(str(run["conversationId"]))
            history = [item for item in conversation["messages"] if item["role"] in {"user", "assistant"}][-self.MAX_HISTORY_MESSAGES:]
            text = 0
            items: list[dict[str, str]] = []
            for item in reversed(history):
                content = str(item["text"])
                if text + len(content) > self.MAX_HISTORY_CHARS:
                    break
                items.insert(0, {"role": str(item["role"]), "content": content})
                text += len(content)
            return deepcopy(run["provider"]), str(run["model"]), str(run["_question"]), deepcopy(run["context"])

    def set_agents(self, run_id: str, agent_keys: list[str]) -> None:
        with self._lock:
            run = self._run(run_id)
            run["selectedAgents"] = list(agent_keys)
            run["agentAssignments"] = [{"key": key, "status": "queued"} for key in agent_keys]

    def increment_call(self, run_id: str) -> None:
        with self._lock:
            self._run(run_id)["calls"] = int(self._run(run_id)["calls"]) + 1

    def mark_stage(self, run_id: str, stage: str) -> None:
        if stage not in self.STAGES:
            raise ValidationError("INVALID_CONFIGURATION", "会话阶段无效")
        with self._lock:
            run = self._run(run_id)
            if run["status"] not in self.ACTIVE:
                return
            run["status"], run["stage"], run["lastActiveStage"], run["updatedAt"] = stage, stage, stage, self._now()
            if stage not in run["completedStages"]:
                run["completedStages"].append(stage)

    def append_delta(self, run_id: str, delta: str) -> None:
        with self._lock:
            run = self._run(run_id)
            if len(str(run["answer"])) + len(delta) > self.MAX_STREAM_ANSWER_CHARS:
                raise ValidationError("INVALID_CONFIGURATION", "模型回答超过安全限制")
            run["answer"] = str(run["answer"]) + delta
            run["updatedAt"] = self._now()

    def complete_run(self, run_id: str, answer: str) -> None:
        with self._lock:
            run = self._run(run_id)
            conversation = self._conversation(str(run["conversationId"]))
            run["answer"] = answer
            run["status"], run["stage"], run["updatedAt"] = "completed", "completed", self._now()
            conversation["messages"].append({"id": str(uuid4()), "role": "assistant", "text": answer, "createdAt": self._now(), "runId": run_id, "status": "completed"})
            del conversation["messages"][:-self.MAX_MESSAGES]
            conversation["activeRunId"] = ""
            self._active_run_id = ""
            self._touch(conversation)

    def fail_run(self, run_id: str, code: str, message: str = "") -> None:
        with self._lock:
            run = self._run(run_id)
            conversation = self._conversation(str(run["conversationId"]))
            run["status"], run["failedStage"], run["errorCode"], run["updatedAt"] = "failed", str(run["stage"]), code, self._now()
            conversation["activeRunId"] = ""
            self._active_run_id = ""
            self._touch(conversation)
