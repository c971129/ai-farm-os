(function (global) {
  "use strict";

  const API_ROOT = "/api/ai-runtime";
  const resolveUrl = (path) => (global.FarmApiBase && global.FarmApiBase.apiUrl)
    ? global.FarmApiBase.apiUrl(path)
    : path;
  let sessionToken = "";
  let selectedConversationId = "";
  let editorProviderId = "";
  let assistantPlots = [];
  let selectedPlotId = "";
  let selectedQuestionType = "vigor";

  function providerViewModel(provider) {
    const source = provider || {};
    const copy = {};
    Object.entries(source).forEach(([key, value]) => {
      if (key !== "apiKey" && key !== "_api_key") copy[key] = value;
    });
    return copy;
  }

  function createAssistantState({ sessionToken: token }) {
    return {
      sessionToken: token,
      currentRun: null,
      acceptRun(run) { this.currentRun = providerViewModel(run); },
      canSend() { return !this.currentRun || ["completed", "failed"].includes(this.currentRun.status); },
      async reconcile(loadConversation) {
        const conversation = await loadConversation();
        if (conversation && conversation.latestRun && (!this.currentRun || conversation.latestRun.id === this.currentRun.id)) {
          this.currentRun = providerViewModel(conversation.latestRun);
        }
        return conversation;
      },
    };
  }

  async function ensureSession() {
    if (sessionToken) return sessionToken;
    const response = await fetch(resolveUrl(`${API_ROOT}/session`), { credentials: "omit" });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.data || !payload.data.token) throw new Error("无法获取本地 AI 会话");
    sessionToken = payload.data.token;
    return sessionToken;
  }

  async function runtimeRequest(path, { method = "GET", body } = {}) {
    const write = !["GET", "HEAD"].includes(method);
    const headers = write ? { "Content-Type": "application/json", "X-FarmOS-Session": await ensureSession() } : {};
    const response = await fetch(resolveUrl(`${API_ROOT}${path}`), { method, headers, credentials: "omit", body: write ? JSON.stringify(body || {}) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const error = new Error(payload?.error?.message || "本地 AI 服务请求失败");
      error.code = payload?.error?.code || "AI_RUNTIME_ERROR";
      if (error.code === "SESSION_INVALID") sessionToken = "";
      throw error;
    }
    return payload.data;
  }

  function escText(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function runtimeError(error) {
    if (error?.code === "VERIFIED_PROVIDER_REQUIRED") return "请先由专家配置并验证模型供应商。";
    if (error?.code === "DEFAULT_PROVIDER_REQUIRED") return "存在多个已验证供应商，请由专家设置默认供应商。";
    if (error?.code === "RUN_CAPACITY_REACHED") return "已有模型会话正在处理，请完成后再发送。";
    if (error?.code === "SESSION_INVALID") return "服务已重启，运行期 AI 配置已清空。";
    if (error?.code === "UPSTREAM_INVALID_REQUEST" || error?.code === "UPSTREAM_INVALID_PARAMETERS") return "模型服务拒绝了验证请求，请检查接口格式和模型参数。";
    if (error?.code === "INSUFFICIENT_BALANCE") return "模型服务余额不足，请充值后重新验证。";
    return error?.message || "本地 AI 服务暂时不可用。";
  }

  function providerForm(provider) {
    const p = provider || { mappings: {} };
    const mapping = p.mappings || {};
    return `<form id="aiRuntimeProviderForm" class="ai-runtime-form" novalidate>
      <input type="hidden" id="aiRuntimeProviderId" aria-label="正在编辑的供应商标识" value="${escText(p.id || "")}" />
      <label>供应商名称<input id="aiRuntimeProviderName" aria-label="供应商名称" required maxlength="100" value="${escText(p.name || "")}" /></label>
      <label>说明<input id="aiRuntimeProviderNote" aria-label="供应商说明" maxlength="300" value="${escText(p.note || "")}" /></label>
      <label>Base URL<input id="aiRuntimeProviderUrl" aria-label="模型服务 Base URL" required maxlength="2048" placeholder="https://…/v1" value="${escText(p.baseUrl || "")}" /></label>
      <label>接口格式<select id="aiRuntimeProviderFormat" aria-label="接口格式"><option value="openai" ${p.apiFormat === "openai" ? "selected" : ""}>OpenAI 兼容</option><option value="anthropic" ${p.apiFormat === "anthropic" ? "selected" : ""}>Anthropic Messages</option></select></label>
      <label>默认模型<input id="aiRuntimeProviderModel" aria-label="默认模型" required maxlength="200" value="${escText(p.defaultModel || "")}" /></label>
      <label>API Key<input id="aiRuntimeProviderKey" aria-label="API Key" type="password" autocomplete="new-password" maxlength="4096" placeholder="仅保存在本次服务运行期间" /></label>
      <div class="ai-runtime-mapping"><label>对话模型<input id="aiRuntimeDialogueModel" aria-label="对话模型" maxlength="200" value="${escText(mapping.dialogue || "")}" /></label><label>知识模型<input id="aiRuntimeKnowledgeModel" aria-label="知识模型" maxlength="200" value="${escText(mapping.knowledge || "")}" /></label><label>报告模型<input id="aiRuntimeReportModel" aria-label="报告模型" maxlength="200" value="${escText(mapping.report || "")}" /></label><label>视觉模型<input id="aiRuntimeVisionModel" aria-label="视觉模型" maxlength="200" value="${escText(mapping.vision || "")}" /></label></div>
      <div class="ai-runtime-actions"><button class="btn" type="submit">${p.id ? "保存供应商" : "新增供应商"}</button><button class="btn ghost" id="aiRuntimeCancelEdit" type="button" ${p.id ? "" : "hidden"}>取消编辑</button></div>
    </form>`;
  }

  function providerPayload() {
    const value = (id) => document.getElementById(id)?.value.trim() || "";
    return {
      name: value("aiRuntimeProviderName"), note: value("aiRuntimeProviderNote"), baseUrl: value("aiRuntimeProviderUrl"), apiFormat: value("aiRuntimeProviderFormat"), defaultModel: value("aiRuntimeProviderModel"), apiKey: value("aiRuntimeProviderKey"),
      mappings: { dialogue: value("aiRuntimeDialogueModel"), knowledge: value("aiRuntimeKnowledgeModel"), report: value("aiRuntimeReportModel"), vision: value("aiRuntimeVisionModel") },
    };
  }

  async function renderSettings(context) {
    const { role, navigate, toast, esc = escText } = context;
    const view = document.getElementById("view");
    if (role !== "expert") {
      view.innerHTML = `<section class="panel ai-runtime-empty"><h2>AI 与报告仅在专家视角可配置</h2><p class="sub">当前项目的角色切换用于界面呈现；模型密钥仅保存在本机服务内存。</p></section>`;
      return;
    }
    let providers = [], settings = { defaultModel: "", language: "中文", citations: true, manualReview: true };
    try { [providers, settings] = await Promise.all([runtimeRequest("/providers"), runtimeRequest("/report-settings")]); } catch (error) { view.innerHTML = `<section class="panel ai-runtime-empty"><h2>无法读取 AI 配置</h2><p class="sub">${esc(runtimeError(error))}</p></section>`; return; }
    const edited = providers.find((item) => item.id === editorProviderId);
    view.innerHTML = `<section class="ai-runtime-page ai-runtime-settings"><div class="ai-runtime-hero"><div><span>系统管理与开放平台</span><h2>AI 与报告</h2><p>供应商与 API Key 仅保存在当前服务进程；服务重启后会清空。连接验证会发送最小真实请求，可能产生少量费用。</p></div><span class="ai-runtime-badge">文本协作 · 本地运行期</span></div><div class="ai-runtime-settings-grid"><section class="panel"><h3>模型供应商</h3><div class="ai-runtime-provider-list">${providers.length ? providers.map((p) => `<article class="ai-runtime-provider" data-provider-id="${esc(p.id)}"><div><strong>${esc(p.name)}</strong><span>${esc(p.apiFormat)} · ${esc(p.defaultModel)}</span><small>${p.keyConfigured ? "Key 已配置" : "未配置 Key"} · ${p.verified ? "已验证" : "未验证"}${p.isDefault ? " · 默认" : ""}</small></div><div class="ai-runtime-card-actions"><button class="btn ghost" type="button" data-ai-edit="${esc(p.id)}">编辑</button><button class="btn ghost" type="button" data-ai-verify="${esc(p.id)}">验证</button><button class="btn ghost" type="button" data-ai-default="${esc(p.id)}" ${p.verified ? "" : "disabled"}>设为默认</button><button class="btn ghost" type="button" data-ai-clear="${esc(p.id)}" ${p.keyConfigured ? "" : "disabled"}>清除 Key</button></div></article>`).join("") : `<p class="sub">尚未配置供应商。新增后先验证，再设为默认供应商。</p>`}</div></section><section class="panel"><h3>${edited ? "编辑供应商" : "新增供应商"}</h3>${providerForm(edited)}</section></div><section class="panel ai-runtime-report"><h3>报告偏好</h3><p class="sub">报告生成和图像诊断尚未接通模型调用。</p><form id="aiRuntimeReportForm" class="ai-runtime-report-form"><label>默认报告模型<input id="aiRuntimeReportDefault" aria-label="默认报告模型" required maxlength="200" value="${esc(settings.defaultModel || "")}" /></label><label>输出语言<select id="aiRuntimeReportLanguage" aria-label="报告输出语言">${["中文", "英文", "俄文", "哈萨克文"].map((language) => `<option value="${language}" ${settings.language === language ? "selected" : ""}>${language}</option>`).join("")}</select></label><label><input id="aiRuntimeCitations" aria-label="保留引用" type="checkbox" ${settings.citations ? "checked" : ""} /> 保留引用</label><label><input id="aiRuntimeManualReview" aria-label="人工复核" type="checkbox" ${settings.manualReview ? "checked" : ""} /> 人工复核</label><button class="btn" type="submit">保存报告偏好</button></form></section></section>`;
    document.getElementById("aiRuntimeProviderForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = document.getElementById("aiRuntimeProviderId")?.value;
      try { await runtimeRequest(id ? `/providers/${encodeURIComponent(id)}` : "/providers", { method: id ? "PUT" : "POST", body: providerPayload() }); editorProviderId = ""; toast("供应商已保存", "API Key 不会回显", "green"); await renderSettings(context); } catch (error) { toast("保存失败", runtimeError(error), "orange"); } finally { const field = document.getElementById("aiRuntimeProviderKey"); if (field) field.value = ""; }
    });
    document.getElementById("aiRuntimeCancelEdit")?.addEventListener("click", () => { editorProviderId = ""; renderSettings(context); });
    document.querySelectorAll("[data-ai-edit]").forEach((button) => button.addEventListener("click", () => { editorProviderId = button.dataset.aiEdit || ""; renderSettings(context); }));
    document.querySelectorAll("[data-ai-verify]").forEach((button) => button.addEventListener("click", async () => { try { await runtimeRequest(`/providers/${encodeURIComponent(button.dataset.aiVerify)}/verify`, { method: "POST", body: {} }); toast("连接已验证", "可设为默认供应商", "green"); await renderSettings(context); } catch (error) { toast("验证失败", runtimeError(error), "orange"); } }));
    document.querySelectorAll("[data-ai-default]").forEach((button) => button.addEventListener("click", async () => { try { await runtimeRequest(`/providers/${encodeURIComponent(button.dataset.aiDefault)}/default`, { method: "POST", body: {} }); toast("已设为默认", "AI 智能管家会使用此供应商", "green"); await renderSettings(context); } catch (error) { toast("设置失败", runtimeError(error), "orange"); } }));
    document.querySelectorAll("[data-ai-clear]").forEach((button) => button.addEventListener("click", async () => { try { await runtimeRequest(`/providers/${encodeURIComponent(button.dataset.aiClear)}/key`, { method: "DELETE", body: {} }); toast("API Key 已清除", "供应商需重新配置并验证", "green"); await renderSettings(context); } catch (error) { toast("清除失败", runtimeError(error), "orange"); } }));
    document.getElementById("aiRuntimeReportForm")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await runtimeRequest("/report-settings", { method: "PUT", body: { defaultModel: document.getElementById("aiRuntimeReportDefault").value.trim(), language: document.getElementById("aiRuntimeReportLanguage").value, citations: document.getElementById("aiRuntimeCitations").checked, manualReview: document.getElementById("aiRuntimeManualReview").checked } }); toast("报告偏好已保存", "模型调用尚未接通", "green"); } catch (error) { toast("保存失败", runtimeError(error), "orange"); } });
  }

  async function loadAssistantPlots() {
    try {
      const response = await fetch(resolveUrl("/api/lands"), { credentials: "omit" });
      const payload = await response.json();
      assistantPlots = response.ok && Array.isArray(payload) ? payload : [];
    } catch (_) { assistantPlots = []; }
  }

  function formatLocalTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function isToday(value) {
    const date = new Date(value), now = new Date();
    return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  }

  function conversationList(conversations, esc) {
    const renderGroup = (title, items) => items.length ? `<section class="ai-runtime-conversation-group"><h4>${title}</h4>${items.map((item) => `<button class="ai-runtime-conversation ${item.id === selectedConversationId ? "is-selected" : ""}" type="button" data-ai-conversation="${esc(item.id)}"><strong>${esc(item.title)}</strong><small>${esc(formatLocalTime(item.updatedAt))}</small></button>`).join("")}</section>` : "";
    const today = conversations.filter((item) => isToday(item.updatedAt));
    const earlier = conversations.filter((item) => !isToday(item.updatedAt));
    return today.length || earlier.length ? `${renderGroup("今天", today)}${renderGroup("本周较早", earlier)}` : `<p class="sub">创建会话后开始田间研判。</p>`;
  }

  function selectedPlot() { return assistantPlots.find((item) => String(item.id) === selectedPlotId) || null; }

  function contextPayload() {
    const plot = selectedPlot();
    const questionType = selectedQuestionType || "general";
    return plot ? { plotId: String(plot.id), plotName: String(plot.name || ""), crop: String(plot.crop_name || ""), variety: String(plot.variety || ""), growthStage: String(plot.stage || ""), questionType } : { questionType };
  }

  function contextSummary(context, esc) {
    const details = [["田块", context?.plotName], ["作物", context?.crop], ["品种", context?.variety], ["生育期", context?.growthStage]].filter(([, value]) => value);
    return details.length ? details.map(([label, value]) => `<span><b>${label}</b>${esc(value)}</span>`).join("") : "<span>尚未选择田块</span>";
  }

  function evidenceSummary(context) {
    return context?.plotId ? "" : "未选择田块：本次只能生成待补证据清单，不能形成田间结论。";
  }

  function actionDraftsMarkup(drafts, esc) {
    if (!drafts.length) return `<p class="sub">将完成后的回答转为待人工确认的农事建议草稿。</p>`;
    return `<ul>${drafts.map((draft) => `<li><div><strong>${esc(draft.title)}</strong><small>${esc(draft.evidence || "人工确认前不得执行")}</small></div><div><em class="ai-runtime-draft-status is-${esc(draft.status)}">${draft.status === "pending" ? "待确认" : draft.status === "confirmed" ? "已确认" : "已撤销"}</em>${draft.status === "pending" ? `<button class="btn ghost" type="button" data-ai-draft="${esc(draft.id)}" data-ai-draft-status="confirmed">确认</button><button class="btn ghost" type="button" data-ai-draft="${esc(draft.id)}" data-ai-draft-status="revoked">撤销</button>` : ""}</div></li>`).join("")}</ul>`;
  }

  function stageList(run) {
    const stages = [["planning", "规划"], ["experts", "专家协作"], ["reviewing", "交叉复核"], ["summarizing", "总结"]];
    const completed = new Set(run?.completedStages || []);
    return stages.map(([id, name]) => `<li class="${completed.has(id) ? "is-done" : run?.stage === id ? "is-active" : ""}"><span></span><strong>${name}</strong><small>${completed.has(id) ? "已完成" : run?.stage === id ? "处理中" : "等待"}</small></li>`).join("");
  }

  async function renderAssistant(context) {
    const { role, navigate, toast, esc = escText } = context;
    const view = document.getElementById("view");
    let conversations = [];
    try { [conversations] = await Promise.all([runtimeRequest("/conversations"), loadAssistantPlots()]); } catch (error) { view.innerHTML = `<section class="panel ai-runtime-empty"><h2>AI 智能管家暂不可用</h2><p class="sub">${esc(runtimeError(error))}</p></section>`; return; }
    if (!selectedConversationId && conversations[0]) selectedConversationId = conversations[0].id;
    let conversation = null;
    if (selectedConversationId) { try { conversation = await runtimeRequest(`/conversations/${encodeURIComponent(selectedConversationId)}`); } catch (_) { selectedConversationId = ""; } }
    const run = conversation?.activeRun || conversation?.latestRun || null;
    const messages = conversation?.messages || [];
    const currentContext = run?.context || contextPayload();
    if (!selectedPlotId && currentContext?.plotId) selectedPlotId = String(currentContext.plotId);
    if (currentContext?.questionType) selectedQuestionType = currentContext.questionType;
    const drafts = conversation?.actionDrafts || [];
    const options = assistantPlots.map((plot) => `<option value="${esc(String(plot.id))}" ${String(plot.id) === selectedPlotId ? "selected" : ""}>${esc(`${plot.code || "田块"} · ${plot.name || "未命名"}`)}</option>`).join("");
    view.innerHTML = `<section class="ai-runtime-page ai-runtime-assistant">
      <header class="ai-runtime-hero ai-runtime-hero-compact"><div class="ai-runtime-hero-copy"><span class="ai-runtime-eyebrow">作物全生命周期 · 田间研判工作台</span><h2>从一个田间问题开始</h2><p class="ai-runtime-lead">选择田块与问题类型，整理依据、风险、建议行动和待补证据。</p></div><div class="ai-runtime-hero-actions"><button class="btn" id="aiRuntimeNewConversationTop" type="button">新会话</button>${role === "expert" ? `<button class="btn ghost" id="aiRuntimeOpenSettingsTop" type="button">AI 与报告</button>` : ""}</div></header>
      <div class="ai-runtime-assistant-grid">
        <aside class="panel ai-runtime-conversations"><div class="ai-runtime-panel-head"><h3>会话</h3><button class="btn ghost" id="aiRuntimeNewConversation" type="button">新建</button></div>${conversationList(conversations, esc)}</aside>
        <section class="panel ai-runtime-chat">
          <div class="ai-runtime-panel-head"><h3>${conversation ? esc(conversation.title) : "开始作物咨询"}</h3><button class="btn ghost" id="aiRuntimeReload" type="button">刷新</button></div>
          <section class="ai-runtime-context" aria-label="田间上下文"><div><h4>田间上下文</h4><small>本次服务运行有效</small></div><label>田块<select id="aiRuntimePlot" aria-label="选择田块"><option value="">未选择田块</option>${options}</select></label><label>问题类型<select id="aiRuntimeQuestionType" aria-label="选择问题类型"><option value="vigor" ${selectedQuestionType === "vigor" ? "selected" : ""}>长势异常排查</option><option value="irrigation" ${selectedQuestionType === "irrigation" ? "selected" : ""}>水肥灌溉核查</option><option value="soil" ${selectedQuestionType === "soil" ? "selected" : ""}>土壤与盐分风险</option><option value="pest" ${selectedQuestionType === "pest" ? "selected" : ""}>病虫风险核验</option><option value="general" ${selectedQuestionType === "general" ? "selected" : ""}>其他田间问题</option></select></label><div class="ai-runtime-context-summary">${contextSummary(currentContext, esc)}</div>${evidenceSummary(currentContext) ? `<p>${esc(evidenceSummary(currentContext))}</p>` : ""}</section>
          <div class="ai-runtime-messages" id="aiRuntimeMessages" aria-live="polite">${messages.length ? messages.map((message) => `<article class="ai-runtime-message is-${esc(message.role)}"><span>${message.role === "user" ? "你" : "AI 管家"}</span><p>${esc(message.text)}</p></article>`).join("") : `<div class="ai-runtime-empty-message"><strong>先选择田块，再提出问题</strong><p>回答会呈现判断、依据、风险、建议行动和待补证据。</p></div>`}</div>
          <div class="ai-runtime-quick"><button type="button" data-ai-template="当前作物长势是否异常？请列出判断依据和待补证据。">长势异常排查</button><button type="button" data-ai-template="当前是否具备灌溉研判条件？请列出缺少的田间数据。">水肥灌溉核查</button><button type="button" data-ai-template="当前病虫或盐分风险需要怎样人工核验？">病虫与盐分风险</button></div>
          <form id="aiRuntimeChatForm" class="ai-runtime-chat-form"><label class="sr-only" for="aiRuntimeQuestion">咨询问题</label><textarea id="aiRuntimeQuestion" aria-label="咨询问题" maxlength="4000" placeholder="输入作物、土壤、水肥或病虫相关问题…"></textarea><div><small id="aiRuntimeQuestionCount">0 / 4000</small><button class="btn" type="submit" ${run && !["completed", "failed"].includes(run.status) ? "disabled" : ""}>发送</button></div></form>
          <section class="ai-runtime-action-drafts" aria-label="待确认农事建议"><div class="ai-runtime-panel-head"><h4>待确认农事建议</h4>${run?.status === "completed" && run.answer ? `<button class="btn ghost" id="aiRuntimeCreateDraft" type="button">加入待确认清单</button>` : ""}</div>${actionDraftsMarkup(drafts, esc)}</section>
        </section>
        <aside class="panel ai-runtime-stages"><h3>协作进度</h3>${run ? `<ol>${stageList(run)}</ol>` : `<p class="sub">尚未开始。发送问题后将显示规划、专家协作、交叉复核与总结的实际状态。</p>`}${run?.errorCode ? `<div class="ai-runtime-error" role="alert">${esc(runtimeError({ code: run.errorCode }))}</div>` : ""}<div class="ai-runtime-agents"><strong>参与角色</strong>${(run?.selectedAgents || []).map((key) => `<span>${esc(key)}</span>`).join("") || "<small>回答将区分判断、依据、建议行动与待补证据。</small>"}</div>${role === "expert" ? `<button class="btn ghost" id="aiRuntimeOpenSettings" type="button">配置 AI 与报告</button>` : ""}</aside>
      </div>
    </section>`;
    const question = document.getElementById("aiRuntimeQuestion");
    const count = document.getElementById("aiRuntimeQuestionCount");
    question?.addEventListener("input", () => { count.textContent = `${question.value.length} / 4000`; });
    document.querySelectorAll("[data-ai-template]").forEach((button) => button.addEventListener("click", () => { question.value = button.dataset.aiTemplate || ""; question.dispatchEvent(new Event("input")); question.focus(); }));
    document.getElementById("aiRuntimePlot")?.addEventListener("change", (event) => { selectedPlotId = event.target.value; });
    document.getElementById("aiRuntimeQuestionType")?.addEventListener("change", (event) => { selectedQuestionType = event.target.value; });
    document.querySelectorAll("[data-ai-conversation]").forEach((button) => button.addEventListener("click", () => { selectedConversationId = button.dataset.aiConversation || ""; renderAssistant(context); }));
    document.getElementById("aiRuntimeNewConversation")?.addEventListener("click", async () => { try { const created = await runtimeRequest("/conversations", { method: "POST", body: {} }); selectedConversationId = created.id; await renderAssistant(context); } catch (error) { toast("创建会话失败", runtimeError(error), "orange"); } });
    document.getElementById("aiRuntimeNewConversationTop")?.addEventListener("click", () => document.getElementById("aiRuntimeNewConversation")?.click());
    document.getElementById("aiRuntimeReload")?.addEventListener("click", () => renderAssistant(context));
    document.getElementById("aiRuntimeOpenSettings")?.addEventListener("click", () => navigate("ai_settings"));
    document.getElementById("aiRuntimeOpenSettingsTop")?.addEventListener("click", () => navigate("ai_settings"));
    document.getElementById("aiRuntimeCreateDraft")?.addEventListener("click", async () => {
      if (!conversation || !run?.id) return;
      try { await runtimeRequest(`/conversations/${encodeURIComponent(conversation.id)}/action-drafts`, { method: "POST", body: { title: `核验：${conversation.title}`.slice(0, 160), sourceRunId: run.id, evidence: "根据本次 AI 回答生成；确认前不得作为生产操作执行。" } }); toast("已加入待确认清单", "仅保存在本次服务运行中，不会创建业务农事任务。", "green"); await renderAssistant(context); } catch (error) { toast("创建草稿失败", runtimeError(error), "orange"); }
    });
    document.querySelectorAll("[data-ai-draft]").forEach((button) => button.addEventListener("click", async () => { try { await runtimeRequest(`/action-drafts/${encodeURIComponent(button.dataset.aiDraft)}`, { method: "PUT", body: { status: button.dataset.aiDraftStatus } }); toast(button.dataset.aiDraftStatus === "confirmed" ? "建议已确认" : "建议已撤销", "状态仅在本次服务运行中保留。", "green"); await renderAssistant(context); } catch (error) { toast("更新草稿失败", runtimeError(error), "orange"); } }));
    document.getElementById("aiRuntimeChatForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = question.value.trim();
      if (!message) return;
      try {
        if (!selectedConversationId) { const created = await runtimeRequest("/conversations", { method: "POST", body: {} }); selectedConversationId = created.id; }
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await runtimeRequest(`/conversations/${encodeURIComponent(selectedConversationId)}/messages`, { method: "POST", body: { requestId, message, language: "zh", context: contextPayload() } });
        await renderAssistant(context);
        for (let index = 0; index < 40; index += 1) { await new Promise((resolve) => setTimeout(resolve, 250)); const refreshed = await runtimeRequest(`/conversations/${encodeURIComponent(selectedConversationId)}`); const state = refreshed.activeRun || refreshed.latestRun; if (state && ["completed", "failed"].includes(state.status)) break; }
        await renderAssistant(context);
      } catch (error) { toast("发送失败", runtimeError(error), "orange"); }
    });
  }

  global.FarmAiRuntime = Object.freeze({ runtimeRequest, createAssistantState, providerViewModel, renderAssistant, renderSettings });
})(window);
