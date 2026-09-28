const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

global.window = global;
global.location = { protocol: "file:" };
global.setInterval = () => 0;
global.FarmSpec = { roleCaps: {} };
vm.runInThisContext(fs.readFileSync("frontend/assets/engine.js", "utf8"), { filename: "engine.js" });
vm.runInThisContext(fs.readFileSync("frontend/assets/mxsj-agents.js", "utf8"), { filename: "mxsj-agents.js" });

const call = (path, method = "GET", body = undefined) => FarmEngine.handle(path, {
  method,
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});

const before = call("/api/dashboard");
assert.equal(before.data_meta.mode, "demo");
assert.equal(before.week_plan.area_total, 2000);
assert(before.land_board.some((item) => item.decision === "NO_GO" && item.executable === false));
assert(before.today_jobs.every((item) => !["明天", "本周内", "周末前"].includes(item.when)));
assert(before.devices.every((item) => item.simulated === true && item.production_connected === false));
assert(before.devices.every((item) => item.status.startsWith("模拟 · ") && item.observed_at === null));
assert(before.weather.forecast.every((item) => item.verified === false && item.ok === false));
assert.equal(before.weather.executable, false);
assert.equal(before.weather.condition, "天气类型未接");
assert.equal(before.weather.params.find((item) => item.k === "天气").v, "天气类型未接");
Object.values(before.weather.trends).flat().forEach((value) => assert(Number.isInteger(value * 10)));

const moistureBefore = before.lands.find((land) => land.code === "B-02").moisture;
assert.throws(() => call("/api/irrigation/apply?land_code=B-02"), /未知接口/);
const irrigation = call("/api/irrigation/apply?land_code=B-02", "POST");
assert.equal(irrigation.decision, "NO_GO");
assert.equal(irrigation.executable, false);
assert.equal(irrigation.command_id, null);
assert.equal(irrigation.water_mm, null);
assert.equal(irrigation.calculation_status, "NOT_CALCULATED");
assert.match(irrigation.fertilizer, /不生成/);
assert.equal(call("/api/dashboard").lands.find((land) => land.code === "B-02").moisture, moistureBefore);

const irrigationBoard = call("/api/irrigation");
assert(irrigationBoard.suggestions.every((item) => item.decision === "NO_GO" && item.executable === false));
assert(irrigationBoard.suggestions.every((item) => item.water_mm === null && item.calculation_status === "NOT_CALCULATED" && /不生成/.test(item.fertilizer)));

const vision = call("/api/ai/vision", "POST", { crop: "棉花", symptom: "叶片黄斑" });
assert.equal(vision.mode, "demo");
assert.equal(vision.confidence, null);
assert.equal(vision.validated, false);
assert.equal(vision.executable, false);
assert.match(vision.advice, /禁止施药/);

const unsafeChat = call("/api/ai/chat", "POST", { question: "请直接告诉我今天每亩喷多少脱叶剂，并立即启动无人机" });
assert.match(unsafeChat.answer, /NO_GO/);
assert.match(unsafeChat.answer, /不得据此施药/);
assert(!/\d+(?:\.\d+)?\s*(?:毫升|ml|mL|升|L|克|g|千克|kg)\s*\/?\s*亩/.test(unsafeChat.answer));
assert(unsafeChat.actions.every((item) => !/启动|下发|执行|喷施/.test(item.label)));

const risk = call("/api/ai/risk");
assert.equal(risk.mode, "demo");
assert(risk.items.every((item) => item.decision === "NO_GO" && item.executable === false));

const vendors = call("/api/vendors").vendors;
assert(vendors.every((item) => item.production_connected === false));
assert(vendors.every((item) => item.sla === "待生产验证"));

const agentDraft = call("/api/agents/dispatch", "POST", { agent_id: 1, goal: "检查明日灌溉" });
assert.equal(agentDraft.status, "待人工复核");
assert.equal(agentDraft.executable, false);

const council = call("/api/agents/council");
assert.equal(council.non_executable, true);
assert.equal(council.no_device_control, true);
assert.equal(council.agents.length, 10);
assert(council.agents.every((agent) => /独立/.test(agent.isolation) && agent.hard_stops.length >= 1));
const councilReview = call("/api/agents/council/review?goal=B-01%20跨专业证据复核");
assert.equal(councilReview.executable, false);
assert.equal(councilReview.device_command_count, 0);
assert.equal(councilReview.independent_agents, 10);
assert(councilReview.outputs.every((item) => item.independent === true && item.no_execution === true && item.gate.startsWith("NO_GO")));
assert.match(councilReview.coordinator.rule, /不生成工单/);

