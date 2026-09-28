# AI 智能管家与 AI 与报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 AI Farm OS 中交付主题一致的 AI 智能管家和 AI 与报告页面，并以进程内、密钥不持久化的真实模型连接替代占位实现。

**Architecture:** 新建 `backend/ai_runtime` 以隔离供应商连接、内存配置、会话状态和单次流式编排；`backend/app.py` 仅挂载路由并协调生命周期。新增 `ai-runtime.js` 和 `ai-runtime.css` 复用现有单页路由、菜单、卡片和主题变量，现有 `renderAI()` 保持不动。

**Tech Stack:** Python 3.10+、FastAPI、标准库 `http.client/socket/ssl`、原生 ES2022、现有 Node test、pytest/httpx。

## Global Constraints

- 供应商 API Key 仅存在服务进程内存，绝不回显、持久化、记录到日志或写入浏览器存储。
- 运行期 AI 状态服务重启即清空；不增加数据库迁移、账户、权限或多租户功能。
- AI 仅支持文本会话，不得连接设备、工单、审批、支付或生产控制。
- 保留现有 `/api/ai/*` 仿真分析接口和 `renderAI()`；新增能力统一使用 `/api/ai-runtime/*`。
- AI 智能管家仅在农户、专家菜单出现；AI 与报告仅在专家的系统管理分组出现；监管视角不新增入口。
- 新页面沿用既有颜色变量、卡片、圆角、按钮、表单、空状态和响应式断点；禁止新增 UI 框架、外部字体或独立主题。
- 所有 `frontend/index.html` 静态资源查询版本必须完全一致，并由契约测试验证。
- 当前目录不是 Git 仓库；每项中的“提交”步骤以状态检查替代，不执行提交或远程操作。

---

### Task 1: 运行期供应商存储和安全连接

**Files:**
- Create: `backend/ai_runtime/__init__.py`
- Create: `backend/ai_runtime/state.py`
- Create: `backend/ai_runtime/providers.py`
- Test: `tests/test_ai_runtime_state.py`
- Test: `tests/test_ai_runtime_providers.py`

**Interfaces:**
- Produces: `MemoryStore`, `ValidationError`, `sanitize_provider`, `normalize_endpoint`, `verify_provider`, `stream_text`, `ProviderError`。
- Consumes: Python 标准库网络模块；不依赖当前 SQLite 或现有仿真写入令牌。

- [ ] **Step 1: 写失败的供应商状态测试**

```python
def test_provider_public_data_never_exposes_api_key():
    store = MemoryStore()
    provider = store.create_provider(valid_provider(apiKey="secret-key"))
    assert provider["keyConfigured"] is True
    assert "apiKey" not in provider
    assert "secret-key" not in repr(provider)
    assert all("_api_key" not in item for item in store.list_providers())

def test_change_or_clear_key_resets_verification_and_default():
    store = MemoryStore()
    created = store.create_provider(valid_provider(apiKey="key-one"))
    store.mark_verified(created["id"], "2026-09-19T00:00:00Z")
    store.set_default(created["id"])
    updated = store.update_provider(created["id"], valid_provider(apiKey="key-two"))
    assert (updated["verified"], updated["isDefault"]) == (False, False)
    cleared = store.clear_key(created["id"])
    assert cleared["keyConfigured"] is False
```

- [ ] **Step 2: 运行测试并确认其因模块不存在而失败**

Run: `python -m pytest tests/test_ai_runtime_state.py -q`

Expected: `ModuleNotFoundError: No module named 'backend.ai_runtime'`。

- [ ] **Step 3: 实现内存态供应商与报告偏好**

Public interface: `MemoryStore.create_provider(payload)`, `update_provider(provider_id, payload)`, `list_providers()`, `get_credentials(provider_id)`, `get_dialogue_credentials()`, `mark_verified(provider_id, verified_at)`, `set_default(provider_id)`, `clear_key(provider_id)`, `get_report_settings()` and `update_report_settings(payload)`. Each returns only public provider/report data except the two credential retrieval methods, whose Key return value must remain inside the runtime service.

移植 wrnc 中的字段校验：供应商最多 20 条；`apiFormat` 仅允许 `openai`/`anthropic`；模型映射固定为 `dialogue`、`knowledge`、`report`、`vision`；报告语言仅允许中文、英文、俄文、哈萨克文。公开序列化必须删除所有下划线开头字段并以 `keyConfigured` 代替实际 Key。

