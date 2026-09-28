const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

global.window = global;
global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) });
vm.runInThisContext(fs.readFileSync("frontend/assets/ai-runtime.js", "utf8"), { filename: "ai-runtime.js" });

test("provider view model removes all secret fields", () => {
  const view = FarmAiRuntime.providerViewModel({ name: "测试", keyConfigured: true, apiKey: "must-not-leak", _api_key: "also-secret" });
  assert.equal("apiKey" in view, false);
  assert.equal("_api_key" in view, false);
  assert.equal(JSON.stringify(view).includes("must-not-leak"), false);
});

test("accepted run is reconciled before another send", async () => {
  const state = FarmAiRuntime.createAssistantState({ sessionToken: "test-token" });
  state.acceptRun({ id: "run-1", requestId: "request-1", status: "planning" });
  await state.reconcile(async () => ({ latestRun: { id: "run-1", status: "completed", answer: "完成" } }));
  assert.equal(state.currentRun.status, "completed");
  assert.equal(state.canSend(), true);
});

test("assistant view exposes explicit context and template controls", () => {
  const source = fs.readFileSync("frontend/assets/ai-runtime.js", "utf8");
  assert.match(source, /id="aiRuntimePlot"/);
  assert.match(source, /id="aiRuntimeQuestionType"/);
  assert.match(source, /data-ai-template=/);
  assert.match(source, /action-drafts/);
});
