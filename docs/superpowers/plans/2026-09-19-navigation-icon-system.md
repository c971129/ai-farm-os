# Navigation Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the left navigation's inconsistent Unicode symbols with a complete local SVG icon system shared by the farm, expert, and government views.

**Architecture:** A small `nav-icons.js` registry owns every page ID's semantic SVG markup and exposes a renderer plus a coverage predicate. `app.js` consumes that registry while preserving existing button semantics; CSS styles the SVG through the existing icon container. Node and Python contracts prevent missing page IDs, load-order regressions, and reintroduction of the Unicode map.

**Tech Stack:** Vanilla JavaScript, inline SVG, CSS custom properties, Node built-in test runner, pytest.

## Global Constraints

- Do not add an external icon package, CDN, network request, or build step.
- Do not change menu labels, route/page IDs, role selection, API calls, data mode labels, or control permissions.
- All SVGs use `viewBox="0 0 24 24"`, no fill, 1.8px stroke, rounded caps and joins.
- Normal menu states remain low contrast; active state retains the existing brand-green menu emphasis.
- Keep `aria-hidden="true"` on the icon wrapper; buttons retain their existing text label and title.
- Current repository has no Git metadata. Do not initialize Git, commit, or alter remote state.

---

### Task 1: Add a complete local SVG registry and its coverage contract

**Files:**
- Create: `frontend/assets/nav-icons.js`
- Create: `tests/js/navigation_icons.test.js`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `window.FarmSpec.navGroupsFarm`, `navGroupsExpert`, and `navGroupsGov` from `frontend/assets/spec.js`.
- Produces: `window.FarmNavIcons` with `render(id: string): string`, `has(id: string): boolean`, and `ids: readonly string[]`.
- Produces: a Node test that loads `spec.js` and `nav-icons.js` in a VM, then verifies every declared navigation ID has a dedicated icon.

- [ ] **Step 1: Write the failing registry coverage test**

Create `tests/js/navigation_icons.test.js`:

```js
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
    assert.match(svg, /data-nav-icon="[a-z]+"/);
  }
});
```

- [ ] **Step 2: Run the focused test and confirm the baseline failure**

Run:

```bash
/Users/a0/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/js/navigation_icons.test.js
```

Expected: `ENOENT` because `frontend/assets/nav-icons.js` does not exist.

- [ ] **Step 3: Implement the icon registry**

Create `frontend/assets/nav-icons.js` as a dependency-free IIFE. Define exact path fragments for these IDs: `dashboard`, `twin`, `monitoring`, `devices`, `water`, `fleet`, `season`, `history`, `council`, `ai`, `tasks`, `diagnosis`, `workbench`, `collab`, `agents`, `plants`, `robots`, `vendors`, `postharvest`, `assets`, and `arch`.

Use this shared renderer shape and provide a distinct `paths[id]` string for every listed ID:

```js
(function (global) {
  "use strict";
  const attributes = 'class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"';
  const paths = Object.freeze({
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 13.5v7"/>',
    twin: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
    monitoring: '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>',
    devices: '<rect x="6" y="4" width="12" height="16" rx="3"/><path d="M9 8h6M9 12h6M12 16h.01"/>',
    water: '<path d="M12 3s5 5.1 5 9a5 5 0 1 1-10 0c0-3.9 5-9 5-9Z"/><path d="M4 19c2.2-1.5 4.3-1.5 6.3 0M13.7 19c2.2-1.5 4.3-1.5 6.3 0"/>',
    fleet: '<path d="M3 16h18v3H3zM5 16V9h10l3 4h3v3"/><circle cx="7" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
    season: '<path d="M20 8a8 8 0 0 0-14.5-2.9L3 8m18 8a8 8 0 0 1-14.5 2.9L4 16"/><path d="M3 8h5V3m13 13h-5v5"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    council: '<circle cx="12" cy="8" r="3"/><path d="M5 20c.5-3.2 3-5 7-5s6.5 1.8 7 5M4 11H2m20 0h-2"/>',
    ai: '<path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4Z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6Z"/>',
    tasks: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 7.5M8 15h8"/>',
    diagnosis: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/>',
    workbench: '<path d="M4 5h16v14H4zM4 10h16M9 5v14"/>',
    collab: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="m7.7 7.3 2.9 8.1m5.7-8.1-2.9 8.1M8 6h8"/>',
    agents: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 7 3 3m7-3-3 3m-4 4-3 3m7-3 3 3"/>',
    plants: '<path d="M12 21V11M12 12C7 12 5 8 5 4c4 0 7 2 7 8m0 0c5 0 7-4 7-8-4 0-7 2-7 8"/>',
    robots: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M8 13h.01M16 13h.01M8 17h8"/>',
    vendors: '<path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"/>',
    postharvest: '<path d="M4 9 12 4l8 5v11H4Z"/><path d="M9 20v-6h6v6M4 9h16"/>',
    assets: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>',
    arch: '<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="6" y="15" width="5" height="5" rx="1"/><rect x="13" y="15" width="5" height="5" rx="1"/><path d="M12 9v3m-3.5 0h7"/>',
  });
  const fallback = '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>';
  global.FarmNavIcons = Object.freeze({
    ids: Object.freeze(Object.keys(paths)),
    has: (id) => Object.hasOwn(paths, id),
    render: (id) => `<svg ${attributes} data-nav-icon="${paths[id] ? id : "fallback"}" aria-hidden="true">${paths[id] || fallback}</svg>`,
  });
})(window);
```

