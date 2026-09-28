# AI 智能管家三期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个带田块上下文、证据说明、运行期农事建议草稿、真实协作状态和移动端布局的 AI 智能管家。

**Architecture:** 后端继续使用 `backend.ai_runtime` 的进程内存存储。会话写入新增经过白名单校验的田块上下文；运行公开快照携带安全证据摘要；建议草稿只保存至会话内存，绝不调用核心业务写入 API。前端在既有农场主题中重构 AI Runtime 工作台，以可读的田块、证据、行动和协作状态替代空白聊天壳。

**Tech Stack:** Python 3.8+、FastAPI、pytest、原生 JavaScript、原生 CSS、Node.js `node:test`。

## Global Constraints

- AI 仅生成建议和待确认草稿，不下发真实或仿真设备控制命令。
- 未绑定、过期、缺失或质量异常的厂家数据不可作为田间结论。
- API Key 仅保留于当前服务进程，不能进入公开响应、草稿、日志、数据库或浏览器状态。
- 保持核心业务 API 写锁、真实设备读取方式和数据库架构不变。
- 所有 AI Runtime 写请求继续要求同源 JSON 与 `X-FarmOS-Session`。
- 当前目录不是 Git 仓库；不执行提交。

---

### Task 1: 安全田块上下文与建议草稿存储

**Files:**
- Modify: `backend/ai_runtime/conversations.py`
- Test: `tests/test_ai_runtime_conversations.py`

**Interfaces:**
- Consumes: `ConversationStore.create_run(conversation_id, request_id, question, language, provider, model, context=None)`。
- Produces: `ConversationStore.create_action_draft(conversation_id, payload)`、`ConversationStore.update_action_draft(draft_id, status)` 和公开会话中的 `context`、`actionDrafts`。

- [ ] **Step 1: Write the failing test**

```python
def test_conversation_exposes_safe_context_and_runtime_action_draft() -> None:
    store = ConversationStore(now=lambda: "2026-09-20T01:00:00Z")
    conversation = store.create_conversation()
    run, _ = store.create_run(
        str(conversation["id"]), "request-context", "需要巡田吗", "zh", provider(), "farm-test",
        {"plotId": "B-01", "plotName": "中区棉花田", "crop": "棉花", "variety": "新陆早61", "growthStage": "吐絮盛期", "questionType": "vigor"},
    )
    draft = store.create_action_draft(str(conversation["id"]), {"title": "核验 B-01 样方", "sourceRunId": run["id"], "evidence": "补充带时间位置的样方"})
    assert store.update_action_draft(str(draft["id"]), "confirmed")["status"] == "confirmed"
    public = store.get_conversation_public(str(conversation["id"]))
    assert public["latestRun"]["context"]["plotId"] == "B-01"
    assert public["actionDrafts"][0]["status"] == "confirmed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ai_runtime_conversations.py::test_conversation_exposes_safe_context_and_runtime_action_draft -v`

Expected: FAIL because `create_run` does not accept `context` and draft APIs do not exist.

- [ ] **Step 3: Write minimal implementation**

```python
SAFE_CONTEXT_KEYS = ("plotId", "plotName", "crop", "variety", "growthStage", "questionType")

def create_action_draft(self, conversation_id: str, payload: dict[str, object]) -> dict[str, object]:
    title = str(payload.get("title", "")).strip()
    source_run_id = str(payload.get("sourceRunId", "")).strip()
    evidence = str(payload.get("evidence", "")).strip()
    if not title or len(title) > 160 or len(evidence) > 1_000:
        raise ValidationError("INVALID_CONFIGURATION", "建议草稿无效")
    conversation = self._conversation(conversation_id)
    if source_run_id not in self._runs or self._runs[source_run_id]["conversationId"] != conversation_id:
        raise ValidationError("RUN_NOT_FOUND", "建议草稿来源会话运行不存在")
    draft = {"id": str(uuid4()), "conversationId": conversation_id, "sourceRunId": source_run_id, "title": title, "evidence": evidence, "status": "pending", "createdAt": self._now(), "updatedAt": self._now()}
    conversation["actionDraftIds"].append(draft["id"])
    self._action_drafts[draft["id"]] = draft
    return deepcopy(draft)

def update_action_draft(self, draft_id: str, status: str) -> dict[str, object]:
    draft = self._action_drafts.get(draft_id)
    if draft is None or status not in {"confirmed", "revoked"} or draft["status"] != "pending":
        raise ValidationError("INVALID_CONFIGURATION", "建议草稿状态变更无效")
    draft["status"] = status
    draft["updatedAt"] = self._now()
    return deepcopy(draft)
```