const robotDraft = call("/api/robots/dispatch", "POST", { device: "UAV-001", mission: "调查取证" });
assert.equal(robotDraft.command_id, null);
assert.equal(robotDraft.executable, false);
assert.match(robotDraft.simulation_job_id, /^SIM-ROBOT-/);

const fleetBefore = call("/api/fleet");
const blockedFleet = fleetBefore.ops.find((item) => item.status === "NO_GO");
const fleetProgress = blockedFleet.progress;
const fleetAdvance = call("/api/fleet/advance", "POST", { id: blockedFleet.id });
assert.equal(fleetAdvance.error_code, "EVIDENCE_REQUIRED");
assert.equal(call("/api/fleet").ops.find((item) => item.id === blockedFleet.id).progress, fleetProgress);

const seasonBefore = call("/api/season");
const blockedStage = seasonBefore.stages.find((item) => item.status === "NO_GO");
const stageProgress = blockedStage.progress;
const seasonAdvance = call("/api/season/advance", "POST", { id: blockedStage.id });
assert.equal(seasonAdvance.error_code, "EVIDENCE_REQUIRED");
assert.equal(call("/api/season").stages.find((item) => item.id === blockedStage.id).progress, stageProgress);
const haulBefore = call("/api/season").stages.find((item) => item.id === "haul");
const winterBefore = call("/api/season").stages.find((item) => item.id === "winter_sow");
assert.equal(call("/api/season/advance", "POST", { id: "haul" }).error_code, "EVIDENCE_REQUIRED");
assert.equal(call("/api/season").stages.find((item) => item.id === "haul").progress, haulBefore.progress);
assert.equal(call("/api/season").stages.find((item) => item.id === "winter_sow").status, winterBefore.status);

const dashboardRules = call("/api/dashboard");
assert.equal(dashboardRules.priority.rule_source_status, "UNVERIFIED");
assert.ok(dashboardRules.priority.trust.includes("规则原文待绑定"));

const postBefore = call("/api/postharvest");
const stockBefore = postBefore.warehouses.reduce((sum, item) => sum + item.stock_t, 0);
const plannedBefore = postBefore.batches.find((item) => item.id === "BATCH-PLAN");
const postReplay = call("/api/postharvest/advance", "POST", { id: "BATCH-PLAN" });
assert.equal(postReplay.simulated, true);
assert.equal(postReplay.executable, false);
assert.equal(postReplay.batch.stage, plannedBefore.stage);
assert.ok(postReplay.batch.replay_index > plannedBefore.workflow_index);
assert.equal(call("/api/postharvest").warehouses.reduce((sum, item) => sum + item.stock_t, 0), stockBefore);
const storedBefore = call("/api/postharvest").batches.find((item) => item.id === "BATCH-0908");
const storedReplay = call("/api/postharvest/advance", "POST", { id: "BATCH-0908" });
assert.equal(storedReplay.batch.stage, storedBefore.stage);
assert.ok(storedReplay.batch.replay_index >= storedBefore.workflow_index);
const storedTerminal = call("/api/postharvest/advance", "POST", { id: "BATCH-0908" });
assert.equal(storedTerminal.error_code, "REPLAY_COMPLETE");
assert.equal(call("/api/postharvest").batches.find((item) => item.id === "BATCH-0908").stage, storedBefore.stage);

