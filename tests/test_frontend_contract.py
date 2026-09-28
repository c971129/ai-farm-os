from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_index_references_existing_versioned_assets():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r'(?:src|href)="(assets/[^"?]+)\?v=(\d+)"', html)
    assert refs
    versions = {version for _, version in refs}
    assert len(versions) == 1
    for relative, _ in refs:
        assert (FRONTEND / relative).is_file(), relative


def test_ai_runtime_workbench_contract_exposes_context_templates_and_drafts():
    runtime = (FRONTEND / "assets" / "ai-runtime.js").read_text(encoding="utf-8")
    assert 'id="aiRuntimePlot"' in runtime
    assert 'id="aiRuntimeQuestionType"' in runtime
    assert "data-ai-template=" in runtime
    assert "/action-drafts" in runtime


def test_ai_runtime_styles_define_context_drafts_and_mobile_composer():
    styles = (FRONTEND / "assets" / "ai-runtime.css").read_text(encoding="utf-8")
    assert ".ai-runtime-context" in styles
    assert ".ai-runtime-action-drafts" in styles
    assert "position: sticky" in styles


def test_ai_runtime_workbench_is_loaded_and_routable_for_all_roles():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    spec = (FRONTEND / "assets" / "spec.js").read_text(encoding="utf-8")

    assert 'assets/ai-runtime.css?v=' in html
    assert 'assets/ai-runtime.js?v=' in html
    assert 'page === "ai_assistant"' in app
    assert "FarmAiRuntime.renderAssistant" in app
    assert 'page === "ai_settings"' in app
    assert "FarmAiRuntime.renderSettings" in app
    assert spec.count('["ai_assistant", "AI智能管家"]') == 3


def test_primary_navigation_and_global_controls_are_semantic():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert '<button id="g-search"' in html
    assert 'aria-label="主功能导航"' in html
    assert '<h1 id="pageTitle"' in html
    assert 'role="status" aria-live="polite"' in html
    assert 'document.createElement("button")' in app
    assert 'aria-current", "page"' in app
    assert 'class="skip-link" href="#main"' in html
    assert 'id="theme-toggle" title="切换浅色/深色主题" aria-label=' in html
    assert 'id="notif-btn" title="通知中心" aria-label="通知中心"' in html
    assert 'id="notif-panel" role="dialog" aria-label="通知中心" aria-hidden="true" tabindex="-1"' in html
    assert "closeNotificationPanel(true)" in app