Context is validated as a bounded object, copied into the private run, and returned only through the public safe-run serializer. Drafts hold no credentials or upstream failure details.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ai_runtime_conversations.py -v`

Expected: PASS with existing idempotency, capacity and secret-redaction coverage preserved.

### Task 2: Runtime API contracts for context and drafts

**Files:**
- Modify: `backend/ai_runtime/api.py`
- Modify: `tests/test_ai_runtime_api.py`

**Interfaces:**
- Consumes: Task 1 conversation context and draft methods.
- Produces: optional `context` support on message create; `POST /conversations/{id}/action-drafts`; `PUT /action-drafts/{id}`.

- [ ] **Step 1: Write the failing test**

```python
def test_context_and_action_drafts_stay_inside_ai_runtime(locked_client) -> None:
    headers = runtime_headers(locked_client)
    conversation = locked_client.post("/api/ai-runtime/conversations", headers=headers, json={}).json()["data"]
    response = locked_client.post(
        f"/api/ai-runtime/conversations/{conversation['id']}/messages", headers=headers,
        json={"requestId": "context-1", "message": "需要巡田吗", "language": "zh", "context": {"plotId": "B-01", "questionType": "vigor"}},
    )
    assert response.status_code == 202
    draft = locked_client.post(
        f"/api/ai-runtime/conversations/{conversation['id']}/action-drafts", headers=headers,
        json={"title": "核验样方", "sourceRunId": response.json()["data"]["id"], "evidence": "补拍样方"},
    )
    assert draft.status_code == 201
    assert locked_client.post("/api/tasks", headers=headers, json={"title": "不应调用核心写入"}).status_code == 423
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ai_runtime_api.py::test_context_and_action_drafts_stay_inside_ai_runtime -v`

Expected: FAIL because the AI Runtime draft route does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
@router.post("/conversations/{conversation_id}/action-drafts", status_code=201)
async def create_action_draft(conversation_id: str, request: Request, payload: Dict[str, object]) -> JSONResponse:
    if denied := await write(request):
        return denied
    return JSONResponse(status_code=201, content={"ok": True, "data": service.conversations.create_action_draft(conversation_id, payload)})
```

Pass a dict `context` only when present and valid; route exceptions through existing `_exception`; retain existing session, origin and content-type checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ai_runtime_api.py -v`

Expected: PASS, including origin/session boundaries and fake-provider end-to-end flow.

### Task 3: Assistant workbench rendering and state actions

**Files:**
- Modify: `frontend/assets/ai-runtime.js`
- Modify: `tests/js/ai_runtime.test.js`
- Modify: `tests/test_frontend_contract.py`

**Interfaces:**
- Consumes: Task 2 public conversation fields `latestRun.context` and `actionDrafts`.
- Produces: `renderAssistant()` output containing `aiRuntimePlot`, `aiRuntimeQuestionType`, `data-ai-template`, and draft action controls.

- [ ] **Step 1: Write the failing test**

```javascript
test("assistant view exposes explicit context and template controls", () => {
  const source = fs.readFileSync("frontend/assets/ai-runtime.js", "utf8");
  assert.match(source, /id="aiRuntimePlot"/);
  assert.match(source, /id="aiRuntimeQuestionType"/);
  assert.match(source, /data-ai-template=/);
  assert.match(source, /action-drafts/);
});
```

Add a Python static contract assertion for the same IDs so the built frontend cannot silently omit the workbench controls.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/js/ai_runtime.test.js && pytest tests/test_frontend_contract.py -v`

Expected: FAIL because the selector and draft controls are absent.

- [ ] **Step 3: Write minimal implementation**

Implement focused render helpers:

```javascript
let assistantPlots = [];
async function loadAssistantPlots() {
  const response = await fetch("/api/lands", { credentials: "same-origin" });
  assistantPlots = response.ok ? await response.json() : [];
}
function contextPayload() {
  const item = assistantPlots.find((plot) => String(plot.id) === document.getElementById("aiRuntimePlot")?.value);
  return item ? { plotId: String(item.id), plotName: item.name, crop: item.crop_name, variety: item.variety, growthStage: item.stage, questionType: document.getElementById("aiRuntimeQuestionType")?.value || "" } : { questionType: document.getElementById("aiRuntimeQuestionType")?.value || "" };
}
function formatLocalTime(iso) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(iso)); }
function evidenceSummary(context) { return context?.plotId ? "场景田块资料；厂家设备未绑定地块，不参与判断。" : "尚未选择田块；仅能提供待补证据清单。"; }
function renderActionDrafts(drafts, esc) { return drafts.map((draft) => `<li><strong>${esc(draft.title)}</strong><small>${esc(draft.status)}</small></li>`).join(""); }
```

