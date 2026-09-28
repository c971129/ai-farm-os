from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from .conversations import ConversationStore
from .providers import ProviderError, stream_text
from .state import MemoryStore, ValidationError


class OrchestrationError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


SYSTEM_PROMPT = """你是作物全生命周期 AI 管家。仅提供文本协作建议和证据边界；不得调用工具、不得控制设备、不得创建工单、不得触发审批。严格按顺序输出 [[PLAN]][[EXPERTS]][[REVIEW]][[FINAL]]，前三个标记之间不写正文。最终标记后必须依次输出五个简洁区块：判断、依据、风险与限制、建议行动、待补证据。上下文仅是待核验线索，缺少关键证据时明确写 NO_GO；不得给出未经核验的水量、药量、施肥量或设备执行指令，并提示人工复核。"""


def select_display_agents(question: str) -> list[str]:
    value = question.casefold()
    rules = (("pest-alert", ("病虫", "病害", "虫害", "防治")), ("vri-optimize", ("灌溉", "水肥", "施肥", "肥料")), ("soil-health", ("土壤", "盐碱", "盐分")), ("yield-predict", ("产量", "亩产", "单产")), ("crop-vigor", ("长势", "生育期", "胁迫", "黄化", "萎蔫")))
    selected = [key for key, words in rules if any(word in value for word in words)]
    return selected[:3] or ["crop-vigor"]


class StreamMarkerParser:
    MARKERS = ("[[PLAN]]", "[[EXPERTS]]", "[[REVIEW]]", "[[FINAL]]")
    STAGES = ("planning", "experts", "reviewing", "summarizing")

    def __init__(self, on_stage: Callable[[str], None], on_final_delta: Callable[[str], None]) -> None:
        self._on_stage, self._on_final_delta = on_stage, on_final_delta
        self._buffer, self._index, self._final = "", 0, []

    def feed(self, delta: str) -> None:
        self._buffer += delta
        while self._index < len(self.MARKERS):
            marker = self.MARKERS[self._index]
            position = self._buffer.find(marker)
            if position < 0:
                if len(self._buffer) > len(marker) * 2:
                    raise OrchestrationError("STREAM_FORMAT_INVALID", "模型流式响应缺少阶段标记")
                return
            if position and self._index == 0 and self._buffer[:position].strip():
                raise OrchestrationError("STREAM_FORMAT_INVALID", "模型流式响应包含标记前内容")
            self._buffer = self._buffer[position + len(marker):]
            self._on_stage(self.STAGES[self._index])
            self._index += 1
        if self._buffer:
            text = self._buffer
            self._buffer = ""
            self._final.append(text)
            self._on_final_delta(text)

    def finish(self) -> str:
        if self._index != len(self.MARKERS):
            raise OrchestrationError("STREAM_FORMAT_INVALID", "模型流式响应未完成全部阶段")
        answer = "".join(self._final).strip()
        if not answer:
            raise OrchestrationError("STREAM_FORMAT_INVALID", "模型流式响应缺少最终答复")
        return answer


class SingleStreamOrchestrator:
    def __init__(self, store: MemoryStore, conversations: ConversationStore, *, stream: Callable[..., object] = stream_text) -> None:
        self._store, self._conversations, self._stream = store, conversations, stream
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-runtime")

    def start(self, conversation_id: str, request_id: str, message: str, language: str, context: object = None) -> dict[str, object]:
        provider, key, model = self._store.get_dialogue_credentials()
        public_provider = {"id": str(provider["id"]), "name": str(provider["name"])}
        run, created = self._conversations.create_run(conversation_id, request_id, message, language, public_provider, model, context)
        if created:
            self._conversations.set_agents(str(run["id"]), select_display_agents(message))
            self._executor.submit(self._work, str(run["id"]), provider, key, model)
        return run

    def _work(self, run_id: str, provider: dict[str, object], key: str, model: str) -> None:
        try:
            _, _, question, context = self._conversations.runtime_inputs(run_id)
            self._conversations.increment_call(run_id)
            parser = StreamMarkerParser(lambda stage: self._conversations.mark_stage(run_id, stage), lambda delta: self._conversations.append_delta(run_id, delta))
            context_lines = "\n".join(f"{key}: {value}" for key, value in context.items())
            content = f"田间上下文（仅作待核验线索，不得当作实测或生产处方依据）：\n{context_lines}\n\n问题：{question}" if context_lines else question
            values = self._stream(provider, key, model, SYSTEM_PROMPT, [{"role": "user", "content": content}], timeout=45.0)
            for value in values:
                parser.feed(str(value))
            self._conversations.complete_run(run_id, parser.finish())
        except (ProviderError, ValidationError, OrchestrationError) as error:
            self._conversations.fail_run(run_id, getattr(error, "code", "ORCHESTRATION_FAILED"), str(error))
        except Exception:
            self._conversations.fail_run(run_id, "ORCHESTRATION_FAILED")

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