- [ ] **Step 4: 写失败的连接安全测试**

```python
@pytest.mark.parametrize("base_url", [
    "http://192.168.1.10/v1", "https://10.0.0.8/v1",
    "https://user:pass@example.com/v1", "https://example.com/v1?x=1",
])
def test_normalize_endpoint_rejects_unsafe_provider_urls(base_url):
    with pytest.raises(ProviderError) as raised:
        normalize_endpoint(base_url, "openai", resolve_dns=False)
    assert raised.value.code == "INVALID_CONFIGURATION"

def test_loopback_http_is_allowed_and_gets_openai_completion_path():
    assert normalize_endpoint("http://127.0.0.1:9999/v1", "openai", resolve_dns=False) == (
        "http://127.0.0.1:9999/v1/chat/completions"
    )
```

- [ ] **Step 5: 实现供应商协议适配和地址保护**

从 wrnc 移植并保持行为一致：`normalize_endpoint`、DNS 解析后地址复核、每次连接使用已解析地址、45 秒上游调用限制、1 MiB 响应上限、OpenAI SSE/Anthropic SSE 增量提取，以及认证、限流、模型不存在、超时和不可用错误映射。导出的流函数应满足：

The module must export `verify_provider(config, api_key) -> dict[str, object]` and `stream_text(config, api_key, model, system_prompt, messages, timeout=45.0) -> Iterator[str]`; both accept only the sanitized configuration plus the in-memory Key supplied by the runtime service.

- [ ] **Step 6: 运行供应商单元测试**

Run: `python -m pytest tests/test_ai_runtime_state.py tests/test_ai_runtime_providers.py -q`

Expected: 所有状态、URL 校验和公开数据测试通过。

- [ ] **Step 7: 检查本任务改动**

Run: `git -C /Users/a0/Downloads/ny/ai-farm-os-final status --short || true`

Expected: 当前项目无 Git 仓库；确认只创建本任务列出的文件。

### Task 2: 会话状态机与单次流式协作编排

**Files:**
- Create: `backend/ai_runtime/conversations.py`
- Create: `backend/ai_runtime/agents.py`
- Test: `tests/test_ai_runtime_conversations.py`
- Test: `tests/test_ai_runtime_agents.py`
- Test: `tests/fake_ai_provider.py`

**Interfaces:**
- Consumes: Task 1 的 `MemoryStore.get_dialogue_credentials()`、`ProviderError`、`stream_text()`。
- Produces: `ConversationStore`、`SingleStreamOrchestrator`、`StreamMarkerParser`、`OrchestrationError`。

- [ ] **Step 1: 写失败的会话容量、幂等与公开快照测试**

```python
def test_duplicate_request_id_returns_same_run_without_second_message():
    store = ConversationStore(now=lambda: "2026-09-19T00:00:00Z")
    conversation = store.create_conversation()
    provider = {"id": "provider-1", "name": "本地测试"}
    first, created = store.create_run(conversation["id"], "request-1", "棉花长势如何", "zh", provider, "demo")
    second, replay = store.create_run(conversation["id"], "request-1", "棉花长势如何", "zh", provider, "demo")
    assert created is True and replay is False
    assert first["id"] == second["id"]

def test_question_history_and_active_run_limits_fail_closed():
    store = ConversationStore()
    conversation = store.create_conversation()
    with pytest.raises(ValidationError, match="1 至 4000"):
        store.create_run(conversation["id"], "request-too-long", "x" * 4001, "zh", provider(), "demo")
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tests/test_ai_runtime_conversations.py tests/test_ai_runtime_agents.py -q`

Expected: 失败，原因是会话与编排模块尚未实现。

- [ ] **Step 3: 实现可公开恢复的内存会话状态机**

移植 wrnc `ConversationStore`，维持下列固定限制与公开字段规则：20 会话、100 消息、4,000 字符问题、12 条/24,000 字符历史、64 KiB 最终回答、相同 `requestId` 幂等、全进程仅一个活动运行。公开会话/运行快照不包含 `_question`、`_raw_text`、凭据或上游错误详情。

Public interface: `create_conversation()`, `list_conversations_public()`, `get_conversation_public(conversation_id)`, `create_run(conversation_id, request_id, question, language, provider, model)`, `mark_stage(run_id, stage)`, `append_delta(run_id, delta)`, `complete_run(run_id, answer)` and `fail_run(run_id, code, message="")`. `create_run` returns `(public_run, created)` so the API can distinguish an idempotent replay from a new upstream call.