Use `data-ai-template` buttons to fill the textarea only. Include `context: contextPayload()` in the existing message POST. Render an explicit “本次服务运行有效” label, context summary, evidence summary, structured answer guidance and runtime action-draft section. Keep all text escaped.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/js/ai_runtime.test.js && pytest tests/test_frontend_contract.py -v`

Expected: PASS with current secret-view model test retained.

### Task 4: Responsive farm-theme layout and truthful collaboration states

**Files:**
- Modify: `frontend/assets/ai-runtime.css`
- Modify: `tests/test_frontend_contract.py`

**Interfaces:**
- Consumes: Task 3 class names and control IDs.
- Produces: desktop context/action layout and mobile chat-first layout with composer available at the bottom.

- [ ] **Step 1: Write the failing test**

```python
def test_ai_runtime_styles_define_context_drafts_and_mobile_composer() -> None:
    css = Path("frontend/assets/ai-runtime.css").read_text(encoding="utf-8")
    assert ".ai-runtime-context" in css
    assert ".ai-runtime-action-drafts" in css
    assert "position: sticky" in css
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_frontend_contract.py::test_ai_runtime_styles_define_context_drafts_and_mobile_composer -v`

Expected: FAIL because context and draft classes do not exist.

- [ ] **Step 3: Write minimal implementation**

Add only scoped `ai-runtime` classes. Keep the cream/green theme variables. On desktop, show a compact context strip before messages and make the three-column panel content-sized. On screens at or below 980px, render chat first and make the composer sticky over the page background. The collaboration panel must say “尚未开始” before a run and only show processing/completed stage labels from actual run state.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_frontend_contract.py -v`

Expected: PASS without weakening unrelated frontend contracts.

### Task 5: End-to-end regression and browser verification

**Files:**
- Modify: `tests/test_ai_runtime_api.py`
- Modify: `tests/js/ai_runtime.test.js`
- Modify: `docs/superpowers/specs/2026-09-20-ai-assistant-three-phase-design.md` only if verification exposes an inaccurate statement.

**Interfaces:**
- Consumes: all prior task APIs and view contracts.
- Produces: repeatable provider-to-context-to-draft test evidence.

- [ ] **Step 1: Write the failing end-to-end assertion**

```python
assert terminal["context"]["plotId"] == "B-01"
assert conversation_snapshot["actionDrafts"][0]["status"] == "pending"
assert "/api/tasks" not in recorded_request_paths
```

- [ ] **Step 2: Run it to verify it fails before integration is complete**

Run: `pytest tests/test_ai_runtime_api.py::test_provider_to_conversation_flow_with_local_fake_provider -v`

Expected: FAIL until the fake-provider flow includes context and a draft.

- [ ] **Step 3: Complete the smallest integration changes**

Extend the existing fake-provider flow to send context, wait for terminal state, create an AI Runtime draft and assert no credentials in all responses. Do not add a network dependency.

- [ ] **Step 4: Run focused verification, then the full available suite**

Run:

```bash
pytest tests/test_ai_runtime_conversations.py tests/test_ai_runtime_api.py tests/test_ai_runtime_agents.py tests/test_ai_runtime_state.py tests/test_frontend_contract.py -v
node --test tests/js/ai_runtime.test.js tests/js/telemetry.test.js tests/js/engine_safety.test.js tests/js/navigation_icons.test.js
python -m compileall backend
```

Expected: all selected tests pass and Python compilation succeeds.

- [ ] **Step 5: Verify the visible path**

Run the local FastAPI application, open the AI 智能管家 route, create a conversation, select `B-01`, select a template, send through the local fake provider or configured provider, create and change an action draft, then inspect the browser page at desktop and mobile widths. Record only observed status, never an API Key.

## Review Checklist

- [ ] Every spec requirement maps to Tasks 1–5.
- [ ] No task writes to a device or core business API.
- [ ] API field names match `context`, `actionDrafts`, `create_action_draft` and `update_action_draft` consistently.
- [ ] Tests prove safe context, no secret leakage, no core write bypass, visible controls and responsive CSS hooks.