def test_all_rendered_form_controls_have_accessible_names():
    sources = [
        (FRONTEND / "index.html").read_text(encoding="utf-8"),
        (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8"),
    ]
    controls = []
    for source in sources:
        controls.extend(re.findall(r"<(?:input|select|textarea)\b[^>]*>", source, flags=re.IGNORECASE))
    assert controls
    unnamed = [tag for tag in controls if "aria-label=" not in tag and "aria-labelledby=" not in tag]
    assert unnamed == []


def test_wall_dialog_traps_and_restores_focus():
    wall = (FRONTEND / "assets" / "wall.js").read_text(encoding="utf-8")
    assert "setBackgroundInert(true)" in wall
    assert "setBackgroundInert(false)" in wall
    assert "captureWallFocus(root)" in wall
    assert 'if (e.key === "Tab" && open)' in wall
    assert "opener.focus" in wall


def test_role_wall_copy_and_farm_land_cards_fail_closed():
    wall = (FRONTEND / "assets" / "wall.js").read_text(encoding="utf-8")
    assert 'root.setAttribute("aria-label", wallTitle)' in wall
    assert 'root.setAttribute("aria-label", "态势大屏")' in wall
    assert '水量未计算' in wall
    assert '${pl.water_mm}mm' not in wall
    assert 'class="wall-land-thumb"' in wall
    assert '田间实景' in wall
    assert 'Number(l.moisture) || 0' in wall


def test_wall_map_and_camera_viewer_are_registered_and_operable():
    wall = (FRONTEND / "assets" / "wall.js").read_text(encoding="utf-8")
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    assert 'const WALL_MAP_IMAGE = "assets/img/farm-real/farm-orthophoto.jpg"' in wall
    assert 'const WALL_PLOT_GEOMETRY = {' in wall
    assert 'const WALL_INFRA_POINTS = {' in wall
    assert 'const registeredItemPoint = (item, landCode)' in wall
    assert 'registeredItemPoint(d, d.location)' in wall
    assert 'registeredItemPoint(s, s.location)' in wall
    assert 'registeredItemPoint(pl, pl.land_code)' in wall
    assert 'class="wall-dev-lab" aria-hidden="true"' in wall
    assert '悬停或聚焦点位查看编号' in wall
    assert 'WALL_PLOT_GEOMETRY[el.dataset.devLand]' in wall
    assert 'pendingFocusMarker = { attr: "data-dev", value: el.dataset.dev }' in wall
    assert 'pendingFocusMarker = { attr: "data-plant", value: el.dataset.plant }' in wall
    assert 'typeof el.click === "function"' in wall
    assert 'new MouseEvent("click", { bubbles: true, cancelable: true, view: global })' in wall
    assert 'viewBox="0 0 1536 1024"' in wall
    assert 'class="wall-map-photo"' in wall
    assert 'vector-effect="non-scaling-stroke"' in wall
    assert 'data-cam-img=' in wall
    assert 'function openCameraViewer(trigger)' in wall
    assert 'role="dialog" aria-modal="true"' in wall
    assert 'id="wall-camera-play" aria-pressed="true"' in wall
    assert 'closeCameraViewer(true)' in wall
    assert 'pendingFocusMarker = { attr: "data-code", value: land }' in wall
    assert 'if (e.key === "Escape" && cameraViewerOpen)' in wall
    assert '.wall-camera-viewer' in styles
    assert '@keyframes wallCameraMotion' in styles


def test_home_queues_use_compact_progressive_disclosure():
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert '(desk.audit_queue || []).slice(0, 6)' in app
    assert '(desk.high_tasks || []).slice(0, 6)' in app
    assert 'id="weekShowAll" aria-expanded="false"' in app
    assert '优先显示 ${Math.min(HOME_QUEUE_LIMIT, defaultTodoItems.length)} / 共 ${workTotal} 项' in app
    assert 'showAll.setAttribute("aria-expanded", queueExpanded ? "true" : "false")' in app
    assert '<span class="sr-only">排序</span>' not in app
    assert 'id="weekSort" aria-label="任务排序方式"' in app


def test_homepage_prioritizes_tasks_before_context_panels():
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    assert "v121 · 首页任务优先" in styles
    assert ".dash-cockpit > .dc-tasks { order: 1; }" in styles
    assert ".dash-cockpit > .dc-mid { order: 2; }" in styles
    assert "min-height: 74px" in styles
    assert "v127 · 首页任务表可点击尺寸校准" in styles
    assert re.search(r"\.dash-cockpit \.wq-h-check input,[\s\S]{0,100}width:\s*24px", styles)


def test_home_map_uses_one_registered_image_coordinate_space():
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    assert 'viewBox="0 0 1536 1024"' in app
    assert 'class="dc-map-photo" href="assets/img/farm-real/farm-orthophoto.jpg"' in app
    assert 'const dashboardPlotGeometry = {' in app
    for code in ["A-01", "A-02", "B-01", "B-02", "C-01", "C-02"]:
        assert f'"{code}": {{ points:' in app
    assert 'role="button" tabindex="0"' in app
    assert 'data-search=' in app
    assert 'data-map-mode="field" aria-pressed="true">地块地图' in app
    assert '.dc-map-stage.is-sat .dc-map-photo' in styles
    assert 'url("img/farm-real/farm-orthophoto.jpg") center / cover' not in styles.split("/* v115", 1)[1]


def test_form_pages_are_not_destroyed_by_interval_rerender():
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert "timer = setInterval(() => render" not in app
    assert 'id="refresh-page"' in (FRONTEND / "index.html").read_text(encoding="utf-8")


def test_fail_closed_and_output_encoding_guards_are_present():
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert 'if (backendAvailable) throw e' in app
    assert '后端接口不可用，已阻止本地模拟写入' in app
    assert 'esc(String(i.value ?? "—"))' in app
    assert '["=", "+", "-", "@", "\\t", "\\r"]' in app
    assert 'value="${esc(x.code)}"' in app


def test_csp_compatible_ui_has_no_inline_script_handlers():
    sources = [
        (FRONTEND / "index.html").read_text(encoding="utf-8"),
        (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8"),
    ]
    assert re.findall(r"\son(?:click|change|input|submit|keydown|keyup|load|error)\s*=", "\n".join(sources), re.I) == []
    assert 'document.querySelector("#cmd-panel .cmd-box")?.addEventListener("click"' in sources[1]
    assert re.findall(r"\b(?:prompt|confirm)\s*\(", sources[1]) == []
    assert "requestActionConfirm" in sources[1]


def test_static_server_has_no_wildcard_cors_or_prefix_only_path_check():
    script = (ROOT / "start-web.ps1").read_text(encoding="utf-8")
    assert "Access-Control-Allow-Origin: *" not in script
    assert "StartsWith($webPrefix, [StringComparison]::OrdinalIgnoreCase)" in script
    assert "$maxBodyBytes = 16384" in script
    assert "AI_FARM_PORT" in script
    assert "UNSUPPORTED_TRANSFER_ENCODING" in script
    assert "AMBIGUOUS_CONTENT_LENGTH" in script
    assert "INVALID_REQUEST_LINE" in script
    assert "X-Frame-Options: DENY" in script
    assert '400 { "Bad Request" }' in script


def test_demo_truth_markers_and_legacy_safety_copy_are_present():
    engine = (FRONTEND / "assets" / "engine.js").read_text(encoding="utf-8")
    agents = (FRONTEND / "assets" / "mxsj-agents.js").read_text(encoding="utf-8")
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    legacy = (FRONTEND / "assets" / "media" / "farm-demo.html").read_text(encoding="utf-8")

    assert "production_connected = false" in engine
    assert 'vendor.sla = "待生产验证"' not in engine  # source records are safe without runtime repair
    assert "不生成肥料或剂量" in engine
    assert "EVIDENCE_REQUIRED" in engine
    assert "未建立生产连接" in app
    assert "独立场景页" in legacy
    assert "批量下发" not in legacy

    forbidden = [
        "建议抢晴喷施脱叶剂后安排机采",
        "机收编队启动，首批转运进仓",
        'comment: "同意下发"',
        "建议无人机复飞确认病斑分布，局部施药",
        "补施钾肥，控制氮肥",
    ]
    combined = "\n".join((engine, agents, app))
    assert [phrase for phrase in forbidden if phrase in combined] == []


def test_independent_expert_council_has_a_safe_route_and_visible_boundaries():
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    agents = (FRONTEND / "assets" / "mxsj-agents.js").read_text(encoding="utf-8")
    spec = (FRONTEND / "assets" / "spec.js").read_text(encoding="utf-8")
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    wall = (FRONTEND / "assets" / "wall.js").read_text(encoding="utf-8")
    assert 'page === "council"' in app
    assert "function renderCouncil()" in app
    assert '"/api/agents/council/review"' in agents
    assert "INDEPENDENT_EXPERT_AGENTS" in agents
    assert "no_device_control: true" in agents
    assert spec.count('["council",') == 3
    assert "v157 · 独立专家 Agent 委员会" in styles
    assert 'api("/api/agents/council")' in wall
    assert "NO_GO 不可覆盖" in wall


def test_150_percent_comfort_density_uses_reflow_not_root_zoom():
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    assert "v112 · 150% 舒适密度" in styles
    assert re.search(r"body\s*\{\s*zoom:\s*1;\s*font-size:\s*17px", styles)
    assert re.search(r"#topbar\s*\{[^}]*height:\s*72px", styles)
    assert re.search(r"\.page-title h1\s*\{[^}]*font-size:\s*34px", styles)
    assert re.search(r"\.wo-task-hd\s*\{[^}]*--task-control-h:\s*44px", styles)
    assert "grid-template-columns: repeat(4, minmax(0, 1fr))" in styles
    assert "zoom: 1.5" not in styles


def test_mobile_dashboard_keeps_tasks_near_the_decision_summary():
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    assert "v129 · 手机首屏任务优先" in styles
    assert re.search(r"\.dash-cockpit > \.command-strip\s*\{\s*order:\s*-3", styles)
    assert re.search(r"\.dash-cockpit > \.ops-trust-bar\s*\{\s*order:\s*-2", styles)
    assert re.search(r"\.dash-cockpit > \.dc-tasks\s*\{\s*order:\s*-1", styles)
    assert "scroll-snap-type: inline proximity" in styles


def test_pc_homepage_uses_compact_decision_and_progressive_task_actions():
    styles = (FRONTEND / "assets" / "styles.css").read_text(encoding="utf-8")
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert "v131 · PC 农事首页重构" in styles
    assert 'class="dc-overview"' in app
    assert 'class="wo-task-title"' in app
    assert 'class="wq-more"' in app
    assert 'class="wq-more-list"' in app
    assert 'name="task-more"' in app
    assert "先核验，再下地" in app
    assert "五日天气占位" not in app
    assert 'event.key !== "Escape" || !menu.open' in app
    assert "height: clamp(300px, 25vw, 420px) !important" in styles
    assert "farmLands.length || 12" not in app
    assert '<aside class="wo-toast"' not in app
    assert app.count("${opsTrustBar({") == 2
    assert 'aria-labelledby="woSideTitle"' in app
    assert 'id="conflictOpenSide" aria-haspopup="dialog" aria-controls="woSide"' in app
    assert 'id="prioSuggestOpen" aria-haspopup="dialog" aria-controls="prioPanel"' in app
    assert 'class="btn ai-primary prio-focus"' in app
    assert "采纳并入回放队列" not in app
    assert 'class="wo-task-count"' in app
    assert 'class="wo-tool-label" aria-hidden="true">排序</span>' in app
    assert 'aria-label="任务排序方式"' in app
    assert "今日研判 · 冲突优先" in app
    assert "场景天气 ${wx.air_temp" in app
    assert "作业窗口待证据" in app
    assert "五日仿真趋势" in app
    assert "设备资源" in app
    assert "本周任务分布" in app
    assert "冲突研判 · PRIORITY" not in app
    assert "今日研判 · TODAY" not in app
    assert 'id="weekStatusTabs" role="group" aria-label="按状态筛选任务"' in app
    assert 'class="dc-map-tabs" role="group" aria-label="切换地图底图"' in app
    assert 'aria-pressed="${c.key === "todo" ? "true" : "false"}"' in app
    assert 'el.setAttribute("aria-pressed", on ? "true" : "false")' in app
    assert "hasRenderedInitialRoute" in app
    assert "CRS/来源/日期待接入 · 禁用于导航" in app
    assert 'homeBoard.insertBefore(taskSection, contextSection)' in app
    assert 'id="weekResetFilters"' in app
    assert 'role="status" aria-live="polite"' in app
    assert 'scrollIntoView({ behavior: "smooth"' not in app
    assert re.search(r"\.dash-cockpit \.wq-proof-detail summary\s*\{[^}]*min-height:\s*24px", styles)
    assert 'aria-controls="prioPanel" aria-expanded="false"' in app
    assert 'aria-labelledby="prioPanelTitle"' in app
    assert "closePrioPanel" in app
    assert "prioReturnFocus" in app
    assert "const suggestionLand" in app
    assert re.search(r"\.dash-cockpit \.wo-panel\s*\{[^}]*position:\s*fixed", styles)
    assert re.search(r"\.wo-safety \.btn\.danger-solid\s*\{[^}]*background:\s*#b42318\s*!important", styles)
    assert "width: min(100%, 1480px)" not in styles
    assert re.search(r"\.page-title\.is-farm,\s*\.dash-cockpit\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none", styles)
    assert "已筛地块 ${landFocus.join" in app
    assert "场长/机务联合核验 · 未确认前保持 NO_GO" in app
    assert "项冲突作业 · 场长/机务联合核验" not in app
    assert re.search(r"\.wo-focus-chip\s*\{[^}]*align-self:\s*flex-start", styles)
    assert "[hidden] { display: none !important; }" in styles
    assert 'chip.title = "清除地块筛选"' in app
    assert 'id="dcMapSearchStatus" aria-live="polite"' in app
    assert 'if (!q) return;' in app
    assert 'toast("未找到匹配田块"' in app
    assert ".dc-map-search-status.is-empty" in styles
    assert styles.count("--text3: #647866") >= 2
    assert styles.count("--text3: #8d9bb0") >= 2
    assert ':root[data-theme="dark"] .wq-urgency.u-hot' in styles
    task_header = re.search(r"\.dash-cockpit \.wo-task-hd \{([^}]*)\}", styles)
    table_header = re.search(r"\.dash-cockpit \.wq-table-head \{([^}]*)\}", styles)
    assert task_header and "position: static" in task_header.group(1)
    assert table_header and "position: static" in table_header.group(1)
    assert "minmax(186px, 1.4fr)" in styles
    assert re.search(r"\.dash-cockpit \.wq-row \.wq-ops\s*\{[^}]*min-width:\s*0", styles)
    assert re.search(r"\.dash-cockpit \.dc-secondary\s*\{[^}]*display:\s*grid", styles)
    assert re.search(r"grid-template-columns:\s*minmax\(300px, \.72fr\)\s+minmax\(0, 1\.28fr\)", styles)


def test_active_ui_uses_realistic_local_media_and_avoids_banned_placeholder_words():
    active_paths = [
        FRONTEND / "index.html",
        FRONTEND / "assets" / "app.js",
        FRONTEND / "assets" / "engine.js",
        FRONTEND / "assets" / "equipment-catalog.js",
        FRONTEND / "assets" / "wall.js",
        FRONTEND / "assets" / "styles.css",
    ]
    combined = "\n".join(path.read_text(encoding="utf-8") for path in active_paths)
    assert re.findall(r"演示|样例|示例|示范", combined) == []
    assert "img/scenes/" not in combined
    assert "farm-cockpit-v2-mock" not in combined
    assert "farm-twin-v2-mock" not in combined
    refs = set(re.findall(r"(?:assets/)?img/farm-real/[A-Za-z0-9._-]+", combined))
    assert len(refs) >= 10
    for ref in refs:
        asset = FRONTEND / "assets" / ref.removeprefix("assets/")
        assert asset.is_file(), ref
        assert asset.stat().st_size > 100_000, ref


def test_expert_and_resume_actions_are_protected_by_evidence_dialogs():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert '<dialog id="evidence-dialog"' in html
    for marker in [
        "requestEvidenceGate",
        "requestExpertAudit",
        "requestSafetyReview",
        "credential_ref",
        "evidence_refs",
        "stop_ack_ref",
        "operator_id",
        "supervisor_id",
    ]:
        assert marker in app
    assert "机手与独立监护人不能是同一人" in app
    assert "签核身份当前仅作声明记录" in app


def test_simulation_workflow_labels_do_not_claim_field_execution_or_acceptance():
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    assert 'if (rs === "running") return "流程回放"' in app
    assert 'if (rs === "accepting") return "回放待归档"' in app
    assert 'if (rs === "done") return "回放已归档"' in app
    assert 'done: "模拟已验收"' not in app