- [ ] **Step 4: 写失败的本地流式供应商与阶段解析测试**

```python
def test_one_stream_call_advances_all_four_stages(fake_provider, configured_store):
    orchestrator = SingleStreamOrchestrator(configured_store, ConversationStore(), stream=fake_provider.stream)
    run = orchestrator.start(conversation_id="c1", request_id="r1", message="棉花灌溉要注意什么", language="zh")
    assert fake_provider.calls == 1
    assert run["callCount"] == 1
    assert run["status"] == "completed"
    assert run["completedStages"] == ["planning", "experts", "reviewing", "summarizing"]
    assert "设备控制" not in run["answer"]
```

- [ ] **Step 5: 实现单次流与受限协作展示**

实现 `StreamMarkerParser`，只接受 `[[PLAN]]`、`[[EXPERTS]]`、`[[REVIEW]]`、`[[FINAL]]` 严格顺序；只有 `[[FINAL]]` 后的文本可成为用户回答。`SingleStreamOrchestrator.start()` 只调用一次 `stream_text()`，通过 `select_display_agents(question)` 选择至多三个展示角色，并以后台线程驱动 `planning → experts → reviewing → summarizing`。系统提示必须包含“不得调用工具、不得控制设备、只输出文本建议和证据边界”。

- [ ] **Step 6: 运行状态机与编排测试**

Run: `python -m pytest tests/test_ai_runtime_conversations.py tests/test_ai_runtime_agents.py -q`

Expected: 会话容量、幂等、单次调用、阶段顺序和无工具调用测试全部通过。

- [ ] **Step 7: 检查本任务改动**

Run: `git -C /Users/a0/Downloads/ny/ai-farm-os-final status --short || true`

Expected: 当前项目无 Git 仓库；无无关文件被修改。

### Task 3: FastAPI 运行期 AI 路由与写入边界

**Files:**
- Create: `backend/ai_runtime/api.py`
- Modify: `backend/app.py`
- Modify: `tests/conftest.py`
- Test: `tests/test_ai_runtime_api.py`

**Interfaces:**
- Consumes: Task 1 和 2 的 stores、orchestrator、错误类型。
- Produces: `router`、`AIRuntimeService`、`create_ai_runtime_service()`；所有新端点位于 `/api/ai-runtime`。

- [ ] **Step 1: 写失败的 API 认证、Key 隐藏与默认供应商测试**

```python
def test_runtime_writes_require_same_origin_json_and_session_token(ai_runtime_client):
    client, headers = ai_runtime_client
    rejected = client.post("/api/ai-runtime/providers", json=valid_provider())
    assert rejected.status_code == 403
    accepted = client.post("/api/ai-runtime/providers", headers=headers, json=valid_provider())
    assert accepted.status_code == 201
    assert "apiKey" not in accepted.text

def test_runtime_write_prefix_is_not_unlocked_demo_write(ai_runtime_client):
    client, headers = ai_runtime_client
    response = client.post("/api/ai-runtime/conversations", headers=headers, json={})
    assert response.status_code == 201
    locked = client.post("/api/tasks", headers=headers, json={"title": "still locked"})
    assert locked.status_code == 423
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tests/test_ai_runtime_api.py -q`

Expected: 失败，提示路由不存在。

- [ ] **Step 3: 实现运行期 AI 服务与路由**

在 `api.py` 以服务容器保管 `MemoryStore`、`ConversationStore`、`SingleStreamOrchestrator` 和 `session_token`。实现统一错误 JSON：

```python
{"ok": false, "error": {"code": "SESSION_INVALID", "message": "本地页面会话无效"}}
```

并实现下列端点：

```text
GET  /api/ai-runtime/health
GET  /api/ai-runtime/session
GET  /api/ai-runtime/providers
POST /api/ai-runtime/providers
PUT  /api/ai-runtime/providers/{provider_id}
POST /api/ai-runtime/providers/{provider_id}/verify
POST /api/ai-runtime/providers/{provider_id}/default
DELETE /api/ai-runtime/providers/{provider_id}/key
GET  /api/ai-runtime/report-settings
PUT  /api/ai-runtime/report-settings
GET  /api/ai-runtime/conversations
POST /api/ai-runtime/conversations
GET  /api/ai-runtime/conversations/{conversation_id}
POST /api/ai-runtime/conversations/{conversation_id}/messages
```