- [ ] **Step 4: Load the registry before `app.js`**

In `frontend/index.html`, add exactly one asset tag after `spec.js` and before `app.js`:

```html
<script src="assets/nav-icons.js?v=197"></script>
```

Set every versioned `assets/` reference in the document to the same `v=197` value because `test_index_references_existing_versioned_assets` requires one shared version.

- [ ] **Step 5: Run the focused registry contract**

Run:

```bash
/Users/a0/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/js/navigation_icons.test.js
```

Expected: one passing subtest, with no missing page IDs.

- [ ] **Step 6: Record the Git boundary**

Do not commit. `git -C /Users/a0/Downloads/ny/ai-farm-os-final rev-parse --is-inside-work-tree` returns a non-repository error, and the user did not authorize initializing Git.

### Task 2: Replace the Unicode renderer and refine the icon states

**Files:**
- Modify: `frontend/assets/app.js:194-245`
- Modify: `frontend/assets/styles.css` in the final sidebar override block near the existing `.mod-head` and `.mod-ico` rules
- Modify: `tests/test_frontend_contract.py`

**Interfaces:**
- Consumes: `window.FarmNavIcons.render(id)` and `window.FarmNavIcons.has(id)` from Task 1.
- Produces: buttons whose `.mod-ico` wrapper contains an inline `.nav-icon-svg`, with unchanged `data-id`, title, text label, click handler, and `aria-current` behavior.
- Produces: a Python static contract ensuring the page loads the registry before `app.js` and the legacy Unicode map is absent.

- [ ] **Step 1: Write the failing frontend integration contract**

Append this test to `tests/test_frontend_contract.py`:

```python
def test_navigation_uses_local_svg_icons_for_every_role():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app = (FRONTEND / "assets" / "app.js").read_text(encoding="utf-8")
    icons = (FRONTEND / "assets" / "nav-icons.js").read_text(encoding="utf-8")
    assert 'src="assets/nav-icons.js?v=197"' in html
    assert html.index('assets/nav-icons.js?v=197') < html.index('assets/app.js?v=197')
    assert "FarmNavIcons.render(id)" in app
    assert "const navIco =" not in app
    assert "nav-icon-svg" in icons
    for page_id in ["dashboard", "twin", "monitoring", "devices", "water", "fleet", "season", "history", "council", "ai", "tasks", "diagnosis", "workbench", "collab", "agents", "plants", "robots", "vendors", "postharvest", "assets", "arch"]:
        assert f"{page_id}:" in icons
```

- [ ] **Step 2: Run the focused integration contract and confirm the baseline failure**

Run:

```bash
/Users/a0/Downloads/ny/ai-farm-os-final/.venv/bin/python -m pytest tests/test_frontend_contract.py::test_navigation_uses_local_svg_icons_for_every_role -q
```

Expected: FAIL because `nav-icons.js` and the new loader are absent.

- [ ] **Step 3: Replace the menu's Unicode map**

In `rebuildNav`, delete the complete `const navIco = { ... }` block. Replace the current `btn.innerHTML` assignment with:

```js
const icon = window.FarmNavIcons && typeof window.FarmNavIcons.render === "function"
  ? window.FarmNavIcons.render(id)
  : '<svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h16v16H4z"/></svg>';
btn.innerHTML = `<span class="mod-ico" aria-hidden="true">${icon}</span><span class="mod-name">${esc(label)}</span>`;
```

Keep the current button title, click handler, selected-state calculation, `data-id`, and `aria-current` logic unchanged.

- [ ] **Step 4: Add final visual rules for SVG icons**

Append these scoped declarations after the last sidebar desktop override so they win over earlier `.mod-ico` rules:

```css
#sidebar .mod-ico {
  display: inline-grid;
  place-items: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  color: color-mix(in srgb, var(--blue-dark) 82%, var(--text2));
  background: color-mix(in srgb, var(--blue) 10%, var(--card));
  transition: color .16s ease, background .16s ease, transform .16s ease;
}
#sidebar .nav-icon-svg {
  display: block;
  width: 18px;
  height: 18px;
  overflow: visible;
}
#sidebar .mod-head:hover .mod-ico {
  color: var(--blue-dark);
  background: color-mix(in srgb, var(--blue) 16%, var(--card));
  transform: translateY(-1px);
}
#sidebar .mod-head.active .mod-ico {
  color: var(--blue-dark);
  background: color-mix(in srgb, var(--blue) 23%, var(--card));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--blue) 18%, transparent);
}
#layout.is-side-collapsed #sidebar .mod-ico { flex-basis: 28px; }
@media (min-width: 761px) and (max-width: 1100px) {
  #sidebar .mod-ico,
  #layout.is-side-collapsed #sidebar .mod-ico { flex-basis: 21px; }
  #sidebar .nav-icon-svg { width: 14px; height: 14px; }
}
@media (max-width: 760px) {
  #sidebar .mod-ico,
  #layout.is-side-collapsed #sidebar .mod-ico { flex-basis: 21px; }
  #sidebar .nav-icon-svg { width: 14px; height: 14px; }
}
```

- [ ] **Step 5: Run focused contracts**

Run:

```bash
/Users/a0/Downloads/ny/ai-farm-os-final/.venv/bin/python -m pytest tests/test_frontend_contract.py::test_navigation_uses_local_svg_icons_for_every_role -q
/Users/a0/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check frontend/assets/nav-icons.js
/Users/a0/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check frontend/assets/app.js
```

Expected: all commands exit `0`.

- [ ] **Step 6: Record the Git boundary**

Do not commit for the same non-repository reason recorded in Task 1.

### Task 3: Run regression checks and verify all three roles in the live page

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-navigation-icon-system-design.md` only if verification reveals a mismatch between the accepted design and actual implementation.
- No production code changes expected.

**Interfaces:**
- Consumes: the registry and integration from Tasks 1 and 2.
- Produces: focused automated evidence and three-role browser evidence.

- [ ] **Step 1: Run the relevant automated suite**

Run:

```bash
/Users/a0/Downloads/ny/ai-farm-os-final/.venv/bin/python -m pytest tests/test_frontend_contract.py -q
/Users/a0/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/js/navigation_icons.test.js tests/js/telemetry.test.js
```

Expected: all selected tests pass. If an existing unrelated assertion fails, report its exact name and output separately; do not weaken it to pass this icon change.

- [ ] **Step 2: Verify the live asset delivery**

Open `http://127.0.0.1:8080/` with a hard refresh. Confirm the `nav-icons.js?v=197` response is JavaScript and the rendered buttons contain `.nav-icon-svg` nodes.

- [ ] **Step 3: Verify role coverage and selection state**

For each value in the role selector (`farm`, `expert`, `gov`):

1. Select the role and wait for navigation rebuild.
2. Confirm every visible `.mod-head` has one `.nav-icon-svg`.
3. Click one non-dashboard item and confirm its selected icon receives the active container treatment.
4. Return to the dashboard and confirm the label, route, and page content remain correct.

- [ ] **Step 4: Verify responsive and theme states**

At desktop, 1024px tablet, and 390px mobile widths, confirm icons remain centered without clipping. Toggle the existing theme control and confirm normal, hover, and active icons remain readable in dark mode.

- [ ] **Step 5: Record the Git boundary**

Do not commit because this directory has no Git repository. Report the modified file list and validation output to the user.