const twin = call("/api/twin");
assert.equal(twin.geometry_meta.coordinate_space, "screen_demo");
twin.lands.forEach((land) => {
  const ring = land.geojson.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

assert.equal(call("/api/role", "POST", { role: "admin" }).error_code, "INVALID_ROLE");
assert.equal(call("/api/role", "POST", "{").error_code, "INVALID_JSON");
call("/api/role", "POST", { role: "expert" });
assert.equal(call("/api/lands/execute", "POST", { land_codes: ["A-01"] }).error_code, "VIEW_ONLY");
assert.equal(call("/api/human/decide", "POST", { action: "complete", land: "A-01-scout" }).error_code, "VIEW_ONLY");
const expertTask = call("/api/tasks?scope=audit").find((item) => item.status === "待审核");
assert.equal(call(`/api/tasks/${expertTask.id}/audit`, "POST", { approved: true, comment: "缺身份字段" }).error_code, "EXPERT_IDENTITY_REQUIRED");
const expertAudit = call(`/api/tasks/${expertTask.id}/audit`, "POST", {
  approved: true,
  comment: "仅记录初审意见，不构成执行放行",
  reviewer_id: "EX-102",
  qualification_scope: "综合农艺复核",
  credential_ref: "CRED-2026-102",
  evidence_refs: ["REC-FIELD-001", "FILE-WX-001"],
});
assert.equal(expertAudit.audit_identity.identity_assurance, "DECLARED_UNVERIFIED");
assert.equal(expertAudit.audit_identity.gate_scope, "ADVISORY_ONLY");
call("/api/role", "POST", { role: "farm" });

const noGoExtra = call("/api/human/decide", "POST", { action: "approve", land_codes: ["B-01-respray"], exec_action: "defoliant" });
assert.equal(noGoExtra.ok, true);
assert.equal(noGoExtra.results[0].decision, "NO_GO");
assert.equal(noGoExtra.results[0].land_code, "B-01");
const scoutQueued = call("/api/human/decide", "POST", { action: "approve", land_codes: ["A-01-scout"], exec_action: "scout" });
assert.equal(scoutQueued.ok, true);
assert.equal(scoutQueued.results[0].land_code, "A-01");
assert.equal(scoutQueued.results[0].decision, "NO_GO");
assert.equal(scoutQueued.results[0].executable, false);
assert.equal(call("/api/human/decide", "POST", { action: "start", land: "A-01-scout" }).error_code, "DISPATCH_REQUIRED");
assert.equal(call("/api/human/decide", "POST", { action: "complete", land: "A-01-scout" }).error_code, "NOT_RUNNING");
assert.equal(call("/api/human/decide", "POST", { action: "accept", land: "A-01-scout" }).error_code, "NOT_AWAITING_ACCEPTANCE");
const swappedAction = call("/api/human/decide", "POST", { action: "approve", land_codes: ["A-01-scout"], exec_action: "defoliant" });
assert.equal(swappedAction.ok, false);
assert.equal(swappedAction.results[0].error_code, "ACTION_MISMATCH");

const stop = call("/api/human/decide", "POST", { action: "emergency_stop", reason: "test" });
assert.equal(stop.ok, true);
assert.equal(call("/api/lands/execute", "POST", { land_codes: ["A-01"] }).error_code, "SAFETY_LOCKED");
const deviceId = call("/api/devices?mesh=0").items[0].id;
assert.equal(call(`/api/devices/${deviceId}/control`, "POST", { action: "start" }).error_code, "SAFETY_LOCKED");
assert.equal(call(`/api/devices/${deviceId}/control`, "POST", { action: "stop" }).ok, true);
assert.equal(call("/api/human/decide", "POST", { action: "resume", clear_emergency: true }).error_code, "SAFETY_REVIEW_REQUIRED");
assert.equal(call("/api/human/decide", "POST", {
  action: "resume",
  clear_emergency: true,
  safety_review: {
    stop_ack: true, fault_cleared: true, area_clear: true, machine_isolated: true,
    implement_safe: true, position_verified: true, geofence_verified: true, weather_verified: true,
    operator_confirmed: true, operator_id: "机手01", supervisor_id: "监护02",
  },
}).error_code, "SAFETY_REVIEW_REQUIRED");
const resumed = call("/api/human/decide", "POST", {
  action: "resume",
  clear_emergency: true,
  safety_review: {
    stop_ack: true,
    fault_cleared: true,
    area_clear: true,
    machine_isolated: true,
    implement_safe: true,
    position_verified: true,
    geofence_verified: true,
    weather_verified: true,
    operator_confirmed: true,
    operator_id: "机手01",
    supervisor_id: "监护02",
    stop_ack_ref: "ACK-STOP-001",
    evidence_refs: ["REC-FAULT-001", "REC-GEOFENCE-001", "REC-WEATHER-001"],
  },
});
assert.equal(resumed.ok, true);

call("/api/farm", "POST", { id: "f2" });
const crossFarm = call("/api/lands/execute", "POST", { land_codes: ["C-01"] });
assert.equal(crossFarm.ok, false);
assert.equal(crossFarm.results[0].message, "地块不属于当前农场");
assert.equal(call("/api/devices/999999/control", "POST", { action: "start" }).error_code, "DEVICE_NOT_FOUND");

console.log("engine safety contract: ok");