写入依赖必须检查 `Content-Type: application/json`、`Origin == scheme://host` 和恒定时间比较的 `X-FarmOS-Session`。`verify` 仅进行最小真实请求，且不将上游响应或 Key 写入日志。

- [ ] **Step 4: 将服务注册到应用生命周期，且保持既有写入锁**

在 `backend/app.py` 创建服务并在 lifespan 中关闭 orchestrator；加入 `app.include_router(ai_runtime_router)`。更新现有安全中间件条件为：

```python
is_runtime_write = request.url.path.startswith("/api/ai-runtime/")
if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS") and not is_runtime_write:
    # existing AI_FARM_ALLOW_DEMO_WRITES + X-AI-Farm-Token gate unchanged
```

将 CORS 方法扩展为 `GET, POST, PUT, DELETE, OPTIONS`，并允许 `X-FarmOS-Session`，同时保留现有来源白名单。更新 `tests/conftest.py`，让每次 `_fresh_backend()` 卸载 `backend.ai_runtime` 子模块，避免测试之间复用内存密钥或会话状态。

- [ ] **Step 5: 运行 API 与既有安全测试**

Run: `python -m pytest tests/test_ai_runtime_api.py tests/test_backend_security.py -q`

Expected: 新运行期 API 通过自身令牌校验；既有 `/api/tasks` 在锁定模式仍返回 `DEMO_WRITES_LOCKED`。

- [ ] **Step 6: 检查本任务改动**

Run: `git -C /Users/a0/Downloads/ny/ai-farm-os-final status --short || true`

Expected: 当前项目无 Git 仓库；路由改动仅限运行期 AI 挂载、CORS 和生命周期。

### Task 4: 菜单、图标与页面路由接入

**Files:**
- Modify: `frontend/assets/spec.js`
- Modify: `frontend/assets/nav-icons.js`
- Modify: `frontend/assets/app.js`
- Modify: `frontend/index.html`
- Test: `tests/js/navigation_icons.test.js`
- Test: `tests/test_frontend_contract.py`

**Interfaces:**
- Consumes: Task 3 的 `/api/ai-runtime` API；Task 5 将导出的 `window.FarmAiRuntime.renderAssistant` 与 `renderSettings`。
- Produces: `assistant` 与 `ai_settings` 的角色化菜单、图标覆盖和页面路由。

- [ ] **Step 1: 写失败的角色导航与图标测试**

```javascript
test("AI runtime pages follow the approved role distribution", () => {
  const farm = FarmSpec.navGroupsFarm.flatMap((group) => group.items.map(([id]) => id));
  const expert = FarmSpec.navGroupsExpert.flatMap((group) => group.items.map(([id]) => id));
  const gov = FarmSpec.navGroupsGov.flatMap((group) => group.items.map(([id]) => id));
  assert.ok(farm.includes("assistant"));
  assert.ok(expert.includes("assistant") && expert.includes("ai_settings"));
  assert.ok(!gov.includes("assistant") && !gov.includes("ai_settings"));
  assert.ok(FarmNavIcons.has("assistant") && FarmNavIcons.has("ai_settings"));
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/js/navigation_icons.test.js`

Expected: `assistant` 与 `ai_settings` 尚未在导航定义中。

- [ ] **Step 3: 以现有导航样式接入两个页面**

在农户“账本与问答”组添加 `['assistant', 'AI智能管家']`；在专家导航新增“系统管理 / 模型与报告配置”组并加入 `['ai_settings', 'AI 与报告']`，同时在“审核与协同”加入 `['assistant', 'AI智能管家']`。为两个 ID 新增独立 SVG 线框图标，并让现有图标测试继续对三个角色所有项生效。

在 `render()` 的页面分派中新增：

```javascript
else if (page === "assistant") htmlPromise = window.FarmAiRuntime.renderAssistant({ role: currentRole, navigate, toast, esc });
else if (page === "ai_settings") htmlPromise = window.FarmAiRuntime.renderSettings({ role: currentRole, navigate, toast, esc });
```

若角色无权访问，回退到该角色的 `dashboard` 并显示“当前视角没有该入口”；不能依赖仅隐藏菜单来冒充权限。

- [ ] **Step 4: 加载新资源并统一版本号**

在 `index.html` 加入：

```html
<link rel="stylesheet" href="assets/ai-runtime.css?v=198" />
<script src="assets/ai-runtime.js?v=198"></script>
```

