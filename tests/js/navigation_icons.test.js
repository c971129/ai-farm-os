const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

global.window = global;
vm.runInThisContext(fs.readFileSync("frontend/assets/spec.js", "utf8"), { filename: "spec.js" });
vm.runInThisContext(fs.readFileSync("frontend/assets/nav-icons.js", "utf8"), { filename: "nav-icons.js" });

test("every role navigation item has a dedicated SVG icon", () => {
  const groups = [
    FarmSpec.navGroupsFarm,
    FarmSpec.navGroupsExpert,
    FarmSpec.navGroupsGov,
  ];
  const ids = [...new Set(groups.flatMap((role) => role.flatMap((group) => group.items.map(([id]) => id))))];
  assert.deepEqual(ids.filter((id) => !FarmNavIcons.has(id)), []);
  for (const id of ids) {
    const svg = FarmNavIcons.render(id);
    assert.match(svg, /^<svg class="nav-icon-svg"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /data-nav-icon="[a-z_]+"/);
  }
});

test("AI runtime pages follow the approved role distribution", () => {
  const idsFor = (groups) => groups.flatMap((group) => group.items.map(([id]) => id));
  const farm = idsFor(FarmSpec.navGroupsFarm);
  const expert = idsFor(FarmSpec.navGroupsExpert);
  const gov = idsFor(FarmSpec.navGroupsGov);

  assert.ok(farm.includes("assistant"));
  assert.ok(expert.includes("assistant"));
  assert.ok(expert.includes("ai_settings"));
  assert.ok(!gov.includes("assistant"));
  assert.ok(!gov.includes("ai_settings"));
  assert.ok(FarmNavIcons.has("assistant"));
  assert.ok(FarmNavIcons.has("ai_settings"));
});