并把 `index.html` 中每一个版本化 `assets/` CSS 与 JS 引用统一改为 `v=198`。`ai-runtime.js` 必须位于 `app.js` 前，以便页面分派时已有 `window.FarmAiRuntime`。

- [ ] **Step 5: 运行菜单与静态资源契约测试**

Run: `node --test tests/js/navigation_icons.test.js && python -m pytest tests/test_frontend_contract.py -q`

Expected: 三角色图标覆盖、页面分派和所有资源版本号契约通过。

- [ ] **Step 6: 检查本任务改动**

Run: `git -C /Users/a0/Downloads/ny/ai-farm-os-final status --short || true`

Expected: 当前项目无 Git 仓库；未修改既有 `ai` 页面逻辑。

### Task 5: 主题一致的 AI 智能管家与 AI 与报告界面

**Files:**
- Create: `frontend/assets/ai-runtime.js`
- Create: `frontend/assets/ai-runtime.css`
- Test: `tests/js/ai_runtime.test.js`
- Test: `tests/test_frontend_contract.py`

**Interfaces:**
- Consumes: Task 3 的 API 和 `X-FarmOS-Session`；Task 4 的路由上下文 `{ role, navigate, toast, esc }`。
- Produces: `window.FarmAiRuntime = { renderAssistant, renderSettings }`。

- [ ] **Step 1: 写失败的前端状态机和密钥边界测试**

```javascript
test("accepted run is reconciled before another send", async () => {
  const state = createAssistantState({ sessionToken: "token" });
  state.acceptRun({ id: "run-1", requestId: "request-1", status: "planning" });
  await state.reconcile(async () => ({ latestRun: { id: "run-1", status: "completed", answer: "完成" } }));
  assert.equal(state.canSend(), true);
  assert.equal(state.currentRun.status, "completed");
});

test("provider view model never retains or renders apiKey", () => {
  const view = providerViewModel({ name: "测试", keyConfigured: true, apiKey: "must-not-leak" });
  assert.equal("apiKey" in view, false);
  assert.doesNotMatch(renderProviderCard(view), /must-not-leak/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/js/ai_runtime.test.js`

Expected: 失败，`ai-runtime.js` 尚不存在。

- [ ] **Step 3: 实现共享 API 客户端与会话恢复**

实现仅内存保存的 API 客户端：首次 `GET /api/ai-runtime/session` 获取令牌；写请求添加 JSON、`Origin` 和 `X-FarmOS-Session`；服务返回 `SESSION_INVALID` 或会话不存在时清空本地对话选择并显示“服务已重启，运行期 AI 配置已清空”。浏览器不得使用 `localStorage`、`sessionStorage`、Cookie 或 URL 参数保存 API Key。

```javascript
function providerViewModel(provider) {
  const { apiKey, _api_key, ...publicProvider } = provider || {};
  return publicProvider;
}
```

The module must export `runtimeRequest(path, options)`, `createAssistantState({ sessionToken })`, `providerViewModel(provider)`, `renderAssistant(context)` and `renderSettings(context)` through `window.FarmAiRuntime`.

- [ ] **Step 4: 实现 AI 与报告表单页**

`renderSettings()` 在非专家角色显示真实的不可用状态而不是表单。专家页提供供应商列表、新增/编辑表单、密码类型 API Key 输入、验证、设默认、清除 Key、模型映射和报告偏好。所有动态文本经现有 `esc()` 转义。保存成功、失败或路由离开后都将密码输入 `value = ""`；列表只显示“已配置 / 未配置”，不显示 Key 片段。

对尚未接通的功能显示静态且明确的边界：`报告生成和图像诊断尚未接通模型调用。` 不创建假报告或图像诊断按钮。

- [ ] **Step 5: 实现 AI 智能管家页**

`renderAssistant()` 以三栏布局输出会话、对话和协作阶段；使用快捷问题、4,000 字符限制、发送状态、失败重试和刷新对账。发送后先显示服务接受的 run，再轮询会话详情直到 `completed`/`failed`，绝不因为浏览器中断直接再次提交同一问题。农户无有效供应商时只显示原因；专家显示跳转 `ai_settings` 的按钮。

渲染内容必须使用以下事实边界文案：`仅文本协作建议，不控制设备、不创建工单、不触发审批。` 阶段和最终回答均从服务公开快照读取，不能在前端编造答案。

- [ ] **Step 6: 实现主题限定样式与窄屏折叠**

在 `ai-runtime.css` 中仅使用 `.ai-runtime-*` 选择器和已有 CSS 变量。桌面使用 `minmax(220px, .72fr) minmax(0, 1.45fr) minmax(240px, .8fr)` 三栏；在 `max-width: 980px` 顺序折叠为一栏。使用现有 `.card`、`.btn`、`.ghost` 和表单视觉语义，维持浅色/深色主题可读性，并给会话列表、阶段状态和错误提示添加 `aria-live`、可见标签与键盘可操作按钮。

- [ ] **Step 7: 运行前端单元与契约测试**

Run: `node --test tests/js/ai_runtime.test.js tests/js/navigation_icons.test.js && python -m pytest tests/test_frontend_contract.py -q`

Expected: 状态恢复、无密钥渲染、导航、资源版本和可访问表单契约通过。

- [ ] **Step 8: 检查本任务改动**

Run: `git -C /Users/a0/Downloads/ny/ai-farm-os-final status --short || true`

Expected: 当前项目无 Git 仓库；所有新增样式限定为 `ai-runtime` 命名空间。

### Task 6: 端到端验证、原页面回归与视觉验收

**Files:**
- Modify: `tests/test_ai_runtime_api.py`
- Modify: `tests/test_frontend_contract.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–5 的完整实现。
- Produces: 可重复的本地假供应商验收证据和用户可理解的运行期状态说明。

- [ ] **Step 1: 写本地假供应商端到端测试**

```python
def test_provider_to_conversation_flow_with_local_fake_provider(ai_runtime_client, fake_provider):
    client, headers = ai_runtime_client
    provider = client.post("/api/ai-runtime/providers", headers=headers, json=fake_provider.config()).json()["data"]
    assert client.post(f"/api/ai-runtime/providers/{provider['id']}/verify", headers=headers, json={}).status_code == 200
    assert client.post(f"/api/ai-runtime/providers/{provider['id']}/default", headers=headers, json={}).status_code == 200
    conversation = client.post("/api/ai-runtime/conversations", headers=headers, json={}).json()["data"]
    accepted = client.post(
        f"/api/ai-runtime/conversations/{conversation['id']}/messages",
        headers=headers,
        json={"requestId": "flow-001", "message": "棉花长势如何", "language": "zh"},
    )
    assert accepted.status_code == 202
    completed = wait_for_terminal_run(client, conversation["id"])
    assert completed["latestRun"]["status"] == "completed"
    assert fake_provider.calls == 2  # verify once, dialogue once
```

- [ ] **Step 2: 运行端到端测试并确认通过**

Run: `python -m pytest tests/test_ai_runtime_api.py -q`

Expected: 本地假供应商可完成新增、验证、默认、流式会话、刷新对账；测试不访问外部模型。

- [ ] **Step 3: 更新 README 的真实边界与使用说明**

在 `README.md` 的运行模式段落新增“运行期 AI 连接”说明：配置存在内存，重启即清空；验证可能产生少量费用；AI 仅文本建议，不控制设备或创建工单；报告生成与图像诊断尚未接通。不得写入实际供应商名称、API Key 或未验证的能力宣称。

- [ ] **Step 4: 执行聚焦与完整验证**

Run:

```bash
python -m pytest tests/test_ai_runtime_state.py tests/test_ai_runtime_providers.py tests/test_ai_runtime_conversations.py tests/test_ai_runtime_agents.py tests/test_ai_runtime_api.py -q
node --test tests/js/ai_runtime.test.js tests/js/navigation_icons.test.js
python -m pytest -q
```

Expected: 新增聚焦测试全部通过；完整套件结果须单独记录，任何既有失败不得被掩盖或删除。

- [ ] **Step 5: 启动服务并做浏览器验收**

Run: `python start.py --no-browser --port 8080`

在浏览器执行并记录：农户看到 AI 智能管家但无 AI 与报告；专家可配置本地假供应商并完成流式会话；监管无新增入口；刷新恢复会话；重启后配置与会话清空；既有“AI 分析中心”仍可打开；桌面与窄屏均保持现有主题风格。

- [ ] **Step 6: 最终范围检查**

Run: `git -C /Users/a0/Downloads/ny/ai-farm-os-final status --short || true`

Expected: 当前项目无 Git 仓库；交付报告列出新增、修改和未执行的验证，不声称外部真实供应商已被自动验证。
