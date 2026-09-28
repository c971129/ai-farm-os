/**
 * 界面术语表：内部状态值仍用英文常量参与判断，只在输出给用户时换成中文。
 * 例如 status === "NO_GO" 的比较照旧生效，屏幕上显示“不放行”。
 * ACK-xxxx 这类编号不替换（回执单号需要原样录入与核对）。
 */
const TERM_MAP = [
  [/\bNO_GO\b/g, "不放行"],
  [/\bGO_APPROVED\b/g, "已批准放行"],
  [/(设备|停机|作业)\s*ACK(?!-)\b/g, "$1回执"],
  [/\bACK(?!-)\b/g, "设备回执"],
  [/传感器\s*QC\b/g, "传感器质检"],
  [/\bQC\b/g, "质检"],
  [/\bSLA\b/g, "服务承诺"],
  [/\bETA\b/g, "预计完成"],
  /* 智能体对外用中文职能名；内部 name 仍是英文，engine 的 includes("Robot") 等查找不受影响。
     只匹配完整名字，避免误伤 Yield-InCommand 这类厂家适配器型号。 */
  [/\bFarm Master(\s+Agent)?\b/g, "总调度"],
  [/\bCrop Expert(\s+Agent)?\b/g, "作物专家"],
  [/\bIrrigation Agent\b/g, "灌溉专家"],
  [/\bVision Agent\b/g, "影像识别"],
  [/\bRobot Agent\b/g, "设备调度"],
  [/\bYield Agent\b/g, "产量预测"],
  [/\bFinance Agent\b/g, "收益测算"],
];
/** 智能体内部 key → 中文名；界面不直接显示 master / crop-vigor 这类标识 */
function agentKeyName(key) {
  const k = String(key || "").trim();
  const catalog = (window.FarmMxsj && window.FarmMxsj.EXPERT_CATALOG) || [];
  const hit = catalog.find((a) => a.key === k);
  return hit ? hit.name : k;
}
/** 智能体英文名 → 界面短名，供列表与协同链路使用 */
const AGENT_SHORT_NAME = {
  "Farm Master Agent": "总调度",
  "Crop Expert Agent": "作物专家",
  "Irrigation Agent": "灌溉专家",
  "Vision Agent": "影像识别",
  "Robot Agent": "设备调度",
  "Yield Agent": "产量预测",
  "Finance Agent": "收益测算",
};
function termText(s) {
  let out = String(s ?? "");
  for (const [re, to] of TERM_MAP) out = out.replace(re, to);
  return out;
}
window.termText = termText;

const pages = (window.FarmSpec && FarmSpec.nav) || [
  ["dashboard", "本周农事"],
  ["twin", "看田地图"],
  ["tasks", "农事待办"],
  ["history", "历年收成"],
];

const nav = document.getElementById("nav");
const view = document.getElementById("view");
let current = "dashboard";
let timer = null;
let twinLayer = "moisture";
let twinFocus = "";
let deviceFocus = "";
let vendorFocus = "";
/* 设备台账分页：20 条一口气铺开，卡片高 2969px，右边传感网格只有 568px，差 2401px */
let devicePage = 0;
const DEV_PAGE_SIZE = 8;
/* 监管驾驶舱「高优任务监察」分页：6 条平铺 + 监管入口一起塞在一张卡里，
   右卡 1169px、左边合规核验板只有 510px，差 659px。 */
let govTaskPage = 0;
const GOV_TASK_PAGE_SIZE = 3;
/* 任务台「农事任务列表」分页：19 条一次铺到底，表格 1236px、整卡 1346px（专家角色 2090px，
   因为多两个审核按钮），右边的工作台卡才 332px。每页 8 条和设备台账保持一致。 */
let taskPage = 0;
let taskFocusSeen = null;
const TASK_PAGE_SIZE = 8;
let plantFocus = "";
let plantView = "both"; // canopy | root | both
let aiDraftQuestion = "";
let laterReminders = [];
try {
  laterReminders = JSON.parse(localStorage.getItem("agrios-later") || "[]");
  if (!Array.isArray(laterReminders)) laterReminders = [];
} catch (e) {
  laterReminders = [];
}
let currentRole = "farm";
try {
  const savedRole = localStorage.getItem("agrios-role");
  if (savedRole === "farm" || savedRole === "expert" || savedRole === "gov") currentRole = savedRole;
} catch (e) {}
window.currentRole = currentRole;

function wallLabelForRole(role) {
  if (role === "expert") return "专家监控屏";
  if (role === "gov") return "监管监控屏";
  return "田间监控屏";
}
function wallToastForRole(role) {
  if (role === "expert") return ["专家研判监控屏", "待审 · Agent · 冲突 · 处方态势", "green"];
  if (role === "gov") return ["监管合规监控屏", "目标核验 · 高优 · 模拟状态 · 态势监控", "green"];
  return ["田间态势监控屏", "天气 · 清单状态 · 看田态势", "green"];
}
let renderToken = 0;
let wallMode = false;
try { wallMode = localStorage.getItem("agrios-wall") === "1"; } catch (e) {}
let twinScene = "satellite"; // vector | satellite | field
let twinMap = null;
/* 看田地图两侧栏可收起，只由用户手动控制（自动按视口收起的逻辑已随两行版式去掉）。 */
let twinRailLeft = true;
let twinRailRight = true;

function destroyTwinMap() {
  if (twinMap) {
    try { twinMap.remove(); } catch (_) { /* ignore */ }
    twinMap = null;
  }
}

/** 看田地图：Leaflet + Esri / 矢量底图，地块轮廓来自 FarmGeo.PLOT_LL */
function mountTwinLeaflet(ctx) {
  const host = document.getElementById("twinLeafletMap");
  if (!host || typeof L === "undefined") return;

  destroyTwinMap();

  const geo = window.FarmGeo || {};
  const MAP_CENTER = geo.MAP_CENTER || [45.43288, 84.93065];
  const IMAGERY_URL =
    geo.IMAGERY_URL ||
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const VECTOR_URL =
    geo.VECTOR_URL || "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const PLOT_LL = geo.PLOT_LL || {};
  const ADDRESS =
    geo.ADDRESS || "新疆克拉玛依市克拉玛依区 · 白云一路与蓝天二路交叉口";
  const isFleetUnit =
    typeof geo.isFleetUnit === "function"
      ? geo.isFleetUnit
      : (device) =>
          !!device &&
          !device.mesh &&
          String(device.asset_state || "") !== "planned" &&
          ["tractor", "drone", "sprayer", "robot", "yield", "harvester", "seeder", "transport"].includes(
            String(device.device_type || "")
          );
  const slotLatLng =
    typeof geo.slotLatLng === "function"
      ? geo.slotLatLng
      : (item, landCode, slotIndex, slotTotal) => {
          const plot = PLOT_LL[landCode];
          if (!plot) {
            const seed = String((item && item.code) || "x")
              .split("")
              .reduce((s, c) => s + c.charCodeAt(0), 0);
            return [
              MAP_CENTER[0] + ((seed % 5) - 2) * 0.0005,
              MAP_CENTER[1] + ((((seed / 5) | 0) % 5) - 2) * 0.0006,
            ];
          }
          const n = Math.max(1, slotTotal || 1);
          const i = Math.max(0, slotIndex || 0);
          const ang = -Math.PI / 2 + (i / n) * Math.PI * 1.6 + 0.2;
          const radius = 0.00055 + Math.min(0.00045, (n - 1) * 0.00012);
          const cosLat = Math.cos((plot.center[0] * Math.PI) / 180) || 0.7;
          return [
            plot.center[0] + Math.cos(ang) * radius,
            plot.center[1] + (Math.sin(ang) * radius) / cosLat,
          ];
        };

  const {
    lands = [],
    devices = [],
    sensors = [],
    plants = [],
    layer = "moisture",
    scene = "satellite",
    focus = "",
    onPickLand,
    onPickDev,
    onPickPlant,
  } = ctx || {};

  const map = L.map(host, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 11,
    maxZoom: 18,
  }).setView(MAP_CENTER, 14);
  twinMap = map;

  const tileUrl = scene === "vector" ? VECTOR_URL : IMAGERY_URL;
  L.tileLayer(tileUrl, { maxZoom: 19, crossOrigin: true }).addTo(map);

  const stage = host.closest(".twin") || host.parentElement;
  if (stage && !stage.querySelector(".twin-map-address")) {
    const addr = document.createElement("div");
    addr.className = "twin-map-address";
    addr.textContent = ADDRESS;
    stage.appendChild(addr);
  }

  const cropFill = (land) => {
    const vals = lands.map((l) => Number(l.growth)).filter((v) => Number.isFinite(v));
    const lo = vals.length ? Math.min(...vals) : 65;
    const hi = vals.length ? Math.max(...vals) : 100;
    const g = Number(land.growth) || 0;
    const fixed = (g - 65) / 35;
    const stretched = hi > lo ? (g - lo) / (hi - lo) : 0.5;
    const t = Math.max(0, Math.min(1, fixed * 0.4 + stretched * 0.6));
    return rampColor(RAMP_NDVI, t);
  };

  const fillOf = (land) => {
    if (layer === "device" || layer === "sensors" || layer === "plants") return "rgba(120,140,110,0.32)";
    if (layer === "crop") return cropFill(land);
    if (layer === "risk") return riskColor(land.pest_risk);
    return moistureColor(land.moisture);
  };

  const riskSub = (r) => (r > 50 ? "偏高" : r > 30 ? "关注" : "正常");

  const labelParts = (land) => {
    const metric = landMetric(land, layer);
    const code = land.code;
    let main = metric.label;
    let sub = "";
    if (layer === "moisture") {
      main = metric.label;
      sub = land.crop_name || "";
    } else if (layer === "crop") {
      main = metric.label;
      sub = land.crop_name || "";
    } else if (layer === "risk") {
      main = metric.label;
      sub = riskSub(land.pest_risk);
    } else if (layer === "device") {
      main = "";
      sub = "";
    } else if (layer === "sensors") {
      main = metric.label;
      sub = "";
    } else if (layer === "plants") {
      main = metric.label;
      sub = "";
    }
    return { code, main, sub };
  };

  const plotGroup = L.layerGroup().addTo(map);
  const markGroup = L.layerGroup().addTo(map);
  const fleetMode = layer === "device";

  lands.forEach((land) => {
    const plot = PLOT_LL[land.code];
    if (!plot) return;
    const on = focus && focus === land.code;
    const accent =
      (layer === "moisture" && land.moisture < 25) ||
      (layer === "crop" && land.growth < 75) ||
      (layer === "risk" && land.pest_risk > 50);
    const poly = L.polygon(plot.coords, {
      color: on ? "#ffffff" : accent ? "rgba(255,220,180,0.9)" : "rgba(255,255,255,0.7)",
      weight: on ? 3 : accent ? 2.2 : 1.5,
      fillColor: fillOf(land),
      fillOpacity: fleetMode ? (on ? 0.3 : 0.18) : on ? 0.58 : 0.42,
    });
    poly.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (typeof onPickLand === "function") onPickLand(land.code);
    });
    const parts = labelParts(land);
    const slim = fleetMode || (!parts.main && !parts.sub);
    const html = slim
      ? `<b>${esc(parts.code)}</b>`
      : `<b>${esc(parts.code)}</b><span>${esc(parts.main)}</span>${
          parts.sub ? `<small>${esc(parts.sub)}</small>` : ""
        }`;
    const label = L.marker(plot.center, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: slim ? "twin-ll-label twin-ll-label-slim" : "twin-ll-label",
        html,
        iconSize: slim ? [72, 22] : [108, parts.sub ? 52 : 42],
        iconAnchor: slim ? [36, 11] : [54, parts.sub ? 26 : 21],
      }),
    });
    plotGroup.addLayer(poly);
    plotGroup.addLayer(label);
  });

  const addMark = (latlng, html, onClick, className, size) => {
    const marker = L.marker(latlng, {
      icon: L.divIcon({
        className: className || "twin-ll-mark",
        html,
        iconSize: size || [88, 36],
        iconAnchor: [16, 16],
      }),
    });
    if (onClick) marker.on("click", onClick);
    markGroup.addLayer(marker);
  };

  if (layer === "device") {
    const fleet = devices.filter(isFleetUnit);
    const byLand = new Map();
    fleet.forEach((d) => {
      const land = PLOT_LL[d.location] ? d.location : "_yard";
      if (!byLand.has(land)) byLand.set(land, []);
      byLand.get(land).push(d);
    });
    byLand.forEach((list, land) => {
      list.forEach((d, idx) => {
        const ok = deviceStatusOk(d.status);
        const type = String(d.device_type || "");
        const latlng = slotLatLng(d, land === "_yard" ? "" : land, idx, list.length);
        addMark(
          latlng,
          `<i class="twin-ll-dot ${esc(type)}${ok ? " is-online" : ""}" title="${esc(d.name || d.code)}"></i><em>${esc(d.code)}</em>`,
          (e) => {
            L.DomEvent.stopPropagation(e);
            if (typeof onPickDev === "function") onPickDev(d.code, d);
          },
          "twin-ll-mark twin-ll-fleet"
        );
      });
    });
  } else if (layer === "sensors") {
    const byLand = new Map();
    sensors.forEach((s) => {
      const land = s.location || "_yard";
      if (!byLand.has(land)) byLand.set(land, []);
      byLand.get(land).push(s);
    });
    byLand.forEach((list, land) => {
      list.forEach((s, idx) => {
        const dim = focus && s.location && s.location !== focus;
        const fill =
          s.sensor_kind === "ec" ? "#a78bfa" : s.sensor_kind === "temp" ? "#f59e0b" : moistureColor(s.value || 25);
        addMark(
          slotLatLng(s, land === "_yard" ? "" : land, idx, list.length),
          `<i class="twin-ll-dot sensor${dim ? " is-dim" : ""}" style="background:${fill}" title="${esc(s.code)}"></i>`,
          (e) => {
            L.DomEvent.stopPropagation(e);
            if (s.location && typeof onPickLand === "function") onPickLand(s.location);
            else if (typeof onPickDev === "function") onPickDev(s.code, s);
          },
          "twin-ll-mark",
          [28, 28]
        );
      });
    });
  } else if (layer === "plants") {
    const byLand = new Map();
    plants.forEach((pl) => {
      const land = pl.land_code || "_yard";
      if (!byLand.has(land)) byLand.set(land, []);
      byLand.get(land).push(pl);
    });
    byLand.forEach((list, land) => {
      list.forEach((pl, idx) => {
        const dim = focus && pl.land_code && pl.land_code !== focus;
        const on = plantFocus && (plantFocus === pl.code || String(plantFocus) === String(pl.id));
        const fill =
          plantView === "root" ? growthColor(pl.root?.vigor || 70) : growthColor(pl.canopy?.vigor || 70);
        addMark(
          slotLatLng(pl, land === "_yard" ? "" : land, idx, list.length),
          `<i class="twin-ll-dot plant${dim ? " is-dim" : ""}${on ? " is-on" : ""}${
            pl.status && pl.status !== "正常" ? " is-watch" : ""
          }" style="background:${fill}" title="${esc(pl.code)}"></i>`,
          (e) => {
            L.DomEvent.stopPropagation(e);
            if (typeof onPickPlant === "function") onPickPlant(pl.code, pl.land_code, pl);
          },
          "twin-ll-mark",
          [28, 28]
        );
      });
    });
  }

  const fitAll = () => {
    map.invalidateSize();
    const points = [];
    plotGroup.eachLayer((l) => {
      if (l.getBounds) {
        const b = l.getBounds();
        if (b && b.isValid()) points.push(b.getSouthWest(), b.getNorthEast());
      }
    });
    if (points.length) {
      map.fitBounds(L.latLngBounds(points).pad(0.2));
    } else {
      map.setView(MAP_CENTER, 14);
    }
  };
  requestAnimationFrame(fitAll);
  setTimeout(fitAll, 120);
  setTimeout(fitAll, 400);
}
function destroyDashboardMap() {
  if (window.__dcLeaflet) {
    try { window.__dcLeaflet.remove(); } catch (_) { /* ignore */ }
    window.__dcLeaflet = null;
    window.__dcLeafletPlots = null;
  }
}
/* 浇水施肥页的「只看需复核」筛选。和 twinFocus 同级，跨页返回时保持上次选择。 */
let waterOnlyReview = false;
let farmId = "f1";
let seasonStageFocus = "";
let postBatchFocus = "";
let historyYear = 2026;
let taskTab = "current"; // current | history
let councilFocus = "agronomy";
let councilLastReview = null;

/** 统一跨页联动：写焦点 → 可选关大屏 → toast → show */
function rolePageAllowed(page, role = currentRole) {
  if (page === "dashboard") return true;
  const spec = window.FarmSpec;
  if (!spec) return pages.some(([id]) => id === page);
  const groups = role === "expert"
    ? (spec.navGroupsExpert || spec.navGroupsPro || spec.navGroups || [])
    : role === "gov"
      ? (spec.navGroupsGov || spec.navGroupsPro || spec.navGroups || [])
      : (spec.navGroupsFarm || spec.navGroups || []);
  return groups.some((group) => (group.items || []).some(([id]) => id === page));
}

function navigate(opts) {
  const o = typeof opts === "string" ? { page: opts } : opts || {};
  const targetPage = o.page || "dashboard";
  if (!rolePageAllowed(targetPage)) {
    toast("当前角色不可访问", "请从左侧进入本角色已授权页面", "orange");
    return;
  }
  if (o.land != null && o.land !== "全场") twinFocus = o.land || "";
  if (o.land === "全场") twinFocus = "";
  if (o.device) deviceFocus = o.device;
  if (o.vendor != null) vendorFocus = o.vendor || "";
  if (o.plant) plantFocus = o.plant;
  if (o.plantView) plantView = o.plantView;
  if (o.layer) twinLayer = o.layer;
  if (o.year) historyYear = Number(o.year) || historyYear;
  if (o.taskTab) taskTab = o.taskTab === "history" ? "history" : "current";
  if (o.aiDraft) aiDraftQuestion = o.aiDraft;
  if (o.closeWall !== false && window.FarmWall && FarmWall.isOpen()) FarmWall.close(true);
  if (o.toast) {
    const t = o.toast;
    if (Array.isArray(t)) toast(t[0], t[1], t[2] || "green");
    else if (typeof t === "string") toast(t, "", "green");
    else toast(t.title || "已跳转", t.sub || "", t.tone || "green");
  }
  show(targetPage);
}
window.navigate = navigate;
window.FarmFocus = {
  get land() { return twinFocus; },
  set land(v) { twinFocus = v || ""; },
  get device() { return deviceFocus; },
  set device(v) { deviceFocus = v || ""; },
  get plant() { return plantFocus; },
  set plant(v) { plantFocus = v || ""; },
};
if (window.FarmSpec) document.title = FarmSpec.product.brand;

// 主题：默认浅色（田间可读），可切深色值班屏
(function initTheme() {
  let theme = "light";
  try { theme = localStorage.getItem("agrios-theme") || "light"; } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
  syncThemeBtn(theme);
})();

function syncThemeBtn(theme) {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "light" ? "☾" : "☀";
}

function toggleTheme() {
  const root = document.documentElement;
  const cur = root.getAttribute("data-theme") || "light";
  const next = cur === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("agrios-theme", next); } catch (e) {}
  syncThemeBtn(next);
  toast("主题已切换", next === "light" ? "浅色田间模式" : "深色值班大屏模式", "green");
}

function toast(title, sub, tone) {
  const wrap = document.getElementById("toast-wrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<b class="${tone === "green" ? "ok" : tone === "orange" ? "warn" : ""}">${esc(title)}</b><div class="t-sub">${esc(sub || "")}</div>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
window.toast = toast;

/**
 * 侧栏图标。原来用的是 ▦ ◐ ◌ ⧉ 这类字符字形：字重/基线/实际尺寸全看系统装了哪套字体，
 * 20 个菜单又凑不出 20 个含义对得上的字符。改成 24×24 描边 SVG，
 * stroke 走 currentColor，激活态跟着 .mod-ico 的颜色一起变，不用额外规则。
 */
const NAV_ICO_PATHS = {
  /* 本周农事 · 带勾的日历 */
  dashboard: '<rect x="3.4" y="5" width="17.2" height="15.4" rx="2.4"/><path d="M3.4 9.8h17.2M8 3.2v3.4M16 3.2v3.4"/><path d="M9 14.4l2.2 2.2 4-4.2"/>',
  /* 看田地图 · 折叠地图 */
  twin: '<path d="M3.4 6.6 9 4.2l6 2.6 5.6-2.4v13l-5.6 2.4-6-2.6-5.6 2.4z"/><path d="M9 4.2v13M15 6.8v13"/>',
  /* 田间设备 · 立杆测点与信号 */
  devices: '<path d="M12 20.8v-9.2M8.6 20.8h6.8"/><circle cx="12" cy="9" r="1.7"/><path d="M9.1 5.9a4.6 4.6 0 0 0 0 6.2M14.9 5.9a4.6 4.6 0 0 1 0 6.2"/><path d="M6.6 3.6a8.2 8.2 0 0 0 0 10.8M17.4 3.6a8.2 8.2 0 0 1 0 10.8"/>',
  /* 浇水施肥 · 水滴与水面 */
  water: '<path d="M12 2.9s-4.9 5.6-4.9 9.3a4.9 4.9 0 0 0 9.8 0c0-3.7-4.9-9.3-4.9-9.3z"/><path d="M3.6 20.4c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0 2.8-1.1 4.2 0 2.8 1.1 4.2 0"/>',
  /* 机具作业 · 拖拉机 */
  fleet: '<circle cx="7.4" cy="16.8" r="3.6"/><circle cx="17.8" cy="18" r="2.4"/><path d="M4.2 14V10.4h3.4l1.3-4h3.9v4h6.6v5.2"/><path d="M11 17.4h4.4"/>',
  /* 播收到仓 · 麦穗 */
  season: '<path d="M12 21V7.4"/><path d="M12 8.4c-1.7-1.7-1.7-3.4 0-5.1 1.7 1.7 1.7 3.4 0 5.1z"/><path d="M12 13.2c-2.4 0-4.3-1.9-4.3-4.3 2.4 0 4.3 1.9 4.3 4.3zM12 13.2c2.4 0 4.3-1.9 4.3-4.3-2.4 0-4.3 1.9-4.3 4.3z"/><path d="M12 18.4c-2.4 0-4.3-1.9-4.3-4.3 2.4 0 4.3 1.9 4.3 4.3zM12 18.4c2.4 0 4.3-1.9 4.3-4.3-2.4 0-4.3 1.9-4.3 4.3z"/>',
  /* 历年收成 · 回溯时钟 */
  history: '<path d="M3.6 12.2A8.4 8.4 0 1 1 6.2 18.3"/><path d="M3.2 6.2 6.3 6.6 5.8 9.7"/><path d="M12 7.6v4.8l3.6 2"/>',
  /* 专家会诊 · 多人 */
  council: '<circle cx="9.2" cy="8.4" r="3.2"/><path d="M3.4 19.8c0-3.2 2.6-5.4 5.8-5.4s5.8 2.2 5.8 5.4"/><circle cx="17.4" cy="9" r="2.4"/><path d="M15.8 14.8c2.9-.6 5.2 1.4 5.2 4.4"/>',
  /* 问一问 · 带问号的对话气泡 */
  ai: '<path d="M20.6 12.3c0 4-3.9 7.2-8.6 7.2-1 0-2-.15-2.9-.42L4.3 20.8l1.3-3.6c-1.4-1.3-2.2-3-2.2-4.9 0-4 3.9-7.2 8.6-7.2s8.6 3.2 8.6 7.2z"/><path d="M9.9 10.2a2.2 2.2 0 1 1 2.9 2.1c-.7.25-1 .8-1 1.5"/><path d="M11.8 15.9v.1"/>',
  /* 任务审核台 · 带勾的审批夹 */
  tasks: '<path d="M9 4.6H7.2A2.2 2.2 0 0 0 5 6.8v12A2.2 2.2 0 0 0 7.2 21h9.6a2.2 2.2 0 0 0 2.2-2.2v-12a2.2 2.2 0 0 0-2.2-2.2H15"/><rect x="9" y="2.6" width="6" height="4" rx="1.2"/><path d="M8.8 13.6 11 15.8l4.4-4.6"/>',
  /* 联合诊断 · 放大镜里的叶片 */
  diagnosis: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.3 15.3 20.6 20.6"/><path d="M7.8 13.4c0-3 2.4-5.4 5.4-5.4 0 3-2.4 5.4-5.4 5.4zM7.8 13.4 13.2 8"/>',
  /* 协作工作台 · 分栏台面 */
  workbench: '<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.4"/><path d="M3.2 9.2h17.6M10.4 9.2v10.4"/>',
  /* 多智能体协同 · 互联节点 */
  collab: '<circle cx="12" cy="4.8" r="2.3"/><circle cx="5.2" cy="17.4" r="2.3"/><circle cx="18.8" cy="17.4" r="2.3"/><path d="M10.9 6.8 6.3 15.4M13.1 6.8l4.6 8.6M7.5 17.4h9"/>',
  /* 智能体名册 · 带头像的名册卡 */
  agents: '<rect x="2.8" y="5" width="18.4" height="14" rx="2.4"/><circle cx="8.4" cy="10.8" r="2.2"/><path d="M4.9 16.4c0-2 1.6-3.2 3.5-3.2s3.5 1.2 3.5 3.2"/><path d="M14.6 9.8h4M14.6 13.6h4"/>',
  /* 植株精细管控 · 带根系的单株 */
  plants: '<path d="M12 20.8V10"/><path d="M12 14.6c-2.8 0-5-2.2-5-5 2.8 0 5 2.2 5 5zM12 11.6c0-2.8 2.2-5 5-5 0 2.8-2.2 5-5 5z"/><path d="M12 17.4 8.6 20.8M12 17.4l3.4 3.4"/>',
  /* 机器人沙箱 · 机器人头 */
  robots: '<rect x="4.4" y="7.8" width="15.2" height="11.4" rx="3"/><path d="M12 4.2v3.6M2.6 12.2h1.8M19.6 12.2h1.8"/><circle cx="12" cy="3" r="1.2"/><path d="M9.2 12v1.8M14.8 12v1.8M9.8 16.2h4.4"/>',
  /* 厂家接入中心 · 厂房 */
  vendors: '<path d="M3.4 20.6V10.2l5.6 3.7V10.2l5.6 3.7V4.6h5.4v16z"/><path d="M2.6 20.6h18.8"/>',
  /* 仓储与初加工 · 仓房 */
  postharvest: '<path d="M3.2 10.2 12 4.2l8.8 6"/><path d="M5.4 9.4v11.2h13.2V9.4"/><rect x="9.4" y="14.2" width="5.2" height="6.4"/>',
  /* 数据资产 · 数据库 */
  assets: '<ellipse cx="12" cy="6.2" rx="7.4" ry="3"/><path d="M4.6 6.2v11.6c0 1.66 3.31 3 7.4 3s7.4-1.34 7.4-3V6.2"/><path d="M19.4 12c0 1.66-3.31 3-7.4 3s-7.4-1.34-7.4-3"/>',
  /* 云边端架构 · 云 + 分层 */
  arch: '<path d="M7 11.6a3.2 3.2 0 0 1 .6-6.34 4.6 4.6 0 0 1 8.72 1.06 2.9 2.9 0 0 1 .38 5.28z"/><rect x="4.4" y="14.4" width="15.2" height="2.8" rx="1.2"/><rect x="4.4" y="18.2" width="15.2" height="2.8" rx="1.2"/>',
  /* 兜底：没登记图标的新页面 */
  _fallback: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4v16M4 12h16"/>',
};
function navIcoSvg(id) {
  return (
    '<svg class="mod-ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
    (NAV_ICO_PATHS[id] || NAV_ICO_PATHS._fallback) +
    "</svg>"
  );
}

(function bindNav() {
  window.rebuildNav = function rebuildNav() {
    nav.innerHTML = "";
    const spec = window.FarmSpec;
    let groups;
    if (!spec) groups = [{ label: "", items: pages }];
    else if (currentRole === "expert") groups = spec.navGroupsExpert || spec.navGroupsPro || spec.navGroups;
    else if (currentRole === "gov") groups = spec.navGroupsGov || spec.navGroupsPro || spec.navGroups;
    else groups = spec.navGroupsFarm || spec.navGroups;
    const flat = (groups || []).flatMap((g) => g.items || []);
    if (flat.length) {
      pages.length = 0;
      flat.forEach((pair) => pages.push(pair));
    }
    (groups || []).forEach((g, gi) => {
      /* 分组标题原来还带一行 hint（"浇水和机具安排""算账和政策咨询"），
         就是把下面的菜单名换个说法再念一遍，占掉的高度比菜单项本身还多。 */
      let headId = "";
      if (g.label) {
        const head = document.createElement("div");
        head.className = "nav-group";
        headId = "navGrp" + gi;
        head.id = headId;
        head.textContent = g.label;
        nav.appendChild(head);
      }
      /* 同组菜单包一层 role="group"：原来分组只是视觉上的，读屏拿到的是一串平铺按钮。 */
      const box = document.createElement("div");
      box.className = "nav-items";
      if (headId) {
        box.setAttribute("role", "group");
        box.setAttribute("aria-labelledby", headId);
      }
      (g.items || []).forEach(([id, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const on = current === id || (!current && id === "dashboard");
        btn.className = "mod-head" + (on ? " active" : "");
        btn.dataset.id = id;
        btn.dataset.label = label;
        if (on) btn.setAttribute("aria-current", "page");
        btn.innerHTML = `<span class="mod-ico" aria-hidden="true">${navIcoSvg(id)}</span><span class="mod-name">${esc(label)}</span>`;
        btn.onclick = () => show(id);
        box.appendChild(btn);
      });
      nav.appendChild(box);
    });
    if (window.syncNavTitles) window.syncNavTitles();
    [...nav.querySelectorAll(".mod-head")].forEach((b) => b.classList.toggle("active", b.dataset.id === current));
    document.body.dataset.role = currentRole;
    /* 角色首页就是导航里的第一项，不再单独放一块"返回首页"卡片重复一遍 */
    let foot = document.getElementById("sideBrand");
    if (!foot) {
      foot = document.createElement("div");
      foot.id = "sideBrand";
      foot.className = "side-brand";
      const side = document.getElementById("sidebar");
      if (side) side.appendChild(foot);
    }
    foot.innerHTML = `<div class="side-brand-art"><b>证据优先</b><span>人工门禁 · 全程留痕</span></div><p>农业运营仿真系统</p><small>© 2026 一级芯界</small>`;
  };
  rebuildNav();
})();

(function initSideCollapse() {
  const KEY = "agrios-side-collapsed";
  const layout = document.getElementById("layout");
  const btn = document.getElementById("sideToggle");
  if (!layout || !btn) return;
  /* 展开态菜单文字就在眼前，再弹一个一模一样的 tooltip 没有意义；
     收起态只剩一个图标，tooltip 反而是唯一能读到名字的地方。 */
  window.syncNavTitles = function syncNavTitles() {
    const on = layout.classList.contains("is-side-collapsed");
    document.querySelectorAll("#nav .mod-head").forEach((b) => {
      if (on) b.title = b.dataset.label || b.textContent.trim();
      else b.removeAttribute("title");
    });
  };
  const apply = (on) => {
    layout.classList.toggle("is-side-collapsed", on);
    document.body.classList.toggle("side-collapsed", on);
    btn.setAttribute("aria-expanded", on ? "false" : "true");
    btn.title = on ? "展开侧栏" : "收起侧栏";
    /* 展开态这枚按钮铺满侧栏顶栏那一行，左边写清楚它是干什么的（原来只有一个箭头，
       右对齐一挂，左边 235px 就是一整条空白）；收起态只剩 64px，文字由 CSS 收掉，
       这时 aria-label 是读屏唯一能拿到的名字，所以跟着状态一起改。 */
    btn.setAttribute("aria-label", on ? "展开侧栏" : "收起侧栏");
    const label = document.getElementById("sideToggleLabel");
    if (label) label.textContent = on ? "展开侧栏" : "收起侧栏";
    window.syncNavTitles();
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === "1"; } catch (e) {}
  apply(collapsed);
  btn.addEventListener("click", () => apply(!layout.classList.contains("is-side-collapsed")));
})();

document.getElementById("theme-toggle").onclick = toggleTheme;
document.getElementById("refresh-page").onclick = () => {
  renderToken += 1;
  render(renderToken);
  if (window.refreshTopbarStatus) window.refreshTopbarStatus();
  toast("已重新取数", "表单编辑期间不会自动重绘页面", "green");
};

/* 顶栏两个现场状态都可点：看到不对劲能直接跳到能处理的页面 */
const tbWindowBtn = document.getElementById("tbWindow");
if (tbWindowBtn) tbWindowBtn.onclick = () => navigate("devices");
const tbDevicesBtn = document.getElementById("tbDevices");
if (tbDevicesBtn) tbDevicesBtn.onclick = () => navigate("devices");

function applyWallMode() {
  const btn = document.getElementById("wall-toggle");
  const open = window.FarmWall && FarmWall.isOpen();
  if (btn) {
    const isOpen = open || wallMode;
    const label = isOpen ? "退出大屏" : wallLabelForRole(currentRole);
    btn.textContent = label;
    btn.dataset.short = isOpen ? "退出" : "大屏";
    btn.setAttribute("aria-label", label);
  }
}
applyWallMode();

window.onFarmWallClose = () => {
  wallMode = false;
  try { localStorage.setItem("agrios-wall", "0"); } catch (e) {}
  applyWallMode();
};

const wallBtn = document.getElementById("wall-toggle");
if (wallBtn) {
  wallBtn.onclick = () => {
    if (window.FarmWall && FarmWall.isOpen()) {
      FarmWall.close();
      return;
    }
    wallMode = true;
    try { localStorage.setItem("agrios-wall", "1"); } catch (e) {}
    if (window.FarmWall) {
      FarmWall.open();
      applyWallMode();
      toast(...wallToastForRole(currentRole));
    } else {
      toast("大屏未就绪", "请刷新后重试", "orange");
    }
  };
}

document.getElementById("roleSelect").onchange = async (e) => {
  currentRole = e.target.value;
  window.currentRole = currentRole;
  try { localStorage.setItem("agrios-role", currentRole); } catch (err) {}
  const labels = { farm: "农户/场长", expert: "农技专家", gov: "监管人员" };
  const avatars = { farm: "农", expert: "技", gov: "监" };
  document.getElementById("roleLabel").textContent = labels[currentRole] || "用户";
  const av = document.getElementById("roleAvatar");
  if (av) av.textContent = avatars[currentRole] || "用";
  document.body.dataset.role = currentRole;
  const r = await api("/api/role", { method: "POST", body: JSON.stringify({ role: currentRole }) });
  if (window.rebuildNav) rebuildNav();
  applyWallMode();
  syncPagePath();
  if (window.FarmWall && FarmWall.isOpen()) FarmWall.refreshForRole();
  const caps = (r && r.caps && r.caps.caps) || ((window.FarmSpec && FarmSpec.roleCaps[currentRole]) || {}).caps || [];
  toast(
    labels[currentRole] + "已切换",
    caps.slice(0, 4).join(" · ") + (caps.length > 4 ? " …" : ""),
    "green"
  );
  current = "dashboard";
  renderToken += 1;
  show("dashboard");
};
// 初始化角色 UI
(function syncRoleUi() {
  const sel = document.getElementById("roleSelect");
  if (sel) sel.value = currentRole;
  const labels = { farm: "农户/场长", expert: "农技专家", gov: "监管人员" };
  const avatars = { farm: "农", expert: "技", gov: "监" };
  const rl = document.getElementById("roleLabel");
  if (rl) rl.textContent = labels[currentRole] || "用户";
  const av = document.getElementById("roleAvatar");
  if (av) av.textContent = avatars[currentRole] || "用";
  document.body.dataset.role = currentRole;
  window.currentRole = currentRole;
  applyWallMode();
  syncPagePath();
  api("/api/role", { method: "POST", body: JSON.stringify({ role: currentRole }) }).catch(() => {});
})();
async function refreshFarmSelect(preferId) {
  const sel = document.getElementById("farmSelect");
  if (!sel) return null;
  const d = await api("/api/farms").catch(() => null);
  if (!d || !d.catalog) return d;
  const cur = preferId || d.farmId || farmId || "f1";
  sel.innerHTML = d.catalog
    .map((f) => {
      const pending = f.pending_count || 0;
      const label = pending
        ? `${f.name} · ${f.land_count}块 · 待办${pending}`
        : `${f.name} · ${f.land_count}块`;
      return `<option value="${esc(f.id)}" ${f.id === cur ? "selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
  farmId = cur;
  return d;
}

document.getElementById("farmSelect").onchange = async (e) => {
  farmId = e.target.value;
  const r = await api("/api/farm", { method: "POST", body: JSON.stringify({ id: farmId }) });
  const pending = (r.farm && r.farm.pending_count) || 0;
  const landsN = (r.farm && r.farm.land_count) || 0;
  toast(
    "已切换农场",
    `${r.farm.region} · ${landsN} 块田 · ${pending ? pending + " 项待办" : "暂无紧急待办"}`,
    pending ? "orange" : "green"
  );
  await refreshFarmSelect(farmId);
  renderToken += 1;
  render(renderToken);
  /* 顶栏的作业窗口与设备在线都是按农场算的，换场必须跟着重算 */
  if (window.refreshTopbarStatus) window.refreshTopbarStatus();
};

refreshFarmSelect().catch(() => {});

let commandPaletteOpener = null;
function closeCommandPalette(restoreFocus = true) {
  const panel = document.getElementById("cmd-panel");
  if (!panel || !panel.classList.contains("show")) return;
  panel.classList.remove("show");
  panel.setAttribute("aria-hidden", "true");
  const layout = document.getElementById("layout");
  const topbar = document.getElementById("topbar");
  if (layout) layout.inert = false;
  if (topbar) topbar.inert = false;
  if (restoreFocus && commandPaletteOpener && typeof commandPaletteOpener.focus === "function") commandPaletteOpener.focus();
}

async function openCommandPalette() {
  const panel = document.getElementById("cmd-panel");
  if (!panel) return;
  commandPaletteOpener = document.activeElement;
  panel.classList.add("show");
  panel.setAttribute("aria-hidden", "false");
  const layout = document.getElementById("layout");
  const topbar = document.getElementById("topbar");
  if (layout) layout.inert = true;
  if (topbar) topbar.inert = true;
  const input = document.getElementById("cmd-input");
  const list = document.getElementById("cmd-list");
  input.value = "";
  input.focus();
  const run = async () => {
    const d = await api(`/api/search?q=${encodeURIComponent(input.value.trim())}`);
    const rolePages = (d.pages || []).filter((item) => rolePageAllowed(item.jump || item.id));
    const rows = [...rolePages, ...(d.lands || []), ...(d.plants || []), ...(d.devices || []), ...(d.agents || [])].slice(0, 16);
    const typeLabels = { page: "页面", land: "田块", plant: "植株", device: "设备", agent: "智能体" };
    list.innerHTML = rows.length
      ? rows.map((r) => `<button type="button" class="cmd-item" data-jump="${esc(r.jump)}" data-land="${esc(r.land || "")}" data-device="${esc(r.device || "")}" data-plant="${esc(r.plant || "")}">
          <span class="tag gray">${esc(typeLabels[r.type] || r.type)}</span><b>${esc(r.name)}</b>
        </button>`).join("")
      : `<div class="sub" style="padding:12px">无匹配结果</div>`;
    const items = [...list.querySelectorAll(".cmd-item")];
    items.forEach((btn, index) => {
      btn.onclick = () => {
        closeCommandPalette(false);
        navigate({
          page: btn.dataset.jump,
          land: btn.dataset.land || undefined,
          device: btn.dataset.device || undefined,
          plant: btn.dataset.plant || undefined,
          layer: btn.dataset.plant ? "plants" : undefined,
          toast: ["已定位", btn.textContent.trim(), "green"],
        });
      };
      btn.onkeydown = (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          (items[index + 1] || input).focus();
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          (items[index - 1] || input).focus();
        }
      };
    });
  };
  input.oninput = run;
  input.onkeydown = (event) => {
    const items = [...list.querySelectorAll(".cmd-item")];
    if (event.key === "ArrowDown" && items[0]) {
      event.preventDefault();
      items[0].focus();
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      (items[items.length - 1] || input).focus();
    }
  };
  run();
}
/* 顶栏不再有搜索框，Ctrl+K 全局搜索照常可用 */
document.querySelector("#cmd-panel .cmd-box")?.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCommandPalette();
  }
  if (e.key === "Escape") {
    closeCommandPalette(true);
    closeNotificationPanel(true);
  }
  const panel = document.getElementById("cmd-panel");
  if (e.key === "Tab" && panel?.classList.contains("show") && !e.shiftKey && document.activeElement?.classList.contains("cmd-item")) {
    const items = [...panel.querySelectorAll(".cmd-item")];
    if (document.activeElement === items[items.length - 1]) {
      e.preventDefault();
      document.getElementById("cmd-input")?.focus();
    }
  }
});
document.addEventListener("click", () => closeCommandPalette(false));

let notificationPanelOpener = null;
function closeNotificationPanel(restoreFocus = false) {
  const p = document.getElementById("notif-panel");
  if (!p || !p.classList.contains("show")) return;
  p.classList.remove("show");
  p.setAttribute("aria-hidden", "true");
  document.getElementById("notif-btn")?.setAttribute("aria-expanded", "false");
  if (restoreFocus && notificationPanelOpener && typeof notificationPanelOpener.focus === "function") {
    notificationPanelOpener.focus();
  }
}
function openNotificationPanel(opener) {
  const p = document.getElementById("notif-panel");
  if (!p) return;
  notificationPanelOpener = opener || document.activeElement;
  p.classList.add("show");
  p.setAttribute("aria-hidden", "false");
  document.getElementById("notif-btn")?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => (p.querySelector(".n-close, .n-item") || p).focus());
}
document.getElementById("notif-btn").onclick = (ev) => {
  ev.stopPropagation();
  const p = document.getElementById("notif-panel");
  if (p?.classList.contains("show")) closeNotificationPanel(true);
  else openNotificationPanel(ev.currentTarget);
};
document.getElementById("notif-panel")?.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", () => {
  closeNotificationPanel(false);
});

window.FarmRuntime = window.FarmRuntime || {
  sources: {},
  backendAvailable: false,
  backendConnected: false,
  mode: "checking",
  mark(path, source) {
    const key = String(path || "").split("?")[0];
    this.sources[key] = source;
    this.syncBadge();
  },
  transport() {
    const values = [...new Set(Object.values(this.sources))];
    if (values.includes("backend") && values.includes("local")) return "mixed";
    return values[0] || (location.protocol === "file:" ? "local" : "unknown");
  },
  /* 数据来源已不在顶栏展示，各页面自己的数据说明卡仍然照常渲染 */
  syncBadge() {},
};

window.FarmRuntime.ready = (async () => {
  if (!(location.protocol === "http:" || location.protocol === "https:")) {
    window.FarmRuntime.mode = "local-demo";
    return false;
  }
  try {
    const healthUrl = (window.FarmApiBase && window.FarmApiBase.apiUrl)
      ? window.FarmApiBase.apiUrl("/api/health")
      : "/api/health";
    const response = await fetch(healthUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("health unavailable");
    const payload = await response.json();
    window.FarmRuntime.backendConnected = !!(payload && payload.status === "running");
    window.FarmRuntime.telemetryConfigured = payload?.telemetry?.configured === true;
    window.FarmRuntime.backendAvailable = window.FarmRuntime.backendConnected && payload.business_api === "complete";
  } catch (e) {
    window.FarmRuntime.backendAvailable = false;
  }
  window.FarmRuntime.mode = window.FarmRuntime.backendAvailable ? "backend-demo" : "local-demo";
  window.FarmRuntime.syncBadge();
  return window.FarmRuntime.backendAvailable;
})();
window.FarmRuntime.syncBadge();

async function api(path, options = {}) {
  const isChat = String(path).startsWith("/api/ai/chat");
  const method = String(options.method || "GET").toUpperCase();
  const backendAvailable = await window.FarmRuntime.ready;
  const webProtocol = location.protocol === "http:" || location.protocol === "https:";
  const shouldFetch = webProtocol && (backendAvailable || isChat);
  if (shouldFetch) {
    try {
      const requestUrl = (window.FarmApiBase && window.FarmApiBase.apiUrl)
        ? window.FarmApiBase.apiUrl(path)
        : path;
      const r = await fetch(requestUrl, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      if (r.ok) {
        const data = await r.json();
        window.FarmRuntime.mark(path, "backend");
        if (isChat && data && data.provider === "openai") {
          window.__llmLive = true;
          updateLlmBadge();
        }
        return data;
      }
      if (isChat && r.status === 502) {
        window.__llmLive = false;
        updateLlmBadge();
      }
      if (backendAvailable) {
        let detail = "";
        try {
          const payload = await r.json();
          detail = typeof payload.detail === "string" ? payload.detail : "";
        } catch (e) {}
        const error = new Error(detail || `后端拒绝请求（HTTP ${r.status}）`);
        error.status = r.status;
        error.path = path;
        throw error;
      }
    } catch (e) {
      if (backendAvailable) throw e;
      /* 仅在明确的本地沙箱模式下走规则引擎 */
    }
  }
  if (backendAvailable) throw new Error("后端接口不可用，已阻止本地模拟写入");
  window.FarmRuntime.mark(path, "local");
  return FarmEngine.handle(path, options || {});
}
window.api = api;

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (!reason || !(reason instanceof Error)) return;
  event.preventDefault();
  toast("操作未完成", reason.message || "接口请求失败，未执行本地模拟写入", "orange");
});

function updateLlmBadge() {
  /* 顶栏不再有数据源徽章；保留函数供 api() 在拿到大模型响应时调用 */
}

/**
 * 顶栏「作业窗口」：把气温/风速这类读数换算成场长真正要的那一句结论。
 * 规则与全系统一致 —— 天气源没核验过就不给放行结论，宁可停在“待核验”。
 * 阈值按常规植保口径：风速 >4 m/s 漂移风险偏高，>8 m/s 停喷；气温 >35 ℃ 易药害。
 */
function computeOpWindow(wx) {
  if (!wx || wx.air_temp == null) {
    return { tone: "unknown", text: "无数据", why: "未取到天气快照" };
  }
  if (wx.verified !== true) {
    return {
      tone: "unknown",
      text: "待核验",
      why: "天气源未接入核验，不能据此判定喷施或机收窗口",
    };
  }
  const wind = Number(wx.wind);
  const temp = Number(wx.air_temp);
  const wet = /雨|雪|雷|雹/.test(String(wx.condition || ""));
  if (wet) return { tone: "bad", text: "不可作业", why: `${wx.condition}，喷施与机收均需停机` };
  if (wind > 8) return { tone: "bad", text: "不可作业", why: `风速 ${wind} m/s 超出作业上限` };
  if (wind > 4) return { tone: "warn", text: "谨慎作业", why: `风速 ${wind} m/s，喷施漂移风险偏高` };
  if (temp > 35) return { tone: "warn", text: "谨慎作业", why: `气温 ${temp} ℃，正午喷施易产生药害` };
  return { tone: "ok", text: "可作业", why: `气温 ${temp} ℃ · 风速 ${wind} m/s` };
}

function paintOpWindow(wx) {
  const el = document.getElementById("tbWindow");
  if (!el) return;
  const r = computeOpWindow(wx);
  el.dataset.tone = r.tone;
  const v = el.querySelector(".tb-sig-v");
  if (v) v.textContent = r.text;
  const detail = [];
  if (wx && wx.air_temp != null) detail.push(`气温 ${wx.air_temp} ℃`);
  if (wx && wx.wind != null) detail.push(`风速 ${wx.wind} m/s`);
  if (wx && wx.soil_moisture != null) detail.push(`墒情 ${wx.soil_moisture}%`);
  el.title = `${r.text}：${r.why}${detail.length ? "\n" + detail.join(" · ") : ""}\n点击查看田间设备与天气`;
  updateLlmBadge();
}

function paintDeviceLink(online, total) {
  const el = document.getElementById("tbDevices");
  if (!el) return;
  const v = el.querySelector(".tb-sig-v");
  if (online == null || !total) {
    el.dataset.tone = "unknown";
    if (v) v.textContent = "--";
    el.title = "未取到设备状态";
    return;
  }
  const ratio = online / total;
  el.dataset.tone = ratio >= 0.9 ? "ok" : ratio >= 0.6 ? "warn" : "bad";
  if (v) v.textContent = `${online}/${total}`;
  el.title = `${total} 台接入设备中 ${online} 台在线${online < total ? `，${total - online} 台弱信号或离线` : ""}\n离线期间该点位读数不会更新\n点击查看田间设备`;
}

/** 顶栏状态自己取数，不再依赖某一个页面渲染时顺手刷一下 */
let topbarBusy = false;
async function refreshTopbarStatus() {
  if (topbarBusy) return;
  topbarBusy = true;
  try {
    const [dash, dev] = await Promise.all([
      api("/api/dashboard").catch(() => null),
      api("/api/devices").catch(() => null),
    ]);
    if (dash) paintOpWindow(dash.weather || null);
    if (dev && Array.isArray(dev.items)) {
      const total = dev.items.length;
      const online = dev.items.filter((d) => (d.status_code || d.status) === "在线").length;
      paintDeviceLink(online, total);
    }
  } finally {
    topbarBusy = false;
  }
}
window.refreshTopbarStatus = refreshTopbarStatus;

async function probeLlm() {
  if (!(location.protocol === "http:" || location.protocol === "https:")) return;
  try {
    const statusUrl = (window.FarmApiBase && window.FarmApiBase.apiUrl)
      ? window.FarmApiBase.apiUrl("/api/ai/status")
      : "/api/ai/status";
    const r = await fetch(statusUrl);
    if (!r.ok) return;
    const s = await r.json();
    window.__llmLive = !!s.openai;
    updateLlmBadge();
  } catch (e) {}
}
probeLlm();

function syncPagePath() {
  const el = document.getElementById("pagePath");
  const crumb = document.getElementById("crumb");
  const head = document.getElementById("pageHead");
  if (head) head.classList.toggle("is-farm", currentRole === "farm");
  /* 农户视角本来就不显示这两条，原因写在原注释里：侧栏已有分组/页面名，页头别重复。
     同一条理由对专家/监管一样成立——
     pagePath 实测 20 个专家页逐字相同（「专家 · 研判 → 补证 → 初审 → 人工门禁 → 仿真复盘」），
     它描述的是角色不是页面，角色顶栏常驻显示；
     crumb 就是侧栏分组标题，同一屏上下相隔不到 200px。
     页头只留：这是哪一页 + 这一页的约束。 */
  if (el) {
    el.hidden = true;
    el.textContent = "";
  }
  if (crumb) {
    crumb.hidden = true;
    crumb.textContent = "";
  }
}

/**
 * 页面副标题。原格式是「角色视角 · 页面在干什么 · 约束」三段：
 * 第一段和顶栏的角色下拉重复，第二段复述大标题和侧栏菜单名，两段合计占掉 43% 的字数。
 * 现在只留约束句——实测这是三段里唯一正文没说过的内容（看田地图的
 * 「真实边界 / 观测时间 / 质控」在正文里出现 0 次）。
 * 少数几条的第一段本身就是约束（人工门禁、异议留痕、人工关口、固定模拟），那几条合并保留。
 */
const PAGE_SUBTITLES = Object.freeze({
  /* 三个角色的驾驶舱都会用实时状态覆盖这条，这里只作兜底 */
  dashboard: "聚合当前角色最需要核验的信息与下一步入口",
  twin: "生产使用须绑定真实边界、观测时间与质控结果",
  plants: "单株与冠层均为固定模拟 · 仅用于展示取证和复核流程",
  devices: "未接生产遥测、控制链路或设备 ACK",
  water: "缺关键输入时不放行，不生成用量或肥料剂量",
  fleet: "不连接真实车辆，不形成现场调度指令",
  robots: "仅登记仿真请求，不连接真实设备",
  season: "高风险缺证阶段不可推进",
  postharvest: "不代表真实库存或质检结论",
  tasks: "人工门禁 · 审核、确认和验收全程留痕",
  history: "生产使用须绑定来源、计量、设备 ACK 与验收证据",
  diagnosis: "结论未经专家签署前不可执行",
  workbench: "缺证据时不放行 · 异议留痕",
  collab: "人工关口 · 当前仅为确定性流程回放",
  council: "汇总器不能推翻任何一条叫停意见，也没有设备控制权",
  agents: "输出均为未验证草案，不具备自主执行权",
  vendors: "生产兼容性、SLA 与安全联锁待验收",
  ai: "不替代属地规程、标签、现场调查或专家判断",
  ai_assistant: "",
  ai_settings: "密钥仅保存在当前服务进程，重启后清空",
  assets: "来源、授权、质量、版本与责任人待生产核验",
  arch: "当前展示能力边界，不代表生产组件已部署",
});

let hasRenderedInitialRoute = false;

function resetPageSubtitle(id) {
  const el = document.getElementById("pageSub");
  if (!el) return;
  /* 角色前缀去掉了：顶栏的角色下拉常驻显示同一件事，距离不到 200px */
  const text = Object.prototype.hasOwnProperty.call(PAGE_SUBTITLES, id) ? PAGE_SUBTITLES[id] : "仿真功能页";
  el.textContent = text;
  el.hidden = !text;
}

function show(id) {
  if (!rolePageAllowed(id)) id = "dashboard";
  current = id;
  renderToken += 1;
  [...nav.querySelectorAll(".mod-head")].forEach((b) => {
    const active = b.dataset.id === id;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const hit = pages.find((p) => p[0] === id);
  const title = hit ? hit[1] : id;
  document.getElementById("pageTitle").textContent = title;
  resetPageSubtitle(id);
  const pageEnv = document.getElementById("pageEnv");
  if (pageEnv) {
    pageEnv.hidden = true;
    pageEnv.innerHTML = "";
  }
  syncPagePath();
  if (timer) clearInterval(timer);
  timer = null;
  const main = document.getElementById("main");
  if (main) main.scrollTop = 0;
  const activeNav = nav.querySelector(`.mod-head[data-id="${CSS.escape(id)}"]`);
  if (activeNav) activeNav.scrollIntoView({ block: "nearest", inline: "nearest" });
  render(renderToken);
  if (hasRenderedInitialRoute) {
    requestAnimationFrame(() => document.getElementById("pageTitle")?.focus({ preventScroll: true }));
  }
  hasRenderedInitialRoute = true;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
/** 连续色带：stops = [[0,"#.."],[0.5,"#.."],[1,"#.."]] */
function rampColor(stops, t) {
  const x = clamp01(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) return mixHex(c0, c1, (x - t0) / (t1 - t0 || 1));
  }
  return stops[stops.length - 1][1];
}

/* 田间决策色阶：墒情 / 长势 / 风险连续映射 */
const RAMP_MOISTURE = [[0, "#8B4513"], [0.28, "#D2691E"], [0.45, "#E8C547"], [0.62, "#5BAF7A"], [0.8, "#2B8CFF"], [1, "#0B4F8C"]];
const RAMP_NDVI = [[0, "#A52A2A"], [0.25, "#E07020"], [0.45, "#E8C547"], [0.65, "#7CB342"], [0.85, "#2E7D32"], [1, "#1B5E20"]];
const RAMP_RISK = [[0, "#1B5E20"], [0.35, "#8BC34A"], [0.55, "#FFC107"], [0.75, "#FF7043"], [1, "#C62828"]];

function moistureColor(m) {
  return rampColor(RAMP_MOISTURE, (m - 12) / 30);
}
function growthColor(g) {
  return rampColor(RAMP_NDVI, (g - 55) / 45);
}
function riskColor(r) {
  return rampColor(RAMP_RISK, r / 100);
}
function landMetric(l, layer) {
  if (layer === "crop") return { key: "NDVI-vigor", value: l.growth, unit: "", label: `长势 ${l.growth}` };
  if (layer === "risk") return { key: "risk", value: l.pest_risk, unit: "", label: `风险 ${l.pest_risk}` };
  if (layer === "device") return { key: "health", value: l.health_index, unit: "", label: l.code };
  if (layer === "sensors") return { key: "mesh", value: l.sensor_count || 0, unit: "", label: `${l.sensor_online || 0}/${l.sensor_count || 0}点` };
  if (layer === "plants") return { key: "plants", value: l.plant_count || 0, unit: "", label: `冠${l.canopy_avg || "-"}/根${l.root_avg || "-"}` };
  return { key: "moisture", value: l.moisture, unit: "%", label: `${l.moisture}%` };
}
function layerMeta(id) {
  const map = {
    moisture: {
      title: "土壤墒情",
      subtitle: "分作物/物候/土层阈值待绑定",
      hint: "含水分布",
      insight: "干棕 → 湿蓝仅表达模拟数值分布；来源、深度、质量码与属地阈值核验前不判定达标或处方。",
      ramp: RAMP_MOISTURE,
      low: "干旱 12%",
      high: "湿润 42%",
      basemap: "moisture",
    },
    crop: {
      title: "作物长势",
      subtitle: "冠层长势指数（NDVI 类）· 待复飞核验",
      hint: "冠层指数",
      insight: "红黄弱势 → 深绿旺盛（遥感长势惯例）；低长势地块优先复飞复核。",
      ramp: RAMP_NDVI,
      low: "弱势",
      high: "旺盛",
      basemap: "crop",
    },
    risk: {
      title: "风险热力",
      subtitle: "病虫与胁迫风险分布 · 待现场复核",
      hint: "胁迫热力",
      insight: "冷绿安全 → 热红高风险；高风险地块叠加热核晕圈，避免全田普治。",
      ramp: RAMP_RISK,
      low: "低风险",
      high: "高风险",
      basemap: "risk",
    },
    device: {
      title: "机队设备",
      subtitle: "机具与农具位置叠加 · 仿真位置",
      hint: "机具位置",
      insight: "中性地块底图 + 分类型机队标记；点击设备进入设备中心。",
      ramp: null,
      low: "",
      high: "",
      basemap: "device",
    },
    sensors: {
      title: "传感网格",
      subtitle: "田间多深度传感网 · 含水/EC/土温",
      hint: "多深度点位",
      insight: "单田多点位、多深度（含水/EC/土温）；选中地块高亮本田传感网，符合国际精准农业布点。",
      ramp: RAMP_MOISTURE,
      low: "偏低",
      high: "偏高",
      basemap: "moisture",
    },
    plants: {
      title: "单株表型",
      subtitle: "单株孪生 · 冠层与根系采样",
      hint: "冠/根采样",
      insight: "单株采样点展示地上冠层与地下根系活力；点击植株进入精细管控与全生育期形态。",
      ramp: RAMP_NDVI,
      low: "弱势株",
      high: "旺盛株",
      basemap: "crop",
    },
  };
  return map[id] || map.moisture;
}
function moduleHero(_page) {
  return "";
}
/** 统一 KPI 条：对齐驾驶舱 dc-kpi */
function pgKpis(items, cols) {
  const colCls = cols ? ` cols-${cols}` : (items.length >= 5 ? ` cols-${Math.min(6, items.length)}` : "");
  return `<div class="pg-kpis${colCls}">${(items || [])
    .map((i) => {
      const clickable = !!(i.clickable || i.attrs);
      const tag = clickable ? "button" : "div";
      const type = clickable ? ` type="button"` : "";
      return `<${tag}${type} class="card pg-kpi ${i.cls || ""}${clickable ? " clickable" : ""}" ${i.attrs || ""}>
      <em>${esc(i.label)}</em>
      <strong>${esc(String(i.value ?? "—"))}${i.unit != null && i.unit !== "" ? `<small> ${esc(String(i.unit))}</small>` : ""}</strong>
      ${i.sub ? `<span>${esc(i.sub)}</span>` : ""}
    </${tag}>`;
    })
    .join("")}</div>`;
}
function pgCardHd(title, sub, actionHtml = "") {
  return `<div class="pg-card-hd"><div><h2>${esc(title)}</h2>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${actionHtml || ""}</div>`;
}
function statusTone(status) {
  const s = String(status || "");
  if (/NO_GO|不放行|禁止|紧急|异常|冲突|高风险|驳回/.test(s)) return "red";
  if (/执行中|运行|编队|在线|巡田/.test(s)) return "blue";
  if (/待|排队|待机|联调|关注|审核/.test(s)) return "orange";
  if (/完成|正常|已接入|通过|达标|已完成/.test(s)) return "green";
  return "gray";
}
function deviceGlyph(type) {
  const g = { sensor: "S", weather: "W", rain: "A", irrigation: "I", drone: "D", tractor: "T", robot: "R", sprayer: "P", gateway: "G", soil_scan: "U", par: "L", canopy: "C", leafwet: "H", crop_node: "N", pest: "B", yield: "Y" };
  return g[type] || "·";
}
/** 设备类型枚举 → 中文名。台账类表格里直接出 gateway / soil_scan 这种 key 是读不懂的。 */
function equipTypeLabel(t) {
  if (!t) return "—";
  return (window.FarmEquipmentCatalog && FarmEquipmentCatalog.typeLabel(t)) || t;
}
function deviceStatusOk(status) {
  return ["在线", "巡田", "运行", "执行中"].includes(status);
}
window.moistureColor = moistureColor;
window.growthColor = growthColor;
window.riskColor = riskColor;
function colorbarSvg(stops, x, y, w, h) {
  if (!stops || !stops.length) return "";
  const segs = [];
  for (let i = 0; i < 24; i++) {
    const t0 = i / 24;
    const t1 = (i + 1) / 24;
    segs.push(`<rect x="${x + t0 * w}" y="${y}" width="${(t1 - t0) * w + 0.5}" height="${h}" fill="${rampColor(stops, (t0 + t1) / 2)}" stroke="none"/>`);
  }
  return segs.join("");
}
function esc(s) {
  return termText(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let expertIdentityDraft = {
  reviewer_id: "",
  qualification_scope: "综合农艺复核",
  credential_ref: "",
  evidence_refs: "",
};

function requestEvidenceGate({ title, description, kicker = "作业前核验", confirmLabel = "确认记录", tone = "primary", fields = [], validate }) {
  const dialog = document.getElementById("evidence-dialog");
  const form = document.getElementById("evidence-form");
  const root = document.getElementById("evidence-fields");
  const error = document.getElementById("evidence-error");
  const submit = document.getElementById("evidence-dialog-submit");
  const cancel = document.getElementById("evidence-dialog-cancel");
  const close = document.getElementById("evidence-dialog-x");
  if (!dialog || !form || !root || !error || !submit || !cancel || !close) return Promise.resolve(null);

  const opener = document.activeElement;
  document.getElementById("evidence-dialog-kicker").textContent = kicker;
  document.getElementById("evidence-dialog-title").textContent = title || "提交核验信息";
  document.getElementById("evidence-dialog-desc").textContent = description || "";
  submit.textContent = confirmLabel;
  submit.className = tone === "danger" ? "btn danger" : "btn";
  error.textContent = "";
  root.innerHTML = fields.map((field) => {
    const required = field.required === false ? "" : " required";
    const wide = field.wide ? " is-wide" : "";
    const value = esc(field.value || "");
    if (field.type === "checkbox") {
      return `<label class="evidence-check"><input type="checkbox" name="${esc(field.name)}" aria-label="${esc(field.label)}"${required}><span><b>${esc(field.label)}</b>${field.help ? `<br>${esc(field.help)}` : ""}</span></label>`;
    }
    if (field.type === "select") {
      return `<label class="evidence-field${wide}"><span>${esc(field.label)}</span><select name="${esc(field.name)}" aria-label="${esc(field.label)}"${required}>${(field.options || []).map((option) => {
        const pair = Array.isArray(option) ? option : [option, option];
        return `<option value="${esc(pair[0])}"${String(pair[0]) === String(field.value) ? " selected" : ""}>${esc(pair[1])}</option>`;
      }).join("")}</select></label>`;
    }
    if (field.type === "textarea") {
      return `<label class="evidence-field${wide}"><span>${esc(field.label)}</span><textarea name="${esc(field.name)}" aria-label="${esc(field.label)}" placeholder="${esc(field.placeholder || "")}"${required}>${value}</textarea></label>`;
    }
    return `<label class="evidence-field${wide}"><span>${esc(field.label)}</span><input name="${esc(field.name)}" aria-label="${esc(field.label)}" value="${value}" placeholder="${esc(field.placeholder || "")}"${required}></label>`;
  }).join("");

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      form.onsubmit = null;
      dialog.oncancel = null;
      cancel.onclick = null;
      close.onclick = null;
      if (dialog.open) dialog.close();
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
      resolve(value);
    };
    cancel.onclick = () => finish(null);
    close.onclick = () => finish(null);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        error.textContent = "请补齐所有必填项并勾选核验声明。";
        form.reportValidity();
        return;
      }
      const values = {};
      fields.forEach((field) => {
        const control = form.elements.namedItem(field.name);
        values[field.name] = field.type === "checkbox" ? !!control?.checked : String(control?.value || "").trim();
      });
      const validationError = typeof validate === "function" ? validate(values) : "";
      if (validationError) {
        error.textContent = validationError;
        return;
      }
      finish(values);
    };
    if (dialog.open) dialog.close();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const first = root.querySelector("input,select,textarea");
    (first || submit).focus();
  });
}

async function requestActionConfirm({ title, description, confirmLabel = "确认", tone = "primary", acknowledgements = [] }) {
  const values = await requestEvidenceGate({
    title,
    description,
    kicker: tone === "danger" ? "SAFETY REVIEW" : "ACTION REVIEW",
    confirmLabel,
    tone,
    fields: acknowledgements.map((label, index) => ({ name: `ack_${index}`, label, type: "checkbox" })),
  });
  return !!values;
}

async function requestExpertAudit({ approved, comment, title = "专家初审" }) {
  if (currentRole !== "expert") {
    toast("不可签核", "页面角色仅用于视图；请切换专家视图并提交身份、资质与证据声明", "orange");
    return null;
  }
  const values = await requestEvidenceGate({
    title,
    description: "签核身份当前仅作声明记录，尚未对接 SSO 与资质库；本步骤只形成专家初审意见，不构成设备执行放行。",
    confirmLabel: approved ? "记录初审意见" : "确认退回补证",
    fields: [
      { name: "reviewer_id", label: "签核人姓名 / 工号", value: expertIdentityDraft.reviewer_id, placeholder: "例如 EX-102 张某" },
      { name: "qualification_scope", label: "本次资质范围", type: "select", value: expertIdentityDraft.qualification_scope, options: ["综合农艺复核", "棉花农艺与植保", "水肥管理", "农业机械安全", "收获与仓储"] },
      { name: "credential_ref", label: "资质或授权凭证编号", value: expertIdentityDraft.credential_ref, placeholder: "资质证书 / 内部授权编号" },
      { name: "evidence_refs", label: "本次核验的证据引用", type: "textarea", wide: true, value: expertIdentityDraft.evidence_refs, placeholder: "每行一个记录号、文件号或原始数据引用" },
      { name: "comment", label: approved ? "初审意见" : "退回原因", type: "textarea", wide: true, value: comment || "" },
      { name: "declaration", label: "我确认以上身份、资质范围和证据引用准确", help: "该声明会写入审计记录；仍须独立场长门禁，且不得由同一人自审自批。", type: "checkbox" },
    ],
    validate: (data) => {
      const refs = data.evidence_refs.split(/[\n,，;；]+/).map((v) => v.trim()).filter(Boolean);
      if (data.reviewer_id.length < 2) return "签核人姓名或工号至少 2 个字符。";
      if (data.credential_ref.length < 3) return "请输入可追查的资质或授权凭证编号。";
      if (!refs.length) return "至少填写一个证据引用。";
      return "";
    },
  });
  if (!values) return null;
  expertIdentityDraft = {
    reviewer_id: values.reviewer_id,
    qualification_scope: values.qualification_scope,
    credential_ref: values.credential_ref,
    evidence_refs: values.evidence_refs,
  };
  return {
    approved: !!approved,
    comment: values.comment,
    reviewer_id: values.reviewer_id,
    qualification_scope: values.qualification_scope,
    credential_ref: values.credential_ref,
    evidence_refs: values.evidence_refs.split(/[\n,，;；]+/).map((v) => v.trim()).filter(Boolean),
    identity_assurance: "DECLARED_UNVERIFIED",
  };
}

async function requestSafetyReview(title = "继续作业安全复核") {
  const values = await requestEvidenceGate({
    title,
    description: "这是软件门禁复核，不替代设备物理急停、现场上锁挂牌或机具制造商规程。机手与监护人必须为不同人员。",
    confirmLabel: "提交双人复核",
    fields: [
      { name: "operator_id", label: "机手 / 操作人姓名或工号", placeholder: "至少 2 个字符" },
      { name: "supervisor_id", label: "独立监护人姓名或工号", placeholder: "不得与机手相同" },
      { name: "stop_ack_ref", label: "停机 ACK / 现场确认记录号", placeholder: "ACK、工单或人工确认记录" },
      { name: "evidence_refs", label: "故障消除、定位、围栏与天气证据", type: "textarea", placeholder: "每行一个记录号或文件引用" },
      { name: "stop_ack", label: "停机状态已取得可追查回执", type: "checkbox" },
      { name: "fault_cleared", label: "故障原因已排除并记录", type: "checkbox" },
      { name: "area_clear", label: "作业区域已清场并完成隔离", type: "checkbox" },
      { name: "machine_isolated", label: "动力、PTO、阀泵等危险能源已隔离", type: "checkbox" },
      { name: "implement_safe", label: "机具已处于制造商规定的安全位置", type: "checkbox" },
      { name: "position_verified", label: "当前位置与返场/续作点已核验", type: "checkbox" },
      { name: "geofence_verified", label: "电子围栏与禁入区已核验", type: "checkbox" },
      { name: "weather_verified", label: "当前天气与作业限制已核验", type: "checkbox" },
      { name: "operator_confirmed", label: "机手确认设备可由软件解除锁定", type: "checkbox" },
    ],
    validate: (data) => {
      if (data.operator_id.length < 2 || data.supervisor_id.length < 2) return "机手与监护人姓名或工号均至少 2 个字符。";
      if (data.operator_id === data.supervisor_id) return "机手与独立监护人不能是同一人。";
      if (data.stop_ack_ref.length < 3) return "请输入可追查的停机回执或现场确认记录号。";
      if (!data.evidence_refs.split(/[\n,，;；]+/).map((v) => v.trim()).filter(Boolean).length) return "至少填写一个故障、定位、围栏或天气证据引用。";
      return "";
    },
  });
  if (!values) return null;
  return {
    ...values,
    evidence_refs: values.evidence_refs.split(/[\n,，;；]+/).map((v) => v.trim()).filter(Boolean),
  };
}

/**
 * 统一运营可信条：对齐国际农场管理平台常见的“连接 / 新鲜度 / 留痕”提示。
 * 只展示真实已知状态，不把模型建议伪装成设备事实。
 */
function opsTrustBar({ freshness = "待接入时间戳", connectivity = "链路待核验", coverage = "覆盖待核验", trace = "留痕待核验", dataMeta = null } = {}) {
  const isLive = dataMeta && dataMeta.mode === "live";
  const isDemo = !isLive;
  const title = isLive ? "数据可信" : "数据边界";
  const source = (dataMeta && (dataMeta.source_label || dataMeta.source)) ||
    (window.FarmRuntime.transport() === "backend" ? "后端仿真库" : window.FarmRuntime.transport() === "mixed" ? "混合仿真源" : "本地规则引擎");
  if (isDemo) {
    freshness = (dataMeta && dataMeta.as_of) ? `数据截至 ${dataMeta.as_of}` : "数据刷新";
    connectivity = source;
    trace = `仿真留痕 · ${trace}`;
  }
  return `
    <div class="ops-trust-bar ${isDemo ? "is-demo" : "is-live"}" role="status" aria-label="${esc(title)}状态">
      <span class="ops-trust-title"><i class="dot ${isLive ? "green pulse" : "orange"}"></i> ${esc(title)}</span>
      <span><em>链路</em><b>${esc(connectivity)}</b></span>
      <span><em>新鲜度</em><b>${esc(freshness)}</b></span>
      <span><em>覆盖</em><b>${esc(coverage)}</b></span>
      <span><em>记录</em><b>${esc(trace)}</b></span>
    </div>`;
}

/** 页面级标准作业闭环。MutationObserver 让页内重绘后仍保持完整。 */
const PAGE_PLAYBOOKS = {
  twin: { title: "看田步骤", active: 1, steps: [["选田", "twin"], ["叠图研判", "twin"], ["候选草案", "water"], ["人工门禁", "tasks"], ["回执复盘", "history"]] },
  plants: { title: "单株管控步骤", active: 1, steps: [["采样", "twin"], ["地上/地下表型", "plants"], ["联合诊断", "diagnosis"], ["形成处方", "water"], ["复测归档", "history"]] },
  water: { title: "灌溉决策步骤", active: 2, steps: [["传感与QC", "devices"], ["墒情判读", "twin"], ["候选草案", "water"], ["人工确认", "tasks"], ["设备ACK核查", "tasks"]] },
  tasks: { title: "工单审核步骤", active: 2, steps: [["计划", "dashboard"], ["风险校验", "twin"], ["审核/人工确认", "tasks"], ["流程回放", "fleet"], ["验收证据", "history"]] },
  fleet: { title: "机队作业步骤", active: 2, steps: [["候选计划", "dashboard"], ["资源编组", "devices"], ["联合回放", "fleet"], ["回执核验", "tasks"], ["绩效复核", "history"]] },
  robots: { title: "无人装备作业步骤", active: 2, steps: [["候选任务", "tasks"], ["航线/地块", "twin"], ["沙箱登记", "robots"], ["协同复核", "fleet"], ["回放归档", "history"]] },
  season: { title: "全季作业步骤", active: 2, steps: [["季前计划", "dashboard"], ["装备整备", "devices"], ["田间证据", "season"], ["收贮核验", "postharvest"], ["年度复核", "history"]] },
  postharvest: { title: "收后处理步骤", active: 2, steps: [["田间机收", "fleet"], ["转运交接", "season"], ["入仓/加工", "postharvest"], ["批次溯源", "assets"], ["质量归档", "history"]] },
  devices: { title: "设备接入步骤", active: 2, steps: [["选型接入", "vendors"], ["注册校准", "devices"], ["状态核验", "devices"], ["模拟请求", "fleet"], ["ACK与维护留痕", "tasks"]] },
  vendors: { title: "厂家接入步骤", active: 1, steps: [["协议登记", "vendors"], ["联调验收", "vendors"], ["设备入网", "devices"], ["健康监测", "arch"], ["SLA复盘", "assets"]] },
  collab: { title: "协同处置步骤", active: 2, steps: [["发现异常", "twin"], ["证据汇聚", "diagnosis"], ["多方研判", "collab"], ["人工门禁", "tasks"], ["执行复盘", "history"]] },
  diagnosis: { title: "诊断步骤", active: 1, steps: [["感知证据", "twin"], ["联合诊断", "diagnosis"], ["专家复核", "workbench"], ["人工确认", "tasks"], ["效果验证", "history"]] },
  workbench: { title: "专家协作步骤", active: 2, steps: [["问题拆解", "workbench"], ["并行分析", "agents"], ["交叉复核", "workbench"], ["形成结论", "collab"], ["人工决定", "tasks"]] },
  council: { title: "评议步骤", active: 2, steps: [["定义问题", "council"], ["分域取证", "assets"], ["独立评议", "council"], ["人工门禁", "tasks"], ["归档复盘", "history"]] },
  agents: { title: "智能体治理", active: 2, steps: [["目标定义", "workbench"], ["能力选择", "agents"], ["运行监控", "agents"], ["人工门禁", "collab"], ["审计追溯", "assets"]] },
  ai: { title: "AI 分析步骤", active: 2, steps: [["数据输入", "assets"], ["检索/模型", "ai"], ["草案生成", "ai"], ["人工复核", "tasks"], ["结果反馈", "history"]] },
  history: { title: "复盘步骤", active: 3, steps: [["执行记录", "tasks"], ["地块档案", "history"], ["年度对比", "history"], ["效果复盘", "history"], ["下季计划", "dashboard"]] },
  assets: { title: "数据流转步骤", active: 2, steps: [["采集", "devices"], ["质检", "arch"], ["目录/预览", "assets"], ["模型消费", "ai"], ["审计共享", "history"]] },
  arch: { title: "云边端数据流", active: 2, steps: [["田间端", "devices"], ["边缘节点", "arch"], ["数据平台", "assets"], ["AI 决策", "agents"], ["执行反馈", "dashboard"]] },
};

function enhanceRenderedPage() {
  if (current === "dashboard") return;
  const shell = view.querySelector(".page-shell");
  const cfg = PAGE_PLAYBOOKS[current];
  if (!shell || !cfg || shell.querySelector(":scope > .ops-playbook")) return;
  const html = `
    <nav class="ops-playbook" aria-label="${esc(cfg.title)}">
      <b>${esc(cfg.title)}</b>
      <div class="ops-playbook-steps">
        ${cfg.steps.map(([label, page], idx) => {
          const allowed = rolePageAllowed(page);
          return `
          <button type="button" class="ops-step ${idx < cfg.active ? "is-done" : idx === cfg.active ? "is-active" : ""} ${allowed ? "" : "is-locked"}"
            ${allowed ? `data-flow-jump="${esc(page)}"` : "disabled"} ${allowed ? "" : 'title="当前角色仅可查看授权页面"'}>
            <i>${idx < cfg.active ? "✓" : idx + 1}</i><span>${esc(label)}</span>
          </button>`;
        }).join("")}
      </div>
      <span class="ops-playbook-note">计划 → 人工门禁 → 流程回放 → 验收证据</span>
    </nav>`;
  const anchor = shell.querySelector(":scope > .status-strip, :scope > .seg-tabs, :scope > .plant-view-toggle");
  if (anchor) anchor.insertAdjacentHTML("afterend", html);
  else shell.insertAdjacentHTML("afterbegin", html);
}

const pageEnhancer = new MutationObserver(() => queueMicrotask(enhanceRenderedPage));
pageEnhancer.observe(view, { childList: true, subtree: false });
document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-flow-jump]");
  if (!btn) return;
  navigate({ page: btn.dataset.flowJump, land: twinFocus || undefined });
});

function csvCell(value) {
  const raw = String(value ?? "");
  const first = raw.replace(/^[ \t\r\n]+/, "").charAt(0);
  const s = ["=", "+", "-", "@", "\t", "\r"].includes(first) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function downloadCsv(filename, rows) {
  const body = "\uFEFF" + (rows || []).map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast("台账已生成", filename, "green");
}

async function render(token = renderToken) {
  const page = current;
  if (page !== "dashboard") destroyDashboardMap();
  if (page !== "twin") destroyTwinMap();
  window.FarmTelemetry?.setPage(page);
  try {
    let htmlPromise;
    if (page === "dashboard") htmlPromise = renderDashboard();
    else if (page === "twin") htmlPromise = renderTwin();
    else if (page === "plants") htmlPromise = renderPlants();
    else if (page === "season") htmlPromise = renderSeason();
    else if (page === "postharvest") htmlPromise = renderPostharvest();
    else if (page === "fleet") htmlPromise = renderFleet();
    else if (page === "collab") htmlPromise = renderCollab();
    else if (page === "diagnosis") htmlPromise = renderDiagnosis();
    else if (page === "workbench") htmlPromise = renderWorkbench();
    else if (page === "agents") htmlPromise = renderAgents();
    else if (page === "council") htmlPromise = renderCouncil();
    else if (page === "devices") htmlPromise = renderDevices();
    else if (page === "vendors") htmlPromise = renderVendors();
    else if (page === "robots") htmlPromise = renderRobots();
    else if (page === "ai") htmlPromise = renderAI();
    else if (page === "ai_assistant") {
      if (!window.FarmAiRuntime) throw new Error("AI 智能管家资源未加载，请刷新后重试");
      htmlPromise = window.FarmAiRuntime.renderAssistant({ role: currentRole, navigate, toast, esc });
    }
    else if (page === "ai_settings") {
      if (!window.FarmAiRuntime) throw new Error("AI 与报告资源未加载，请刷新后重试");
      htmlPromise = window.FarmAiRuntime.renderSettings({ role: currentRole, navigate, toast, esc });
    }
    else if (page === "water") htmlPromise = renderWater();
    else if (page === "tasks") htmlPromise = renderTasks();
    else if (page === "history") htmlPromise = renderHistory();
    else if (page === "assets") htmlPromise = renderAssets();
    else if (page === "arch") htmlPromise = renderArch();
    else {
      view.innerHTML = `<div class="panel"><h3>模块未找到</h3><div class="sub">page=${esc(page)}</div></div>`;
      return;
    }
    await htmlPromise;
    if (token !== renderToken || page !== current) return;
  } catch (e) {
    if (token !== renderToken || page !== current) return;
    view.innerHTML = `<div class="panel">加载失败：${esc(e.message)}</div>`;
  }
}

async function renderExpertDashboard() {
  const token = renderToken;
  await api("/api/role", { method: "POST", body: JSON.stringify({ role: "expert" }) });
  if (token !== renderToken) return;
  const [d, desk, collab, fleet] = await Promise.all([
    api("/api/dashboard"),
    api("/api/role/desk"),
    api("/api/collab/center").catch(() => null),
    api("/api/fleet").catch(() => null),
  ]);
  if (token !== renderToken) return;
  const k = d.kpis;
  const p = d.priority || {};
  const ai = d.ai_dispatch || {};
  const m = desk.metrics || {};
  const pendingHuman = collab && collab.metrics ? collab.metrics.human : 0;
  const joint = (fleet && fleet.selected) || (fleet && fleet.ops && fleet.ops[0]) || null;
  document.getElementById("pageSub").textContent =
    `待审 ${m.audit || 0} · 候选处方 ${m.plans || 0} · 人工待办 ${pendingHuman} · 本地仿真数据`;

  view.innerHTML = `
    <div class="page-shell">
    <div class="role-cap-bar expert">
      <div>
        <b>农技专家 · 完整能力已开启</b>
        <div class="sub">${esc((desk.motto || "") )} · 左侧导航已切换为专业能力树</div>
      </div>
      <div class="cap-tags">${((window.FarmSpec && FarmSpec.roleCaps.expert.caps) || []).map((c) => `<span class="tag blue">${esc(c)}</span>`).join("")}</div>
    </div>

    ${pgKpis([
      { label: "待审核", value: m.audit || 0, cls: "is-wait", clickable: true, attrs: `id="exKpiAudit"` },
      { label: "流程回放中", value: m.running || 0, cls: "is-wait", clickable: true, attrs: `id="exKpiRun"` },
      { label: "生产接入 Agent", value: m.agents || 0, cls: "is-wait", clickable: true, attrs: `id="exKpiAgents"` },
      { label: "候选处方待补证", value: m.plans || 0, cls: "is-wait" },
      { label: "人工待办", value: pendingHuman, cls: "is-wait", clickable: true, attrs: `id="exKpiHuman"` },
      { label: "亩增收目标（待核验）", value: k.income_per_mu || 560, unit: "元", cls: "is-wait" },
    ], 6)}

    <div class="cmd-board is-urgent">
      <div class="cmd-body">
        <div class="cmd-main">
          <div class="cmd-kicker"><span class="cmd-badge">优先研判</span><span class="cmd-land-tag">${esc(p.land_code || "全场")}</span></div>
          <h2 class="cmd-title">${esc(p.title || "查看今日研判")}</h2>
          <p class="cmd-desc">${esc(p.desc || "")}</p>
          <div class="reason-board" aria-label="研判依据">
            <article class="reason-card why">
              <header class="reason-label"><span class="reason-ico">①</span>研判依据</header>
              <p class="reason-body">${esc(p.why || "—")}</p>
            </article>
            <article class="reason-card delay">
              <header class="reason-label"><span class="reason-ico">②</span>延误成本</header>
              <p class="reason-body">${esc(p.delay_cost || "—")}</p>
            </article>
            <article class="reason-card ready">
              <header class="reason-label"><span class="reason-ico">③</span>窗口 / 物料</header>
              <p class="reason-body">${esc(p.weather_hint || "—")}${p.materials ? ` · ${esc(p.materials)}` : ""}</p>
            </article>
          </div>
          <div class="cmd-actions">
            <button class="btn cmd-cta" id="exPrio">${esc(p.cta || "进入处置")}</button>
            <button class="btn ghost" id="exDiag">联合诊断</button>
            <button class="btn ghost" id="exCouncil">专家委员会</button>
            <button class="btn ghost" id="exWb">协作工作台</button>
            <button class="btn ghost" id="exAudit">任务审核台</button>
            <button class="btn ghost" id="exExport">导出研判台账</button>
          </div>
        </div>
        <div class="cmd-facts">
          <div class="cmd-fact"><span class="sub">作业窗口</span><b class="num">${(ai.window && ai.window.score) || "--"}</b><em>${esc((ai.window && ai.window.slot) || "")}</em></div>
          <div class="cmd-fact"><span class="sub">计划机队占用</span><b class="num">${(ai.load && ai.load.util) || 0}<small>%</small></b><em>计划忙 ${(ai.load && ai.load.busy) || 0} / 闲 ${(ai.load && ai.load.idle) || 0}</em></div>
          <div class="cmd-fact"><span class="sub">排程冲突</span><b>${(ai.conflicts && ai.conflicts[0] && ai.conflicts[0].level) || "低"}</b><em>${esc((ai.conflicts && ai.conflicts[0] && ai.conflicts[0].text) || "未发现硬冲突")}</em></div>
          <div class="cmd-fact"><span class="sub">联合回放草案</span><b>${esc((joint && (joint.id || joint.title)) || "—")}</b><em>待人工编排</em></div>
        </div>
      </div>
    </div>

    ${opsTrustBar({
      freshness: (d.weather && d.weather.last_sync) || "数据刷新",
      connectivity: (d.weather && d.weather.link) || "设备链路待生产核验",
      coverage: `站端清单 ${k.devices_online || 0}/${k.devices_total || 0} · 测点清单 ${k.sensors_online || 0}/${k.sensors_total || 0}`,
      trace: `待审 ${m.audit || 0} · 专家批注留痕`,
      dataMeta: d.data_meta,
    })}

    <div class="pg-split hist-main ex-desk-split">
      <div class="panel pg-card">
        ${pgCardHd("待审核队列", `${Math.min(6, (desk.audit_queue || []).length)} / ${(desk.audit_queue || []).length} 条优先显示`, `<button class="btn ghost" id="exAllAudit">打开审核台</button>`)}
        <div class="pg-feed">
        ${(desk.audit_queue || []).slice(0, 6).map((t) => `
          <div class="item ${t.priority === "高" ? "warn" : ""}">
            <div class="row-between"><b>${esc(t.title)}</b><span class="tag orange">待审</span></div>
            <div class="sub">${esc(t.land_code)} · ${esc(t.task_type)} · ${esc(t.note)}</div>
            <div class="pg-toolbar">
              <button class="btn" data-ex-pass="${t.id}">记录初审通过</button>
              <button class="btn ghost" data-ex-reject="${t.id}">退回补证</button>
              <button class="btn ghost" data-ex-land="${esc(t.land_code)}">孪生</button>
            </div>
          </div>`).join("") || "<div class='empty-hint'>暂无待审任务</div>"}
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("水肥证据批注", "输入、边界与窗口复核")}
        ${(desk.prescriptions || []).map((pl) => `
          <div class="item">
            <div class="row-between"><b>${esc(pl.land_code)} · ${pl.calculation_status === "NOT_CALCULATED" || pl.water_mm == null ? "水量未计算" : `${pl.water_mm} mm`}</b><span class="tag blue">${esc(pl.status)}</span></div>
            <div class="sub">${esc(pl.fertilizer)}</div>
            <div>${esc(pl.reason)}</div>
            <div class="toolbar" style="margin-top:8px">
              <button class="btn ghost" data-note-plan="${pl.id}" data-note-land="${esc(pl.land_code)}">记录证据初审</button>
              <button class="btn ghost" data-rev-plan="${pl.id}" data-note-land="${esc(pl.land_code)}">退回补证</button>
            </div>
          </div>`).join("") || "<div class='sub'>暂无处方</div>"}
        <h3 style="margin-top:14px">专业能力入口</h3>
        <div class="expert-shortcuts">
          ${(desk.shortcuts || []).map((s) => `
            <button type="button" class="expert-sc" data-sc="${esc(s.page)}">
              <b>${esc(s.label)}</b><span class="sub">${esc(s.desc || "")}</span>
            </button>`).join("")}
        </div>
      </div>
    </div>

    <div class="pg-grid cols-2">
      <div class="panel pg-card">
        ${pgCardHd("Agent 模拟状态", "规则编排与留痕", `<button class="btn ghost" id="exAgents">名册/编排</button>`)}
        ${(d.agents || []).slice(0, 6).map((a) => `
          <div class="agent-chip clickable" data-go-agents="1">
            <span class="dot ${a.status === "运行中" || a.status === "执行中" ? "green pulse" : "orange"}"></span>
            <div><b>${esc(a.name)}</b><div class="sub">${esc(a.last_action || "").slice(0, 40)}</div></div>
            <span class="num">${a.score || "-"}</span>
          </div>`).join("")}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("冲突与窗口", (ai.window && ai.window.reason) || "作业窗口")}
        ${(ai.conflicts || []).map((c, i) => `
          <div class="item clickable insight-jump" data-jump="${esc(c.jump || "fleet")}" data-land="${esc(c.land || p.land_code || "")}">
            <b>${esc(c.text)}</b><div class="sub">${esc(c.resolve)} · 点击进入处置</div>
          </div>`).join("")}
        <button class="btn" id="exOrch" style="width:100%;justify-content:center;margin-top:10px">生成总调度协同研判</button>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("AI 洞察", "可点跳转处置")}
        ${(ai.insights || []).map((ins) => `
          <div class="item clickable insight-jump" data-jump="${esc(ins.jump || "ai")}" data-land="${esc(ins.land || "")}" data-layer="${esc(ins.layer || "")}">
            <b>${esc(ins.title)}</b><div class="sub">${esc(ins.text)}</div>
          </div>`).join("") || "<div class='sub'>暂无洞察</div>"}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("近期专家批注", "审核留痕")}
        ${(desk.reviews || []).map((r) => `
          <div class="item"><div class="row-between"><b>${esc(r.title || r.result)}</b><span class="tag orange">${esc(r.result)}</span></div>
          <div class="sub">${esc(r.land_code || "")} · ${esc(r.at)}</div>
          <div>${esc(r.comment || "")}</div>
          ${r.reviewer_id ? `<div class="sub">签核声明：${esc(r.reviewer_id)} · ${esc(r.qualification_scope || "资质范围待核验")} · ${esc(r.credential_ref || "凭证待核验")} · 身份未接 SSO</div>` : ""}</div>
        `).join("") || "<div class='sub'>审核后将出现在此</div>"}
      </div>
    </div>
    <div class="context-tip-strip">
      ${((window.FarmSpec && FarmSpec.contextTips && FarmSpec.contextTips.expert) || []).map((t) => `
        <button type="button" class="context-tip" data-jump="${esc(t.jump)}" data-layer="${esc(t.layer || "")}">
          <span class="tip-ico">${esc(t.icon || "→")}</span><span>${esc(t.text)}</span>
        </button>`).join("")}
    </div>
    </div>`;

  document.getElementById("exPrio").onclick = () => navigate({ page: p.jump || "fleet", land: p.land_code });
  document.getElementById("exDiag").onclick = () => navigate({ page: "diagnosis", land: p.land_code });
  document.getElementById("exCouncil").onclick = () => navigate({ page: "council", land: p.land_code });
  document.getElementById("exWb").onclick = () => navigate({ page: "workbench" });
  document.getElementById("exAudit").onclick = () => navigate({ page: "tasks", taskTab: "current" });
  document.getElementById("exExport").onclick = () => downloadCsv(
    `专家研判台账_${localDateKey()}.csv`,
    [
      ["类别", "编号", "地块", "标题/处方", "状态/结果", "说明", "签核人", "资质范围", "凭证编号", "身份可信级别"],
      ...(desk.audit_queue || []).map((t) => ["待审核任务", t.id, t.land_code, t.title, "待审", t.note, "", "", "", ""]),
      ...(desk.prescriptions || []).map((pl) => ["水肥证据草案", pl.id, pl.land_code, `${pl.calculation_status === "NOT_CALCULATED" || pl.water_mm == null ? "水量未计算" : `${pl.water_mm} mm`} ${pl.fertilizer}`, pl.status, pl.reason, "", "", "", ""]),
      ...(desk.reviews || []).map((r) => ["专家批注", r.id || "", r.land_code || "", r.title || "批注", r.result, r.comment, r.reviewer_id || "", r.qualification_scope || "", r.credential_ref || "", r.identity_assurance || "未登记"]),
    ]
  );
  document.getElementById("exAllAudit").onclick = () => navigate({ page: "tasks" });
  document.getElementById("exAgents").onclick = () => navigate({ page: "agents" });
  document.getElementById("exKpiAudit")?.addEventListener("click", () => navigate({ page: "tasks", taskTab: "current" }));
  document.getElementById("exKpiRun")?.addEventListener("click", () => navigate({ page: "tasks" }));
  document.getElementById("exKpiAgents")?.addEventListener("click", () => navigate({ page: "agents" }));
  document.getElementById("exKpiHuman")?.addEventListener("click", () => navigate({ page: "collab" }));
  document.getElementById("exOrch").onclick = async () => {
    const r = await api("/api/agents/orchestrate", { method: "POST", body: JSON.stringify({ goal: p.title || "专家协同研判" }) });
    toast("协同完成", r.summary || "", "green");
    navigate({ page: "collab" });
  };
  view.querySelectorAll("[data-sc]").forEach((btn) => {
    btn.onclick = () => navigate({ page: btn.dataset.sc });
  });
  view.querySelectorAll("[data-go-agents]").forEach((el) => {
    el.onclick = () => navigate({ page: "agents" });
  });
  view.querySelectorAll("[data-ex-pass]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        const payload = await requestExpertAudit({ approved: true, comment: "专家初审通过；仍须场长人工确认，不代表允许执行", title: `任务 #${btn.dataset.exPass} 专家初审` });
        if (!payload) return;
        await api(`/api/tasks/${btn.dataset.exPass}/audit`, { method: "POST", body: JSON.stringify(payload) });
        toast("已记录初审", `#${btn.dataset.exPass} · 待场长人工门禁`, "orange");
        renderExpertDashboard();
      } catch (err) {
        toast("初审未保存", err.message || "请稍后重试", "red");
      }
    };
  });
  view.querySelectorAll("[data-ex-reject]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        const payload = await requestExpertAudit({ approved: false, comment: "请补充证据后重提", title: `任务 #${btn.dataset.exReject} 退回补证` });
        if (!payload) return;
        await api(`/api/tasks/${btn.dataset.exReject}/audit`, { method: "POST", body: JSON.stringify(payload) });
        toast("已退回补证", payload.comment, "orange");
        renderExpertDashboard();
      } catch (err) {
        toast("退回未保存", err.message || "请稍后重试", "red");
      }
    };
  });
  view.querySelectorAll("[data-ex-land]").forEach((btn) => {
    btn.onclick = () => navigate({ page: "twin", land: btn.dataset.exLand });
  });
  view.querySelectorAll(".insight-jump, .context-tip").forEach((el) => {
    el.onclick = () =>
      navigate({
        page: el.dataset.jump || "dashboard",
        land: el.dataset.land || undefined,
        layer: el.dataset.layer || undefined,
        toast: ["已跳转", el.textContent.trim().slice(0, 24), "green"],
      });
  });
  view.querySelectorAll("[data-note-plan]").forEach((btn) => {
    btn.onclick = async () => {
      const payload = await requestExpertAudit({ approved: true, comment: "专家初审通过，转入人工门禁；不代表设备执行", title: `${btn.dataset.noteLand} 水肥证据初审` });
      if (!payload) return;
      await api("/api/expert/review", {
        method: "POST",
        body: JSON.stringify({ ...payload, plan_id: Number(btn.dataset.notePlan), land_code: btn.dataset.noteLand, title: "处方批注", result: "通过" }),
      });
      toast("已记录证据初审", `${btn.dataset.noteLand} · 待人工门禁`, "orange");
      renderExpertDashboard();
    };
  });
  view.querySelectorAll("[data-rev-plan]").forEach((btn) => {
    btn.onclick = async () => {
      const payload = await requestExpertAudit({ approved: false, comment: "请补齐水量输入与传感器质控证据", title: `${btn.dataset.noteLand} 水肥证据退回` });
      if (!payload) return;
      await api("/api/expert/review", {
        method: "POST",
        body: JSON.stringify({ ...payload, plan_id: Number(btn.dataset.revPlan), land_code: btn.dataset.noteLand, title: "处方退回", result: "驳回" }),
      });
      toast("已退回", payload.comment, "orange");
      renderExpertDashboard();
    };
  });
}

async function renderGovDashboard() {
  const token = renderToken;
  await api("/api/role", { method: "POST", body: JSON.stringify({ role: "gov" }) });
  if (token !== renderToken) return;
  const [d, desk] = await Promise.all([api("/api/dashboard"), api("/api/role/desk")]);
  if (token !== renderToken) return;
  const k = d.kpis;
  const m = desk.metrics || {};
  const p = d.priority || {};
  const ai = d.ai_dispatch || {};
  document.getElementById("pageSub").textContent =
    `仿真范围 ${(m.area_mu || k.area_mu || 0).toLocaleString("zh-CN")} 亩 · 高优任务 ${m.high_tasks || 0} · 生产设备遥测未接入`;

  /* 高优任务改成翻页：原来 slice(0,6) 一次铺开，后面几条根本看不到，
     卡片还被撑到左边合规板的两倍高。现在一页三条，全部 8 条都翻得到。 */
  const govTasks = desk.high_tasks || [];
  const govPages = Math.max(1, Math.ceil(govTasks.length / GOV_TASK_PAGE_SIZE));
  if (govTaskPage > govPages - 1) govTaskPage = govPages - 1;
  if (govTaskPage < 0) govTaskPage = 0;
  const govFrom = govTaskPage * GOV_TASK_PAGE_SIZE;
  const govPageTasks = govTasks.slice(govFrom, govFrom + GOV_TASK_PAGE_SIZE);

  view.innerHTML = `
    <div class="page-shell">
    <div class="role-cap-bar gov">
      <div>
        <b>监管人员 · 合规监察能力已开启</b>
        <div class="sub">${esc(desk.motto || "")} · 聚焦目标核验、高优任务与证据留痕</div>
      </div>
      <div class="cap-tags">${((window.FarmSpec && FarmSpec.roleCaps.gov.caps) || []).map((c) => `<span class="tag blue">${esc(c)}</span>`).join("")}</div>
    </div>

    <div class="cmd-board farmer-board is-urgent">
      <div class="cmd-body">
        <div class="cmd-main">
          <div class="cmd-kicker"><span class="cmd-badge">${esc(p.kicker || "优先监察")}</span><span class="cmd-land-tag">${esc(p.land_code || "全场")}</span></div>
          <h2 class="cmd-title">${esc(p.title || "全场证据核查")}</h2>
          <p class="cmd-desc">${esc(p.desc || "")}</p>
          <div class="cmd-actions">
            <button class="btn cmd-cta" id="govPrio">${esc(p.cta || "打开监察台")}</button>
            <button class="btn ghost" id="govTwin">田间一张图</button>
            <button class="btn ghost" id="govHist">历年档案取证</button>
            <button class="btn ghost" id="govAsk">政策问答</button>
            <button class="btn ghost" id="govExport">导出监管快照</button>
          </div>
        </div>
        <div class="cmd-facts">
          <div class="cmd-fact clickable insight-jump" data-jump="water"><span class="sub">节水目标（待核验）</span><b class="num">${m.water_saving || 20}<small>%</small></b></div>
          <div class="cmd-fact clickable insight-jump" data-jump="devices"><span class="sub">设备档案</span><b class="num">${m.device_sample_count || 0}<small> 条</small></b></div>
          <div class="cmd-fact clickable insight-jump" data-jump="tasks"><span class="sub">高优任务</span><b class="num">${m.high_tasks || 0}</b></div>
          <div class="cmd-fact clickable insight-jump" data-jump="history"><span class="sub">亩均增收目标（待核验）</span><b class="num">${m.income_per_mu || 560}<small> 元/亩</small></b></div>
        </div>
      </div>
    </div>

    ${opsTrustBar({
      freshness: (d.weather && d.weather.last_sync) || "数据刷新",
      connectivity: (d.weather && d.weather.link) || "设备链路待生产核验",
      coverage: `生产遥测未接入 · ${(m.area_mu || k.area_mu || 0).toLocaleString("zh-CN")} 亩仿真范围`,
      trace: `高优 ${m.high_tasks || 0} · 证据链可导出`,
      dataMeta: d.data_meta,
    })}

    ${pgKpis([
      { label: "管理范围（模拟值）", value: Number(m.area_mu || k.area_mu || 0).toLocaleString("zh-CN"), unit: "亩", cls: "is-wait insight-jump", clickable: true, attrs: `data-jump="history"` },
      { label: "节水目标（待核验）", value: m.water_saving || 20, unit: "%", cls: "is-wait insight-jump", clickable: true, attrs: `data-jump="water"` },
      { label: "节肥目标（待核验）", value: m.fertilizer_saving || 15, unit: "%", cls: "is-wait insight-jump", clickable: true, attrs: `data-jump="water"` },
      { label: "减药目标（待核验）", value: m.pesticide_saving || 18, unit: "%", cls: "is-wait insight-jump", clickable: true, attrs: `data-jump="history"` },
      { label: "高优任务", value: m.high_tasks || 0, cls: "is-wait insight-jump", clickable: true, attrs: `data-jump="tasks"` },
      { label: "设备档案", value: m.device_sample_count || 0, unit: "条", cls: "is-wait insight-jump", clickable: true, attrs: `data-jump="devices"` },
    ], 6)}

    <div class="pg-split hist-main gov-desk-split">
      <div class="panel pg-card">
        ${pgCardHd("合规目标核验板", "当前均为目标模拟数据 · 点击下钻取证")}
        ${(desk.compliance || []).map((c) => `
          <div class="item clickable ${c.ok ? "ok" : "warn"} insight-jump" data-jump="${esc(c.jump || "history")}">
            <div class="row-between"><b>${esc(c.name)}</b><span class="tag ${c.verified ? (c.ok ? "green" : "orange") : "orange"}">${c.verified ? (c.ok ? "已核验达标" : "已核验关注") : "待核验"}</span></div>
            <div class="sub">${esc(c.target)} · ${esc(c.actual)} · ${esc(c.result || "点开补齐证据")}</div>
          </div>`).join("")}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("高优任务监察", `共 ${govTasks.length} 条 · 每页 ${GOV_TASK_PAGE_SIZE} 条`, `<button class="btn ghost" id="govTasks">打开监察台</button>`)}
        <div class="gov-task-list">
          ${govPageTasks.map((t) => `
          <div class="item">
            <div class="row-between"><b>${esc(t.title)}</b><span class="tag orange">${esc(t.status)}</span></div>
            <div class="sub">${esc(t.land_code)} · ${esc(t.assignee)} · 优先级 ${esc(t.priority)}</div>
            <div class="pg-toolbar">
              <button class="btn ghost" data-gov-flag="${esc(t.title)}" data-gov-land="${esc(t.land_code)}">加入监管关注</button>
              <button class="btn ghost" data-gov-land-go="${esc(t.land_code)}">看田</button>
            </div>
          </div>`).join("") || "<div class='sub'>暂无高优任务</div>"}
        </div>
        ${govTasks.length ? `<div class="pg-pager" role="group" aria-label="高优任务翻页">
          <button class="btn ghost" id="govTaskPrev" ${govTaskPage === 0 ? "disabled" : ""} aria-label="上一页">‹ 上一页</button>
          <span class="pg-pager-nums">
            ${Array.from({ length: govPages }, (_, i) => `<button type="button" class="pg-pager-num${i === govTaskPage ? " is-on" : ""}" data-gov-page="${i}" aria-label="第 ${i + 1} 页"${i === govTaskPage ? ' aria-current="page"' : ""}>${i + 1}</button>`).join("")}
          </span>
          <button class="btn ghost" id="govTaskNext" ${govTaskPage >= govPages - 1 ? "disabled" : ""} aria-label="下一页">下一页 ›</button>
          <span class="sub">第 ${govFrom + 1}–${govFrom + govPageTasks.length} 条 / 共 ${govTasks.length} 条</span>
        </div>` : ""}
      </div>
    </div>

    <div class="panel pg-card">
      ${pgCardHd("监管入口", "按监察环节跳转")}
      <div class="expert-shortcuts">
        ${(desk.shortcuts || []).map((s) => `
          <button type="button" class="expert-sc" data-sc="${esc(s.page)}">
            <b>${esc(s.label)}</b><span class="sub">${esc(s.desc || "")}</span>
          </button>`).join("")}
      </div>
    </div>

    <div class="insight-strip panel pg-card">
      ${pgCardHd("AI 与政策提示", "点击下钻核查")}
      <div class="insight-row">
        ${(ai.insights || []).map((ins) => `
          <button type="button" class="insight-card" data-jump="${esc(ins.jump || "ai")}" data-land="${esc(ins.land || "")}">
            <b>${esc(ins.title)}</b><span>${esc(ins.text)}</span>
          </button>`).join("")}
      </div>
      <div class="context-tip-strip compact">
        ${((window.FarmSpec && FarmSpec.contextTips && FarmSpec.contextTips.gov) || []).map((t) => `
          <button type="button" class="context-tip" data-jump="${esc(t.jump)}"><span class="tip-ico">${esc(t.icon || "→")}</span><span>${esc(t.text)}</span></button>
        `).join("")}
      </div>
    </div>

    <div class="panel pg-card">
      ${pgCardHd("监管关注条", "跟踪事项", `<button class="btn" id="govAddFlag">新增关注</button>`)}
      ${(desk.flags || []).map((f) => `
        <div class="item"><div class="row-between"><b>${esc(f.title)}</b><span class="tag blue">${esc(f.level)}</span></div>
        <div class="sub">${esc(f.land_code)} · ${esc(f.at)}</div><div>${esc(f.note)}</div></div>
      `).join("") || "<div class='sub'>可将高优任务或异常标记为关注，便于跟踪</div>"}
    </div>
    </div>`;

  document.getElementById("govPrio").onclick = () => navigate({ page: p.jump || "tasks", land: p.land_code });
  document.getElementById("govTwin").onclick = () => navigate({ page: "twin", land: p.land_code });
  document.getElementById("govHist").onclick = () => navigate({ page: "history" });
  document.getElementById("govAsk").onclick = () =>
    navigate({ page: "ai", aiDraft: "本季节水节肥减药是否达标？如何取证？", toast: ["政策问答", "已预填合规问题", "green"] });
  document.getElementById("govExport").onclick = () => downloadCsv(
    `监管快照_${localDateKey()}.csv`,
    [
      ["类别", "对象", "目标/优先级", "模拟值/状态", "证据/责任人"],
      ...(desk.compliance || []).map((c) => ["合规指标", c.name, c.target, c.actual, c.verified ? (c.ok ? "已核验达标" : "已核验关注") : (c.result || "待核验")]),
      ...(desk.high_tasks || []).map((t) => ["高优任务", `${t.land_code} ${t.title}`, t.priority, t.status, t.assignee]),
      ...(desk.flags || []).map((f) => ["监管关注", `${f.land_code} ${f.title}`, f.level, f.at, f.note]),
    ]
  );
  document.getElementById("govTasks").onclick = () => navigate({ page: "tasks" });
  const gotoGovPage = (n) => {
    govTaskPage = Math.min(Math.max(0, n), govPages - 1);
    renderGovDashboard();
  };
  document.getElementById("govTaskPrev")?.addEventListener("click", () => gotoGovPage(govTaskPage - 1));
  document.getElementById("govTaskNext")?.addEventListener("click", () => gotoGovPage(govTaskPage + 1));
  view.querySelectorAll("[data-gov-page]").forEach((el) => {
    el.onclick = () => gotoGovPage(Number(el.dataset.govPage));
  });
  document.getElementById("govAddFlag").onclick = async () => {
    const values = await requestEvidenceGate({
      title: "新增监管关注",
      description: "登记需要持续跟踪的合规事项；记录仅进入本地仿真审计链，不代表已形成执法结论。",
      kicker: "COMPLIANCE NOTE",
      confirmLabel: "登记关注",
      fields: [{ name: "title", label: "关注事项", value: "秋收窗口合规抽查", wide: true }],
      validate: (data) => data.title.length < 2 ? "关注事项至少填写 2 个字符。" : "",
    });
    if (!values) return;
    const title = values.title;
    await api("/api/gov/flag", { method: "POST", body: JSON.stringify({ title, land_code: p.land_code || "全场", level: "关注", note: "人工登记" }) });
    toast("已登记", title, "green");
    renderGovDashboard();
  };
  view.querySelectorAll(".insight-jump, .insight-card, .context-tip").forEach((el) => {
    el.onclick = () => navigate({ page: el.dataset.jump || "dashboard", land: el.dataset.land || undefined, layer: el.dataset.layer || undefined });
  });
  view.querySelectorAll("[data-gov-land-go]").forEach((btn) => {
    btn.onclick = () => navigate({ page: "twin", land: btn.dataset.govLandGo });
  });
  view.querySelectorAll("[data-sc]").forEach((btn) => {
    btn.onclick = () => navigate({ page: btn.dataset.sc });
  });
  view.querySelectorAll("[data-gov-flag]").forEach((btn) => {
    btn.onclick = async () => {
      await api("/api/gov/flag", {
        method: "POST",
        body: JSON.stringify({ title: btn.dataset.govFlag, land_code: btn.dataset.govLand, level: "跟踪", note: "来自高优任务监察" }),
      });
      toast("已标记关注", btn.dataset.govFlag, "green");
      renderGovDashboard();
    };
  });
}

async function renderDashboard() {
  if (currentRole === "expert") return renderExpertDashboard();
  if (currentRole === "gov") return renderGovDashboard();
  const token = renderToken;
  await api("/api/role", { method: "POST", body: JSON.stringify({ role: "farm" }) });
  if (token !== renderToken) return;
  const [d] = await Promise.all([api("/api/dashboard")]);
  if (token !== renderToken) return;
  const p = d.priority || {};
  const ai = d.ai_dispatch || {};
  const jobs = d.today_jobs || [];
  const warns = (d.alerts || []).filter((a) => a.level === "warn");
  const board = d.land_board || [];
  const landSummary = d.land_summary || {
    total: board.length,
    pending: board.filter((b) => b.level !== "ok" && b.level !== "watch").length,
    ok: board.filter((b) => b.level === "ok" || b.level === "watch").length,
  };
  const topPriors = (board.filter((b) => b.level !== "ok" && b.level !== "watch").length
    ? board.filter((b) => b.level !== "ok" && b.level !== "watch")
    : board
  ).slice(0, 4);
  const aiAskDraft = topPriors.length
    ? `本周这几块田：${topPriors.map((b) => `${b.code}${b.tag}`).join("、")}，先干哪几块、怎么干更省事？`
    : `${p.land_code && p.land_code !== "全场" ? p.land_code + " " : ""}${p.title || "本周该怎么干"}？`;
  const week = d.week_plan || {
    range: "",
    pending: landSummary.pending,
    queued: 0,
    groups: [],
    items: board,
    days: [],
    safety: {},
    progress: 0,
    progress_area: 0,
    done: 0,
    running: 0,
    halted: 0,
    accepting: 0,
    area_total: 0,
    area_done: 0,
    area_running: 0,
    area_queued: 0,
    area_risk: 0,
    area_suitable_today: 0,
  };
  const safety = week.safety || {};
  const weekDays = week.days && week.days.length ? week.days : [];
  const allItems =
    week.items && week.items.length
      ? week.items
      : board.map((b) => ({
          ...b,
          day_key: "d0",
          day_offset: 0,
          needs_confirm: b.level !== "ok" && b.level !== "watch",
          urgency: "优先",
          run_state: b.level !== "ok" && b.level !== "watch" ? "pending" : "ok",
          task_type: b.task_type || "农事",
          plan_slot: b.plan_slot || "",
          resource: b.resource || "—",
          priority_label: b.priority_label || "中",
        }));

  const itemState = (b) =>
    b.run_state ||
    (b.halted ? "paused" : b.running ? "running" : b.accepting ? "accepting" : b.dispatched ? "queued" : b.needs_confirm ? "pending" : "ok");

  const doneN = week.done != null ? week.done : allItems.filter((b) => itemState(b) === "done").length;
  const runningN = week.running != null ? week.running : allItems.filter((b) => itemState(b) === "running").length;
  const pendingN = week.pending != null ? week.pending : allItems.filter((b) => ["pending", "locked"].includes(itemState(b))).length;
  const queuedN = week.queued != null ? week.queued : allItems.filter((b) => itemState(b) === "queued").length;
  const haltedN = week.halted != null ? week.halted : allItems.filter((b) => itemState(b) === "paused").length;
  const acceptingN = week.accepting != null ? week.accepting : allItems.filter((b) => itemState(b) === "accepting").length;
  const waitN = pendingN + queuedN;

  const win = ai.window || {};
  const load = ai.load || {};
  const hours = Array.isArray(win.hours) ? win.hours : [];
  const suitableMu = win.suitable_mu != null ? win.suitable_mu : week.area_suitable_today || 0;
  const areaTotal = week.area_total != null ? week.area_total : allItems.reduce((s, i) => s + (Number(i.area_mu) || 0), 0);
  const areaDone = week.area_done != null ? week.area_done : 0;
  const areaRunning = week.area_running != null ? week.area_running : 0;
  const areaQueued = week.area_queued != null ? week.area_queued : Math.max(0, Math.round(areaTotal) - Math.round(areaDone) - Math.round(areaRunning));
  const progressArea = week.progress_area != null ? week.progress_area : areaTotal ? Math.round((areaDone / areaTotal) * 100) : 0;
  const okHour = hours.find((h) => h.ok) || hours[0] || null;
  const windowLead = okHour
    ? `${okHour.range || ""}${okHour.focus ? ` · 宜${okHour.focus}` : ""}`.trim()
    : "查看分时适宜度";
  const workTotal = week.work_total != null ? week.work_total : allItems.filter((b) => itemState(b) !== "ok").length;
  const fleetBusy = load.busy != null ? load.busy : 0;
  const fleetTotal = load.total != null ? load.total : fleetBusy + (load.idle || 0);
  const fleetLabel = load.label || `${fleetBusy}/${Math.max(1, fleetTotal)}台`;
  const fleetUtil = load.util != null ? load.util : Math.round((fleetBusy / Math.max(1, fleetTotal)) * 100);

  const weatherShort = (() => {
    const raw = (d.weather && (d.weather.summary || d.weather.farmer_line)) || "天气快照缺失";
    return String(raw).replace(/^出门看天[：:]\s*/, "").split(" · ")[0];
  })();
  const paused = !!(safety.auto_paused || (d.co_decision && d.co_decision.auto_paused));
  const emergencyLocked = !!(safety.emergency_locked || (d.co_decision && d.co_decision.emergency_locked));

  const conflict =
    week.conflict ||
    (ai.conflicts || []).find((c) => c && (c.level === "中" || c.level === "高" || c.level === "紧急")) ||
    null;
  const conflictLands = conflict
    ? [...new Set([...(conflict.lands || []), ...(String(conflict.text || "").match(/[A-Z]-\d+/g) || [])])]
    : [];

  const suggestItems = allItems
    .filter((b) => ["pending", "locked", "queued"].includes(itemState(b)))
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (a.day_offset || 0) - (b.day_offset || 0))
    .slice(0, 5);
  const HOME_QUEUE_LIMIT = 6;
  const defaultTodoItems = allItems
    .filter((b) => ["pending", "locked", "queued"].includes(itemState(b)))
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (a.day_offset || 0) - (b.day_offset || 0));

  const stateLabelOf = (b) => {
    const rs = itemState(b);
    if (rs === "running") return "流程回放";
    if (rs === "paused") return "回放已暂停";
    if (rs === "accepting") return "回放待归档";
    if (rs === "done") return "回放已归档";
    if (b.state) return b.state;
    return (
      {
        pending: "待登记",
        locked: "安全锁定",
        queued: "待人工确认",
        running: "流程回放",
        paused: "回放已暂停",
        accepting: "回放待归档",
        done: "回放已归档",
        deferred: "已改期",
        ok: "巡田中",
      }[rs] || rs
    );
  };

  const stateClsOf = (rs) =>
    ({
      paused: "st-halt",
      running: "st-run",
      accepting: "st-accept",
      queued: "st-queue",
      pending: "st-pend",
      locked: "st-halt",
      done: "st-done",
      deferred: "st-defer",
      ok: "st-ok",
    }[rs] || "st-ok");

  const canPickItem = (b) => {
    const rs = itemState(b);
    return b.executable !== false && ["pending", "locked", "queued", "running", "paused", "accepting"].includes(rs);
  };

  const renderQueue = (items) => {
    if (!items.length) {
      return `<div class="empty-hint week-empty">
        <div role="status" aria-live="polite">
          <b>当前筛选没有农事</b>
          <div class="sub">可切换日期、状态或地块范围</div>
        </div>
        <button type="button" class="btn ghost" id="weekResetFilters">回到本周待办</button>
      </div>`;
    }
    const head = `<div class="wq-table-head wq-grid">
      <label class="wq-h-check" title="全选当前列表可操作项">
        <input type="checkbox" id="landSelectAll" aria-label="全选当前列表可操作项" />
      </label>
      <span>地块</span>
      <span>作物/面积</span>
      <span>农事</span>
      <span>核验 / 仿真窗口</span>
      <span>状态</span>
      <span>优先级</span>
      <span>关联资源</span>
      <span>风险/建议</span>
      <span class="wq-h-ops">操作</span>
    </div>`;
    const rows = items
      .map((b) => {
        const runState = itemState(b);
        const canPick = canPickItem(b);
        const pri = b.priority_label || b.urgency || "中";
        const priCls = pri === "紧急" ? "hot" : pri === "高" || pri === "优先" ? "mid" : "low";
        const tip = b.agent_tip || b.reason || "";
        const riskBits = [];
        if (b.conflict) riskBits.push("冲突");
        if (b.halt_reason) riskBits.push(b.halt_reason);
        if (tip) riskBits.push(tip);
        const riskText = riskBits.join(" · ") || "—";
        const evidenceState = b.evidence_status || (b.executable === false ? "证据缺失" : "待核验");
        const owner = b.accountable_person || "待指派责任人";
        const dueAt = b.due_at || b.when || "待确认";
        const stopCondition = b.stop_condition || "异常时停止并人工复核";
        const evidenceList = Array.isArray(b.required_evidence) ? b.required_evidence.join("、") : (b.required_evidence || "待补充原始证据");
        const displayCode = b.land_code || b.code;
        const displayPrefix = `${displayCode} · `;
        const displayName = b.land_code && String(b.name || "").startsWith(displayPrefix)
          ? String(b.name).slice(displayPrefix.length)
          : (b.name || "");
        const ops = [];
        if (b.can_dispatch || runState === "pending" || runState === "locked") {
          ops.push(
            `<button type="button" class="btn wq-primary lb-exec" data-code="${esc(b.code)}" data-action="${esc(b.action || "auto")}">${b.executable === false ? "补齐证据" : "登记任务"}</button>`
          );
        }
        if (b.executable !== false && (b.can_start || runState === "queued")) {
          ops.push(`<button type="button" class="btn wq-primary week-start" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">开始回放</button>`);
        }
        if (b.executable !== false && (b.can_pause || runState === "running")) {
          ops.push(`<button type="button" class="btn ghost danger-outline week-halt" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">暂停回放</button>`);
        }
        if (b.executable !== false && (b.can_complete || runState === "running")) {
          ops.push(`<button type="button" class="btn wq-primary week-complete" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">提交回放材料</button>`);
        }
        if (b.executable !== false && (b.can_resume || runState === "paused")) {
          ops.push(`<button type="button" class="btn wq-primary week-resume" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">继续回放</button>`);
        }
        if (b.executable !== false && (b.can_accept || runState === "accepting")) {
          ops.push(`<button type="button" class="btn wq-primary week-accept" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">归档回放</button>`);
        }
        if (b.can_defer || runState === "pending" || runState === "queued") {
          ops.push(`<button type="button" class="btn ghost week-defer" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">改期</button>`);
        }
        if (b.can_cancel || ["pending", "queued", "paused"].includes(runState)) {
          ops.push(`<button type="button" class="btn ghost week-skip" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">取消本次</button>`);
        }
        if (b.conflict) {
          ops.push(`<button type="button" class="btn ghost week-conflict-one" data-land="${esc(b.code)}" data-label="${esc(displayCode)}">处理冲突</button>`);
        }
        if (runState === "ok" || runState === "done" || !ops.length) {
          ops.push(
            `<button type="button" class="btn ghost lb-go" data-code="${esc(b.code)}" data-jump="${esc(b.jump || "twin")}">查看地块</button>`
          );
        } else {
          ops.push(
            `<button type="button" class="btn ghost lb-go" data-code="${esc(b.code)}" data-jump="${esc(b.jump || "twin")}">查看地块</button>`
          );
        }
        const primaryOps = ops.filter((op, index) => index === 0 || op.includes("week-conflict-one"));
        const moreOps = ops.filter((op, index) => index !== 0 && !op.includes("week-conflict-one"));
        const rowOps = primaryOps.join("") + (moreOps.length
          ? `<details class="wq-more" name="task-more"><summary class="btn ghost" aria-label="任务更多操作">更多</summary><div class="wq-more-list">${moreOps.join("")}</div></details>`
          : "");
        return `
        <article class="wq-row wq-grid is-${esc(runState)} level-${esc(b.cls || "green")}${b.conflict ? " has-conflict" : ""}" data-code="${esc(b.code)}" data-state="${esc(runState)}" data-area="${Number(b.area_mu) || 0}" tabindex="-1">
          <label class="wq-check" title="${canPick ? "可批量操作" : "证据不足，当前不可批量操作"}">
            <input type="checkbox" class="land-pick" aria-label="选择 ${esc(displayCode)} ${esc(b.task_type || b.tag || "农事")}" value="${esc(b.code)}" data-state="${esc(runState)}" data-area="${Number(b.area_mu) || 0}" ${canPick ? "" : "disabled"} />
          </label>
          <div class="wq-main">
            <button type="button" class="wq-code lb-go" data-code="${esc(b.code)}" data-jump="${esc(b.jump || "twin")}" title="查看 ${esc(displayCode)} 地块">${esc(displayCode)}</button>
            <span class="wq-name-sub">${esc(displayName)}</span>
          </div>
          <div class="wq-crop-cell">
            <span class="wq-crop">${esc(b.crop_name || "—")}</span>
            <small>${b.area_mu != null ? `${b.area_mu} 亩` : "—"}</small>
          </div>
          <div class="wq-task">
            <span class="wq-tag ${esc(b.cls || "green")}">${esc(b.task_type || b.tag || "农事")}</span>
          </div>
          <div class="wq-day">
            <span>${esc(b.when || "")}</span>
            <small>${esc(b.plan_slot || b.day_date || "")}</small>
          </div>
          <div class="wq-st">
            <span class="wq-state ${stateClsOf(runState)}">${esc(stateLabelOf(b))}</span>
            ${b.cmd_status ? `<small class="wq-cmd">${esc(b.cmd_status)}</small>` : ""}
          </div>
          <div class="wq-pri"><span class="wq-urgency u-${priCls}">${esc(pri)}</span></div>
          <div class="wq-res" title="${esc(b.resource || "")}">${esc(b.resource || "—")}</div>
          <div class="wq-tip" title="${esc(riskText)}&#10;${esc(evidenceState)} · ${esc(owner)} · 截止 ${esc(dueAt)}">
            <div class="wq-tip-line">
              ${b.conflict ? `<span class="wq-agent">冲突</span>` : b.agent && b.agent !== "系统" ? `<span class="wq-agent">${esc(b.agent)}</span>` : ""}
              <span class="wq-tip-text">${esc(riskText)}</span>
            </div>
            <div class="wq-tip-line">
              <small class="wq-proof">${esc(evidenceState)} · ${esc(owner)} · 截止 ${esc(dueAt)}</small>
              <details class="wq-proof-detail"><summary title="展开需补证据与停机条件">证据</summary><span><b>需补：</b>${esc(evidenceList)}</span><span><b>停止：</b>${esc(stopCondition)}</span></details>
            </div>
          </div>
          <div class="wq-ops">${rowOps}</div>
        </article>`;
      })
      .join("");
    return head + `<div class="wq-table-body">${rows}</div>`;
  };

  document.getElementById("pageSub").textContent = `本周进度 ${progressArea}% · 已归档 ${doneN}/${workTotal} 项 · 作业量 ${Math.round(areaDone).toLocaleString("zh-CN")} / ${Math.round(areaTotal).toLocaleString("zh-CN")} 亩次`;
  const pageEnv = document.getElementById("pageEnv");
  if (pageEnv) {
    pageEnv.hidden = true;
    pageEnv.innerHTML = "";
  }
  paintOpWindow(d.weather || null);

  const statusChips = [
    { key: "todo", label: "待办", count: waitN },
    { key: "running", label: "流程回放", count: runningN },
    { key: "paused", label: "已暂停", count: haltedN },
    { key: "accepting", label: "待验收", count: acceptingN },
    { key: "done", label: "已归档", count: doneN },
    { key: "all", label: "全部", count: workTotal },
  ].filter((c) => (c.key === "todo" ? true : c.key === "all" ? workTotal > waitN : c.count > 0));
  /* 只剩一种状态时它就不是选择器了：两个按钮点出来是同一张表。
     这时不渲染分段控件，计数改挂在标题上，省掉一处重复数字。 */
  const showStatusSeg = statusChips.length > 1;

  const wx = d.weather || {};
  const wxTrends = wx.trends || {};
  const wxForecast =
    Array.isArray(wx.forecast) && wx.forecast.length
      ? wx.forecast.slice(0, 5)
      : [
          { label: "今天", cond: "仿真趋势", high: Math.round((wx.air_temp || 26) + 1), low: Math.round((wx.air_temp || 26) - 8), rain: 5, verified: false },
          { label: "明天", cond: "仿真趋势", high: Math.round((wx.air_temp || 26)), low: Math.round((wx.air_temp || 26) - 7), rain: 10, verified: false },
          { label: "后日", cond: "仿真趋势", high: Math.round((wx.air_temp || 26) + 2), low: Math.round((wx.air_temp || 26) - 7), rain: 0, verified: false },
          { label: "周四", cond: "仿真趋势", high: Math.round((wx.air_temp || 26) + 1), low: Math.round((wx.air_temp || 26) - 8), rain: 12, verified: false },
          { label: "周五", cond: "仿真趋势", high: Math.round((wx.air_temp || 26) + 1.5), low: Math.round((wx.air_temp || 26) - 7), rain: 8, verified: false },
        ];

  const sparkline = (vals, color) => {
    const arr = (Array.isArray(vals) && vals.length ? vals : [1, 2, 1.5, 2.2, 1.8, 2.4, 2]).map(Number);
    const w = 72;
    const h = 26;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const span = max - min || 1;
    const pts = arr
      .map((v, i) => {
        const x = (i / Math.max(1, arr.length - 1)) * w;
        const y = h - 3 - ((v - min) / span) * (h - 6);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const last = arr[arr.length - 1];
    const lx = w;
    const ly = h - 3 - ((last - min) / span) * (h - 6);
    return `<svg class="dc-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <polyline fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
      <circle cx="${lx}" cy="${ly}" r="2.2" fill="${color}"/>
    </svg>`;
  };

  const landStateByCode = {};
  allItems.forEach((b) => {
    const rs = itemState(b);
    if (!landStateByCode[b.code] || stateClsOf(rs) === "st-run") landStateByCode[b.code] = rs;
  });
  const landFill = (code) => {
    const rs = landStateByCode[code] || "ok";
    return (
      {
        running: "rgba(23,92,211,0.55)",
        pending: "rgba(232,145,58,0.45)",
        locked: "rgba(232,145,58,0.45)",
        queued: "rgba(232,145,58,0.38)",
        paused: "rgba(224,82,72,0.5)",
        accepting: "rgba(23,107,91,0.45)",
        done: "rgba(92,184,92,0.5)",
        deferred: "rgba(143,163,144,0.35)",
        ok: "rgba(95,173,110,0.32)",
      }[rs] || "rgba(95,173,110,0.28)"
    );
  };
  const farmLands = Array.isArray(d.lands) && d.lands.length ? d.lands : [];
  const geo = window.FarmGeo || {};
  const mapCenter = geo.MAP_CENTER || [45.43288, 84.93065];
  const dashboardPlotGeometry = geo.PLOT_LL || {};
  const plotSearchIndex = farmLands.map((l) => {
    const rs = landStateByCode[l.code] || "ok";
    const taskTerms = allItems.filter((item) => item.code === l.code).map((item) => item.title || item.kind || "").join(" ");
    const plot = dashboardPlotGeometry[l.code];
    return {
      code: l.code,
      name: l.name || "",
      crop: l.crop_name || "",
      state: rs,
      fill: landFill(l.code),
      search: [l.code, l.name, l.crop_name, taskTerms].filter(Boolean).join(" ").toUpperCase(),
      coords: plot ? plot.coords : null,
      center: plot ? plot.center : mapCenter,
      label: `${l.code} ${l.crop_name || ""}`.trim(),
    };
  });

  const fleetDevices = (Array.isArray(d.devices) ? d.devices : []).filter((x) =>
    geo.isFleetUnit
      ? geo.isFleetUnit(x)
      : !x.mesh && ["tractor", "drone", "sprayer", "robot", "yield", "harvester", "seeder", "transport"].includes(x.device_type)
  );
  const countByType = (types) => fleetDevices.filter((x) => types.includes(x.device_type)).length;
  const allDevices = Array.isArray(d.devices) ? d.devices : [];
  const equipTiles = [
    { label: "地面农机", count: countByType(["tractor", "sprayer", "yield", "robot", "harvester", "seeder", "transport"]), jump: "fleet", tone: "ok" },
    { label: "无人机", count: countByType(["drone"]), jump: "robots", tone: "ok" },
    { label: "水情设备", count: allDevices.filter((x) => !x.mesh && x.device_type === "irrigation").length, jump: "water", tone: "ok" },
    { label: "农情感知", count: allDevices.filter((x) => !x.mesh && ["sensor", "weather", "rain", "par", "canopy", "leafwet", "crop_node", "pest", "gateway"].includes(x.device_type)).length, jump: "devices", tone: "muted" },
  ];
  const trendDays = weekDays.length
    ? weekDays.slice(0, 7).map((day, i) => ({
        label: day.label || `D${i + 1}`,
        n: day.count != null ? day.count : day.pending || Math.max(1, workTotal - i),
      }))
    : ["一", "二", "三", "四", "五", "六", "日"].map((label, i) => ({
        label,
        n: Math.max(1, Math.round(workTotal * (0.55 + ((i * 17) % 7) / 14)) - (i === 6 ? doneN : 0)),
      }));
  const trendMax = Math.max(1, ...trendDays.map((x) => x.n));

  const wxMetrics = [
    { k: "气温", v: wx.air_temp != null ? `${wx.air_temp} ℃` : "--", trend: wxTrends.air_temp, color: "#3a8b4e" },
    { k: "风速", v: wx.wind != null ? `${wx.wind} m/s` : "--", trend: wxTrends.wind, color: "#4a9bd9" },
    { k: "墒情", v: wx.soil_moisture != null ? `${wx.soil_moisture}%` : "--", trend: wxTrends.soil_moisture, color: "#3d9b8f" },
    { k: "土温", v: wx.soil_temp != null ? `${wx.soil_temp} ℃` : "--", trend: wxTrends.soil_temp, color: "#e8913a" },
  ];

  view.innerHTML = `
    <div class="week-ops dash-cockpit is-compact ${paused || emergencyLocked ? "is-paused" : ""}" id="landBoard">
      ${paused || emergencyLocked ? `<div class="wo-banner">${emergencyLocked ? "远程安全停止软件锁定中 · 禁止新启动，现场设备状态须人工确认" : "批量登记已锁定 · 单项仍可暂停 / 继续 / 完成"}</div>` : ""}
      ${!paused && !emergencyLocked && haltedN ? `<div class="wo-banner warn">有 ${haltedN} 项已暂停 · 可在列表中「继续作业」</div>` : ""}

      <section class="dc-overview" aria-label="本周决策总览">
      <section class="command-strip${conflict ? " has-conflict" : ""}" aria-label="今日研判">
        <div class="command-lead">
          <span class="command-eyebrow">${conflict ? "今天最要紧" : "今天待办"}</span>
          <strong>${conflict ? "有排程冲突，先处理完再下地" : (suggestItems.length ? "补齐优先证据，再由场长确认" : "当前无高优规则，仍须现场核验")}</strong>
          <span>${conflict ? "场长和机务一起核验 · 没确认前不下地" : "现场核验完成后再登记执行"}</span>
        </div>
        <div class="command-metrics">
          <div class="command-metric"><b class="num">${conflict ? conflictLands.length : suggestItems.length}</b><span>${conflict ? "关联地块" : "优先建议"}</span></div>
          <div class="command-metric"><b class="num">${Math.round(suitableMu)}<small>&nbsp;亩</small></b><span>证据齐全</span></div>
          <div class="command-metric ${conflict ? "is-alert" : ""}"><b class="num">${conflict ? "1" : "0"}</b><span>排程冲突</span></div>
          <div class="command-metric"><b class="num">${fleetUtil}%</b><span>机队占用</span></div>
        </div>
        <div class="command-actions">
          ${conflict
            ? `<button type="button" class="btn command-primary" id="conflictOpenSide" aria-haspopup="dialog" aria-controls="woSide" aria-expanded="false">核对冲突</button>
               ${conflictLands.length ? `<button type="button" class="btn ghost" id="conflictFocus">相关地块</button>` : ""}
               <button type="button" class="btn ghost" data-command-jump="twin">田块证据</button>
               <button type="button" class="btn ghost" data-command-jump="fleet">机队排程</button>
               <button type="button" class="btn ghost" id="farmExportPlan">导出计划</button>`
            : `<button type="button" class="btn command-primary" data-command-jump="twin">田块证据</button>
               <button type="button" class="btn ghost" data-command-jump="fleet">机队排程</button>
               <button type="button" class="btn ghost" id="farmExportPlan">导出计划</button>`}
        </div>
      </section>
      </section>

      <section class="dc-tasks" aria-label="待办任务">
        <div class="wo-list-block card">
          <header class="wo-task-hd" id="woTaskHd">
            <div class="wo-task-title"><b>本周执行队列</b>${showStatusSeg ? "" : `<span class="wo-task-count"><strong class="num" id="woScopeNum">${defaultTodoItems.length}</strong> 项待办</span>`}</div>
            ${showStatusSeg
              ? `<div class="wo-seg" id="weekStatusTabs" role="group" aria-label="按状态筛选任务">
              ${statusChips
                .map(
                  (c) =>
                    `<button type="button" class="wo-seg-btn wo-st-${esc(c.key)}${c.key === "todo" ? " is-on" : ""}" data-status="${esc(c.key)}" aria-pressed="${c.key === "todo" ? "true" : "false"}"><span>${esc(c.label)}</span><em class="num">${c.count}</em></button>`
                )
                .join("")}
            </div>`
              : ""}
            <div class="wo-task-tools">
              <div class="wo-filter-group">
              <div class="wo-date" id="weekDateNav" aria-label="按日期切换">
                <button type="button" class="wo-date-btn" id="weekDatePrev" aria-label="前一天">‹</button>
                <button type="button" class="wo-date-label is-week" id="weekDateLabel" title="点击回到本周全部">${esc(String(week.range || "本周").replace(/\s+/g, ""))}</button>
                <button type="button" class="wo-date-btn" id="weekDateNext" aria-label="后一天">›</button>
              </div>
              <label class="wo-sort-wrap">
                <span class="wo-tool-label" aria-hidden="true">排序</span>
                <select class="wo-find-sort" id="weekSort" aria-label="任务排序方式">
                  <option value="urgency">紧急优先</option>
                  <option value="day">按日程</option>
                  <option value="code">按地块</option>
                </select>
              </label>
              </div>
              <div class="wo-task-acts">
              <button type="button" class="btn ghost wo-prio-btn" id="prioSuggestOpen" aria-haspopup="dialog" aria-controls="prioPanel" aria-expanded="false" ${suggestItems.length ? "" : "disabled"} title="打开优先建议">
                优先建议${suggestItems.length ? `<em>${suggestItems.length}</em>` : ""}
              </button>
              <button type="button" class="btn ghost" id="woSafetyToggle" aria-expanded="false" aria-controls="woSafetyBar" title="调度安全">调度安全</button>
              </div>
            </div>
          </header>
          <button type="button" class="wo-chip wo-focus-chip" id="weekFocusChip" hidden></button>
          <div class="wo-safety" id="woSafetyBar" hidden>
            ${
              paused || emergencyLocked
                ? `<button type="button" class="btn" id="humanResume">恢复${emergencyLocked ? "（解紧急锁）" : ""}</button>`
                : `<button type="button" class="btn ghost" id="humanPauseAll">暂停调度</button>
                   <button type="button" class="btn danger-solid" id="humanEmergency">远程安全停止</button>`
            }
            ${haltedN && !(paused || emergencyLocked) ? `<button type="button" class="btn ghost" id="resumeHalted">恢复暂停 ${haltedN}</button>` : ""}
            <span class="sub">控制回放队列闸门；真实设备仍须现场急停、联锁与独立控制链</span>
          </div>
          <div class="wo-dock" id="weekDock" hidden aria-live="polite"></div>
          <div class="wo-queue" id="weekQueue">
            ${renderQueue(defaultTodoItems.slice(0, HOME_QUEUE_LIMIT))}
          </div>
          <div class="wo-table-foot">
            <span id="weekQueueMeta">优先显示 ${Math.min(HOME_QUEUE_LIMIT, defaultTodoItems.length)} / 共 ${workTotal} 项</span>
            <button type="button" class="btn ghost" id="weekShowAll" aria-expanded="false">展开全部 ${defaultTodoItems.length} 项</button>
          </div>
        </div>
      </section>

      <section class="dc-mid" aria-label="田块与农情">
        <article class="dc-map card">
          <header class="dc-card-hd">
            <div class="dc-map-hd-left">
              <b>田块分布</b>
              <div class="dc-map-tabs" role="group" aria-label="切换地图底图">
                <button type="button" class="dc-map-tab is-on" data-map-mode="field" aria-pressed="true">地块边界</button>
                <button type="button" class="dc-map-tab" data-map-mode="sat" aria-pressed="false">正射影像</button>
              </div>
            </div>
            <label class="dc-map-search">
              <input type="search" id="dcMapSearch" aria-label="搜索田块、作物或任务" aria-describedby="dcMapSearchStatus" placeholder="搜索田块、作物、任务…" autocomplete="off" />
              <span class="dc-map-search-status" id="dcMapSearchStatus" aria-live="polite">${farmLands.length} 块</span>
            </label>
          </header>
          <div class="dc-map-stage" id="dcMapStage">
            <div id="dcLeafletMap" class="dc-leaflet" role="application" aria-label="田块分布地图"></div>
            <div class="dc-map-status" aria-label="地块状态">
              <b>地块状态</b>
              <ul>
                <li><span>全部</span><em class="num">${farmLands.length}</em></li>
                <li><span>待办</span><em class="num is-wait">${waitN}</em></li>
                <li><span>执行中</span><em class="num is-run">${runningN}</em></li>
                <li><span>已归档</span><em class="num is-done">${doneN}</em></li>
                <li><span>异常</span><em class="num is-bad">${haltedN + (conflict ? 1 : 0)}</em></li>
              </ul>
            </div>
            <div class="dc-map-tools" role="toolbar" aria-label="地图缩放">
              <button type="button" class="btn ghost" id="dcZoomIn" title="放大" aria-label="放大地图">+</button>
              <button type="button" class="btn ghost" id="dcZoomOut" title="缩小" aria-label="缩小地图">−</button>
              <button type="button" class="btn ghost" id="dcZoomReset" title="复位" aria-label="复位地图缩放">⟲</button>
            </div>
            <div class="dc-map-legend" aria-hidden="true">
              <span><i class="lg run"></i>执行中</span>
              <span><i class="lg wait"></i>待办</span>
              <span><i class="lg done"></i>已归档</span>
              <span><i class="lg ok"></i>巡田</span>
            </div>
          </div>
        </article>

        <article class="dc-wx card">
          <header class="dc-card-hd">
            <div>
              <b>农情快照</b>
              <span>模拟监测 · ${esc(wx.last_sync || "本地刷新")}</span>
            </div>
            <button type="button" class="btn ghost insight-jump" data-jump="${esc(wx.jump || "devices")}">查看更多</button>
          </header>
          <div class="dc-wx-grid">
            ${wxMetrics
              .map(
                (m) => `<div class="dc-wx-item">
              <em>${esc(m.k)}</em>
              <strong class="num">${esc(m.v)}</strong>
              ${sparkline(m.trend, m.color)}
            </div>`
              )
              .join("")}
          </div>
          <div class="dc-forecast-meta"><b>五日仿真趋势</b><span>生产预报待接入</span></div>
          <div class="dc-forecast" aria-label="五日仿真天气趋势，生产预报源待接入">
            ${wxForecast
              .map(
                (f) => `<div class="dc-fc">
              <em>${esc(f.label)}</em>
              ${f.verified ? `<b>${esc(f.cond || "预报")}</b>` : ""}
              <span class="num">${f.high}° / ${f.low}°</span>
            </div>`
              )
              .join("")}
          </div>
        </article>
      </section>

      <section class="dc-secondary" aria-label="机具与趋势">
        <article class="dc-devs card">
          <header class="dc-card-hd">
            <div>
              <b>设备资源</b>
              <span>本地登记数</span>
            </div>
            <button type="button" class="btn ghost insight-jump" data-jump="devices">查看全部</button>
          </header>
          <div class="dc-dev-grid is-tiles">
            ${equipTiles
              .map(
                (c) => `<button type="button" class="dc-dev-tile insight-jump" data-jump="${esc(c.jump)}">
              <strong class="num">${c.count}</strong>
              <em>${esc(c.label)}</em>
            </button>`
              )
              .join("")}
          </div>
        </article>
        <article class="dc-bars card">
          <header class="dc-card-hd">
            <div>
              <b>本周任务分布</b>
              <span>未来 7 日计划项</span>
            </div>
          </header>
          <div class="dc-bar-chart" role="img" aria-label="未来七日计划任务量柱图">
            ${trendDays
              .map((d0) => {
                const h = Math.max(8, Math.round((d0.n / trendMax) * 100));
                return `<div class="dc-bar"><i style="height:${h}%"></i><em>${esc(d0.label)}</em><b class="num">${d0.n}</b></div>`;
              })
              .join("")}
          </div>
        </article>
      </section>

      <aside class="wo-side" id="woSide" role="dialog" aria-modal="false" aria-labelledby="woSideTitle" tabindex="-1" hidden>
        <div class="wo-side-head">
          <b id="woSideTitle">冲突核对</b>
          <button type="button" class="btn ghost" id="woSideClose">关闭</button>
        </div>
        <div class="wo-side-body">
          <p><em>原因</em>${esc((conflict && conflict.text) || "暂无冲突")}</p>
          <p><em>资源</em>${esc((conflict && conflict.resource) || "—")}</p>
          <p><em>推荐方案</em>${esc((conflict && conflict.resolve) || "错峰排程")}</p>
          <div class="wo-side-opts">
            ${
              ((conflict && conflict.options) || [{ id: "defer_b02", label: "B-02改期", action: "defer", land: "B-02" }])
                .map((op) => {
                  const label =
                    op.action === "defer" && op.land === "B-02"
                      ? "B-02改期"
                      : op.label || "处理";
                  return `<button type="button" class="btn" data-conflict-opt="${esc(op.action || "defer")}" data-land="${esc(op.land || "")}">${esc(label)}</button>`;
                })
                .join("")
            }
            <button type="button" class="btn ghost" id="conflictToFleet" data-jump="${esc((conflict && conflict.jump) || "fleet")}">去机具调整</button>
          </div>
        </div>
      </aside>

      <aside class="wo-panel" id="prioPanel" role="dialog" aria-modal="false" aria-labelledby="prioPanelTitle" tabindex="-1" hidden>
        <div class="wo-panel-head">
          <b id="prioPanelTitle">优先建议</b>
          <span class="sub">当前待办中的优先核验项 · 不自动登记或启动</span>
          <button type="button" class="btn ghost" id="prioPanelClose">关闭</button>
        </div>
        <div class="wo-panel-list" id="prioPanelList">
          ${
            suggestItems.length
              ? suggestItems
                  .map((b) => {
                    const suggestionLand = b.land_code || String(b.code || "").match(/^[A-Z]+-\d+/)?.[0] || b.code;
                    const why = [
                      b.agent_tip || b.reason || "",
                      b.plan_slot ? `窗口 ${b.plan_slot}` : "",
                      b.conflict ? "存在冲突，建议错峰" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return `<article class="wo-suggest" data-code="${esc(b.code)}">
                    <div>
                      <b>${esc(suggestionLand)} · ${esc(b.task_type || b.tag || "")}</b>
                      <span>${esc(why)}</span>
                    </div>
                    <div class="wo-suggest-acts">
                      <button type="button" class="btn ai-primary prio-focus" data-code="${esc(b.code)}" data-land="${esc(suggestionLand)}">定位任务</button>
                      <button type="button" class="btn ghost prio-skip" data-code="${esc(b.code)}">从清单移除</button>
                    </div>
                  </article>`;
                  })
                  .join("")
              : `<div class="empty-hint"><b>暂无优先待办</b><div class="sub">当前没有待登记或待人工确认项</div></div>`
          }
        </div>
      </aside>

      <button type="button" class="wo-ask-fab" id="prioAsk" title="拖动可移动 · 点击打开对话" aria-label="农事助手">
        <span class="wo-ask-bot" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="28" height="28" fill="none">
            <rect x="10" y="16" width="28" height="22" rx="8" fill="currentColor" opacity="0.92"/>
            <circle cx="19" cy="26" r="3" fill="#0b1c24"/>
            <circle cx="29" cy="26" r="3" fill="#0b1c24"/>
            <path d="M18 33h12" stroke="#0b1c24" stroke-width="2.2" stroke-linecap="round"/>
            <rect x="21" y="8" width="6" height="8" rx="3" fill="currentColor"/>
            <circle cx="24" cy="7" r="2.5" fill="currentColor"/>
          </svg>
        </span>
        <span class="wo-ask-label">农事助手</span>
      </button>

      <div class="wo-ask-panel" id="woAskPanel" hidden>
        <header class="wo-ask-hd" id="woAskHd">
          <div>
            <b>农事助手</b>
            <span>多智能体调度台</span>
          </div>
          <button type="button" class="btn ghost" id="woAskClose" title="关闭">关闭</button>
        </header>
        <section class="wo-ask-sum" id="woAskBrief"></section>
        <section class="wo-ask-agents" id="woAskAgents" aria-label="智能体调度"></section>
        <section class="wo-ask-ops" id="woAskOps" aria-label="联合作业" hidden></section>
        <div class="wo-ask-log" id="woAskLog" aria-live="polite"></div>
        <div class="wo-ask-quick" id="woAskQuick"></div>
        <div class="wo-ask-acts" id="woAskActs"></div>
        <footer class="wo-ask-ft">
          <input type="text" id="woAskInput" aria-label="向农事助手提问" placeholder="问智能体、排程、冲突、作业窗…" autocomplete="off" />
          <button type="button" class="btn ai-primary" id="woAskSend">发送</button>
        </footer>
      </div>
    </div>`;

  const homeBoard = document.getElementById("landBoard");

  const queueRoot = document.getElementById("weekQueue");
  const queueMeta = document.getElementById("weekQueueMeta");
  let dayFilter = "all";
  let statusFilter = "todo";
  let landFocus = [];
  let sortMode = "urgency";
  let queueExpanded = false;

  const stateRank = {
    paused: 0,
    running: 1,
    accepting: 2,
    queued: 3,
    pending: 4,
    locked: 4,
    deferred: 5,
    done: 6,
    ok: 7,
  };

  const filteredItems = () => {
    let list = allItems.filter((b) => {
      const runState = itemState(b);
      if (statusFilter !== "all" && runState === "ok") return false;
      if (dayFilter !== "all" && b.day_key !== dayFilter) return false;
      if (landFocus.length && !landFocus.includes(b.code)) return false;
      if (statusFilter === "todo" && !["pending", "locked", "queued"].includes(runState)) return false;
      if (statusFilter === "running" && runState !== "running") return false;
      if (statusFilter === "paused" && runState !== "paused") return false;
      if (statusFilter === "accepting" && runState !== "accepting") return false;
      if (statusFilter === "done" && runState !== "done") return false;
      if (statusFilter === "all" && runState === "ok") return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      if (sortMode === "day") return (a.day_offset || 0) - (b.day_offset || 0) || (b.score || 0) - (a.score || 0);
      if (sortMode === "code") return String(a.code).localeCompare(String(b.code));
      return (b.score || 0) - (a.score || 0) || (stateRank[itemState(a)] ?? 8) - (stateRank[itemState(b)] ?? 8) || String(a.code).localeCompare(String(b.code));
    });
    return list;
  };

  const syncChipOn = (root, attr, value) => {
    if (!root) return;
    root.querySelectorAll(`[${attr}]`).forEach((el) => {
      const on = el.getAttribute(attr) === value;
      el.classList.toggle("is-on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };

  /* 日期切到某一天以后，原来只有日期控件自己变个字，没有统一回显也没有清空出口。
     这里把日期和地块两个条件并成一条提示，点一下全部清掉。 */
  const syncFocusChip = () => {
    const chip = document.getElementById("weekFocusChip");
    if (!chip) return;
    const parts = [];
    if (!showStatusSeg && statusFilter !== "todo") {
      const hit = statusChips.find((c) => c.key === statusFilter);
      parts.push(hit ? hit.label : "指定状态");
    }
    if (dayFilter !== "all") {
      const day = weekDays.find((x) => x.key === dayFilter);
      parts.push(day ? `${day.label} ${day.date || ""}`.trim() : "指定日期");
    }
    if (landFocus.length) parts.push(`地块 ${landFocus.join("、")}`);
    if (!parts.length) {
      chip.hidden = true;
      chip.textContent = "";
      return;
    }
    chip.hidden = false;
    chip.textContent = `已筛选 ${parts.join(" · ")} · 清空`;
    chip.title = "清空日期与地块筛选，回到本周全部";
  };

  const renderBulkDock = ({ picks, canExec, canHalt, canResume, inconsistent, areaSum }) => {
    const dock = document.getElementById("weekDock");
    if (!dock) return;
    if (!picks.length) {
      dock.hidden = true;
      dock.classList.remove("has-sel", "is-open");
      dock.innerHTML = "";
      return;
    }
    const acts = [];
    if (canExec) acts.push(`<button type="button" class="btn wq-primary" id="landExecBatch">批量登记回放队列</button>`);
    if (canHalt) acts.push(`<button type="button" class="btn ghost danger-outline" id="landHaltBatch">批量暂停</button>`);
    if (canResume) acts.push(`<button type="button" class="btn" id="landResumeBatch">批量继续</button>`);
    if (inconsistent) {
      acts.push(`<span class="wo-dock-warn">所选任务状态不一致，请只勾选同状态项</span>`);
    } else if (!acts.length) {
      acts.push(`<span class="wo-dock-warn">当前选中项暂无批量动作</span>`);
    }
    dock.hidden = false;
    dock.classList.add("has-sel", "is-open");
    dock.innerHTML = `
      <span class="wo-dock-hint" id="landSelectHint">已选 <b class="num">${picks.length}</b> 项 · ${Math.round(areaSum)} 亩</span>
      <span class="sp"></span>
      ${acts.join("")}
      <button type="button" class="btn ghost" id="landClearSel">取消选择</button>`;
    document.getElementById("landExecBatch")?.addEventListener("click", () => {
      const st = syncLandPick();
      if (!st.canExec) return;
      const codes = st.picks.filter((_, i) => st.states[i] === "pending" || st.states[i] === "locked");
      runHumanDecide({ action: "approve", land_codes: codes, exec_action: "auto" });
    });
    document.getElementById("landHaltBatch")?.addEventListener("click", () => {
      const st = syncLandPick();
      if (!st.canHalt) return;
      const codes = st.picks.filter((_, i) => st.states[i] === "running");
      if (!codes.length) return;
      runHumanDecide({ action: "halt_batch", land_codes: codes, reason: "批量暂停" });
    });
    document.getElementById("landResumeBatch")?.addEventListener("click", async () => {
      const st = syncLandPick();
      if (!st.canResume) return;
      const codes = st.picks.filter((_, i) => st.states[i] === "paused");
      if (!codes.length) return;
      const safetyReview = await requestSafetyReview(`批量继续 ${codes.length} 项作业`);
      if (!safetyReview) return;
      runHumanDecide({ action: "resume_batch", land_codes: codes, safety_review: safetyReview });
    });
    document.getElementById("landClearSel")?.addEventListener("click", () => {
      view.querySelectorAll(".land-pick").forEach((el) => {
        el.checked = false;
      });
      const allBtn = document.getElementById("landSelectAll");
      if (allBtn) allBtn.checked = false;
      syncLandPick();
    });
  };

  const syncLandPick = () => {
    const checked = [...view.querySelectorAll(".land-pick:checked")];
    const picks = checked.map((el) => el.value);
    const states = checked.map((el) => el.dataset.state || "");
    const areaSum = checked.reduce((s, el) => s + (Number(el.dataset.area) || 0), 0);
    const uniqueStates = [...new Set(states)];
    const inconsistent = uniqueStates.length > 1;
    const allPend = states.length > 0 && states.every((s) => s === "pending" || s === "locked");
    const allRun = states.length > 0 && states.every((s) => s === "running");
    const allPaused = states.length > 0 && states.every((s) => s === "paused");
    const canExec = !inconsistent && allPend && !emergencyLocked;
    const canHalt = !inconsistent && allRun;
    const canResume = !inconsistent && allPaused;
    const result = { picks, states, canExec, canHalt, canResume, inconsistent, areaSum };
    renderBulkDock(result);
    const allBtn = document.getElementById("landSelectAll");
    if (allBtn) {
      const enabled = [...view.querySelectorAll(".land-pick:not(:disabled)")];
      const checkedN = enabled.filter((el) => el.checked).length;
      allBtn.checked = enabled.length > 0 && checkedN === enabled.length;
      allBtn.indeterminate = checkedN > 0 && checkedN < enabled.length;
    }
    return result;
  };

  const refreshQueue = () => {
    const list = filteredItems();
    const collapsibleDefault = statusFilter === "todo" && dayFilter === "all" && !landFocus.length;
    const visibleList = collapsibleDefault && !queueExpanded ? list.slice(0, HOME_QUEUE_LIMIT) : list;
    queueRoot.innerHTML = renderQueue(visibleList);
    queueRoot.classList.remove("is-refreshing");
    void queueRoot.offsetWidth;
    queueRoot.classList.add("is-refreshing");
    if (queueMeta) {
      const scope =
        statusFilter === "todo"
          ? "待办"
          : statusFilter === "all"
            ? "农事"
            : statusFilter === "running"
              ? "流程回放"
              : statusFilter === "paused"
                ? "回放已暂停"
                : statusFilter === "accepting"
                  ? "回放待归档"
                  : statusFilter === "done"
                    ? "回放归档"
                    : "农事";
      queueMeta.textContent = collapsibleDefault && !queueExpanded && list.length > HOME_QUEUE_LIMIT
        ? `优先显示 ${visibleList.length} / 共 ${list.length} 项 · 可展开查看全部`
        : list.length === workTotal && statusFilter === "all" && dayFilter === "all" && !landFocus.length
          ? `共 ${workTotal} 项农事`
          : `${scope} ${list.length} 项${dayFilter !== "all" || landFocus.length ? `（已筛选）` : ` / 共 ${workTotal} 项`}`;
    }
    const scopeNum = document.getElementById("woScopeNum");
    if (scopeNum) scopeNum.textContent = String(list.length);
    const showAll = document.getElementById("weekShowAll");
    if (showAll) {
      showAll.hidden = !collapsibleDefault || list.length <= HOME_QUEUE_LIMIT;
      showAll.setAttribute("aria-expanded", queueExpanded ? "true" : "false");
      showAll.textContent = queueExpanded ? "收起优先任务" : `展开全部 ${list.length} 项`;
    }
    bindQueueActions();
    const allBtn = document.getElementById("landSelectAll");
    if (allBtn) allBtn.checked = false;
  };

  const runLandExecute = async (codes, action) => {
    if (!codes.length) {
      toast("请先勾选地块", "可多选后批量登记仿真任务", "orange");
      return;
    }
    const r = await api("/api/lands/execute", {
      method: "POST",
      body: JSON.stringify({ land_codes: codes, action: action || "auto" }),
    });
    if (r.ok === false || (r.summary && String(r.summary).includes("锁定"))) {
      toast("已锁定", r.summary || "请先完成安全复核，再人工登记或继续", "orange");
      return;
    }
    toast(
      r.summary || "已写入回放队列",
      (r.results || []).map((x) => x.title).filter(Boolean).slice(0, 2).join(" · ") || "等待人工与设备回执",
      "green"
    );
    await refreshFarmSelect(farmId);
    renderToken += 1;
    render(renderToken);
  };

  const runHumanDecide = async (payload) => {
    const r = await api("/api/human/decide", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const act = payload.action || "";
    const halt = ["halt", "halt_all", "halt_one", "halt_batch", "pause", "pause_all", "emergency_stop"].includes(act);
    const resume = ["resume", "resume_one", "continue", "resume_halted", "resume_batch"].includes(act);
    const done = act === "complete" || act === "done";
    const accepted = act === "accept" || act === "verify";
    const started = act === "start" || act === "begin";
    const title =
      r.ok === false
        ? "未生效"
        : act === "emergency_stop"
          ? "安全停止请求已登记"
          : act === "pause_all"
            ? "已暂停全部"
            : halt
              ? "已暂停"
              : resume
                ? "继续请求已登记"
                : done
                  ? "已提交完成"
                  : accepted
                    ? "验收通过"
                    : started
                      ? "启动请求已登记"
                      : act === "approve"
                        ? "已写入回放队列"
                        : "已记录";
    toast(title, r.message || "", r.ok === false ? "orange" : "green");
    await refreshFarmSelect(farmId);
    renderToken += 1;
    render(renderToken);
  };

  let conflictReturnFocus = null;
  const closeConflictSide = () => {
    const side = document.getElementById("woSide");
    if (!side || side.hidden) return;
    side.hidden = true;
    document.getElementById("conflictOpenSide")?.setAttribute("aria-expanded", "false");
    if (conflictReturnFocus && conflictReturnFocus.isConnected) conflictReturnFocus.focus();
    conflictReturnFocus = null;
  };
  const openConflictSide = () => {
    const side = document.getElementById("woSide");
    if (!side) return;
    conflictReturnFocus = document.activeElement;
    side.hidden = false;
    document.getElementById("conflictOpenSide")?.setAttribute("aria-expanded", "true");
    side.focus();
  };

  const bindQueueActions = () => {
    document.getElementById("weekResetFilters")?.addEventListener("click", () => {
      dayFilter = "all";
      statusFilter = "todo";
      landFocus = [];
      sortMode = "urgency";
      queueExpanded = false;
      const sort = document.getElementById("weekSort");
      if (sort) sort.value = sortMode;
      syncDateLabel();
      syncChipOn(document.getElementById("weekStatusTabs"), "data-status", statusFilter);
      syncFocusChip();
      refreshQueue();
      document.querySelector("#weekStatusTabs .is-on")?.focus({ preventScroll: true });
    });
    view.querySelectorAll(".wq-more").forEach((menu) => {
      menu.onkeydown = (event) => {
        if (event.key !== "Escape" || !menu.open) return;
        event.preventDefault();
        menu.open = false;
        menu.querySelector("summary")?.focus();
      };
    });
    view.querySelectorAll(".week-defer").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        runHumanDecide({ action: "defer", land: el.dataset.land });
      };
    });
    view.querySelectorAll(".week-skip").forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        const confirmed = await requestActionConfirm({
          title: `取消 ${el.dataset.label || el.dataset.land} 本次作业`,
          description: "该操作只取消当前周计划条目并保留审计记录，不会删除田块、设备或历史数据。",
          confirmLabel: "确认取消本次",
          tone: "danger",
        });
        if (!confirmed) return;
        runHumanDecide({ action: "veto", land: el.dataset.land, reason: "场长决定本周不做" });
      };
    });
    view.querySelectorAll(".week-halt").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        runHumanDecide({ action: "pause", land: el.dataset.land, reason: "场长暂停本项" });
      };
    });
    view.querySelectorAll(".week-resume").forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        const safetyReview = await requestSafetyReview(`${el.dataset.label || el.dataset.land} 继续作业复核`);
        if (!safetyReview) return;
        runHumanDecide({ action: "continue", land: el.dataset.land, safety_review: safetyReview });
      };
    });
    view.querySelectorAll(".week-start").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        runHumanDecide({ action: "start", land: el.dataset.land });
      };
    });
    view.querySelectorAll(".week-complete").forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        const confirmed = await requestActionConfirm({
          title: `${el.dataset.label || el.dataset.land} 提交流程回放材料`,
          description: "提交后仅进入“回放待归档”，不代表真实机具已完成作业；归档前仍须补齐独立验收证据。",
          confirmLabel: "提交回放材料",
          acknowledgements: ["我确认本次提交是流程回放记录，不是生产作业完成证明"],
        });
        if (!confirmed) return;
        runHumanDecide({ action: "complete", land: el.dataset.land });
      };
    });
    view.querySelectorAll(".week-accept").forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        const values = await requestEvidenceGate({
          title: `${el.dataset.label || el.dataset.land} 独立验收归档`,
          description: "四项证据均为必填；验收人不得与结果提交人相同。系统未接生产凭证库，当前只记录声明并保持可追查引用。",
          kicker: "ACCEPTANCE GATE",
          confirmLabel: "提交独立验收",
          fields: [
            { name: "device_ack", label: "设备 ACK / 人工确认记录号", placeholder: "ACK、工单或人工确认编号" },
            { name: "track_ref", label: "轨迹文件 / 作业记录引用", placeholder: "文件号或记录号" },
            { name: "actuals", label: "实际面积 / 用量摘要", type: "textarea", wide: true, placeholder: "写明计量口径与原始记录引用" },
            { name: "accepted_by", label: "独立验收人姓名 / 工号", placeholder: "不得与结果提交人相同" },
            { name: "independent", label: "我确认验收人与结果提交人相互独立，且以上引用可追查", type: "checkbox" },
          ],
          validate: (data) => data.accepted_by.length < 2 ? "独立验收人姓名或工号至少 2 个字符。" : "",
        });
        if (!values) return;
        runHumanDecide({
          action: "accept",
          land: el.dataset.land,
          acceptance_evidence: {
            device_ack: values.device_ack,
            track_ref: values.track_ref,
            actuals: values.actuals,
            accepted_by: values.accepted_by,
          },
        });
      };
    });
    view.querySelectorAll(".week-conflict-one").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        openConflictSide();
        toast("冲突处理", el.dataset.label || el.dataset.land, "orange");
      };
    });
    view.querySelectorAll(".lb-exec").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        el.classList.add("is-busy");
        runHumanDecide({
          action: "approve",
          land_codes: [el.dataset.code],
          exec_action: el.dataset.action || "auto",
        });
      };
    });
    view.querySelectorAll(".lb-go").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        navigate({
          page: el.dataset.jump || "twin",
          land: el.dataset.code,
          toast: ["去看这块田", el.dataset.code, "green"],
        });
      };
    });
    view.querySelectorAll(".land-pick").forEach((el) => {
      el.onchange = syncLandPick;
    });
    const allBtn = document.getElementById("landSelectAll");
    if (allBtn) {
      allBtn.onchange = () => {
        view.querySelectorAll(".land-pick:not(:disabled)").forEach((el) => {
          el.checked = allBtn.checked;
        });
        syncLandPick();
      };
    }
    syncLandPick();
  };

  let prioReturnFocus = null;
  const closePrioPanel = (restoreFocus = true) => {
    const panel = document.getElementById("prioPanel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.getElementById("prioSuggestOpen")?.setAttribute("aria-expanded", "false");
    if (restoreFocus && prioReturnFocus && prioReturnFocus.isConnected) prioReturnFocus.focus();
    prioReturnFocus = null;
  };
  document.getElementById("prioSuggestOpen")?.addEventListener("click", () => {
    const panel = document.getElementById("prioPanel");
    if (!panel) return;
    prioReturnFocus = document.activeElement;
    panel.hidden = false;
    document.getElementById("prioSuggestOpen")?.setAttribute("aria-expanded", "true");
    panel.focus();
  });
  view.querySelectorAll("[data-command-jump]").forEach((el) => {
    el.addEventListener("click", () => navigate({ page: el.dataset.commandJump, toast: ["已打开工作台", el.textContent.trim(), "green"] }));
  });
  document.getElementById("farmExportPlan")?.addEventListener("click", () => downloadCsv(
    `本周农事计划_${localDateKey()}.csv`,
    [
      ["地块", "作物", "面积(亩)", "农事", "计划时间", "优先级", "状态", "资源", "建议/风险"],
      ...allItems.map((b) => [b.code, b.crop_name || b.crop || "", b.area_mu || 0, b.task_type || b.tag || "", b.plan_slot || b.when || "", b.priority_label || b.urgency || "", stateLabelOf(b), b.resource || "", b.agent_tip || b.reason || ""]),
    ]
  ));
  document.getElementById("prioPanelClose")?.addEventListener("click", () => closePrioPanel());
  document.getElementById("prioPanel")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closePrioPanel();
  });
  view.querySelectorAll(".prio-focus").forEach((el) => {
    el.onclick = () => {
      const code = el.dataset.code || "";
      closePrioPanel(false);
      dayFilter = "all";
      statusFilter = "todo";
      landFocus = [];
      sortMode = "urgency";
      queueExpanded = true;
      const sort = document.getElementById("weekSort");
      if (sort) sort.value = sortMode;
      syncDateLabel();
      syncChipOn(document.getElementById("weekStatusTabs"), "data-status", statusFilter);
      syncFocusChip();
      refreshQueue();
      const row = [...document.querySelectorAll("#weekQueue .wq-row")].find((item) => item.dataset.code === code);
      if (!row) return;
      row.classList.add("is-located");
      row.scrollIntoView({ behavior: "auto", block: "center" });
      row.focus({ preventScroll: true });
      toast("已定位优先任务", el.dataset.land || code, "green");
    };
  });
  view.querySelectorAll(".prio-skip").forEach((el) => {
    el.onclick = () => {
      const card = el.closest(".wo-suggest");
      if (card) card.remove();
      const list = document.getElementById("prioPanelList");
      if (list && !list.querySelector(".wo-suggest")) {
        list.innerHTML = `<div class="empty-hint"><b>优先清单已清空</b><div class="sub">仅影响本次查看，不改变待办状态</div></div>`;
      }
      toast("已从本次清单移除", el.dataset.code, "green");
    };
  });

  document.getElementById("humanPauseAll")?.addEventListener("click", async () => {
    const runningItems = allItems.filter((b) => itemState(b) === "running");
    const n = runningItems.length || runningN;
    const area = runningItems.reduce((s, b) => s + (Number(b.area_mu) || 0), 0) || areaRunning;
    const values = await requestEvidenceGate({
      title: "暂停全部流程回放",
      description: `预计影响 ${n} 项 / ${Math.round(area)} 亩计划范围。暂停只作用于软件回放状态，现场机具仍须由人员按制造商规程安全停机。`,
      kicker: "OPERATION HOLD",
      confirmLabel: "确认全部暂停",
      tone: "danger",
      fields: [
        { name: "reason", label: "暂停原因", type: "select", value: "人工干预", options: ["天气突变", "机具故障", "人工干预", "道路或人员隔离", "其他"] },
        { name: "detail", label: "补充说明（可选）", type: "textarea", required: false, wide: true, placeholder: "现场情况、责任人与工单引用" },
        { name: "scope_ack", label: `我已核对影响范围：${n} 项 / ${Math.round(area)} 亩计划范围`, type: "checkbox" },
      ],
    });
    if (!values) return;
    const reason = [values.reason, values.detail].filter(Boolean).join("：");
    runHumanDecide({ action: "pause_all", reason: reason || "暂停全部作业" });
  });
  document.getElementById("humanEmergency")?.addEventListener("click", async () => {
    const confirmed = await requestActionConfirm({
      title: "登记全场远程安全停止",
      description: "确认后将立即启用软件锁，禁止新的回放登记与启动。它不等同于物理急停，必须同步由现场人员安全停机、隔离危险能源并清场。",
      confirmLabel: "启用全场软件锁",
      tone: "danger",
      acknowledgements: [
        "我理解软件锁不能替代设备物理急停、上锁挂牌或制造商停机规程",
        "我已通知现场负责人执行安全停机、危险能源隔离与人员清场",
      ],
    });
    if (!confirmed) return;
    runHumanDecide({ action: "emergency_stop", reason: "远程安全停止请求" });
  });
  document.getElementById("humanResume")?.addEventListener("click", async () => {
    if (!emergencyLocked) {
      runHumanDecide({ action: "resume", clear_emergency: false });
      return;
    }
    const safetyReview = await requestSafetyReview("解除全场紧急软件锁");
    if (!safetyReview) return;
    runHumanDecide({
      action: "resume",
      clear_emergency: true,
      safety_review: safetyReview,
    });
  });
  document.getElementById("resumeHalted")?.addEventListener("click", async () => {
    const safetyReview = await requestSafetyReview("恢复全部已暂停作业");
    if (!safetyReview) return;
    runHumanDecide({ action: "resume_halted", safety_review: safetyReview });
  });
  document.getElementById("woSafetyToggle")?.addEventListener("click", () => {
    const bar = document.getElementById("woSafetyBar");
    const btn = document.getElementById("woSafetyToggle");
    if (!bar) return;
    bar.hidden = !bar.hidden;
    if (btn) btn.setAttribute("aria-expanded", bar.hidden ? "false" : "true");
  });

  const dayOrder = ["all", ...weekDays.map((d) => d.key)];
  const syncDateLabel = () => {
    const el = document.getElementById("weekDateLabel");
    if (!el) return;
    if (dayFilter === "all") {
      el.textContent = String(week.range || "本周").replace(/\s+/g, "");
      el.classList.add("is-week");
      el.title = "当前：本周全部";
      return;
    }
    const day = weekDays.find((d) => d.key === dayFilter);
    el.textContent = day ? `${day.label} ${day.date || ""}`.trim() : String(week.range || "本周").replace(/\s+/g, "");
    el.classList.toggle("is-week", !day);
    el.title = day ? `当前：${day.label} ${day.date || ""} · 点击回本周` : "查看本周全部";
  };
  const stepDay = (delta) => {
    let i = dayOrder.indexOf(dayFilter);
    if (i < 0) i = 0;
    i = (i + delta + dayOrder.length) % dayOrder.length;
    dayFilter = dayOrder[i];
    syncDateLabel();
    syncFocusChip();
    refreshQueue();
  };

  document.getElementById("weekDatePrev")?.addEventListener("click", () => stepDay(-1));
  document.getElementById("weekDateNext")?.addEventListener("click", () => stepDay(1));
  document.getElementById("weekDateLabel")?.addEventListener("click", () => {
    dayFilter = "all";
    syncDateLabel();
    syncFocusChip();
    refreshQueue();
  });
  document.getElementById("weekStatusTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status]");
    if (!btn) return;
    statusFilter = btn.dataset.status || "all";
    syncChipOn(document.getElementById("weekStatusTabs"), "data-status", statusFilter);
    refreshQueue();
  });
  view.querySelectorAll("[data-jump-status]").forEach((el) => {
    el.onclick = () => {
      statusFilter = el.dataset.jumpStatus || "all";
      syncChipOn(document.getElementById("weekStatusTabs"), "data-status", statusFilter);
      syncFocusChip();
      refreshQueue();
      document.getElementById("weekStatusTabs")?.scrollIntoView({ behavior: "auto", block: "nearest" });
    };
  });
  document.getElementById("weekSort")?.addEventListener("change", (e) => {
    sortMode = e.target.value || "urgency";
    refreshQueue();
  });
  document.getElementById("weekFocusChip")?.addEventListener("click", () => {
    landFocus = [];
    dayFilter = "all";
    if (!showStatusSeg) statusFilter = "todo";
    syncDateLabel();
    syncFocusChip();
    refreshQueue();
    document.querySelector("#weekStatusTabs .is-on")?.focus({ preventScroll: true });
  });

  destroyDashboardMap();
  (() => {
    const host = document.getElementById("dcLeafletMap");
    const stage = document.getElementById("dcMapStage");
    if (!host) return;

    const ensureLeaflet = () => {
      if (window.FarmGeo?.ensureLeaflet) return window.FarmGeo.ensureLeaflet();
      if (typeof L !== "undefined") return Promise.resolve(L);
      return Promise.reject(new Error("Leaflet 未就绪"));
    };

    const mountMap = () => {
      destroyDashboardMap();
      const center = mapCenter;
      const imageryUrl =
        geo.IMAGERY_URL ||
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      const map = L.map(host, {
        zoomControl: false,
        attributionControl: false,
        minZoom: 11,
        maxZoom: 18,
      }).setView(center, 14);
      window.__dcLeaflet = map;
      L.tileLayer(imageryUrl, { maxZoom: 19, crossOrigin: true }).addTo(map);

      if (!stage?.querySelector(".dc-map-address")) {
        const addr = document.createElement("div");
        addr.className = "dc-map-address";
        addr.textContent = geo.ADDRESS || "新疆克拉玛依市克拉玛依区 · 白云一路与蓝天二路交叉口";
        stage?.appendChild(addr);
      }

      const plotLayers = new Map();
      const labelLayers = new Map();
      let selectedCode = null;
      const styleFor = (plot, emphasize) => ({
        color: emphasize ? "#ffffff" : "rgba(255,255,255,0.78)",
        weight: emphasize ? 3 : 1.6,
        fillColor: plot.fill,
        fillOpacity: emphasize ? 0.62 : 0.45,
      });

      const selectPlot = (code) => {
        if (!code) return;
        selectedCode = code;
        plotLayers.forEach((layer, id) => {
          const plot = plotSearchIndex.find((p) => p.code === id);
          if (!plot) return;
          layer.setStyle(styleFor(plot, id === code));
          if (id === code) layer.bringToFront();
        });
        landFocus = [code];
        statusFilter = "all";
        dayFilter = "all";
        syncDateLabel();
        syncChipOn(document.getElementById("weekStatusTabs"), "data-status", statusFilter);
        syncFocusChip();
        refreshQueue();
        document.getElementById("weekStatusTabs")?.scrollIntoView({ behavior: "auto", block: "nearest" });
        toast("地块筛选", code, "green");
      };

      plotSearchIndex.forEach((plot) => {
        if (!plot.coords) return;
        const layer = L.polygon(plot.coords, styleFor(plot, false));
        layer.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          selectPlot(plot.code);
        });
        layer.on("mouseover", () => {
          if (selectedCode !== plot.code) layer.setStyle({ weight: 2.6, fillOpacity: 0.58 });
        });
        layer.on("mouseout", () => layer.setStyle(styleFor(plot, selectedCode === plot.code)));
        layer.addTo(map);
        plotLayers.set(plot.code, layer);
        const label = L.marker(plot.center, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "dc-plot-label",
            html: `<b>${esc(plot.code)}</b><span>${esc(plot.crop || "")}</span>`,
            iconSize: [96, 40],
            iconAnchor: [48, 20],
          }),
        });
        label.addTo(map);
        labelLayers.set(plot.code, label);
      });
      window.__dcLeafletPlots = plotLayers;

      const setBase = (mode) => {
        const showPlots = mode !== "sat";
        plotLayers.forEach((layer) => {
          if (showPlots) {
            if (!map.hasLayer(layer)) layer.addTo(map);
          } else if (map.hasLayer(layer)) map.removeLayer(layer);
        });
        labelLayers.forEach((layer) => {
          if (showPlots) {
            if (!map.hasLayer(layer)) layer.addTo(map);
          } else if (map.hasLayer(layer)) map.removeLayer(layer);
        });
        stage?.classList.toggle("is-sat", mode === "sat");
      };

      document.getElementById("dcZoomIn")?.addEventListener("click", () => map.zoomIn());
      document.getElementById("dcZoomOut")?.addEventListener("click", () => map.zoomOut());
      document.getElementById("dcZoomReset")?.addEventListener("click", () => {
        const bounds = [];
        plotLayers.forEach((layer) => bounds.push(layer.getBounds()));
        if (bounds.length) {
          map.fitBounds(bounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(bounds[0])).pad(0.18));
        } else map.setView(center, 14);
      });

      document.querySelectorAll(".dc-map-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".dc-map-tab").forEach((t) => {
            const selected = t === tab;
            t.classList.toggle("is-on", selected);
            t.setAttribute("aria-pressed", String(selected));
          });
          setBase(tab.dataset.mapMode === "sat" ? "sat" : "field");
        });
      });

      const mapSearch = document.getElementById("dcMapSearch");
      const mapSearchStatus = document.getElementById("dcMapSearchStatus");
      if (mapSearch) {
        mapSearch.addEventListener("input", () => {
          const q = mapSearch.value.trim().toUpperCase();
          let hitCount = 0;
          plotSearchIndex.forEach((plot) => {
            const hit = !q || plot.search.includes(q);
            if (hit) hitCount += 1;
            const poly = plotLayers.get(plot.code);
            const label = labelLayers.get(plot.code);
            if (poly) {
              poly.setStyle({
                ...styleFor(plot, selectedCode === plot.code),
                fillOpacity: hit ? (selectedCode === plot.code ? 0.62 : 0.45) : 0.12,
                opacity: hit ? 1 : 0.25,
              });
            }
            if (label) label.getElement()?.classList.toggle("is-dim", !hit);
          });
          if (mapSearchStatus) {
            mapSearchStatus.textContent = q ? `${hitCount} 块匹配` : `${plotSearchIndex.length} 块`;
            mapSearchStatus.classList.toggle("is-empty", Boolean(q) && hitCount === 0);
          }
        });
        mapSearch.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          const q = mapSearch.value.trim().toUpperCase();
          if (!q) return;
          const hit = plotSearchIndex.find((p) => p.search.includes(q));
          if (hit) {
            selectPlot(hit.code);
            const poly = plotLayers.get(hit.code);
            if (poly) map.fitBounds(poly.getBounds().pad(0.35));
          } else toast("未找到匹配田块", "请改用田块编号、作物或任务关键词", "orange");
        });
      }

      const fitAll = () => {
        map.invalidateSize();
        const bounds = [];
        plotLayers.forEach((layer) => bounds.push(layer.getBounds()));
        if (!bounds.length) return;
        map.fitBounds(bounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(bounds[0])).pad(0.18));
      };
      requestAnimationFrame(fitAll);
      setTimeout(fitAll, 120);
      setTimeout(fitAll, 400);
    };

    ensureLeaflet()
      .then(mountMap)
      .catch((err) => {
        host.innerHTML = `<div class="dc-map-fallback"><b>地图未能加载</b><span>${esc(err?.message || "Leaflet 不可用")}</span></div>`;
      });
  })();

  const askFab = document.getElementById("prioAsk");
  const askPanel = document.getElementById("woAskPanel");
  const askLog = document.getElementById("woAskLog");
  const askBrief = document.getElementById("woAskBrief");
  const askAgents = document.getElementById("woAskAgents");
  const askOps = document.getElementById("woAskOps");
  const askQuick = document.getElementById("woAskQuick");
  const askActs = document.getElementById("woAskActs");
  const askInput = document.getElementById("woAskInput");
  const agentList = Array.isArray(d.agents) ? d.agents : [];
  const agentTasks = Array.isArray(d.tasks) ? d.tasks : [];

  /* 匹配用：保留英文短名，任务 assignee 仍是 "Crop Expert Agent" 这类原始值 */
  const shortAgentKey = (name) => String(name || "").replace(/\s*Agent$/i, "").trim() || name;
  /* 展示用：换成中文职能名 */
  const shortAgent = (name) => AGENT_SHORT_NAME[String(name || "").trim()] || shortAgentKey(name);

  const agentStatusCls = (st) => {
    const s = String(st || "");
    if (/执行|作业|编队/.test(s)) return "is-run";
    if (/运行|在线|待命/.test(s)) return "is-ok";
    if (/暂停|异常|离线|失败/.test(s)) return "is-warn";
    return "is-idle";
  };

  const buildAskScope = () => {
    const scope = [];
    if (dayFilter !== "all") {
      const day = weekDays.find((d) => d.key === dayFilter);
      scope.push(day ? `${day.label}${day.date ? " " + day.date : ""}` : "指定日程");
    }
    if (statusFilter !== "all") {
      const statusMap = { todo: "待办", running: "流程回放", paused: "回放已暂停", accepting: "回放待归档", done: "回放归档" };
      scope.push(statusMap[statusFilter] || statusFilter);
    }
    if (landFocus.length) scope.push(`地块 ${landFocus.join("、")}`);
    return scope;
  };

  const paintAskBrief = () => {
    if (!askBrief) return;
    const wx = d.weather || {};
    askBrief.innerHTML = `
      <div class="wo-ask-sum-grid">
        <div><em>本周农事</em><b>${workTotal}<small> 项</small></b><span>${Math.round(areaTotal)} 亩次 · 回放 ${progressArea}%</span></div>
        <div><em>流程回放</em><b class="is-run">${runningN}</b><span>${Math.round(areaRunning)} 亩次计划量</span></div>
        <div><em>待核验</em><b class="is-wait">${waitN}</b><span>${Math.round(areaQueued)} 亩次计划量</span></div>
        <div><em>计划机具</em><b>${esc(fleetLabel)}</b><span>计划占用 ${fleetUtil}%</span></div>
      </div>
      <p class="wo-ask-sum-line">${esc(windowLead)} · 当前可执行 0 亩（天气与现场证据未接）${
        wx.air_temp != null ? ` · 气温 ${wx.air_temp} ℃` : ""
      }${wx.soil_moisture != null ? ` · 墒情 ${wx.soil_moisture}%` : ""}</p>
      ${
        conflict
          ? `<p class="wo-ask-sum-warn"><b>冲突</b>${esc(conflict.text || "")}<span>${esc(conflict.resolve || "")}</span></p>`
          : ""
      }`;
  };

  const paintAskAgents = () => {
    if (!askAgents) return;
    if (!agentList.length) {
      askAgents.innerHTML = `<div class="wo-ask-empty">暂无智能体数据</div>`;
      return;
    }
    const busy = agentList.filter((a) => /执行|作业/.test(a.status || "")).length;
    askAgents.innerHTML = `
      <div class="wo-ask-sec-hd">
        <b>智能体调度</b>
        <span>${agentList.length} 个仿真角色 · ${busy} 个草稿态</span>
      </div>
      <div class="wo-ask-agent-list">
        ${agentList
          .map((a) => {
            const mine = agentTasks.filter((t) => {
              const asg = t.assignee || "";
              return asg === a.name || asg.includes(shortAgentKey(a.name));
            });
            const doing = mine.find((t) => /进行|执行/.test(t.status || "")) || mine[0];
            return `<article class="wo-ask-agent ${agentStatusCls(a.status)}">
              <header>
                <b>${esc(shortAgent(a.name))}</b>
                <i>${esc(a.status || "—")}</i>
              </header>
              <p class="role">${esc(a.role || "")}</p>
              <p class="act">${esc(a.last_action || "暂无动作")}</p>
              ${doing ? `<p class="task">${esc(doing.land_code || "")} · ${esc(doing.title || "")}</p>` : ""}
              <span class="score">${a.score != null ? `${a.score}` : "—"}</span>
            </article>`;
          })
          .join("")}
      </div>`;
  };

  const paintAskOps = (ops) => {
    if (!askOps) return;
    const list = Array.isArray(ops) ? ops.slice(0, 3) : [];
    if (!list.length) {
      askOps.hidden = true;
      askOps.innerHTML = "";
      return;
    }
    askOps.hidden = false;
    askOps.innerHTML = `
      <div class="wo-ask-sec-hd">
        <b>候选联合作业链</b>
        <span>${list.filter((op) => op.status === "NO_GO").length} 条不放行</span>
      </div>
      ${list
        .map((op) => {
          const agents = (op.agents || []).map((x) => shortAgent(x.name || x)).join(" · ");
          return `<article class="wo-ask-op">
            <header>
              <b>${esc(op.land || "")}</b>
              <i>${esc(op.status || "")} ${op.progress != null ? op.progress + "%" : ""}</i>
            </header>
            <p>${esc(op.title || "")}</p>
            <span>${esc(op.window || "")}${agents ? ` · ${esc(agents)}` : ""}</span>
          </article>`;
        })
        .join("")}`;
  };

  const paintAskActs = (actions) => {
    if (!askActs) return;
    askActs.innerHTML = (actions || [])
      .map(
        (a) =>
          `<button type="button" class="btn ghost" data-ask-act="${esc(a.jump)}" data-ask-land="${esc(a.land || "")}" data-ask-layer="${esc(a.layer || "")}">${esc(a.label)}</button>`
      )
      .join("");
    askActs.querySelectorAll("[data-ask-act]").forEach((btn) => {
      btn.onclick = () =>
        navigate({
          page: btn.dataset.askAct,
          land: btn.dataset.askLand || undefined,
          layer: btn.dataset.askLayer || undefined,
          toast: ["已跳转", btn.textContent, "green"],
        });
    });
  };

  const appendAskMsg = (role, text, meta) => {
    if (!askLog) return;
    const row = document.createElement("div");
    row.className = `wo-ask-msg is-${role}`;
    row.innerHTML = `<b>${role === "user" ? "我" : meta || "调度助手"}</b><p>${esc(text)}</p>`;
    askLog.appendChild(row);
    askLog.scrollTop = askLog.scrollHeight;
  };

  const sendAsk = async (raw) => {
    const question = String(raw || "").trim();
    if (!question || !askInput) return;
    askInput.value = "";
    appendAskMsg("user", question);
    const scope = buildAskScope();
    const agentCtx = agentList
      .map((a) => `${shortAgent(a.name)}[${a.status}] ${a.last_action || ""}`)
      .join("；");
    const context = [
      `本周仿真农事：${workTotal} 项 / ${Math.round(areaTotal)} 亩次，流程回放 ${runningN}，待核验 ${waitN}`,
      windowLead ? `作业窗 ${windowLead}` : "",
      conflict ? `冲突 ${conflict.text}；建议 ${conflict.resolve}` : "暂无冲突",
      `机具 ${fleetLabel}，利用率 ${fleetUtil}%`,
      agentCtx ? `智能体：${agentCtx}` : "",
      scope.length ? `当前筛选 ${scope.join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join("。");
    const r = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ question: `${context}\n用户问题：${question}` }),
    });
    appendAskMsg("bot", r.answer || "暂无建议，请换个问法。", "多智能体");
    paintAskActs(
      (r.actions || []).concat([
        { label: "智能体工作台", jump: "agents" },
        { label: "多机协同", jump: "fleet" },
      ])
    );
  };

  const openAskPanel = async () => {
    if (!askPanel) return;
    paintAskBrief();
    paintAskAgents();
    paintAskOps([]);
    api("/api/fleet")
      .then((fleet) => paintAskOps(fleet && fleet.ops))
      .catch(() => {});
    if (askQuick) {
      const qs = [
        "各智能体现在在干什么？",
        "本周怎么排最合理？",
        conflict ? "冲突怎么处理？" : "今日作业窗还缺什么证据？",
        "联合作业链进度如何？",
        "优先建议先做哪几项？",
      ];
      askQuick.innerHTML = qs
        .map((q) => `<button type="button" class="wo-chip" data-ask-q="${esc(q)}">${esc(q)}</button>`)
        .join("");
      askQuick.querySelectorAll("[data-ask-q]").forEach((btn) => {
        btn.onclick = () => sendAsk(btn.dataset.askQ);
      });
    }
    if (askLog && !askLog.dataset.seeded) {
      askLog.dataset.seeded = "1";
      const agentHint = agentList
        .slice(0, 4)
        .map((a) => `${shortAgent(a.name)}（${a.status}）`)
        .join("、");
      appendAskMsg(
        "bot",
        `已汇聚本周仿真调度与 ${agentList.length} 个智能体角色。当前流程回放 ${runningN}、待核验 ${waitN}${
          conflict ? `；冲突：${conflictLands.join("、") || "相关地块"}` : ""
        }。仿真智能体：${agentHint || "—"}。可问证据缺口、排程冲突或某个 Agent 的草稿。`,
        "Farm Master"
      );
    }
    askPanel.hidden = false;
    askPanel.classList.add("is-open");
    askFab?.classList.add("is-open");
    placeAskPanelNearFab();
    setTimeout(() => askInput?.focus(), 30);
  };

  const closeAskPanel = () => {
    if (!askPanel) return;
    askPanel.hidden = true;
    askPanel.classList.remove("is-open");
    askFab?.classList.remove("is-open");
  };

  const placeAskPanelNearFab = () => {
    const inlineAsk = document.getElementById("farmAssistantOpen");
    const anchor = inlineAsk && getComputedStyle(inlineAsk).display !== "none" ? inlineAsk : askFab;
    if (!askPanel || !anchor || askPanel.hidden) return;
    const fr = anchor.getBoundingClientRect();
    const pw = Math.min(420, window.innerWidth - 24);
    const ph = Math.min(620, window.innerHeight - 24);
    let left = fr.left + fr.width / 2 - pw / 2;
    let top = fr.top - ph - 10;
    if (top < 12) top = fr.bottom + 10;
    left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - Math.min(ph, askPanel.offsetHeight || ph) - 12));
    askPanel.style.width = `${pw}px`;
    askPanel.style.left = `${left}px`;
    askPanel.style.top = `${top}px`;
    askPanel.style.right = "auto";
    askPanel.style.bottom = "auto";
  };

  const restoreAskFabPos = () => {
    if (!askFab) return;
    try {
      const raw = localStorage.getItem("agrios-ask-fab");
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left === "number" && typeof pos.top === "number") {
        askFab.style.left = `${pos.left}px`;
        askFab.style.top = `${pos.top}px`;
        askFab.style.right = "auto";
        askFab.style.bottom = "auto";
      }
    } catch (e) {}
  };
  restoreAskFabPos();

  if (askFab) {
    let drag = null;
    askFab.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      const r = askFab.getBoundingClientRect();
      drag = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origL: r.left,
        origT: r.top,
        moved: false,
      };
      askFab.setPointerCapture?.(e.pointerId);
      askFab.classList.add("is-dragging");
    });
    askFab.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      const w = askFab.offsetWidth;
      const h = askFab.offsetHeight;
      let left = drag.origL + dx;
      let top = drag.origT + dy;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      askFab.style.left = `${left}px`;
      askFab.style.top = `${top}px`;
      askFab.style.right = "auto";
      askFab.style.bottom = "auto";
      placeAskPanelNearFab();
    });
    const endDrag = (e) => {
      if (!drag || (e.pointerId != null && drag.id !== e.pointerId)) return;
      const wasDrag = drag.moved;
      drag = null;
      askFab.classList.remove("is-dragging");
      try {
        const r = askFab.getBoundingClientRect();
        localStorage.setItem("agrios-ask-fab", JSON.stringify({ left: r.left, top: r.top }));
      } catch (err) {}
      if (!wasDrag) {
        if (askPanel && !askPanel.hidden) closeAskPanel();
        else openAskPanel();
      }
    };
    askFab.addEventListener("pointerup", endDrag);
    askFab.addEventListener("pointercancel", endDrag);
  }
  document.getElementById("farmAssistantOpen")?.addEventListener("click", () => {
    if (askPanel && !askPanel.hidden) closeAskPanel();
    else openAskPanel();
  });

  const askHd = document.getElementById("woAskHd");
  if (askPanel && askHd) {
    let pDrag = null;
    askHd.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = askPanel.getBoundingClientRect();
      pDrag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, origL: r.left, origT: r.top };
      askHd.setPointerCapture?.(e.pointerId);
      askPanel.classList.add("is-dragging");
    });
    askHd.addEventListener("pointermove", (e) => {
      if (!pDrag || pDrag.id !== e.pointerId) return;
      const w = askPanel.offsetWidth;
      const h = askPanel.offsetHeight;
      let left = pDrag.origL + (e.clientX - pDrag.startX);
      let top = pDrag.origT + (e.clientY - pDrag.startY);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      askPanel.style.left = `${left}px`;
      askPanel.style.top = `${top}px`;
    });
    const endP = (e) => {
      if (!pDrag || (e.pointerId != null && pDrag.id !== e.pointerId)) return;
      pDrag = null;
      askPanel.classList.remove("is-dragging");
    };
    askHd.addEventListener("pointerup", endP);
    askHd.addEventListener("pointercancel", endP);
  }

  document.getElementById("woAskClose")?.addEventListener("click", closeAskPanel);
  document.getElementById("woAskSend")?.addEventListener("click", () => sendAsk(askInput?.value));
  askInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendAsk(askInput.value);
    }
  });

  document.getElementById("conflictFocus")?.addEventListener("click", () => {
    if (!conflictLands.length) return;
    dayFilter = "all";
    statusFilter = "all";
    landFocus = [...conflictLands];
    syncDateLabel();
    syncChipOn(document.getElementById("weekStatusTabs"), "data-status", statusFilter);
    syncFocusChip();
    refreshQueue();
    toast("相关地块", conflict.resolve || `已筛出 ${conflictLands.join("、")}`, "orange");
  });
  document.getElementById("conflictOpenSide")?.addEventListener("click", openConflictSide);
  document.getElementById("woSideClose")?.addEventListener("click", closeConflictSide);
  document.getElementById("woSide")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeConflictSide();
  });
  view.querySelectorAll("[data-conflict-opt]").forEach((btn) => {
    btn.onclick = () => {
      const act = btn.dataset.conflictOpt;
      if (act === "focus") {
        document.getElementById("conflictFocus")?.click();
        return;
      }
      if (act === "defer" && btn.dataset.land) {
        runHumanDecide({ action: "defer", land: btn.dataset.land });
        return;
      }
      runHumanDecide({ action: act || "defer", land: btn.dataset.land });
    };
  });
  document.getElementById("conflictToFleet")?.addEventListener("click", () =>
    navigate({
      page: (conflict && conflict.jump) || "fleet",
      land: conflictLands[0] || undefined,
      toast: ["去机具调整", (conflict && conflict.resolve) || "错峰排程", "orange"],
    })
  );

  view.querySelectorAll(".insight-jump").forEach((el) => {
    el.onclick = () =>
      navigate({
        page: el.dataset.jump || "dashboard",
        land: el.dataset.land || undefined,
        layer: el.dataset.layer || undefined,
      });
  });

  document.getElementById("landSelectAll")?.addEventListener("change", (e) => {
    view.querySelectorAll(".land-pick:not(:disabled)").forEach((el) => {
      el.checked = e.target.checked;
    });
    syncLandPick();
  });

  document.getElementById("weekShowAll")?.addEventListener("click", () => {
    queueExpanded = !queueExpanded;
    refreshQueue();
    document.getElementById("weekQueue")?.scrollIntoView({ block: "nearest" });
  });

  refreshQueue();
  syncFocusChip();
  syncDateLabel();
  syncLandPick();

  const badge = document.getElementById("notif-badge");
  badge.textContent =
    Math.max(pendingN + queuedN || 0, landSummary.pending || 0, jobs.filter((j) => j.status === "紧急").length, warns.length) ||
    (d.alerts || []).length;
  badge.style.display = "flex";
  document.getElementById("notif-panel").innerHTML =
    `<div class="n-head"><span>本周待办（${pendingN + queuedN || 0}）</span><button type="button" class="icon-btn n-close" aria-label="关闭通知中心">×</button></div>` +
    allItems
      .filter((b) => ["pending", "locked", "queued", "running", "paused", "accepting"].includes(itemState(b)))
      .map(
        (b) =>
          `<button type="button" class="n-item" data-nj="${esc(b.jump || "twin")}" data-nl="${esc(b.code || "")}">
          <b>${esc(b.when || "")} ${esc(b.code)} ${esc(b.task_type || b.tag || "")}</b><div class="sub">${esc(stateLabelOf(b))} · ${esc(b.agent_tip || b.reason || "")}</div>
        </button>`
      )
      .join("") +
    (d.alerts || [])
      .map(
        (a) =>
          `<button type="button" class="n-item" data-nj="${esc(a.jump || "dashboard")}" data-nl="${esc(a.land_code || "")}">
        <b>${esc(a.text)}</b><div class="sub">${esc(a.land_code || "")} · ${esc(a.at || "")}</div>
      </button>`
      )
      .join("");
  document.querySelector("#notif-panel .n-close")?.addEventListener("click", () => closeNotificationPanel(true));
  document.querySelectorAll("#notif-panel .n-item").forEach((el) => {
    el.onclick = () => {
      closeNotificationPanel(false);
      navigate({ page: el.dataset.nj || "dashboard", land: el.dataset.nl || undefined });
    };
  });
}

async function renderTwin() {
  const token = renderToken;
  const q = twinFocus ? `&land=${encodeURIComponent(twinFocus)}` : "";
  const d = await api(`/api/twin?layer=${encodeURIComponent(twinLayer)}${q}`);
  if (token !== renderToken) return;
  const selected = d.lands.find((l) => l.code === twinFocus) || d.lands[0];
  const meta = layerMeta(twinLayer);
  const ops = d.ops || {};
  const geo = window.FarmGeo || {};
  const fleetDevices = (Array.isArray(d.devices) ? d.devices : []).filter((x) =>
    geo.isFleetUnit
      ? geo.isFleetUnit(x)
      : !x.mesh &&
        ["tractor", "drone", "sprayer", "robot", "yield", "harvester", "seeder", "transport"].includes(x.device_type)
  );
  const fleetOnline = fleetDevices.filter((x) => deviceStatusOk(x.status)).length;
  /* 原来这里在 1101–1280 档自动收起地块栏：那时三栏并排，地图只剩 200px 出头。
     现在地图独占第一行、两个侧栏各占第二行的一半，哪一档都不挤，自动收起没必要了。 */

  const legendBar = meta.ramp
    ? `<div class="colorbar">
        <span class="cb-low">${esc(meta.low)}</span>
        <svg viewBox="0 0 240 14" preserveAspectRatio="none">${colorbarSvg(meta.ramp, 0, 0, 240, 14)}</svg>
        <span class="cb-high">${esc(meta.high)}</span>
      </div>`
    : `<div class="device-legend">
        <span><i class="dl sensor"></i>传感</span>
        <span><i class="dl weather"></i>气象</span>
        <span><i class="dl irrigation"></i>水肥</span>
        <span><i class="dl drone"></i>无人机</span>
        <span><i class="dl tractor"></i>农机</span>
        <span><i class="dl robot"></i>机器人</span>
      </div>`;

  const layerStats = (() => {
    if (twinLayer === "moisture") {
      const dry = d.lands.filter((l) => l.moisture < 25).length;
      const avg = (d.lands.reduce((s, l) => s + l.moisture, 0) / d.lands.length).toFixed(1);
      return [
        { label: "场均含水", value: `${avg}%` },
        { label: "低于阈值", value: `${dry} 块` },
        { label: "阈值", value: "25%" },
      ];
    }
    if (twinLayer === "crop") {
      const weak = d.lands.filter((l) => l.growth < 75).length;
      const avg = Math.round(d.lands.reduce((s, l) => s + l.growth, 0) / d.lands.length);
      return [
        { label: "场均长势", value: `${avg}` },
        { label: "弱势地块", value: `${weak} 块` },
        { label: "指数类型", value: "冠层长势" },
      ];
    }
    if (twinLayer === "risk") {
      const hot = d.lands.filter((l) => l.pest_risk > 50).length;
      const avg = Math.round(d.lands.reduce((s, l) => s + l.pest_risk, 0) / d.lands.length);
      return [
        { label: "平均风险", value: `${avg}` },
        { label: "高风险", value: `${hot} 块` },
        { label: "策略", value: "局部复核" },
      ];
    }
    if (twinLayer === "sensors") {
      return [
        { label: "模拟可用点", value: `${ops.sensors_online || 0}` },
        { label: "传感总数", value: `${ops.sensors_total || 0}` },
        { label: "布点", value: "多深度网格" },
      ];
    }
    if (twinLayer === "plants") {
      return [
        { label: "采样单株", value: `${ops.plants_total || 0}` },
        { label: "需关注", value: `${ops.plants_watch || 0}` },
        { label: "冠/根均", value: `${ops.canopy_avg || "-"}/${ops.root_avg || "-"}` },
      ];
    }
    return [
      { label: "模拟可用机队", value: `${ops.online || 0}` },
      { label: "机队总数", value: `${ops.total || 0}` },
      { label: "覆盖", value: "全场" },
    ];
  })();

  /* 三项图层读数原来压在地图下面。地图铺满整卡、又是一整张实景底图之后，
     卡片里再挂三张白卡会把「一张图」截断；挪进左栏「图层洞察」——
     那本来就是讲这一层怎么读的地方，和洞察正文放一起反而成套。 */
  const kpiBlock = `<div class="twin-kpi-row">${pgKpis(layerStats.map((s, idx) => ({
    label: s.label,
    value: s.value,
    cls: idx === 1 && /低于|弱势|高风险|关注/.test(s.label) ? "is-wait" : "is-ok",
  })), layerStats.length)}</div>`;

  const listMetric = (l) => {
    if (twinLayer === "crop") return { pct: l.growth, text: `长势 ${l.growth}`, color: growthColor(l.growth) };
    if (twinLayer === "risk") return { pct: l.pest_risk, text: `风险 ${l.pest_risk}`, color: riskColor(l.pest_risk) };
    if (twinLayer === "device") return { pct: l.health_index, text: `健康 ${l.health_index}`, color: "#5BAF7A" };
    if (twinLayer === "sensors") {
      const n = l.sensor_count || 1;
      const on = l.sensor_online || 0;
      return { pct: (on / n) * 100, text: `传感 ${on}/${n}`, color: "#2B8CFF" };
    }
    if (twinLayer === "plants") {
      return { pct: l.canopy_avg || 70, text: `冠${l.canopy_avg || "-"} · 根${l.root_avg || "-"} · 关注${l.plant_watch || 0}`, color: growthColor(l.canopy_avg || 70) };
    }
    return { pct: (l.moisture / 42) * 100, text: `含水 ${l.moisture}%`, color: moistureColor(l.moisture) };
  };

  const sceneMeta = {
    vector: { name: "矢量底图", img: "" },
    satellite: (d.scenes && d.scenes.satellite) || {
      name: "卫星实景",
      img: "assets/img/farm-real/farm-orthophoto.jpg",
    },
    field: (d.scenes && d.scenes.field) || {
      name: "田间实景",
      img: "assets/img/farm-real/cotton-field.jpg",
    },
  };
  const sc = sceneMeta[twinScene] || sceneMeta.vector;
  const mediaMap = d.land_media || {};
  const scenePhotos = {};
  (d.lands || []).forEach((l) => {
    const m = mediaMap[l.code];
    scenePhotos[l.code] = (m && (twinScene === "satellite" ? m.aerial : twinScene === "field" ? m.field : m.thumb)) || (d.land_photos && d.land_photos[l.code]) || "";
  });
  const focusMedia = selected && mediaMap[selected.code];

  /* 图层分两组：选指标和选对象，是两件事，不该平铺成一排六个。
     分组标题（「指标层 · 连续色阶」「对象层 · 点位标记」）已去掉：
     两组之间本来就有间距和换行，分组看得出来；组名只是给分好的组起了个学名，
     每个 tab 自己还带一行说明（含水分布 / 冠层指数 / 机具位置…）。
     组名保留在 tablist 的 aria-label 上——读屏拿不到视觉分组，那里才真的需要它。 */
  const metricIds = ["moisture", "crop", "risk"];
  const allLayers = d.layers || [];
  const layerTabs = (list) => list.map((ly) => {
    const on = twinLayer === ly.id;
    return `<button class="layer-tab ${on ? "active" : ""}" data-layer="${ly.id}" type="button" role="tab" aria-selected="${on}">
      <span class="lt-name">${esc(ly.name)}</span>
      <span class="lt-hint">${esc(layerMeta(ly.id).hint || "")}</span>
    </button>`;
  }).join("");
  const metricLayers = allLayers.filter((ly) => metricIds.indexOf(ly.id) >= 0);
  const objectLayers = allLayers.filter((ly) => metricIds.indexOf(ly.id) < 0);

  destroyTwinMap();
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip twin-strip">
      <span class="live-pill"><span class="dot orange"></span> 田间仿真地图</span>
      <span class="status-text">选中 ${esc(selected ? `${selected.code} ${selected.name}` : "—")} · 底图 ${esc(sc.name)}${focusMedia ? ` · ${esc(focusMedia.crop)}/${esc(focusMedia.stage)}` : ""}</span>
      <span class="chip">机队 ${fleetOnline}/${fleetDevices.length}</span>
      <span class="chip">传感 ${ops.sensors_online || 0}/${ops.sensors_total || 0}</span>
      <span class="chip">单株 ${ops.plants_total || 0} · 关注 ${ops.plants_watch || 0}</span>
      <div class="twin-jump">
        <button class="btn ghost" id="twinWall">态势大屏</button>
        <button class="btn ghost" id="twinPlants">植株管控</button>
        <button class="btn ghost" id="twinHistory">历年档案</button>
        <button class="btn ghost" id="twinDash">返回驾驶舱</button>
      </div>
    </div>

    <div class="layer-bar">
      ${metricLayers.length ? `<div class="layer-group">
        <div class="layer-group-tabs" role="tablist" aria-label="指标层（连续色阶）">${layerTabs(metricLayers)}</div>
      </div>` : ""}
      ${objectLayers.length ? `<div class="layer-group">
        <div class="layer-group-tabs" role="tablist" aria-label="对象层（点位标记）">${layerTabs(objectLayers)}</div>
      </div>` : ""}
    </div>

    ${twinLayer === "plants" ? `
    <div class="plant-view-toggle panel pg-card">
      <span class="sub">表型视角</span>
      <button type="button" class="btn ${plantView === "canopy" ? "" : "ghost"}" data-pview="canopy">地上冠层</button>
      <button type="button" class="btn ${plantView === "root" ? "" : "ghost"}" data-pview="root">地下根系</button>
      <button type="button" class="btn ${plantView === "both" ? "" : "ghost"}" data-pview="both">综合健康</button>
    </div>` : ""}

    <div class="twin-stage" data-rail-left="${twinRailLeft ? "on" : "off"}" data-rail-right="${twinRailRight ? "on" : "off"}">
      <div class="panel twin-map-wrap pg-card">
        <div class="toolbar">
          <div>
            <h3 style="margin:0">${esc(meta.title)}</h3>
            <div class="sub">${esc(meta.subtitle)}</div>
          </div>
          <div class="twin-map-tools">
            <div class="layer-btns map-tools twin-scene-btns">
              <button type="button" class="twin-base-btn ${twinScene === "vector" ? "active" : ""}" data-scene="vector" aria-pressed="${twinScene === "vector"}">矢量边界</button>
              <button type="button" class="twin-base-btn ${twinScene === "satellite" ? "active" : ""}" data-scene="satellite" aria-pressed="${twinScene === "satellite"}">卫星实景</button>
              <button type="button" class="twin-base-btn ${twinScene === "field" ? "active" : ""}" data-scene="field" aria-pressed="${twinScene === "field"}">田间实景</button>
            </div>
          </div>
        </div>
        <div class="twin twin-hero basemap-${esc(meta.basemap)} scene-${esc(twinScene)}">
          <div id="twinLeafletMap" class="twin-leaflet" role="application" aria-label="${esc(meta.title)}分布图 · 共 ${d.lands.length} 块地 · 当前选中 ${esc(selected ? selected.code : "无")}"></div>
          <div class="hud-float left"><div class="sub">底图</div><b>${esc(sc.name)}</b></div>
          <div class="hud-float right"><div class="sub">叠加层</div><b>${esc(meta.title)}</b></div>
          <div class="twin-rail-toggles">
            <button type="button" class="twin-rail-btn ${twinRailLeft ? "on" : ""}" data-rail="left" aria-pressed="${twinRailLeft}">${twinRailLeft ? "隐藏地块栏" : "显示地块栏"}</button>
            <button type="button" class="twin-rail-btn ${twinRailRight ? "on" : ""}" data-rail="right" aria-pressed="${twinRailRight}">${twinRailRight ? "隐藏详情栏" : "显示详情栏"}</button>
          </div>
        </div>
        <div class="legend legend-pro">
          ${legendBar}
          <span class="legend-hint">实景底图 · 色阶示意分布</span>
        </div>
      </div>

      <aside class="twin-rail rail-left">
        <div class="panel hud-panel pg-card">
          ${pgCardHd("图层洞察", "")}
          <div class="item ok" style="margin-top:0">${esc(meta.insight)}</div>
          ${kpiBlock}
          ${pgCardHd("地块队列", "点击切换焦点")}
          ${d.lands.map((l) => {
            const m = listMetric(l);
            const on = !!(selected && selected.code === l.code);
            return `
            <div class="land-row ${on ? "active" : ""}" data-pick="${l.code}" tabindex="0" role="button" aria-pressed="${on}" aria-label="${esc(l.code)} ${esc(l.crop_name)} ${esc(m.text)}">
              <span class="swatch" style="background:${m.color}"></span>
              <div class="land-row-body">
                <div class="row-between"><b>${esc(l.code)}</b><span class="tag gray">${esc(l.crop_name)}</span></div>
                <div class="sub">${esc(m.text)} · ${esc(l.stage)}</div>
                <div class="bar"><span style="width:${Math.min(m.pct, 100)}%;background:${m.color}"></span></div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </aside>

      <aside class="twin-rail rail-right">
        <div class="panel hud-panel pg-card">
          ${pgCardHd("地块详情", selected ? `${selected.code} · ${selected.name}` : "选择地块")}
          ${selected ? `
            <div class="scene-thumb" style="background-image:url('${esc(scenePhotos[selected.code] || (d.land_photos && d.land_photos[selected.code]) || "")}')">
              <span>${esc(selected.code)} · ${esc((focusMedia && focusMedia.credit) || "农情实景")}</span>
            </div>
            ${focusMedia ? `<div class="sub media-credit">采集 ${esc(focusMedia.captured_at)} · ${esc(focusMedia.source)}</div>` : ""}
            <div class="land-photo-strip">
              ${["field", "aerial", "closeup", "growth"].map((kind) => {
                const url = focusMedia && focusMedia[kind];
                if (!url) return "";
                const labels = { field: "田间", aerial: "航拍", closeup: "近景", growth: "长势" };
                return `<button type="button" class="land-photo-chip" data-photo="${esc(url)}" title="${esc(labels[kind])}" style="background-image:url('${esc(url)}')"><span>${esc(labels[kind])}</span></button>`;
              }).join("")}
            </div>
            <div class="item ok field-card">
              <div class="row-between">
                <b>${esc(selected.code)} ${esc(selected.name)}</b>
                <span class="swatch lg" style="background:${twinLayer === "crop" ? growthColor(selected.growth) : twinLayer === "risk" ? riskColor(selected.pest_risk) : moistureColor(selected.moisture)}"></span>
              </div>
              <div class="value" style="font-size:18px;margin:8px 0">${esc(selected.crop_name)} · ${esc(selected.stage)}</div>
              <div class="metric-grid">
                <div><span class="sub">含水</span><b class="num">${selected.moisture}%</b></div>
                <div><span class="sub">长势</span><b class="num">${selected.growth}</b></div>
                <div><span class="sub">冠层均</span><b class="num">${selected.canopy_avg || "-"}</b></div>
                <div><span class="sub">根系均</span><b class="num">${selected.root_avg || "-"}</b></div>
              </div>
              <div class="sub" style="margin-top:8px">土壤 ${esc(selected.soil_type)} · NPK ${selected.n}/${selected.p}/${selected.k} · 单株采样 ${selected.plant_count || 0} · 关注 ${selected.plant_watch || 0}</div>
            </div>
            <button class="btn" id="twinWater" style="width:100%;justify-content:center">${currentRole === "gov" ? "核查水肥证据" : "进入水肥证据研判"}</button>
            <div class="twin-act-grid">
              <button class="btn ghost" id="twinPlantPage">本田单株管控</button>
              <button class="btn ghost" id="twinSensors">本田传感网</button>
              <button class="btn ghost" id="twinCollab">${currentRole === "gov" ? "查看协同诊断" : "发起协同诊断"}</button>
              <button class="btn ghost" id="twinFleet">${currentRole === "gov" ? "查看机队作业" : "多机联合作业"}</button>
              ${twinLayer === "device" ? `<button class="btn ghost" id="twinDevices">打开设备中心</button>` : ""}
            </div>
            ${twinLayer === "plants" ? `<div class="sub" style="margin-top:8px">点击地图上的圆点可下钻到单株</div>` : ""}
          ` : "<div class='item'>选择地块</div>"}
          <h3>AI 决策旁注</h3>
          ${(d.decisions || []).map((x) => {
            const text = typeof x === "string" ? x : x.text;
            const jump = typeof x === "string" ? "water" : (x.jump || "water");
            const land = typeof x === "string" ? "" : (x.land || "");
            return `<div class="item ok decision-item" data-jump="${esc(jump)}" data-land="${esc(land)}" style="cursor:pointer">${esc(text)}</div>`;
          }).join("")}
          <div class="item"><div class="sub">作业流程</div>${esc(d.loop)}</div>
        </div>
      </aside>
    </div>
    </div>`;

  document.getElementById("twinDash").onclick = () => navigate({ page: "dashboard" });
  document.getElementById("twinPlants")?.addEventListener("click", () => navigate({ page: "plants", land: selected?.code || twinFocus || undefined }));
  document.getElementById("twinHistory")?.addEventListener("click", () => navigate({
    page: "history",
    land: selected?.code || twinFocus || undefined,
    toast: ["历年档案", selected?.code || "全场", "green"],
  }));
  document.getElementById("twinWall").onclick = () => {
    wallMode = true;
    try { localStorage.setItem("agrios-wall", "1"); } catch (e) {}
    if (window.FarmWall) {
      FarmWall.open();
      applyWallMode();
    }
  };
  const tw = document.getElementById("twinWater");
  if (tw) tw.onclick = () => navigate({ page: "water", land: selected?.code, toast: ["水肥证据研判", selected?.code || "", "orange"] });
  const tpp = document.getElementById("twinPlantPage");
  if (tpp) tpp.onclick = () => navigate({ page: "plants", land: selected?.code });
  const ts = document.getElementById("twinSensors");
  if (ts) ts.onclick = () => { twinLayer = "sensors"; twinFocus = selected?.code || twinFocus; renderTwin(); };
  const tc = document.getElementById("twinCollab");
  if (tc) tc.onclick = () => navigate({ page: "diagnosis", land: selected?.code });
  const tf = document.getElementById("twinFleet");
  if (tf) tf.onclick = () => navigate({ page: "fleet", land: selected?.code });
  const td = document.getElementById("twinDevices");
  if (td) td.onclick = () => navigate({ page: "devices", land: selected?.code, layer: "device" });
  view.querySelectorAll("[data-pview]").forEach((btn) => {
    btn.onclick = () => { plantView = btn.dataset.pview; renderTwin(); };
  });
  view.querySelectorAll("[data-photo]").forEach((btn) => {
    btn.onclick = () => {
      const thumb = view.querySelector(".scene-thumb");
      if (thumb) thumb.style.backgroundImage = `url('${btn.dataset.photo}')`;
      toast("切换农情图", btn.title || "实景", "green");
    };
  });
  view.querySelectorAll("[data-layer]").forEach((btn) => {
    btn.onclick = () => { twinLayer = btn.dataset.layer; renderTwin(); };
  });
  view.querySelectorAll("[data-scene]").forEach((btn) => {
    btn.onclick = () => { twinScene = btn.dataset.scene; renderTwin(); };
  });
  view.querySelectorAll("[data-rail]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.rail === "left") twinRailLeft = !twinRailLeft;
      else twinRailRight = !twinRailRight;
      renderTwin();
    };
  });
  view.querySelectorAll("[data-pick]").forEach((el) => {
    el.onclick = (ev) => {
      if (el.dataset.plant) return;
      ev.stopPropagation();
      twinFocus = el.dataset.pick || el.dataset.code || twinFocus;
      renderTwin();
    };
  });
  view.querySelectorAll(".land-row").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      twinFocus = el.dataset.pick || el.dataset.code || twinFocus;
      renderTwin();
    });
  });
  view.querySelectorAll(".decision-item").forEach((el) => {
    el.onclick = () => navigate({
      page: el.dataset.jump || "water",
      land: el.dataset.land || undefined,
      toast: ["决策联动", el.textContent.slice(0, 24), "green"],
    });
  });

  const twinMapCtx = {
    lands: d.lands || [],
    devices: d.devices || [],
    sensors: d.sensors || d.sensors_all || [],
    plants: d.plants || d.plants_all || [],
    layer: twinLayer,
    scene: twinScene,
    focus: selected?.code || twinFocus || "",
    onPickLand: (code) => {
      twinFocus = code;
      renderTwin();
    },
    onPickDev: (code) => {
      navigate({ page: "devices", device: code, toast: ["设备定位", code, "green"] });
    },
    onPickPlant: (code, land) => {
      plantFocus = code;
      twinFocus = land || twinFocus;
      navigate({
        page: "plants",
        plant: plantFocus,
        land: twinFocus,
        toast: ["单株下钻", plantFocus, "green"],
      });
    },
  };
  const ensureTwinLeaflet = () => {
    if (window.FarmGeo?.ensureLeaflet) return window.FarmGeo.ensureLeaflet();
    if (typeof L !== "undefined") return Promise.resolve(L);
    return Promise.reject(new Error("Leaflet 未就绪"));
  };
  ensureTwinLeaflet()
    .then(() => mountTwinLeaflet(twinMapCtx))
    .catch((err) => {
      const host = document.getElementById("twinLeafletMap");
      if (host) {
        host.innerHTML = `<div class="twin-map-fallback"><b>地图未能加载</b><span>${esc(err?.message || "Leaflet 不可用")}</span></div>`;
      }
    });
}

async function renderPlants() {
  const token = renderToken;
  const qs = [];
  if (twinFocus) qs.push(`land=${encodeURIComponent(twinFocus)}`);
  if (window.__plantWatchOnly) qs.push("status=watch");
  const pack = await api(`/api/plants${qs.length ? `?${qs.join("&")}` : ""}`);
  if (token !== renderToken) return;

  let selected = pack.selected;
  if (plantFocus) {
    selected = (pack.items || []).find((p) => p.code === plantFocus || String(p.id) === String(plantFocus)) || selected;
  }
  if (selected) plantFocus = selected.code;

  const detail = selected
    ? await api(`/api/plants/${encodeURIComponent(selected.code)}`).catch(() => ({
        plant: selected,
        morphology: (pack.morphology && selected.crop_name && pack.morphology[selected.crop_name]) || [],
        prescriptions: [],
        neighbors: [],
      }))
    : { plant: null, morphology: [], prescriptions: [], neighbors: [] };

  const pl = detail.plant || selected;
  const sum = pack.summary || {};
  const morphList = detail.morphology?.length
    ? detail.morphology
    : (pack.morphology && pl && pack.morphology[pl.crop_name]) || [];
  const canopyBar = pl ? Math.min(100, pl.canopy.vigor) : 0;
  const rootBar = pl ? Math.min(100, pl.root.vigor) : 0;

  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 单株表型模拟</span>
      <span class="status-text">${esc(pack.note || "地上冠层 · 地下根系 · 全生育期形态")}${twinFocus ? ` · 聚焦 ${esc(twinFocus)}` : ""}</span>
      <span class="chip">采样 ${sum.total || 0} 株</span>
      <span class="chip">关注 ${sum.watch || 0}</span>
      <span class="chip">冠层均 ${sum.canopy_avg || "-"}</span>
      <span class="chip">根系均 ${sum.root_avg || "-"}</span>
      <button class="btn ghost" id="plTwin">孪生单株层</button>
      <button class="btn ghost" id="plClear">全场</button>
      <button class="btn ${window.__plantWatchOnly ? "" : "ghost"}" id="plWatch">${window.__plantWatchOnly ? "显示全部" : "仅看关注株"}</button>
    </div>

    ${pgKpis([
      { label: "采样株数", value: sum.total || 0, cls: "is-ok" },
      { label: "需关注", value: sum.watch || 0, cls: "is-wait", clickable: true, attrs: `id="plKpiWatch"` },
      { label: "冠层均", value: sum.canopy_avg || "-", cls: "is-run" },
      { label: "根系均", value: sum.root_avg || "-", cls: "is-done" },
    ])}

    <div class="pg-grid">
      ${(sum.by_land || []).map((l) => `
        <div class="card compact clickable ${twinFocus === l.code ? "ok" : ""}" data-pland="${esc(l.code)}">
          <div class="row-between"><b>${esc(l.code)}</b><span class="tag gray">${esc(l.crop)}</span></div>
          <div class="sub">${esc(l.stage)} · 采样 ${l.count} · 关注 ${l.watch}</div>
          <div class="plant-dual-mini">
            <div><span class="sub">地上</span><b>${l.canopy_avg}</b><div class="bar"><span style="width:${l.canopy_avg}%;background:${growthColor(l.canopy_avg)}"></span></div></div>
            <div><span class="sub">地下</span><b>${l.root_avg}</b><div class="bar"><span style="width:${l.root_avg}%;background:${growthColor(l.root_avg)}"></span></div></div>
          </div>
        </div>`).join("")}
    </div>

    <div class="plant-workspace pg-split wide-right">
      <div class="panel plant-list-panel pg-card">
        ${pgCardHd(`植株队列${twinFocus ? ` · ${twinFocus}` : ""}`, "展示前 60 株采样点")}
        <div class="plant-list pg-feed">
          ${(pack.items || []).slice(0, 60).map((p) => `
            <div class="plant-row clickable ${pl && pl.code === p.code ? "on" : ""} ${p.status !== "正常" ? "watch" : ""}" data-sel-plant="${esc(p.code)}">
              <span class="swatch" style="background:${growthColor(p.canopy.vigor)}"></span>
              <div>
              <div class="row-between"><b>${esc(p.code)}</b><span class="tag gray">生成值·未观测</span></div>
                <div class="sub">${esc(p.morph_name)} · 冠${p.canopy.vigor} · 根${p.root.vigor} · R${p.row}/C${p.col}</div>
              </div>
            </div>`).join("")}
        </div>
        <div class="sub">地图全量见孪生「单株表型」层</div>
      </div>

      <div class="panel plant-detail-panel pg-card">
        ${pl ? `
          <div class="row-between">
            <div>
              <div class="priority-kicker">单株数字孪生</div>
              <h3 style="margin:4px 0 0">${esc(pl.code)} · ${esc(pl.crop_name)} ${esc(pl.variety)}</h3>
              <div class="sub">${esc(pl.land_code)} · 行${pl.row} 列${pl.col} · 生成场景，未取得单株观测</div>
            </div>
            <span class="tag gray">不能判断</span>
          </div>

          <div class="plant-morph-rail">
            ${morphList.map((m, i) => `
              <div class="morph-step ${pl.morph_key === m.key ? "on" : ""} ${i < pl.morph_index ? "done" : ""}">
                <b>${esc(m.name)}</b>
                <div class="sub">${esc(m.days)}</div>
              </div>`).join("")}
          </div>
          <div class="item ok" style="margin-top:8px">
            <b>当前形态 · ${esc(pl.morph_name)}</b>
            <div class="sub">地上：${esc(pl.morph_canopy_desc)}</div>
            <div class="sub">地下：${esc(pl.morph_root_desc)}</div>
          </div>

          <div class="plant-split">
            <div class="plant-half canopy">
              <div class="plant-half-hd">地上长势 · 冠层</div>
              <div class="plant-silhouette canopy-sil" aria-hidden="true"></div>
              <div class="verify-grid">
                <div><span class="sub">活力</span><b class="num">${pl.canopy.vigor}</b></div>
                <div><span class="sub">株高</span><b class="num">${pl.canopy.height_cm}<small>cm</small></b></div>
                <div><span class="sub">LAI</span><b class="num">${pl.canopy.lai}</b></div>
                <div><span class="sub">NDVI</span><b class="num">${pl.canopy.ndvi}</b></div>
              </div>
              <div class="bar"><span style="width:${canopyBar}%;background:${growthColor(pl.canopy.vigor)}"></span></div>
              <div class="sub" style="margin-top:6px">叶色 ${esc(pl.canopy.leaf_color)} · 结实 ${pl.canopy.fruit_load} · 冠幅 ${pl.phenotype.canopy_width_cm}cm</div>
            </div>
            <div class="plant-half root">
              <div class="plant-half-hd">地下长势 · 根系</div>
              <div class="plant-silhouette root-sil" aria-hidden="true"></div>
              <div class="verify-grid">
                <div><span class="sub">活力</span><b class="num">${pl.root.vigor}</b></div>
                <div><span class="sub">根深</span><b class="num">${pl.root.depth_cm}<small>cm</small></b></div>
                <div><span class="sub">密度</span><b class="num">${esc(pl.root.density)}</b></div>
                <div><span class="sub">根际墒</span><b class="num">${pl.root.rhizosphere_moisture}%</b></div>
              </div>
              <div class="bar"><span style="width:${rootBar}%;background:${growthColor(pl.root.vigor)}"></span></div>
              <div class="sub" style="margin-top:6px">根健康 ${esc(pl.root.root_health)} · 根尖 ${esc(pl.root.tip_activity)} · 茎粗 ${pl.phenotype.stem_diameter_mm}mm</div>
            </div>
          </div>

          <h3>胁迫与表型</h3>
          <div class="tags">${(pl.stress || []).length ? pl.stress.map((s) => `<span class="tag orange">模拟提示·${esc(s)}</span>`).join("") : `<span class="tag gray">无真实观测，不能判断胁迫</span>`}
            <span class="tag gray">${esc(pl.phenotype.symmetry)}</span>
            <span class="tag gray">生物量代理 ${pl.phenotype.biomass_proxy}</span>
          </div>

          <h3>处方建议</h3>
          ${(detail.prescriptions || []).length
            ? detail.prescriptions.map((r) => `
              <div class="item clickable" data-rx-jump="${esc(r.jump)}">
                <span class="tag blue">${esc(r.type)}</span> ${esc(r.text)}
              </div>`).join("")
            : `<div class="item">无真实观测与属地阈值，暂不能判断或形成农艺处方</div>`}

          <div class="pg-toolbar">
            <button class="btn" id="plWater">水肥处置</button>
            <button class="btn ghost" id="plDiag">联合诊断</button>
            <button class="btn ghost" id="plFleet">联合作业</button>
            <button class="btn ghost" id="plMap">孪生定位</button>
          </div>
        ` : `<div class="item">请选择植株</div>`}
      </div>
    </div>
    </div>`;

  document.getElementById("plTwin").onclick = () => navigate({ page: "twin", layer: "plants", land: twinFocus || undefined, plant: plantFocus || undefined });
  document.getElementById("plClear").onclick = () => { twinFocus = ""; plantFocus = ""; window.__plantWatchOnly = false; renderPlants(); };
  document.getElementById("plWatch").onclick = () => { window.__plantWatchOnly = !window.__plantWatchOnly; renderPlants(); };
  document.getElementById("plKpiWatch")?.addEventListener("click", () => { window.__plantWatchOnly = true; renderPlants(); });
  view.querySelectorAll("[data-pland]").forEach((el) => {
    el.onclick = () => { twinFocus = el.dataset.pland; renderPlants(); };
  });
  view.querySelectorAll("[data-sel-plant]").forEach((el) => {
    el.onclick = async () => {
      plantFocus = el.dataset.selPlant;
      await api("/api/plants/select", { method: "POST", body: JSON.stringify({ code: plantFocus }) });
      renderPlants();
    };
  });
  if (pl) {
    document.getElementById("plWater").onclick = () => navigate({ page: "water", land: pl.land_code });
    document.getElementById("plDiag").onclick = () => navigate({ page: "diagnosis", land: pl.land_code });
    document.getElementById("plFleet").onclick = () => navigate({ page: "fleet", land: pl.land_code });
    document.getElementById("plMap").onclick = () => navigate({ page: "twin", layer: "plants", land: pl.land_code, plant: pl.code });
    view.querySelectorAll("[data-rx-jump]").forEach((el) => {
      el.onclick = () => navigate({ page: el.dataset.rxJump, land: pl.land_code, toast: ["单株处方", pl.code, "green"] });
    });
  }
}

async function renderSeason() {
  const token = renderToken;
  const d = await api("/api/season");
  if (token !== renderToken) return;
  const stages = d.stages || [];
  const selected = stages.find((s) => s.id === seasonStageFocus) || stages.find((s) => ["NO_GO", "待审核", "流程回放"].includes(s.status)) || stages[0];
  const liveDevices = d.live_devices || [];
  /* 状态条原来三个 chip（回放进度 / 回放归档 / 生产执行）和下面的 KPI 条逐字重复，
     「生产执行 0」还是写死的字面量。chip 全部去掉，KPI 改成四个各自独立、且都从数据算出来的数。 */
  const doneStages = stages.filter((x) => ["回放归档", "流程回放完成"].includes(x.status)).length;
  const blockStages = stages.filter((x) => x.status === "NO_GO").length;
  /* 归档阶段已经回放完，不放行的阶段引擎一律挡回（实测两类都弹「当前保持禁行」）。
     与其让人反复点一个注定失败的主按钮，不如按阶段状态禁用并把原因写出来。 */
  const advanceBlock = selected
    ? (["回放归档", "流程回放完成"].includes(selected.status)
        ? "本阶段已回放归档"
        : selected.status === "NO_GO" ? "不放行 · 不能推进回放" : "")
    : "";

  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 全季流程回放</span>
      <span class="status-text">${esc(d.season || "")} · ${esc(d.note || "")}</span>
      <button class="btn ghost" id="seaFleet">联合作业</button>
      <button class="btn ghost" id="seaPost">收贮加工</button>
      <button class="btn ghost" id="seaDev">设备清单</button>
      <button class="btn ghost" id="seaExport">导出全季台账</button>
    </div>

    <div class="season-kpis">${pgKpis([
      { label: "回放归档阶段", value: doneStages, unit: `/ ${stages.length} 个`, cls: "is-done", sub: "仅流程回放，不代表真实作业" },
      { label: "待核验阶段", value: blockStages, unit: `/ ${stages.length} 个`, cls: "is-urgent", sub: "不放行 · 需补证据" },
      { label: "全季装备", value: liveDevices.length, unit: "台", cls: "is-wait", sub: "均为仿真状态" },
      { label: "当前阶段", value: selected ? selected.name : "—", cls: "is-run", sub: selected ? selected.window : "" },
    ])}</div>

    <div class="season-progress panel pg-card">
      <div class="row-between"><b>仿真流程：播种 → 管护 → 秋收 → 进仓</b><span class="num">模拟 ${d.progress || 0}%</span></div>
      <div class="bar lg"><span style="width:${d.progress || 0}%"></span></div>
    </div>

    <div class="season-rail">
      ${stages.map((x) => `
        <button type="button" class="season-step ${selected && selected.id === x.id ? "on" : ""} ${x.status === "回放归档" || x.status === "流程回放完成" ? "done" : x.status === "流程回放" ? "run" : ""}"
          data-stage="${esc(x.id)}" aria-pressed="${selected && selected.id === x.id}">
          <span class="tag ${x.status === "回放归档" || x.status === "流程回放完成" ? "green" : x.status === "流程回放" ? "blue" : "orange"}">${esc(x.status)}</span>
          <b>${esc(x.name)}</b>
          <div class="sub">${esc(x.window)}</div>
          <div class="fl-prog"><em>回放</em><div class="bar"><span style="width:${x.progress}%"></span></div><b>${x.progress}%</b></div>
        </button>`).join("")}
    </div>

    <div class="pg-split">
      <div class="panel pg-card">
        ${pgCardHd(`阶段详情 · ${selected.name}`, selected.window)}
        <div class="item ok">
          <div class="row-between"><b>${esc(selected.ops)}</b><span class="tag blue">${esc(selected.land)}</span></div>
          <div class="sub">候选窗口 ${esc(selected.window)} · 模拟台时 ${esc(String(selected.hours))} · 模拟能耗 ${esc(selected.fuel)}</div>
          <div class="fl-prog"><em>本阶段回放</em><div class="bar"><span style="width:${selected.progress}%"></span></div><b>${selected.progress}%</b></div>
        </div>
        ${advanceBlock && currentRole === "farm" ? `<div class="sub">${selected.status === "NO_GO" ? "补齐证据包与设备联锁核验并经人工确认后，才可推进回放。" : "本阶段回放已归档，不再推进。"}</div>` : ""}
        <div class="pg-toolbar">
          ${currentRole !== "farm"
            ? `<span class="role-readonly"><i></i>查看/审核视图 · 阶段推进由农场执行</span>`
            : advanceBlock
              ? `<button class="btn" id="seaAdvance" disabled>${esc(advanceBlock)}</button>`
              : `<button class="btn" id="seaAdvance">模拟推进本阶段 +12%</button>`}
          <button class="btn ghost" id="seaTwin">孪生机队层</button>
          <button class="btn ghost" id="seaPlants">单株表型</button>
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("本阶段装备", `${(selected.devices || []).length} 台 · 点击定位设备`)}
        ${(selected.devices || []).map((code) => {
          const live = liveDevices.find((x) => x.code === code) || { code, status: "—", location: "—", name: code };
          return `<div class="item clickable sea-dev" data-sdev="${esc(live.code)}"
            tabindex="0" role="button" aria-label="在设备中心定位 ${esc(live.code)} ${esc(live.name || "")}">
            <div class="row-between"><b>${esc(live.code)}</b><span class="tag ${statusTone(live.status)}">${esc(live.status)}</span></div>
            <div class="sub">${esc(live.name || "")} · ${esc(live.location || "")}</div>
          </div>`;
        }).join("") || "<div class='item'>本阶段未登记装备</div>"}
      </div>
    </div>

    <div class="panel pg-card">
      ${pgCardHd("全季装备台账", `${liveDevices.length} 台 · 点击定位设备 · 均为仿真状态`)}
      <div class="pg-table-wrap sea-table-wrap">
      <table class="table">
        <thead><tr><th>编号</th><th>名称</th><th>类型</th><th>状态</th><th>位置</th></tr></thead>
        <tbody>
        ${liveDevices.map((x) => `
          <tr class="clickable sea-row" data-sdev="${esc(x.code)}"
            tabindex="0" role="button" aria-label="在设备中心定位 ${esc(x.code)} ${esc(x.name || "")}">
            <td>${esc(x.code)}</td><td>${esc(x.name || "-")}</td><td>${esc(equipTypeLabel(x.type || x.device_type))}</td>
            <td><span class="tag ${statusTone(x.status)}">${esc(x.status)}</span></td><td>${esc(x.location || "-")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      </div>
    </div>
    </div>`;

  document.getElementById("seaFleet").onclick = () => navigate({ page: "fleet" });
  document.getElementById("seaPost").onclick = () => navigate({ page: "postharvest" });
  document.getElementById("seaDev").onclick = () => navigate({ page: "devices" });
  document.getElementById("seaTwin").onclick = () => navigate({ page: "twin", layer: "device" });
  document.getElementById("seaPlants").onclick = () => navigate({ page: "plants" });
  document.getElementById("seaExport").onclick = () => downloadCsv(
    `全季装备台账_${localDateKey()}.csv`,
    [
      ["阶段", "状态", "窗口", "作业", "地块", "进度", "台时", "能耗", "装备"],
      ...stages.map((s) => [s.name, s.status, s.window, s.ops, s.land, `${s.progress}%`, s.hours, s.fuel, (s.devices || []).join(";")]),
    ]
  );
  document.getElementById("seaAdvance")?.addEventListener("click", async () => {
    const r = await api("/api/season/advance", { method: "POST", body: JSON.stringify({ id: selected.id }) });
    if (r.ok === false) {
      toast("阶段未推进", r.message || "操作被安全锁阻止", "orange");
      return;
    }
    seasonStageFocus = (r.stage && r.stage.id) || selected.id;
    toast("流程回放已推进", r.message || `${r.stage?.name || ""} · 回放进度 ${r.progress ?? 0}%`, "orange");
    renderSeason();
  });
  view.querySelectorAll("[data-stage]").forEach((el) => {
    el.onclick = () => { seasonStageFocus = el.dataset.stage; renderSeason(); };
  });
  view.querySelectorAll("[data-sdev]").forEach((el) => {
    el.onclick = () => navigate({ page: "devices", device: el.dataset.sdev, toast: ["装备定位", el.dataset.sdev, "green"] });
    /* 装备卡片和台账行是 div/tr 上挂的 role="button"，键盘要自己补 Enter/Space */
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      el.click();
    });
  });
}

async function renderPostharvest() {
  const token = renderToken;
  const d = await api("/api/postharvest");
  if (token !== renderToken) return;
  const sum = d.summary || {};
  const batch = (d.batches || []).find((b) => b.id === postBatchFocus) || (d.batches || [])[0];
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 收贮加工仿真</span>
      <span class="status-text">${esc(d.note || "")}</span>
      <span class="chip">模拟库存 ${sum.stock_t || 0}/${sum.capacity_t || 0} t</span>
      <span class="chip">生产产线运行 0</span>
      <span class="chip">模拟批次 ${sum.batches || 0}</span>
      <button class="btn ghost" id="phSeason">全季装备</button>
      <button class="btn ghost" id="phAssets">数据资产</button>
      <button class="btn ghost" id="phExport">导出批次核验清单</button>
    </div>

    ${pgKpis([
      { label: "模拟库存", value: `${sum.stock_t || 0}/${sum.capacity_t || 0}`, unit: "t", cls: "is-wait" },
      { label: "生产产线运行", value: 0, cls: "is-wait" },
      { label: "模拟批次", value: sum.batches || 0, cls: "is-wait" },
      { label: "当前模拟批次", value: batch ? batch.id : "—", cls: "is-wait" },
    ])}

    <div class="item ok panel pg-card">
      <b>收后处理流程</b>
      <div class="ph-flow">${(d.flow || []).map((f, i) => `<span>${esc(f)}</span>${i < d.flow.length - 1 ? "<i>→</i>" : ""}`).join("")}</div>
    </div>

    <div class="pg-grid">
      ${(d.warehouses || []).map((w) => `
        <div class="panel pg-card">
          <div class="row-between"><h3 style="margin:0">${esc(w.name)}</h3><span class="tag ${w.status === "正常" ? "green" : "orange"}">${esc(w.status)}</span></div>
          <div class="sub">${esc(w.crop)} · 更新 ${esc(w.updated)}</div>
          <div class="value" style="font-size:22px;margin:8px 0">${w.stock_t}<small> / ${w.capacity_t} t</small></div>
          <div class="bar"><span style="width:${w.capacity_t ? (w.stock_t / w.capacity_t) * 100 : 0}%"></span></div>
          <div class="verify-grid" style="margin-top:8px">
            <div><span class="sub">仓湿</span><b class="num">${w.moisture}%</b></div>
            <div><span class="sub">仓温</span><b class="num">${w.temp}℃</b></div>
          </div>
        </div>`).join("")}
    </div>

    <div class="pg-split equal">
      <div class="panel pg-card">
        ${pgCardHd("基本初加工产线", "吞吐与质量")}
        ${(d.lines || []).map((l) => `
          <div class="item ${l.status === "运行" ? "ok" : ""}">
            <div class="row-between"><b>${esc(l.name)}</b><span class="tag ${l.status === "运行" ? "blue" : l.status === "待机" ? "orange" : "gray"}">${esc(l.status)}</span></div>
            <div class="sub">${esc(l.crop)} · ${esc(l.throughput)} · 批次 ${esc(l.batch)}</div>
            <div class="tags">${(l.steps || []).map((s) => `<span class="tag gray">${esc(s)}</span>`).join("")}</div>
            <div class="sub" style="margin-top:6px">质量：${esc(l.quality)}</div>
          </div>`).join("")}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("批次核验台账", "点击切换批次")}
        ${(d.batches || []).map((b) => `
          <div class="item clickable ${batch && batch.id === b.id ? "ok" : ""}" data-batch="${esc(b.id)}">
            <div class="row-between"><b>${esc(b.id)}</b><span class="tag blue">${esc(b.grade)}</span></div>
            <div>${esc(b.crop)} · ${esc(b.land)} · ${b.weight_t} t</div>
            <div class="sub">业务记录：${esc(b.stage)} → ${esc(b.next)} · ${esc(b.warehouse)}</div>
            <div class="sub">回放位置：${esc(b.replay_stage || (d.flow || [])[b.replay_index] || b.stage)} · 不改写业务记录</div>
          </div>`).join("")}
        ${batch ? `
          <div class="pg-toolbar">
            ${currentRole !== "farm" ? `<span class="role-readonly"><i></i>查看/审核视图 · 回放由农场角色操作</span>` : `<button class="btn" id="phAdvance">回放下一环节 · ${esc(batch.id)}</button>`}
            <button class="btn ghost" id="phSeason2">关联机收装备</button>
          </div>` : ""}
      </div>
    </div>
    </div>`;

  document.getElementById("phSeason").onclick = () => navigate({ page: "season" });
  document.getElementById("phAssets").onclick = () => navigate({ page: "assets" });
  document.getElementById("phExport").onclick = () => downloadCsv(
    `收贮批次核验清单_${localDateKey()}.csv`,
    [
      ["批次", "作物", "来源地块", "重量(t)", "等级", "业务记录环节", "下一环节", "仓库", "回放位置", "数据性质"],
      ...(d.batches || []).map((b) => [b.id, b.crop, b.land, b.weight_t, b.grade, b.stage, b.next, b.warehouse, b.replay_stage || (d.flow || [])[b.replay_index] || b.stage, "仿真·未核验"]),
    ]
  );
  const adv = document.getElementById("phAdvance");
  if (adv) {
    adv.onclick = async () => {
      const r = await api("/api/postharvest/advance", { method: "POST", body: JSON.stringify({ id: batch.id }) });
      if (r.ok === false) {
        toast("批次未推进", r.message || "操作被安全锁阻止", "orange");
        return;
      }
      const replayBatch = r.batch || r;
      postBatchFocus = replayBatch.id;
      toast("采后回放已推进", r.message || `${replayBatch.id} · ${replayBatch.stage}`, "orange");
      renderPostharvest();
    };
  }
  const ph2 = document.getElementById("phSeason2");
  if (ph2) ph2.onclick = () => navigate({ page: "season", toast: ["机收装备", "harvest", "green"] });
  view.querySelectorAll("[data-batch]").forEach((el) => {
    el.onclick = () => { postBatchFocus = el.dataset.batch; renderPostharvest(); };
  });
}

async function renderDevices() {
  const token = renderToken;
  const landQ = twinFocus ? `&land=${encodeURIComponent(twinFocus)}` : "";
  const venQ = vendorFocus ? `&vendor=${encodeURIComponent(vendorFocus)}` : "";
  const d = await api(`/api/devices?mesh=0${landQ}${venQ}`);
  const mesh = await api(`/api/devices?mesh=1${landQ}${venQ}`);
  const catalog = await api("/api/equipment-catalog");
  if (token !== renderToken) return;
  const fleet = d.items || [];
  const sensors = mesh.items || [];
  const fleetSummary = d.summary || {};
  const sensorSummary = mesh.summary || {};
  const sum = {
    fleet: fleetSummary.fleet ?? fleet.length,
    sensors: sensorSummary.sensors ?? sensors.length,
    sensors_online: sensorSummary.sensors_online ?? 0,
    by_land: sensorSummary.by_land || [],
  };
  const catItems = catalog.deployed || catalog.items || [];
  const typeLabel = (t) =>
    (window.FarmEquipmentCatalog && FarmEquipmentCatalog.typeLabel(t)) || t || "—";
  const focused = fleet.find((x) => x.code === deviceFocus) || sensors.find((x) => x.code === deviceFocus);
  /* 从别处跳过来聚焦某台设备时，直接翻到它所在那一页，不然点了看不见 */
  const focusIdx = fleet.findIndex((x) => x.code === deviceFocus);
  if (focusIdx >= 0) devicePage = Math.floor(focusIdx / DEV_PAGE_SIZE);
  const devPages = Math.max(1, Math.ceil(fleet.length / DEV_PAGE_SIZE));
  if (devicePage > devPages - 1) devicePage = devPages - 1;
  if (devicePage < 0) devicePage = 0;
  const devFrom = devicePage * DEV_PAGE_SIZE;
  const fleetPage = fleet.slice(devFrom, devFrom + DEV_PAGE_SIZE);
  const vendorOptions = [
    ...new Set([
      "xinjie", "topcloud", "huade", "dji", "lovol", "meter", "vaisala", "ott", "veris", "licor", "apogee", "netafim", "arable", "trapview", "agleader", "senseagro",
    ]),
  ];
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 设备状态模拟</span>
      <span class="status-text">${vendorFocus ? `厂家筛选：${esc(vendorFocus)}` : twinFocus ? `地块 ${esc(twinFocus)}` : "全场机具与农情感知"} · 机队 ${sum.fleet || fleet.length} · 测点 ${sum.sensors_online || 0}/${sum.sensors || sensors.length}</span>
      ${vendorFocus ? `<button class="btn ghost" id="devClearVen">清除厂家筛选</button>` : ""}
      <button class="btn ghost" id="devTwin">孪生传感网格</button>
      <button class="btn ghost" id="devVendors">厂家接入</button>
      <button class="btn ghost" id="devClear">全场</button>
      <button class="btn ghost" id="devExport">导出设备台账</button>
    </div>
    ${pgKpis([
      { label: "机队/站端", value: sum.fleet ?? fleet.length, cls: "is-ok", clickable: true, attrs: `id="devKpiFleet"` },
      { label: "模拟可用点", value: sum.sensors_online ?? 0, unit: `/ ${sum.sensors ?? sensors.length}`, cls: "is-wait" },
      { label: "清单型号", value: catItems.length || 12, cls: "is-done" },
      { label: "厂家", value: vendorFocus || "全部", cls: vendorFocus ? "is-wait" : "is-ok", clickable: true, attrs: `id="devKpiVen"` },
    ])}
    <div class="item warn" role="note"><b>仿真控制模式</b><div class="sub">启动、停止、开阀与巡航仅登记模拟请求，不代表真实设备已收到或执行；真实接入必须配置身份、联锁、幂等命令与设备回执。</div></div>
    <div class="panel pg-card">
      ${pgCardHd(catalog.title || "大田作业农情感知设备清单", catalog.note || "代表型号公开资料")}
      <div class="sub" style="margin:0 0 10px">资料整理 ${esc(catalog.retrieved_at || "2026-09-13")} · 型号能力待按厂家正式资料与现场验收核对</div>
      <div class="eq-catalog-grid">
        ${catItems.map((c) => `
          <button type="button" class="eq-card ${(focused && focused.catalog_id === c.id) || vendorFocus === c.vendor_id ? "is-on" : ""}" data-cat-id="${esc(c.id)}" data-cat-vendor="${esc(c.vendor_id)}" title="${esc(c.tips || "")}">
            <div class="eq-card-media" style="background-image:url('${esc(c.image_url || "")}')"></div>
            <div class="eq-card-body">
              <div class="eq-card-top"><span class="tag gray">${esc(c.category)}</span><span class="sub">设备数量 ${c.deployed_count != null ? c.deployed_count : "—"}</span></div>
              <b>${esc(c.model)}</b>
              <div class="sub">${esc(c.type_name)}</div>
              <div class="eq-params">${(c.params || []).slice(0, 4).map((p) => `<em>${esc(p)}</em>`).join("")}${(c.params || []).length > 4 ? `<em>+${(c.params || []).length - 4}</em>` : ""}</div>
              <div class="sub">${esc((c.interfaces || []).slice(0, 2).join(" · "))}</div>
            </div>
          </button>`).join("")}
      </div>
    </div>
    ${focused ? `
    <div class="panel pg-card eq-detail">
      ${pgCardHd(`${esc(focused.name)} · 参数档案`, focused.model || focused.code)}
      <div class="eq-detail-grid">
        <div>
          <div class="sub">类别 / 型号</div>
          <b>${esc(focused.category || typeLabel(focused.device_type))} · ${esc(focused.model || "—")}</b>
          <div class="sub" style="margin-top:8px">厂家</div>
          <b>${esc(focused.vendor_name || focused.vendor_id || "—")}</b>
          <div class="sub" style="margin-top:8px">安装/应用</div>
          <div>${esc(focused.application || "—")}</div>
          <div class="sub" style="margin-top:8px">最近模拟值</div>
          <div class="value" style="font-size:18px">${esc(focused.last_value || "—")}</div>
          ${focused.calibration_status ? `
            <div class="sub" style="margin-top:8px">校准状态</div>
            <b class="${focused.calibration_status === "VERIFIED" ? "ok" : "warn"}">${esc(focused.calibration_label || focused.calibration_status)}</b>
            <div class="sub">${(focused.calibration_required || []).map((item) => esc(item)).join(" · ") || "校准证据未登记"}</div>
          ` : ""}
        </div>
        <div>
          <div class="sub">直接回传参数</div>
          <div class="eq-chip-row">${(focused.params || []).map((p) => `<span class="eq-chip">${esc(p)}</span>`).join("") || "<span class='sub'>—</span>"}</div>
          <div class="sub" style="margin-top:8px">单位 / 形式</div>
          <div>${esc(focused.units || "—")}</div>
          <div class="sub" style="margin-top:8px">通信接口</div>
          <div class="eq-chip-row">${(focused.interfaces || []).map((p) => `<span class="eq-chip soft">${esc(p)}</span>`).join("") || "<span class='sub'>—</span>"}</div>
        </div>
        <div>
          <div class="sub">平台可派生指标</div>
          <div class="eq-chip-row">${(focused.derived || []).map((p) => `<span class="eq-chip soft">${esc(p)}</span>`).join("") || "<span class='sub'>—</span>"}</div>
          <div class="sub" style="margin-top:8px">选型与使用要点</div>
          <div>${esc(focused.tips || "—")}</div>
          ${focused.docs_url ? `<div style="margin-top:10px"><a class="linkish" href="${esc(focused.docs_url)}" target="_blank" rel="noopener">厂家资料</a></div>` : ""}
        </div>
      </div>
    </div>` : ""}
    <div class="panel pg-card">
      ${pgCardHd("地块传感密度（TEROS 12 网格）", "点击筛选地块")}
      <div class="pg-grid">
        ${(sum.by_land || []).map((l) => `
          <div class="card compact clickable ${twinFocus === l.code ? "ok" : ""}" data-land-mesh="${esc(l.code)}">
            <b>${esc(l.code)}</b>
            <div class="value" style="font-size:20px">${l.count}<small> 点</small></div>
            <div class="sub">模拟可用 ${l.online}</div>
            <div class="bar"><span style="width:${l.count ? (l.online / l.count) * 100 : 0}%"></span></div>
          </div>`).join("")}
      </div>
    </div>
    <div class="pg-split wide-left dev-split">
      <div class="panel pg-card dev-fleet-card">
        ${pgCardHd("机队 / 站端感知 / 阀泵", `共 ${fleet.length} 台 · 含清单代表型号`)}
        <div class="pg-table-wrap dev-fleet-wrap">
        <table class="table dev-fleet-table">
          <thead>
          <tr><th>编号</th><th>名称</th><th>类别</th><th>型号</th><th>厂家</th><th>位置</th><th>状态</th><th>控制</th></tr>
          </thead>
          <tbody>
          ${fleetPage.map((x) => `<tr class="${deviceFocus === x.code ? "row-focus" : ""}">
            <td class="linkish clickable nowrap" data-goto-dev="${esc(x.code)}">${esc(x.code)}</td>
            <td title="${esc(x.name)}">${esc(x.name)}</td>
            <td>${esc(x.category || typeLabel(x.device_type))}</td>
            <td title="${esc(x.model || "")}">${esc(x.model || "—")}</td>
            <td class="linkish clickable" data-filter-vendor="${esc(x.vendor_id || "")}" title="${esc(x.vendor_name || x.vendor_id || "")}">${esc(x.vendor_name || x.vendor_id || "-")}</td>
            <td class="linkish clickable nowrap" data-goto-land="${esc(x.location)}">${esc(x.location)}</td>
            <td><span class="tag ${statusTone(x.status)}">${esc(x.status)}</span></td>
            <td class="dev-ctl">
              ${currentRole !== "farm"
                ? `<span class="tag gray">${currentRole === "gov" ? "监管只读" : "专家只读"}</span>`
                : `<button class="btn" data-id="${x.id}" data-act="start" data-code="${esc(x.code)}">登记启动</button>
                   <button class="btn ghost" data-id="${x.id}" data-act="stop" data-code="${esc(x.code)}">登记停止</button>`}
            </td>
          </tr>`).join("")}
          </tbody>
        </table>
        </div>
        <div class="pg-pager" role="group" aria-label="设备台账翻页">
          <button class="btn ghost" id="devPrev" ${devicePage === 0 ? "disabled" : ""} aria-label="上一页">‹ 上一页</button>
          <span class="pg-pager-nums">
            ${Array.from({ length: devPages }, (_, i) => `<button type="button" class="pg-pager-num${i === devicePage ? " is-on" : ""}" data-dev-page="${i}" aria-label="第 ${i + 1} 页"${i === devicePage ? ' aria-current="page"' : ""}>${i + 1}</button>`).join("")}
          </span>
          <button class="btn ghost" id="devNext" ${devicePage >= devPages - 1 ? "disabled" : ""} aria-label="下一页">下一页 ›</button>
          <span class="sub">第 ${devFrom + 1}–${devFrom + fleetPage.length} 台 / 共 ${fleet.length} 台</span>
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd(`TEROS 12 传感网格（${sensors.length}）`, "展示前 40 条 · VWC/EC/土温")}
        <div class="pg-feed dev-mesh-feed">
          ${sensors.slice(0, 40).map((s) => `
            <div class="item clickable ${deviceFocus === s.code ? "ok" : ""}" data-goto-dev="${esc(s.code)}" data-goto-land="${esc(s.location)}">
              <div class="row-between"><b>${esc(s.code)}</b><span class="tag orange">${esc(s.status)}</span></div>
              <div class="sub">${esc(s.last_value)} · ${esc(s.model || "TEROS 12")} · ${esc(s.depth || "")} · 电量 ${s.battery}%</div>
            </div>`).join("")}
        </div>
        <div class="sub">完整网格见孪生「传感网格」图层；探针应按土质校准并保证与土体紧密接触</div>
      </div>
    </div>
    <div class="panel pg-card">
      ${currentRole === "gov" ? `
        ${pgCardHd("设备接入审计", "监管只读")}
        <div class="item ok"><b>接入状态可追溯</b><div class="sub">当前可核查厂家、型号、协议、模拟状态与最近值；登记控制请求仅对农场角色开放。</div></div>
        <div class="pg-toolbar"><button class="btn ghost" id="devGovArch">查看云边端链路</button><button class="btn ghost" id="devGovAssets">查看数据资产</button></div>
      ` : `
      ${pgCardHd("设备沙箱登记", "仅登记能力目录，不建立生产连接")}
      <div class="form-row">
        <select id="devCatalog" aria-label="设备清单型号">
          <option value="">自选类型（不绑定清单）</option>
          ${catItems.map((c) => `<option value="${esc(c.id)}">${esc(c.seq)}. ${esc(c.model)} · ${esc(c.type_name)}</option>`).join("")}
        </select>
        <input id="devCode" aria-label="设备编号" placeholder="设备编号 e.g. WX-010" />
        <input id="devName" aria-label="设备名称" placeholder="设备名称" />
        <select id="devType" aria-label="设备类型">
          <option value="sensor">土壤传感器</option>
          <option value="weather">气象站</option>
          <option value="rain">雨量计</option>
          <option value="par">PAR 辐射</option>
          <option value="canopy">冠层温度</option>
          <option value="leafwet">叶面湿度</option>
          <option value="crop_node">作物感知节点</option>
          <option value="pest">虫情监测</option>
          <option value="yield">测产系统</option>
          <option value="soil_scan">土壤走航</option>
          <option value="irrigation">水肥/水表</option>
          <option value="drone">无人机</option>
          <option value="tractor">无人农机</option>
          <option value="sprayer">喷雾机</option>
          <option value="robot">机器人</option>
          <option value="gateway">网关</option>
        </select>
        <select id="devVendor" aria-label="设备厂家">
          ${vendorOptions.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}
        </select>
        <input id="devLoc" aria-label="设备位置或地块" placeholder="位置地块" value="${esc(twinFocus || "场部")}" />
        <button class="btn" id="regDev">登记沙箱设备</button>
      </div>
      `}
    </div>
    </div>`;
  document.getElementById("devTwin").onclick = () => navigate({ page: "twin", layer: "sensors", land: twinFocus || undefined });
  document.getElementById("devVendors").onclick = () => navigate({ page: "vendors" });
  const clearVen = document.getElementById("devClearVen");
  if (clearVen) clearVen.onclick = () => { vendorFocus = ""; devicePage = 0; renderDevices(); };
  document.getElementById("devClear").onclick = () => { twinFocus = ""; deviceFocus = ""; devicePage = 0; renderDevices(); };
  document.getElementById("devExport").onclick = () => downloadCsv(
    `设备与传感台账_${localDateKey()}.csv`,
    [
      ["编号", "名称", "类别", "型号", "厂家", "位置", "状态", "电量", "最新值"],
      ...[...fleet, ...sensors].map((x) => [x.code, x.name, x.category || typeLabel(x.device_type), x.model || "", x.vendor_name || x.vendor_id || "", x.location, x.status, x.battery != null ? `${x.battery}%` : "", x.last_value || ""]),
    ]
  );
  document.getElementById("devGovArch")?.addEventListener("click", () => navigate({ page: "arch" }));
  document.getElementById("devGovAssets")?.addEventListener("click", () => navigate({ page: "assets" }));
  document.getElementById("devKpiFleet")?.addEventListener("click", () => navigate({ page: "fleet" }));
  document.getElementById("devKpiLand")?.addEventListener("click", () => { twinFocus = ""; renderDevices(); });
  document.getElementById("devKpiVen")?.addEventListener("click", () => navigate({ page: "vendors" }));
  const gotoDevPage = (n) => {
    devicePage = Math.min(Math.max(0, n), devPages - 1);
    deviceFocus = ""; /* 翻页是浏览，不该把某一行的聚焦态带着跑 */
    renderDevices();
  };
  document.getElementById("devPrev")?.addEventListener("click", () => gotoDevPage(devicePage - 1));
  document.getElementById("devNext")?.addEventListener("click", () => gotoDevPage(devicePage + 1));
  view.querySelectorAll("[data-dev-page]").forEach((el) => {
    el.onclick = () => gotoDevPage(Number(el.dataset.devPage));
  });
  view.querySelectorAll("[data-cat-id]").forEach((el) => {
    el.onclick = () => {
      const hit = fleet.find((x) => x.catalog_id === el.dataset.catId);
      vendorFocus = el.dataset.catVendor || "";
      deviceFocus = hit ? hit.code : "";
      devicePage = 0;
      toast("清单型号", el.dataset.catId, "green");
      renderDevices();
    };
  });
  view.querySelectorAll("[data-filter-vendor]").forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      if (!el.dataset.filterVendor) return;
      vendorFocus = el.dataset.filterVendor;
      devicePage = 0;
      renderDevices();
    };
  });
  view.querySelectorAll("[data-land-mesh]").forEach((el) => {
    el.onclick = () => { twinFocus = el.dataset.landMesh; devicePage = 0; renderDevices(); };
  });
  view.querySelectorAll("[data-goto-dev]").forEach((el) => {
    el.onclick = () => { deviceFocus = el.dataset.gotoDev; if (el.dataset.gotoLand) twinFocus = el.dataset.gotoLand; toast("已聚焦", deviceFocus, "green"); renderDevices(); };
  });
  view.querySelectorAll("[data-goto-land]").forEach((el) => {
    el.onclick = (ev) => { ev.stopPropagation(); navigate({ page: "twin", land: el.dataset.gotoLand, layer: "sensors" }); };
  });
  view.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.onclick = async () => {
      const r = await api(`/api/devices/${btn.dataset.id}/control`, { method: "POST", body: JSON.stringify({ action: btn.dataset.act }) });
      if (r.ok === false) {
        toast("请求未登记", r.message || `${btn.dataset.code} 操作被阻止`, "orange");
        return;
      }
      toast("沙箱请求已登记", r.message || `${btn.dataset.code} · ${btn.dataset.act}；未连接真实设备`, "orange");
      renderDevices();
    };
  });
  const catSel = document.getElementById("devCatalog");
  if (catSel) {
    catSel.onchange = () => {
      const c = catItems.find((x) => x.id === catSel.value);
      if (!c) return;
      const nameEl = document.getElementById("devName");
      const typeEl = document.getElementById("devType");
      const venEl = document.getElementById("devVendor");
      if (nameEl && !nameEl.value) nameEl.value = `${c.type_name} · ${c.model}`;
      if (typeEl) typeEl.value = c.device_type;
      if (venEl) venEl.value = c.vendor_id;
    };
  }
  const registerDevice = document.getElementById("regDev");
  if (registerDevice) registerDevice.onclick = async () => {
    const catalogId = document.getElementById("devCatalog")?.value || "";
    const c = catItems.find((x) => x.id === catalogId);
    const name = document.getElementById("devName").value.trim();
    const location = document.getElementById("devLoc").value.trim();
    if (!name || !location) {
      toast("请补全设备", "设备名称和安装位置不能为空", "orange");
      return;
    }
    const payload = {
      code: document.getElementById("devCode").value || undefined,
      name,
      device_type: document.getElementById("devType").value,
      vendor_id: document.getElementById("devVendor").value,
      location,
      catalog_id: catalogId || undefined,
    };
    if (c) {
      payload.model = c.model;
      payload.category = c.category;
      payload.type_name = c.type_name;
      payload.params = c.params;
      payload.units = c.units;
      payload.interfaces = c.interfaces;
      payload.derived = c.derived;
      payload.tips = c.tips;
      payload.docs_url = c.docs_url;
      payload.image_url = c.image_url;
      payload.application = c.application;
      payload.vendor_name = c.vendor;
      payload.last_value = c.sample_value || "沙箱模拟";
    }
    const created = await api("/api/devices/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (created.ok === false || !created.code) {
      toast("沙箱登记失败", created.message || "请检查编号、位置与字段", "orange");
      return;
    }
    toast("沙箱设备已登记", created.message || `${created.code} · 未建立生产连接`, "orange");
    deviceFocus = created.code;
    renderDevices();
  };
}

async function renderFleet() {
  const token = renderToken;
  const d = await api("/api/fleet");
  if (token !== renderToken) return;
  let selected = d.selected || d.ops[0];
  if (twinFocus) selected = d.ops.find((o) => o.land === twinFocus) || selected;

  const ops = d.ops || [];
  /* 原来的 KPI 里「候选编队」和「不放行」在构造上恒等（编队全是 NO_GO），
     「生产执行」是写死的 0，「当前回放」又和右侧卡头、左栏选中态重复三遍。
     改成四个各自独立、且都从数据算出来的数。 */
  const goOps = ops.filter((o) => o.status !== "NO_GO").length;
  const allMachines = [];
  ops.forEach((o) => (o.machines || []).forEach((m) => allMachines.push(m)));
  const machineCodes = new Set(allMachines.map((m) => m.code));
  const blockedMachines = allMachines.filter((m) => m.status === "禁止执行").length;

  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 联合作业流程回放</span>
      <span class="status-text">${esc(d.note || "")}</span>
      <button class="btn ghost" id="fleetTwin">看田机具层</button>
      ${currentRole === "farm"
        ? `<button class="btn ghost" id="fleetRobots">无人机派飞</button>`
        : currentRole === "gov"
          ? `<button class="btn ghost" id="fleetHistory">作业档案</button>`
          : `<button class="btn ghost" id="fleetAgents">智能体名册</button>`}
      <button class="btn ghost" id="fleetExport">导出作业台账</button>
    </div>
    <div class="fleet-kpis">${pgKpis([
      { label: "候选编队", value: ops.length, unit: "个", cls: "is-wait", sub: "仅流程回放" },
      { label: "可放行编队", value: goOps, unit: `/ ${ops.length} 个`, cls: "is-urgent", sub: "证据齐备前不放行" },
      { label: "涉及机具", value: machineCodes.size, unit: "台", cls: "is-wait", sub: `其中 ${blockedMachines} 台标为禁止执行` },
      { label: "当前回放进度", value: selected ? selected.progress : 0, unit: "%", cls: "is-run", sub: "回放进度，不代表真实作业" },
    ])}</div>
    <div class="pg-split wide-right fleet-split">
      <div class="panel pg-card fleet-queue">
        ${pgCardHd("候选编队回放队列", "点击切换 · 不连接真实机具")}
        ${ops.map((op) => {
          const on = selected && selected.id === op.id;
          return `
          <div class="item clickable fl-op ${on ? "ok" : ""}" data-joint="${esc(op.id)}"
            tabindex="0" role="button" aria-pressed="${on}" aria-label="切换到编队 ${esc(op.id)} ${esc(op.title)}">
            <div class="row-between"><b>${esc(op.id)}</b><span class="tag ${statusTone(op.status)}">${esc(op.status)}</span></div>
            <div>${esc(op.title)}</div>
            <div class="sub">${esc(op.land)} · ${esc(op.scene)} · ${esc(op.window)}</div>
            <div class="fl-prog">
              <em>流程回放</em>
              <div class="bar"><span style="width:${op.progress}%"></span></div>
              <b>${op.progress}%</b>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="pg-stack">
        <div class="panel pg-card">
          ${pgCardHd(`编队详情 · ${selected.id}`, `${selected.land} · ${selected.scene}`)}
          <div class="item warn"><b>${esc(selected.title)}</b><div class="sub">${esc(selected.window)} · 未生成设备命令</div></div>
          <div class="fl-timeline">
            ${selected.timeline.map((t) => `<div class="fl-tl-row"><span class="tag ${statusTone(t.t)}">${esc(t.t)}</span><span>${esc(t.event)}</span></div>`).join("")}
          </div>
          <div class="sub">以上为未验证模拟节点，不代表已发生的真实作业。${selected.status === "NO_GO" ? "补齐证据包与机具联锁核验并经人工确认后，才可推进回放。" : ""}</div>
          <div class="pg-toolbar">
            ${currentRole !== "farm"
              ? `<span class="role-readonly"><i></i>查看/审核视图 · 仅查看模拟位置与进度</span>`
              /* 编队是 NO_GO 时点「推进」必然被引擎挡回来（实测每次都弹「当前保持禁行」）。
                 与其让人反复点一个注定失败的主按钮，不如直接禁用并把原因写在旁边。 */
              : selected.status === "NO_GO"
                ? `<button class="btn" id="fleetAdvance" disabled title="须先补齐证据包与机具联锁核验，并经人工确认">不放行 · 不能推进回放</button>`
                : `<button class="btn" id="fleetAdvance">模拟推进编队进度</button>`}
            <button class="btn ghost" id="fleetWater">关联水肥</button>
            <button class="btn ghost" id="fleetDiag">联合诊断</button>
            <button class="btn ghost" id="fleetDevices">设备中心</button>
          </div>
        </div>
        <div class="panel pg-card">
          ${pgCardHd("机具编队", "点击定位设备 · 仅仿真位置")}
          ${selected.machines.map((m) => `
            <div class="item clickable fl-mach" data-mdev="${esc(m.code)}"
              tabindex="0" role="button" aria-label="在设备中心定位 ${esc(m.code)} ${esc(m.role)}">
              <div class="fl-mach-hd">
                <b>${esc(m.code)}</b>
                <span class="fl-mach-role">${esc(m.role)}</span>
                <span class="tag ${statusTone(m.status)}">${esc(m.status)}</span>
              </div>
              <div class="sub">${esc(m.vendor)} · ${esc(m.agent)} 仅提供仿真建议</div>
            </div>`).join("")}
        </div>
        <div class="panel pg-card">
          ${pgCardHd("调度智能体", "协同链路 · 只产出建议")}
          <div class="agent-chain">
            ${selected.agents.map((a, i) => `
              <div class="agent-chain-node">
                <span class="dot orange"></span>
                <div><b>${esc(a.name)}</b><div class="sub">${esc(a.duty)}</div></div>
                ${i < selected.agents.length - 1 ? '<div class="agent-chain-arrow">→</div>' : ""}
              </div>`).join("")}
          </div>
        </div>
      </div>
    </div>
    </div>`;
  document.getElementById("fleetTwin").onclick = () => navigate({ page: "twin", layer: "device", land: selected.land });
  document.getElementById("fleetAgents")?.addEventListener("click", () => navigate({ page: "agents" }));
  document.getElementById("fleetRobots")?.addEventListener("click", () => navigate({ page: "robots", land: selected.land }));
  document.getElementById("fleetHistory")?.addEventListener("click", () => navigate({ page: "history", land: selected.land }));
  document.getElementById("fleetWater").onclick = () => navigate({ page: "water", land: selected.land });
  document.getElementById("fleetDiag").onclick = () =>
    navigate({
      page: currentRole === "farm" ? "ai" : "diagnosis",
      land: selected.land,
      aiDraft: currentRole === "farm" ? `${selected.land} 机具作业有没有风险、接下来怎么干？` : undefined,
    });
  document.getElementById("fleetDevices").onclick = () => navigate({ page: "devices", land: selected.land });
  document.getElementById("fleetExport").onclick = () => downloadCsv(
    `机队联合作业_${localDateKey()}.csv`,
    [
      ["编队", "任务", "地块", "场景", "窗口", "状态", "进度", "机具", "智能体"],
      ...(d.ops || []).map((op) => [op.id, op.title, op.land, op.scene, op.window, op.status, `${op.progress}%`, (op.machines || []).map((m) => `${m.code}:${m.role}`).join(";"), (op.agents || []).map((a) => a.name).join(";")]),
    ]
  );
  document.getElementById("fleetAdvance")?.addEventListener("click", async () => {
    const r = await api("/api/fleet/advance", { method: "POST", body: JSON.stringify({ id: selected.id }) });
    if (r.ok === false) {
      toast("编队未推进", r.message || "操作被安全锁阻止", "orange");
      return;
    }
    toast("流程回放已推进", r.message || `${r.op?.id || ""} · 回放进度 ${r.op?.progress ?? 0}%`, "orange");
    renderFleet();
  });
  view.querySelectorAll("[data-joint]").forEach((el) => {
    el.onclick = async () => {
      await api("/api/fleet/select", { method: "POST", body: JSON.stringify({ id: el.dataset.joint }) });
      twinFocus = (d.ops.find((o) => o.id === el.dataset.joint) || {}).land || twinFocus;
      renderFleet();
    };
  });
  view.querySelectorAll("[data-mdev]").forEach((el) => {
    el.onclick = () => navigate({ page: "devices", device: el.dataset.mdev, land: selected.land });
  });
  /* 队列行和机具行是 div 上挂的 role="button"，键盘要自己补 Enter/Space */
  view.querySelectorAll("[data-joint], [data-mdev]").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      el.click();
    });
  });
}

async function renderVendors() {
  const token = renderToken;
  const d = await api("/api/vendors");
  if (token !== renderToken) return;
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 厂家能力与沙箱接入</span>
      <span class="status-text">${esc(d.note || "")}</span>
      <button class="btn ghost" id="venDev">设备清单</button>
      <button class="btn ghost" id="venArch">云边端架构</button>
      <button class="btn ghost" id="venExport">导出接入台账</button>
    </div>
    ${pgKpis([
      { label: "厂家目录", value: (d.vendors || []).length, cls: "is-wait" },
      { label: "适配验证", value: (d.vendors || []).filter((v) => v.status === "适配验证").length, cls: "is-wait" },
      { label: "沙箱待配置", value: (d.vendors || []).filter((v) => v.status === "沙箱申请待配置").length, cls: "is-wait" },
      { label: "协议", value: (d.protocols || []).length, cls: "is-run" },
    ])}
    <div class="item warn panel pg-card"><b>能力目录，不代表生产接入</b><div class="sub">协议模拟：${(d.protocols || []).map((p) => `<span class="tag blue">${esc(p)}</span>`).join(" ")} · 生产使用须独立完成授权、证书、最小权限、沙箱联调和验收。</div></div>
    <div class="pg-grid">
      ${d.vendors.map((v) => `
        <div class="panel vendor-card pg-card">
          <div class="row-between">
            <h3 style="margin:0">${esc(v.name)}</h3>
            <span class="tag ${statusTone(v.status)}">${esc(v.status)}</span>
          </div>
          <div class="sub">${esc(v.region)} · ${esc(v.category)}</div>
          <div class="verify-grid" style="margin-top:10px">
            <div><span class="sub">设备数</span><b class="num">${v.devices}</b></div>
            <div><span class="sub">服务承诺核验</span><b>${esc(v.sla)}</b></div>
          </div>
          <div class="tags">${(v.protocols || []).map((p) => `<span class="tag gray">${esc(p)}</span>`).join("")}</div>
          <div class="item" style="margin-top:8px"><div class="sub">适配器</div>${esc(v.adapter)}</div>
          <div class="sub">${esc(v.note)}</div>
          <div class="pg-toolbar">
            <button class="btn" data-ven="${esc(v.id)}" data-act="open">查看设备</button>
            <button class="btn ghost" data-ven="${esc(v.id)}" data-act="connect">${v.status === "接口预留" ? "登记沙箱申请" : v.status === "沙箱申请待配置" ? "模拟完成适配" : "查看适配状态"}</button>
          </div>
        </div>`).join("")}
    </div>
    </div>`;
  document.getElementById("venDev").onclick = () => navigate({ page: "devices" });
  document.getElementById("venArch").onclick = () => navigate({ page: "arch" });
  document.getElementById("venExport").onclick = () => downloadCsv(
    `厂家接入台账_${localDateKey()}.csv`,
    [
      ["厂家", "区域", "类别", "沙箱状态", "设备模拟数", "SLA核验", "能力协议", "适配器模拟", "说明"],
      ...(d.vendors || []).map((v) => [v.name, v.region, v.category, v.status, v.devices, v.sla, (v.protocols || []).join(";"), v.adapter, v.note]),
    ]
  );
  view.querySelectorAll("[data-ven]").forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.act === "open") {
        navigate({ page: "devices", vendor: btn.dataset.ven, toast: ["厂家设备", btn.dataset.ven, "green"] });
        return;
      }
      const r = await api("/api/vendors/connect", { method: "POST", body: JSON.stringify({ id: btn.dataset.ven }) });
      toast(r.status || "已处理", `${r.name || btn.dataset.ven} · 未连接生产账号`, "green");
      renderVendors();
    };
  });
}

async function renderCollab() {
  const token = renderToken;
  const d = await api("/api/collab/center");
  if (token !== renderToken) return;
  const s = d.selected || {};
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 协同案例仿真</span>
      <span class="status-text">${esc(d.safety || "")}</span>
      <button class="btn ghost" id="collabTwin">孪生定位 ${esc(s.land || "")}</button>
      <button class="btn ghost" id="collabWater">${currentRole === "gov" ? "水肥核查" : "水肥处置"}</button>
      <button class="btn ghost" id="collabWall">态势大屏</button>
    </div>
    <div class="item panel pg-card"><span class="tag blue">协同案例</span> ${esc(d.safety)}</div>
    ${pgKpis([
      { label: "进行中", value: d.metrics.running, cls: "is-run", clickable: true, attrs: `id="colKpiRun"` },
      { label: "待人工确认", value: d.metrics.human, cls: "is-wait", clickable: true, attrs: `id="colKpiHuman"` },
      { label: "存在冲突", value: d.metrics.conflict, cls: "is-urgent" },
      { label: "可追溯记录", value: d.metrics.traceable, cls: "is-ok" },
    ])}
    <div class="pg-split triple">
      <div class="panel pg-card">
        ${pgCardHd("协同任务队列", "点击切换案例")}
        ${d.tasks.map((t) => `
          <div class="item ${t.selected ? "ok" : ""}" style="cursor:pointer" data-case="${t.id}">
            <div class="row-between"><b>${esc(t.id)}</b><span class="tag ${t.risk === "高" ? "red" : "orange"}">${esc(t.risk)}</span></div>
            <div>${esc(t.title)}</div>
            <div class="sub">${esc(t.land)} · ${esc(t.scene)} · ${esc(t.stage)}</div>
          </div>`).join("")}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("选中任务详情", s.stage)}
        <div class="item"><b>${esc(s.title)}</b><div class="sub">阶段 ${esc(s.stage)}</div></div>
        <div class="item warn"><b>专家分歧</b><div>${esc(s.conflict)}</div></div>
        <div class="item"><b>证据缺口</b><div class="tags">${(s.gaps || []).map((g) => `<span class="tag orange">${esc(g)}</span>`).join("")}</div></div>
        <div class="item ok"><b>总管协调结论</b><div>${esc(s.master)}</div></div>
        <div class="item"><b>参与 Agent</b><div class="tags">${(s.agents || []).map((a) => `<span class="tag blue">${esc(agentKeyName(a))}</span>`).join("")}</div></div>
        <div class="pg-toolbar">
          <button class="btn" id="goDiag">进入分步诊断</button>
          <button class="btn ghost" id="goWb">${currentRole === "gov" ? "查看任务证据" : "发起协作会话"}</button>
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("人工待办 / 追溯", "留痕可查")}
        ${(s.todos || []).map((t) => `<div class="item"><span class="dot orange pulse"></span> ${esc(t)}</div>`).join("")}
        ${(s.trace || []).map((t) => `<div class="item"><div class="sub">${esc(t.t)} · ${esc(t.agent)}</div>${esc(t.event)}</div>`).join("")}
        <button class="btn ghost" id="goCatalog">${currentRole === "gov" ? "查看数据资产" : "查看 Agent 名册"}</button>
      </div>
    </div>
    </div>`;
  view.querySelectorAll("[data-case]").forEach((el) => {
    el.onclick = async () => {
      await api("/api/collab/select", { method: "POST", body: JSON.stringify({ id: el.dataset.case }) });
      renderCollab();
    };
  });
  document.getElementById("goDiag").onclick = () => {
    twinFocus = s.land || twinFocus;
    navigate({ page: "diagnosis", land: s.land, toast: ["进入联合诊断", s.id || "", "green"] });
  };
  document.getElementById("goWb").onclick = () => navigate({ page: currentRole === "gov" ? "tasks" : "workbench", land: s.land });
  document.getElementById("goCatalog").onclick = () => navigate({ page: currentRole === "gov" ? "assets" : "agents" });
  document.getElementById("colKpiRun")?.addEventListener("click", () => navigate({ page: "diagnosis", land: s.land }));
  document.getElementById("colKpiHuman")?.addEventListener("click", () => navigate({ page: currentRole === "gov" ? "tasks" : "workbench", land: s.land }));
  document.getElementById("collabTwin").onclick = () => navigate({ page: "twin", land: s.land, layer: "moisture" });
  document.getElementById("collabWater").onclick = () => navigate({ page: "water", land: s.land });
  document.getElementById("collabWall").onclick = () => {
    if (s.land) twinFocus = s.land;
    wallMode = true;
    try { localStorage.setItem("agrios-wall", "1"); } catch (e) {}
    FarmWall?.open();
    applyWallMode();
  };
}

async function renderDiagnosis() {
  const token = renderToken;
  const d = await api("/api/diagnosis");
  if (token !== renderToken) return;
  const stage = d.stage;
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 联合诊断仿真</span>
      <span class="status-text"><span class="tag orange">${esc(d.label)}</span> <span class="tag blue">${esc(d.caseId)}</span></span>
      ${currentRole === "gov" ? `<span class="role-readonly"><i></i>监管只读</span>` : `<button class="btn ghost" id="diagReset">重置仿真</button>`}
      <button class="btn" id="diagReal">${currentRole === "gov" ? "查看协作链路" : "发起协作会话"}</button>
    </div>
    ${pgKpis([
      { label: "当前阶段", value: `${stage}/4`, cls: "is-run" },
      { label: "仿真案例", value: d.caseId || "—", cls: "is-wait" },
      { label: "执行态", value: d.executionState || "—", cls: "is-wait" },
      { label: "反馈", value: d.feedbackOutcome || "—", cls: d.feedbackOutcome === "abnormal" ? "is-urgent" : "is-done" },
    ])}
    <div class="item warn panel pg-card"><b>固定仿真案例</b><div class="sub">所有数值、天气、进度与结论均为未验证模拟；流程只做规则讲解和模拟回放，不调用真实模型、工单或设备。</div></div>
    <div class="layer-btns panel pg-card" style="margin:0">
      ${d.stages.map((name, i) => `<button class="btn ${stage === i + 1 ? "" : "ghost"}" disabled>${i + 1}. ${esc(name)}</button>`).join("")}
    </div>
    <div class="pg-split">
      <div class="panel pg-card">
        ${stage === 1 ? `
          ${pgCardHd("感知异常", "证据与阈值")}
          <div class="item">${esc(d.problem)}</div>
          ${d.evidence.map((e) => `<div class="item ${e.ok ? "" : "warn"}"><b>${esc(e.name)}</b> · <span class="num">${esc(e.value)}</span> <span class="tag ${e.ok ? "green" : "orange"}">${esc(e.tag)}</span></div>`).join("")}
          ${currentRole === "gov" ? `<div class="role-readonly"><i></i>等待执行角色确认并推进</div>` : `<button class="btn" id="diagNext">确认问题，进入联合分析</button>`}` : ""}
        ${stage === 2 ? `
          ${pgCardHd("联合分析", "专家并行泳道")}
          ${d.experts.map((e) => `<div class="item"><div class="row-between"><b>${esc(e.name)}</b><span class="tag green">${esc(e.status)}</span></div>
            <div class="sub">${esc(e.duty)} · ${e.ms}ms · 证据 ${e.evidence} · 缺口 ${esc(e.gap)}</div></div>`).join("")}
          ${currentRole === "gov" ? `<div class="role-readonly"><i></i>等待专家完成联合研判</div>` : `<button class="btn" id="diagNext">进入协同决策</button>`}` : ""}
        ${stage === 3 ? `
          ${pgCardHd("协同决策", "分歧复核")}
          <div class="item warn"><b>水肥意见</b><div>${esc(d.conflict.a)}</div></div>
          <div class="item warn"><b>土壤意见</b><div>${esc(d.conflict.b)}</div></div>
          <div class="item ok"><b>交叉复核收敛</b><div>${esc(d.conflict.resolve)}</div></div>
          ${currentRole === "expert" ? `
            <textarea id="diagExpertNote" aria-label="专家补充意见" rows="2" placeholder="专家补充意见（将写入批注）">证据不足，暂不放行；先补齐现场样方、天气、标签与剂量校准</textarea>
            <button class="btn ghost" id="diagExpertSave">保存专家意见</button>` : ""}
          ${currentRole === "gov" ? `<div class="role-readonly"><i></i>监管查看 · 不改变诊断阶段</div>` : `<button class="btn" id="diagNext">进入执行与复盘</button>`}` : ""}
        ${stage === 4 ? `
          ${pgCardHd("执行与复盘", "流程状态机")}
          <div class="item">状态：<span class="tag blue">${esc(d.executionState)}</span> · 反馈：<span class="tag ${d.feedbackOutcome === "abnormal" ? "red" : "green"}">${esc(d.feedbackOutcome)}</span></div>
          <div class="item warn">仿真工单 / 模拟执行 — 不调用真实设备与工单服务</div>
          ${currentRole === "farm" && d.executionState === "awaiting_approval" ? `<button class="btn" id="diagApprove">场长确认并生成仿真工单</button>` : ""}
          ${currentRole !== "gov" && ["queued", "running", "feedback"].includes(d.executionState) ? `<button class="btn" id="diagExec">推进模拟执行</button>` : ""}
          ${currentRole !== "gov" && (d.executionState === "feedback" || d.executionState === "reviewed") ? `<button class="btn ghost" id="diagReopen">异常反馈·重新诊断</button>` : ""}
          ${currentRole === "gov" ? `<div class="role-readonly"><i></i>监管只读 · 执行状态由责任角色推进</div>` : ""}
          ${d.executionState === "reviewed" ? `<div class="item ok">流程回放已结束：未产生真实设备动作；现场结果、停止条件和效果仍待外部证据。</div>` : ""}` : ""}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("底层协作轨道", "阶段推进")}
        ${d.track.map((n, i) => {
          const active = (stage === 1 && i === 0) || (stage === 2 && i <= 2) || (stage === 3 && i <= 3) || (stage === 4 && i <= 5);
          const current = (stage === 1 && i === 0) || (stage === 2 && i === 2) || (stage === 3 && i === 3) || (stage === 4 && i >= 4);
          return `<div class="item ${current ? "ok" : ""}"><span class="dot ${active ? "green" : "orange"} ${current ? "pulse" : ""}"></span> ${esc(n)}</div>`;
        }).join("")}
      </div>
    </div>
    </div>`;
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind("diagReset", async () => { await api("/api/diagnosis/reset", { method: "POST", body: "{}" }); toast("已重置", "回到感知异常", "green"); renderDiagnosis(); });
  bind("diagReal", () => navigate({ page: currentRole === "gov" ? "tasks" : "workbench", land: twinFocus || undefined }));
  bind("diagNext", async () => { await api("/api/diagnosis/advance", { method: "POST", body: "{}" }); renderDiagnosis(); });
  bind("diagApprove", async () => { await api("/api/diagnosis/approve", { method: "POST", body: "{}" }); toast("仿真工单已登记", "仅进入模拟回放队列，未生成设备命令", "green"); renderDiagnosis(); });
  bind("diagExec", async () => { await api("/api/diagnosis/exec", { method: "POST", body: "{}" }); renderDiagnosis(); });
  bind("diagReopen", async () => { await api("/api/diagnosis/reopen", { method: "POST", body: "{}" }); toast("重新诊断", "保留复盘说明，回到联合分析", "orange"); renderDiagnosis(); });
  bind("diagExpertSave", async () => {
    const comment = (document.getElementById("diagExpertNote") && document.getElementById("diagExpertNote").value) || "专家已确认";
    const payload = await requestExpertAudit({ approved: true, comment, title: "联合诊断专家意见" });
    if (!payload) return;
    await api("/api/expert/review", {
      method: "POST",
      body: JSON.stringify({ ...payload, target: "diagnosis", land_code: twinFocus || "B-01", title: "联合诊断专家意见", result: "通过" }),
    });
    toast("专家意见已保存", payload.comment.slice(0, 24), "green");
  });
}

async function renderWorkbench() {
  const token = renderToken;
  const d = await api("/api/workbench");
  if (token !== renderToken) return;
  const run = d.active;
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 本地规则协作</span>
      <span class="status-text">任务拆解、专家协作、交叉复核与总管汇总 · <span class="tag orange">${esc(d.mode)}</span></span>
      <span class="tag blue">规则编排</span>
      <span class="tag gray">语音/图片尚未接入</span>
    </div>
    ${pgKpis([
      { label: "会话数", value: (d.conversations || []).length, cls: "is-ok" },
      { label: "模式", value: d.mode || "仿真", cls: "is-run" },
      { label: "调用", value: run ? `${run.callCount}/6` : "0/6", cls: "is-wait" },
      { label: "分歧/缺口", value: run ? `${run.conflicts || 0}/${run.gaps || 0}` : "—", cls: "is-urgent" },
    ])}
    <div class="pg-split triple">
      <div class="panel pg-card">
        <button class="btn" id="wbNew" style="width:100%;margin-bottom:10px">新建协作任务</button>
        ${pgCardHd("最近任务", "会话列表")}
        ${(d.conversations || []).map((c) => `<div class="item"><b>${esc(c.title)}</b><div class="sub">${esc(c.status)} · 调用 ${c.callCount} · Agent ${c.agents}</div><div class="sub">${esc(c.updatedAt)}</div></div>`).join("")}
      </div>
      <div class="panel pg-card">
        <div class="item">仅使用用户提供的信息 · 不注入固定农场实时遥测 · ${esc(d.safety)}</div>
        <div class="chat-log" id="wbLog" style="height:280px">
          ${(d.messages || []).map((m) => `<div class="msg"><b>${m.role === "user" ? "问" : m.role === "stage" ? "阶段" : "答"}：</b>${esc(m.text)}</div>`).join("") || "<div class='sub'>发送问题后观察总管→专家→复核→汇总</div>"}
        </div>
        ${run ? `<div class="item ok"><b>协作运行卡</b><div class="sub">总管拆解 → 专家并行 → 交叉复核 → 总管汇总</div>
          <div>调用 ${run.callCount}/6 · 模型 ${esc(run.model)} · ${esc(run.providerName)}</div></div>` : ""}
        <textarea id="wbQ" aria-label="协作研判问题" rows="3" placeholder="例如：A-02 含水率偏低且 EC 升高，如何处置？">A-02 棉花长势下降，20cm 含水率 8.9%，EC 3.1，是否该立即灌溉？</textarea>
        <div class="pg-toolbar">
          <button class="btn" id="wbAsk">发送</button>
          <button class="btn ghost" id="wbFill">填入快捷问题</button>
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("协作链与责任追踪", "阶段状态")}
        ${(run && run.timeline ? run.timeline : [
          { name: "总管拆解", status: "待开始", note: "" },
          { name: "专家并行", status: "待开始", note: "" },
          { name: "交叉复核", status: "待开始", note: "" },
          { name: "总管汇总", status: "待开始", note: "" },
          { name: "人工复核边界", status: "常驻", note: "不调用工具/设备" },
        ]).map((t) => `<div class="item"><div class="row-between"><b>${esc(t.name)}</b><span class="tag ${t.status === "完成" ? "green" : "gray"}">${esc(t.status)}</span></div><div class="sub">${esc(t.note || "")}</div></div>`).join("")}
        ${run ? `<div class="item warn">分歧 ${run.conflicts} · 证据缺口 ${run.gaps}</div>
          <div class="item"><b>参与专家</b>${run.selectedAgents.map((a) => `<div class="sub">${esc(a.name)} · ${esc(a.status)} · ${a.ms}ms</div>`).join("")}</div>` : ""}
        <div class="item">专家能力：作物长势 / 土壤健康 / 水肥优化 / 病虫害预警 / 产量预测 …</div>
      </div>
    </div>
    </div>`;
  document.getElementById("wbNew").onclick = async () => {
    await api("/api/workbench/new", { method: "POST", body: "{}" });
    toast("已新建", "空白协作会话", "green");
    renderWorkbench();
  };
  document.getElementById("wbFill").onclick = () => {
    document.getElementById("wbQ").value = "A-02 棉花长势下降，20cm 含水率 8.9%，EC 3.1，是否该立即灌溉？";
  };
  document.getElementById("wbAsk").onclick = async () => {
    const question = document.getElementById("wbQ").value.trim();
    if (!question) return;
    await api("/api/workbench/ask", { method: "POST", body: JSON.stringify({ question }) });
    toast("协作草稿已生成", "规则编排仿真 · 待人工复核 · 未调用设备", "green");
    renderWorkbench();
  };
}

async function renderCouncil() {
  const token = renderToken;
  const d = await api("/api/agents/council");
  if (token !== renderToken) return;
  const agents = Array.isArray(d.agents) ? d.agents : [];
  if (!agents.length) {
    view.innerHTML = `<div class="page-shell"><div class="panel pg-card"><h3>专家委员会暂不可用</h3><div class="sub">未返回独立专家名册；未生成任何设备或业务动作。</div></div></div>`;
    return;
  }
  let selected = agents.find((agent) => agent.key === councilFocus);
  if (!selected) {
    selected = agents[0];
    councilFocus = selected.key;
  }
  const review = councilLastReview || d.review || null;
  const selectedOutput = review && (review.outputs || []).find((item) => item.agent_key === selected.key);
  const referenceLink = /^https?:\/\//.test(String(selected.reference_url || ""))
    ? `<a class="council-reference" href="${esc(selected.reference_url)}" target="_blank" rel="noopener noreferrer">${esc(selected.standard)} ↗</a>`
    : `<span class="council-reference">${esc(selected.standard)}</span>`;
  const reviewCount = review ? (review.outputs || []).length : 0;
  const title = d.title || "独立专家委员会";
  const protocol = d.protocol || "先独立取证与评议，后只读汇总。";

  /* 原来四个 KPI 里三个恒 0，其中「汇总器可推翻」是写死的字面量、「设备命令」是主张不是指标
     （同样的话卡片 chip 里已经有一遍）。改成四个都从本轮评议结果算出来。 */
  const outputs = review ? review.outputs || [] : [];
  const stopCount = outputs.filter((o) => /NO_GO|不放行/.test(String(o.gate || ""))).length;
  const missingCount = outputs.reduce((n, o) => n + (o.evidence_missing || []).length, 0);
  const pending = review ? "" : "发起评议后统计";

  view.innerHTML = `
    <div class="page-shell council-page">
      <div class="status-strip">
        <span class="live-pill"><span class="dot orange"></span> 独立专家评议 · 本地仿真</span>
        <span class="status-text">${esc(protocol)}</span>
        <button class="btn ghost" id="councilGoAgents">查看运营智能体</button>
        <button class="btn ghost" id="councilGoCollab">查看协同事件</button>
      </div>

      ${pgKpis([
        { label: "独立专家", value: agents.length, unit: "位", cls: "is-run", sub: "职责域互不重叠" },
        { label: "本轮独立输出", value: reviewCount, unit: "份", cls: review ? "is-wait" : "is-run", sub: pending || "互不参考的评议草稿" },
        { label: "本轮叫停", value: stopCount, unit: "位", cls: stopCount ? "is-urgent" : "is-ok", sub: pending || "任一专家叫停即不放行" },
        { label: "待补证据项", value: missingCount, unit: "项", cls: missingCount ? "is-urgent" : "is-ok", sub: pending || "按专业域分列" },
      ])}

      <section class="panel pg-card council-review" aria-labelledby="councilRunTitle">
        ${pgCardHd(`发起本轮独立评议 · ${agents.length} 位专家`, "每位专家只读本域证据，不看同伴结论；汇总器只归并缺口，不投票放行")}
        <div class="pg-chips">
          <span class="tag blue">${agents.length} 个独立职责域</span>
          <span class="tag orange">任一专家叫停即不放行</span>
          <span class="tag green">不连接生产设备 · 不下发命令</span>
        </div>
        <div class="item warn" role="note"><b>${esc((d.current_case && d.current_case.title) || title)}</b><div class="sub">${esc((d.current_case && d.current_case.description) || "所有结论都是规则仿真草稿。")}</div></div>
        <div class="council-run-form">
          <label for="councilGoal">待评议问题</label>
          <textarea id="councilGoal" maxlength="500" aria-label="待评议问题" aria-describedby="councilGoalHint">${esc((review && review.goal) || (d.current_case && d.current_case.default_goal) || "")}</textarea>
          <div class="council-run-actions">
            <span id="councilGoalHint">会生成 ${agents.length} 份互不覆盖的证据、风险与叫停理由草稿；不生成生产动作。</span>
            <button type="button" class="btn" id="councilRun">请 ${agents.length} 位专家分别评议</button>
          </div>
        </div>
      </section>

      ${review ? `
      <section class="panel pg-card council-result" aria-labelledby="councilReviewTitle">
        <div class="council-result-head">
          <div><span class="pg-kicker">${esc(review.id || "本轮评议")}</span><h2 id="councilReviewTitle">本轮独立输出 · ${review.independent_agents || reviewCount} 份</h2><p>${esc(review.goal || "")}</p></div>
          <div class="council-result-meta"><span class="tag orange">${esc(review.mode === "local_rules_simulation" ? "本地规则仿真" : review.mode || "仿真")}</span><small>${esc(review.reviewed_at || "")}</small></div>
        </div>
        <div class="council-coordinator" role="note"><b>${esc((review.coordinator && review.coordinator.role) || "只读汇总器")}</b><span>${esc((review.coordinator && review.coordinator.conclusion) || "")}</span><small>${esc((review.coordinator && review.coordinator.rule) || "")}</small></div>
        <div class="council-output-grid">
          ${outputs.map((item) => `<article class="council-output-card ${item.agent_key === selected.key ? "is-selected" : ""}">
            <div class="row-between"><b>${esc(item.agent_name)}</b><span class="tag orange">${esc(item.gate)}</span></div>
            <div class="sub">${esc(item.domain)} · ${esc(item.confidence)}</div>
            <p><strong>独立发现：</strong>${esc(item.finding)}</p>
            <p><strong>待补证据：</strong>${(item.evidence_missing || []).map(esc).join("；")}</p>
            <p><strong>下一步：</strong>${esc(item.recommendation)}</p>
            <small>独立输出 · 未下发命令</small>
          </article>`).join("")}
        </div>
      </section>` : ""}

      <div class="pg-split wide-left council-main-grid">
        <section class="panel pg-card" aria-label="独立专家名册">
          ${pgCardHd(`${agents.length} 位独立专家`, "点击查看各自的证据范围、硬门禁和输出边界")}
          <div class="council-agent-grid" id="councilAgents">
            ${agents.map((agent, index) => {
              const active = agent.key === selected.key;
              const state = selectedOutput && active ? "本轮已叫停" : review ? "已独立评议" : "待独立评议";
              return `<button type="button" class="council-agent tone-${esc(agent.tone || "blue")}${active ? " is-active" : ""}" data-council-agent="${esc(agent.key)}" aria-pressed="${active ? "true" : "false"}" aria-controls="council-detail" aria-label="查看 ${esc(agent.name)} 的独立评议范围">
                <span class="council-agent-index">${String(index + 1).padStart(2, "0")}</span>
                <span class="council-agent-body"><b>${esc(agent.name)}</b><small>${esc(agent.domain)}</small></span>
                <span class="council-agent-state">${esc(state)}</span>
              </button>`;
            }).join("")}
          </div>
        </section>

        <aside class="panel pg-card council-detail" id="council-detail" aria-live="polite">
          <div class="council-detail-head">
            <div><span class="pg-kicker">${esc(selected.short)} · 独立评议</span><h2>${esc(selected.name)}</h2></div>
            ${referenceLink}
          </div>
          <p class="council-domain">${esc(selected.domain)}</p>
          <div class="council-boundary"><b>职责边界</b><span>${esc(selected.scope)}</span></div>
          <div class="council-boundary"><b>隔离规则</b><span>${esc(selected.isolation)}</span></div>
          <div class="council-detail-section">
            <b>必须具备的证据</b>
            <ul>${(selected.evidence || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
          </div>
          <div class="council-detail-section stops">
            <b>必须叫停的情况</b>
            <ul>${(selected.hard_stops || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
          </div>
          <div class="council-output-contract"><b>允许输出</b><span>${esc(selected.output)}</span><em>无处方、无工单、无设备命令</em></div>
        </aside>
      </div>

      <section class="panel pg-card council-reference-panel" aria-labelledby="councilReferencesTitle">
        <div class="pg-card-hd"><div><h2 id="councilReferencesTitle">设计依据</h2><span>仅作为系统设计参考；实际合规、认证和属地规则须由授权团队核对正式版本</span></div></div>
        <div class="council-references" id="councilReferences">
          ${(d.references || []).map((item) => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)} <span aria-hidden="true">↗</span></a>`).join("")}
        </div>
      </section>
    </div>`;

  document.getElementById("councilGoAgents").onclick = () => navigate({ page: "agents" });
  document.getElementById("councilGoCollab").onclick = () => navigate({ page: currentRole === "farm" ? "ai" : "collab" });
  view.querySelectorAll("[data-council-agent]").forEach((button) => {
    button.onclick = () => {
      councilFocus = button.dataset.councilAgent || councilFocus;
      renderCouncil();
    };
  });
  document.getElementById("councilRun").onclick = async () => {
    const goal = document.getElementById("councilGoal").value.trim().slice(0, 500);
    try {
      councilLastReview = await api(`/api/agents/council/review?goal=${encodeURIComponent(goal)}`);
      toast("独立评议草稿已生成", `${councilLastReview.independent_agents || agents.length} 位专家 · 未下发任何设备命令`, "green");
      renderCouncil();
    } catch (error) {
      toast("评议未生成", error.message || "接口不可用；未执行任何动作", "orange");
    }
  };
}

async function renderAgents() {
  const token = renderToken;
  const [ops, cat] = await Promise.all([api("/api/agents"), api("/api/agents/catalog")]);
  if (token !== renderToken) return;
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> Agent 能力名册 · 仿真</span>
      <span class="status-text">${esc((cat.note || "").replace(/mxsj/gi, "作物AI"))} · 运营 Agent 与专家能力分列</span>
      <button class="btn ghost" id="toCollab">协同中心</button>
      <button class="btn ghost" id="toDiag">联合诊断</button>
      <button class="btn ghost" id="toWb">协作工作台</button>
    </div>
    ${pgKpis([
      { label: "仿真 Agent", value: (ops || []).length, cls: "is-wait" },
      { label: "专家能力", value: (cat.catalog || []).length, cls: "is-run" },
      { label: "真实运行", value: 0, cls: "is-wait" },
      { label: "调度入口", value: "Farm Master", cls: "is-wait" },
    ])}
    <div class="pg-split equal">
      <div class="panel pg-card">
        ${pgCardHd("运营 Agent", "本地规则草稿层 · 不执行设备")}
        ${ops.map((a) => `
          <div class="item">
            <div class="row-between"><b>${esc(a.name)}</b><span class="tag ${statusTone(a.status)}">${esc(a.status)} · ${a.score || "-"}</span></div>
            <div class="sub">${esc(a.role)} · ${(a.tools || []).map(esc).join(" / ")}</div>
            <div>${esc(a.last_action)}</div>
          </div>`).join("")}
        ${pgCardHd("单 Agent 调度", "目标驱动")}
        <select id="agentId" aria-label="选择智能体">${ops.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
        <textarea id="goal" aria-label="智能体任务目标" rows="3">分析 B-01 农事建议所缺证据、责任人与停止条件</textarea>
        <div class="pg-toolbar">
          <button class="btn" id="dispatch">生成单 Agent 草稿</button>
          <button class="btn ghost" id="orchestrate">生成多 Agent 协同草稿</button>
        </div>
        <div id="agentResult"></div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("专家能力名册", "专业分工")}
        ${(cat.catalog || []).map((a) => `
          <div class="item">
            <div class="row-between"><b>${esc(a.name)}</b><span class="tag blue">${esc(a.role)}</span></div>
            <div>${esc(a.duty)}</div>
            <div class="tags">${(a.tools || []).map((t) => `<span class="tag gray">${esc(t)}</span>`).join("")}</div>
          </div>`).join("")}
      </div>
    </div>
    </div>`;
  document.getElementById("dispatch").onclick = async () => {
    const body = { agent_id: Number(document.getElementById("agentId").value), goal: document.getElementById("goal").value };
    const r = await api("/api/agents/dispatch", { method: "POST", body: JSON.stringify(body) });
    document.getElementById("agentResult").innerHTML = `<div class="item ok">${esc(r.result)}</div>`;
    toast("Agent 草稿已生成", r.message || r.result.slice(0, 36), "green");
  };
  document.getElementById("orchestrate").onclick = async () => {
    const r = await api("/api/agents/orchestrate", { method: "POST", body: JSON.stringify({ goal: document.getElementById("goal").value }) });
    document.getElementById("agentResult").innerHTML =
      `<div class="item ok">${esc(r.summary)}</div>` + r.steps.map((s) => `<div class="item"><b>${esc(s.agent)}</b><br>${esc(s.result)}</div>`).join("");
    toast("协同草稿已生成", r.summary, "green");
  };
  document.getElementById("toCollab").onclick = () => show("collab");
  document.getElementById("toDiag").onclick = () => show("diagnosis");
  document.getElementById("toWb").onclick = () => show("workbench");
}

async function renderRobots() {
  const token = renderToken;
  const d = await api("/api/robots");
  if (token !== renderToken) return;
  const prefMission = twinFocus ? `${twinFocus} 复飞确认病斑分布` : "B-01 复飞确认病斑分布";
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 调度沙箱</span>
      <span class="status-text">单机任务 + 多机编队仿真 · 不连接真实设备</span>
      <button class="btn ghost" id="robFleet">多机联合作业</button>
      <button class="btn ghost" id="robVendors">厂家接入</button>
    </div>
    ${pgKpis([
      { label: "仿真任务", value: (d.missions || []).length, cls: "is-wait" },
      { label: "生产执行", value: 0, cls: "is-wait" },
      { label: "设备目录模拟", value: (d.devices || []).length, cls: "is-wait" },
      { label: "候选联合编队", value: (d.joint || []).length, cls: "is-wait" },
    ])}
    <div class="item warn" role="note"><b>调度沙箱</b><div class="sub">本页仅创建模拟任务，不会向无人机、拖拉机或机器人发送真实指令；状态须以机手与设备回执为准。</div></div>
    ${(d.joint || []).length ? `
    <div class="panel pg-card">
      ${pgCardHd("候选编队入口", "进入联合流程回放")}
      <div class="pg-grid cols-2">
        ${d.joint.map((j) => `
          <div class="item clickable warn" data-joint-go="${esc(j.id)}">
            <div class="row-between"><b>${esc(j.id)}</b><span class="tag ${statusTone(j.status)}">${esc(j.status)}</span></div>
            <div>${esc(j.title)}</div>
            <div class="sub">${esc(j.land)} · ${(j.machines || []).length} 台机具 · ${(j.agents || []).length} 调度智能体</div>
          </div>`).join("")}
      </div>
    </div>` : ""}
    <div class="pg-split equal">
      <div class="panel pg-card">
        ${pgCardHd("无人设备模拟任务", "设备调度 · 未接生产设备")}
        ${d.missions.map((m) => `
          <div class="item clickable" data-mission-dev="${esc(m.device)}">
            <div class="row-between"><b>${esc(m.device)}</b><span class="tag ${statusTone(m.status)}">${esc(m.status)}</span></div>
            <div>${esc(m.mission)}</div>
            <div class="sub">预计完成 ${esc(m.eta)} · 点击定位设备</div>
            <div class="bar"><span style="width:${m.progress}%"></span></div>
          </div>`).join("")}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("登记仿真任务", "Robot Agent 调度沙箱")}
        <select id="robDev" aria-label="选择无人设备">${d.devices.map((x) => `<option value="${esc(x.code)}" ${deviceFocus === x.code ? "selected" : ""}>${esc(x.code)} · ${esc(x.name)} (${esc(x.status)})</option>`).join("")}</select>
        <input id="robMission" aria-label="仿真任务内容" value="${esc(prefMission)}" />
        <div class="pg-toolbar">
          ${currentRole === "farm" ? `<button class="btn" id="robGo">加入回放队列</button>` : `<span class="role-readonly"><i></i>查看/审核视图</span>`}
          <button class="btn ghost" id="robTwin">打开孪生设备层</button>
        </div>
        <div id="robOut"></div>
        ${pgCardHd("沙箱候选设备", "点击定位模拟档案")}
        ${d.devices.map((x) => `<div class="item clickable" data-fleet="${esc(x.code)}">${esc(x.code)} ${esc(x.name)} · ${esc(x.status)} · ${esc(x.last_value)}</div>`).join("")}
      </div>
    </div>
    </div>`;
  document.getElementById("robFleet").onclick = () => navigate({ page: "fleet", land: twinFocus || undefined });
  document.getElementById("robVendors").onclick = () => navigate({ page: "vendors" });
  view.querySelectorAll("[data-joint-go]").forEach((el) => {
    el.onclick = () => navigate({ page: "fleet", land: twinFocus || undefined, toast: ["联合编队", el.dataset.jointGo, "green"] });
  });
  view.querySelectorAll("[data-mission-dev], [data-fleet]").forEach((el) => {
    el.onclick = () => navigate({
      page: "devices",
      device: el.dataset.missionDev || el.dataset.fleet,
      toast: ["设备定位", el.dataset.missionDev || el.dataset.fleet, "green"],
    });
  });
  document.getElementById("robTwin").onclick = () => navigate({ page: "twin", layer: "device", land: twinFocus || undefined });
  const robGo = document.getElementById("robGo");
  if (robGo) robGo.onclick = async () => {
    const r = await api("/api/robots/dispatch", {
      method: "POST",
      body: JSON.stringify({
        device: document.getElementById("robDev").value,
        mission: document.getElementById("robMission").value,
      }),
    });
    if (r.ok === false) {
      document.getElementById("robOut").innerHTML = `<div class="item warn">${esc(r.message || "任务未登记")}</div>`;
      return;
    }
    deviceFocus = r.device;
    document.getElementById("robOut").innerHTML = `<div class="item warn">沙箱任务已登记 ${esc(r.device)}：${esc(r.mission)}<div class="sub">${esc(r.message || "等待人工确认；未生成设备命令")}</div></div>`;
    toast("沙箱任务已登记", `${r.mission} · 未生成设备命令`, "orange");
    setTimeout(renderRobots, 400);
  };
}

async function renderAI() {
  const token = renderToken;
  const [y, rag, risk] = await Promise.all([
    api("/api/ai/yield"),
    api("/api/ai/rag"),
    api("/api/ai/risk"),
  ]);
  if (token !== renderToken) return;
  const hadDraft = !!aiDraftQuestion;
  const draft =
    aiDraftQuestion ||
    (twinFocus
      ? currentRole === "gov"
        ? `${twinFocus} 节水节肥是否达标？如何取证？`
        : `${twinFocus} 今天该怎么干？`
      : currentRole === "gov"
        ? "本季节水节肥减药是否达标？"
        : "今天棉花该不该喷脱叶剂？");
  aiDraftQuestion = "";
  const defaultLand = twinFocus || "B-01";
  /* 模型「类型」列原来直接吐 LLM / Vision / Prediction / Simulation。 */
  const MODEL_TYPE = { LLM: "大语言模型", Vision: "视觉识别", Prediction: "产量预测", Simulation: "仿真推演", RAG: "检索增强" };
  const modelType = (t) => MODEL_TYPE[t] || t || "—";
  /* 原来的「模拟风险地块」按 pest_risk > 50 计数，而仿真数据里最高只有 28，这个 KPI 恒为 0。
     改成用数据里真实出现的「墒情风险 高」，另给出全场病虫风险峰值。 */
  const riskItems = risk.items || [];
  const wetHigh = riskItems.filter((r) => r.moisture_risk === "高").length;
  const pestPeak = riskItems.reduce((n, r) => Math.max(n, r.pest_risk || 0), 0);
  const isRisky = (r) => r.moisture_risk === "高" || (r.pest_risk || 0) >= 50;

  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> ${currentRole === "gov" ? "政策问答仿真" : currentRole === "expert" ? "本地规则分析" : "仿真问答"}</span>
      <span class="status-text">焦点地块 ${esc(twinFocus || "未选 · 默认关联优先田")}</span>
      <button class="btn ghost" id="aiGoTwin">看田地图</button>
      <button class="btn ghost" id="aiGoDash">返回驾驶舱</button>
    </div>

    <div class="panel pg-card ai-ask">
      ${pgCardHd("大白话问一问", "检索增强问答 · 回车或点「提问」都可以")}
      <div class="chat-log" id="log">
        <div class="ai-chat-empty">
          <span class="tag orange">证据优先</span>
          <b>先问“还缺什么证据？”，再讨论作业方案</b>
          <p>回答仅为本地仿真草案；不会生成真实设备命令，也不能替代药剂标签、属地规程、现场调查与专家签署。</p>
          <div><span>天气与观测时间</span><span>传感器质检</span><span>人工批准</span></div>
        </div>
      </div>
      <div class="ai-ask-row">
        <input id="q" aria-label="农业问答问题" value="${esc(draft)}" placeholder="例如：今天该怎么灌溉？黄萎病如何处理？" />
        <button class="btn" id="ask">提问</button>
      </div>
      <div id="aiActions" class="ai-action-row"></div>
      <div id="ragBox"></div>
    </div>

    ${pgKpis([
      { label: "仿真预测均产", value: y.avg_kg_per_mu, unit: "kg/亩", cls: "is-wait", sub: "未校准模型草案" },
      { label: "墒情风险高地块", value: wetHigh, unit: "块", cls: wetHigh ? "is-urgent" : "is-ok", clickable: true, attrs: `id="aiKpiRisk"`, sub: `全场 ${riskItems.length} 块 · 点击看热力图层` },
      { label: "病虫风险峰值", value: pestPeak, cls: "is-wait", sub: "本地阈值未标定，不作判定" },
      { label: "可检索知识", value: (rag.knowledge || []).length, unit: "条", cls: "is-wait", sub: "仿真摘要，非正式规程" },
    ])}

    <div class="pg-split equal">
      <div class="panel pg-card">
        ${pgCardHd("风险预测", `${riskItems.length} 块 · 点击定位地块`)}
        ${riskItems.map((r) => `<div class="item clickable ai-risk ${isRisky(r) ? "warn" : ""}" data-r-land="${esc(r.code)}"
          tabindex="0" role="button" aria-label="在风险图层定位 ${esc(r.code)} ${esc(r.name)}">
          <div class="row-between"><b>${esc(r.code)} ${esc(r.name)}</b><span class="tag ${r.moisture_risk === "高" ? "red" : "gray"}">墒情风险 ${esc(r.moisture_risk)}</span></div>
          <div class="sub">模拟病虫风险 ${r.pest_risk} · ${esc(r.advice)}</div>
        </div>`).join("")}
        <div class="pg-toolbar">
          <button class="btn" id="aiTwin">打开风险热力图层</button>
          <button class="btn ghost" id="aiRobots">${currentRole === "gov" ? "查看复飞候选" : "登记复飞候选"}</button>
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd(`产量仿真估算 · ${y.avg_kg_per_mu} kg/亩`, y.model || "")}
        <div class="pg-table-wrap">
        <table class="table">
          <thead><tr><th>地块</th><th>作物</th><th>生育期</th><th>模拟估算</th><th>模拟偏差</th><th>模拟风险</th></tr></thead>
          <tbody>
          ${y.items.map((i) => `<tr class="clickable" data-y-land="${esc(i.code)}" tabindex="0" role="button" aria-label="在孪生图层定位 ${esc(i.code)} ${esc(i.name)}"><td class="linkish">${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.stage)}</td><td>${i.predicted}</td><td>${i.delta}</td><td>${i.risk}</td></tr>`).join("")}
          </tbody>
        </table>
        </div>
        <div class="item">${esc(y.note)}</div>
      </div>
    </div>

    <div class="pg-split equal">
      <div class="pg-stack">
      <div class="panel pg-card">
        ${pgCardHd("看图识病", "描述症状，生成识别草稿")}
        <div class="ai-vision-form">
          <label for="crop">作物</label>
          <input id="crop" value="棉花" />
          <label for="symptom">症状描述</label>
          <input id="symptom" value="叶片出现黄斑" />
        </div>
        <div class="pg-toolbar"><button class="btn" id="vision">生成识别草稿</button></div>
        <div id="visionOut"></div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("模型版本", `${rag.models.length} 个 · 均为仿真模型，指标为目标值而非本场实测`)}
        <div class="pg-table-wrap">
        <table class="table">
          <thead><tr><th>模型</th><th>类型</th><th>版本</th><th>状态</th><th>指标</th></tr></thead>
          <tbody>
          ${rag.models.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(modelType(m.type))}</td><td>${esc(m.version)}</td><td><span class="tag ${statusTone(m.status)}">${esc(m.status)}</span></td><td>${esc(m.metric)}</td></tr>`).join("")}
          </tbody>
        </table>
        </div>
      </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("农事知识库", `${rag.knowledge.length} 条检索来源 · 点击进对应功能`)}
        ${rag.knowledge.map((k) => {
          let jump = "ai";
          if (/脱叶|吐絮/.test(k.title)) jump = "fleet";
          else if (/冬麦|小麦|播种/.test(k.title)) jump = "tasks";
          else if (/灌溉|水|墒/.test(k.title)) jump = "water";
          else if (/病|虫/.test(k.title)) jump = "diagnosis";
          else if (/产量|测产/.test(k.title)) jump = "history";
          return `<div class="item clickable insight-jump" data-jump="${jump}" data-land="${esc(defaultLand)}"
            tabindex="0" role="button" aria-label="打开相关功能：${esc(k.title)}"><b>${esc(k.title)}</b><div class="sub">${esc(k.source)} · 进入相关功能</div>${esc(k.snippet)}</div>`;
        }).join("")}
      </div>
    </div>
    </div>`;
  const log = document.getElementById("log");
  const paintActions = (actions) => {
    const box = document.getElementById("aiActions");
    if (!box) return;
    box.innerHTML = (actions || [])
      .map(
        (a) =>
          `<button type="button" class="btn" data-ai-act="${esc(a.jump)}" data-ai-land="${esc(a.land || "")}" data-ai-layer="${esc(a.layer || "")}">${esc(a.label)}</button>`
      )
      .join("");
    box.querySelectorAll("[data-ai-act]").forEach((btn) => {
      btn.onclick = () =>
        navigate({
          page: btn.dataset.aiAct,
          land: btn.dataset.aiLand || undefined,
          layer: btn.dataset.aiLayer || undefined,
          toast: ["已跳转", btn.textContent, "green"],
        });
    });
  };
  document.getElementById("ask").onclick = async () => {
    const question = document.getElementById("q").value.trim();
    if (!question) return;
    const r = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ question }) });
    if (log.querySelector(".ai-chat-empty")) log.innerHTML = "";
    log.innerHTML += `<div class="msg"><b>问：</b>${esc(question)}<br><b class="ok">答：</b>${esc(r.answer)}</div>`;
    log.scrollTop = log.scrollHeight;
    paintActions(r.actions || []);
    document.getElementById("ragBox").innerHTML =
      `<div class="sub">检索增强来源 · 可点进功能</div>` +
      (r.rag || [])
        .map(
          (x) =>
            `<div class="item clickable insight-jump" data-jump="${esc(x.jump || "ai")}" data-land="${esc(defaultLand)}"><b>${esc(x.title)}</b> · ${esc(x.source)}<br>${esc(x.snippet)}</div>`
        )
        .join("");
    document.getElementById("ragBox").querySelectorAll(".insight-jump").forEach((el) => {
      el.onclick = () => navigate({ page: el.dataset.jump || "ai", land: el.dataset.land || undefined });
    });
  };
  document.getElementById("vision").onclick = async () => {
    const r = await api("/api/ai/vision", {
      method: "POST",
      body: JSON.stringify({
        crop: document.getElementById("crop").value,
        symptom: document.getElementById("symptom").value,
      }),
    });
    const confidenceLabel = r.confidence == null ? "未验证" : `${(Number(r.confidence) * 100).toFixed(1)}%`;
    document.getElementById("visionOut").innerHTML =
      `<div class="item warn">分析草稿：${esc(r.disease)} · 置信度 ${esc(confidenceLabel)} · 级别 ${esc(r.level)} · 模型 ${esc(r.model)}<br>${esc(r.advice)}${r.limitations ? `<div class="sub">限制：${esc(r.limitations)}</div>` : ""}
      <div class="pg-toolbar"><button class="btn" id="visionGo">联合诊断</button>
      <button class="btn ghost" id="visionTwin">风险图层</button>
      <button class="btn ghost" id="visionRobots">${currentRole === "gov" ? "查看复飞任务" : "登记复飞候选"}</button></div></div>`;
    toast("识别草稿已生成", r.disease, "orange");
    document.getElementById("visionGo").onclick = () => navigate({ page: "diagnosis", land: defaultLand });
    document.getElementById("visionTwin").onclick = () => navigate({ page: "twin", layer: "risk", land: defaultLand });
    document.getElementById("visionRobots").onclick = () =>
      navigate(currentRole === "gov" ? { page: "tasks" } : { page: "robots", land: defaultLand, device: "UAV-001" });
  };
  /* 问一问页最要紧的交互就是提问，原来只能点按钮，输入框里回车没反应。 */
  document.getElementById("q").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.isComposing) return;
    ev.preventDefault();
    document.getElementById("ask").click();
  });
  view.querySelectorAll("[data-y-land], [data-r-land]").forEach((el) => {
    el.onclick = () =>
      navigate({
        page: "twin",
        layer: el.dataset.rLand ? "risk" : "crop",
        land: el.dataset.yLand || el.dataset.rLand,
        toast: ["地块定位", el.dataset.yLand || el.dataset.rLand, "green"],
      });
  });
  view.querySelectorAll("[data-y-land], [data-r-land], .insight-jump[tabindex]").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      el.click();
    });
  });
  view.querySelectorAll(".insight-jump").forEach((el) => {
    el.onclick = () => navigate({ page: el.dataset.jump || "ai", land: el.dataset.land || undefined });
  });
  document.getElementById("aiTwin").onclick = () => navigate({ page: "twin", layer: "risk" });
  document.getElementById("aiRobots").onclick = () =>
    navigate(currentRole === "gov" ? { page: "tasks" } : { page: "robots", land: defaultLand, device: "UAV-001" });
  document.getElementById("aiGoTwin").onclick = () => navigate({ page: "twin", land: twinFocus || undefined });
  document.getElementById("aiGoDash").onclick = () => navigate({ page: "dashboard" });
  document.getElementById("aiKpiRisk")?.addEventListener("click", () => navigate({ page: "twin", layer: "risk" }));
  if (hadDraft) document.getElementById("ask").click();
}

async function renderWater() {
  const token = renderToken;
  const q = twinFocus ? `?land=${encodeURIComponent(twinFocus)}` : "";
  const d = await api(`/api/irrigation${q}`);
  if (token !== renderToken) return;

  /* 引擎按地块返回了一份机器可读的缺口清单 missing_inputs，原来一次都没渲染，
     页面只用一句「缺关键水量与质量证据」笼统带过。这一页的用处就是说清楚还差哪几样，
     所以逐项列出来，并在全场维度汇总。 */
  const GAP_LABEL = {
    field_capacity: "田间持水量",
    root_depth_cm: "根层深度",
    effective_rainfall: "有效降雨",
    ETc: "作物需水 ETc",
    irrigation_efficiency: "灌溉效率",
    sensor_qc: "传感器质检",
  };
  const gapText = (k) => GAP_LABEL[k] || k;

  const all = (d.suggestions || []).slice();
  const plans = d.plans || [];
  const filed = new Set(plans.map((p) => p.land_code));

  /* 六条建议的结论完全相同，唯一能分轻重的是含水率：越干越靠前。
     从看田地图带过来的聚焦地块仍然置顶。 */
  all.sort((a, b) => {
    if (a.land_code === twinFocus) return -1;
    if (b.land_code === twinFocus) return 1;
    return (a.moisture == null ? 99 : a.moisture) - (b.moisture == null ? 99 : b.moisture);
  });

  const needReview = all.filter((s) => s.priority === "复核");
  const driest = all.reduce((m, s) => (m && m.moisture <= s.moisture ? m : s), null);
  const goCount = all.filter((s) => s.executable).length;
  const shown = waterOnlyReview ? needReview : all;

  /* 全场缺口汇总：同一项缺口涉及几块地。监管和专家看的是面上的缺口结构，
     不是逐块重复同一句拒绝。 */
  const gapKeys = [];
  const gapCount = {};
  all.forEach((s) => (s.missing_inputs || []).forEach((k) => {
    if (gapCount[k] == null) { gapCount[k] = 0; gapKeys.push(k); }
    gapCount[k] += 1;
  }));

  const scopeText = waterOnlyReview
    ? `只看需复核 ${needReview.length} / ${all.length} 块`
    : twinFocus ? `聚焦 ${esc(twinFocus)} · 仍列全场 ${all.length} 块` : `全场 ${all.length} 块地`;

  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 水肥决策仿真</span>
      <span class="status-text">${scopeText} · ${esc(d.saving_target)}</span>
      <button class="btn ghost" id="waterTwin">墒情图层</button>
      <button class="btn ghost" id="waterDev">水泵设备</button>
      <button class="btn ghost" id="waterExport">导出处方台账</button>
    </div>
    <div class="water-kpis">${pgKpis([
      { label: "需复核地块", value: needReview.length, unit: `/ ${all.length} 块`, cls: "is-urgent", sub: waterOnlyReview ? "已筛选 · 点击看全部" : "含水率低于 25% · 点击只看这些", clickable: true, attrs: `id="waterKpiReview" aria-pressed="${waterOnlyReview}"` },
      { label: "最低含水率", value: driest ? driest.moisture : "—", unit: driest ? `% · ${driest.land_code}` : "", cls: "is-wait", sub: "未核验模拟值" },
      { label: "可放行地块", value: goCount, unit: `/ ${all.length} 块`, cls: "is-wait", sub: "证据齐备前不放行" },
      { label: "候选记录", value: plans.length, unit: "条", cls: "is-done", sub: "仅留痕 · 不下发指令" },
    ])}</div>
    <div class="pg-split water-split">
      <div class="panel pg-card">
        ${pgCardHd("水肥证据研判", `缺关键输入即不放行 · ${d.protocol || ""}`,
          waterOnlyReview ? `<button class="btn ghost" id="waterClearFilter">清除筛选</button>` : "")}
        <div class="item warn wt-note" role="note">
          <b>${esc(all[0] ? all[0].reason.split("；")[1] || "缺关键水量与质量证据，不判断是否灌溉，也不计算剂量" : "")}</b>
          <div class="sub">含水率与 K 指标均为未核验模拟值；下列缺口补齐并经人工确认前，不计算水量，也不生成肥料剂量。</div>
        </div>
        ${shown.map((s) => `
          <div class="item wt-row ${twinFocus === s.land_code ? "ok" : ""} ${s.priority === "复核" ? "warn" : ""}">
            <div class="wt-hd">
              <button type="button" class="linkish wt-land" data-land-open="${esc(s.land_code)}"
                aria-label="打开 ${esc(s.land_code)} ${esc(s.land_name)} 的墒情图层">${esc(s.land_code)} ${esc(s.land_name)}</button>
              <span class="wt-metric">含水率 <b>${s.moisture}%</b><i>·</i>K <b>${s.k == null ? "—" : s.k}</b></span>
              <span class="tag ${s.priority === "复核" ? "red" : "gray"}">${esc(s.priority)}</span>
              <span class="tag orange">${esc(s.decision === "NO_GO" ? "不放行" : s.decision)}</span>
              ${filed.has(s.land_code) ? `<span class="tag blue">已登记</span>` : ""}
              ${currentRole === "farm" ? (filed.has(s.land_code)
                ? `<button class="btn ghost wt-act" disabled>已在候选记录</button>`
                : `<button class="btn wt-act" data-land="${esc(s.land_code)}" aria-label="为 ${esc(s.land_code)} 登记待补证据单">登记待补证据单</button>`) : ""}
            </div>
            <div class="wt-gaps">
              <em>待补证据 ${(s.missing_inputs || []).length} 项</em>
              ${(s.missing_inputs || []).map((k) => `<span class="gap-chip">${esc(gapText(k))}</span>`).join("")}
              <span class="gap-fert">${esc(s.fertilizer || "")}</span>
            </div>
          </div>`).join("") || "<div class='item'>当前筛选下没有地块</div>"}
      </div>
      <div class="pg-stack">
      <div class="panel pg-card">
        ${pgCardHd("全场证据缺口", `${gapKeys.length} 类 · 补齐后才进入水量计算`)}
        <div class="wt-gap-sum">
          ${gapKeys.map((k) => `<div class="wt-gap-sum-row"><span>${esc(gapText(k))}</span><b>${gapCount[k]} / ${all.length} 块</b></div>`).join("")}
        </div>
        <div class="sub">缺口来自仿真数据登记，不代表已向任何阀泵或传感设备发起采集。</div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("处方记录", "回放记录 · 专家可批注")}
        ${plans.map((p) => `<div class="item">
          <button type="button" class="n-item clickable" data-plan-land="${esc(p.land_code)}"
            aria-label="打开 ${esc(p.land_code)} 的墒情图层">${esc(p.land_code)} · ${p.calculation_status === "NOT_CALCULATED" || p.water_mm == null ? "水量未计算" : `${p.water_mm} mm`} · ${esc(p.fertilizer)}<br>${esc(p.reason)}
            <div class="sub">${esc(p.status || "")} ${esc(p.created_at || "")}${p.expert_note ? ` · 专家：${esc(p.expert_note)}` : ""}</div>
          </button>
          ${currentRole === "expert" ? `<div class="pg-toolbar">
            <button class="btn ghost" data-w-note="${p.id}" data-w-land="${esc(p.land_code)}">记录初审意见</button>
            <button class="btn ghost" data-w-rev="${p.id}" data-w-land="${esc(p.land_code)}">退回</button>
          </div>` : ""}
        </div>`).join("") || "<div class='item'>暂无</div>"}
        <button class="btn" id="waterTasks" style="width:100%;justify-content:center;margin-top:10px">查看农事任务</button>
      </div>
      </div>
    </div>
    </div>`;
  document.getElementById("waterTwin").onclick = () => navigate({ page: "twin", layer: "moisture", land: twinFocus || undefined });
  document.getElementById("waterDev").onclick = () => navigate({ page: "devices", device: "PUMP-001" });
  document.getElementById("waterTasks").onclick = () => navigate({ page: "tasks", land: twinFocus || undefined });
  document.getElementById("waterExport").onclick = () => downloadCsv(
    `水肥证据台账_${localDateKey()}.csv`,
    [
      ["类型", "地块", "含水率", "水量", "计算状态", "肥料/建议", "优先级/状态", "待补证据", "依据", "时间"],
      ...all.map((s) => ["建议", s.land_code, `${s.moisture}%`, s.water_mm == null ? "未计算" : `${s.water_mm} mm`, s.calculation_status || "", s.fertilizer || "", s.priority, (s.missing_inputs || []).map(gapText).join(" / "), s.reason, ""]),
      ...plans.map((p) => ["候选处方", p.land_code, "", p.water_mm == null ? "未计算" : `${p.water_mm} mm`, p.calculation_status || "", p.fertilizer, p.status, "", p.reason, p.created_at]),
    ]
  );
  document.getElementById("waterKpiReview")?.addEventListener("click", () => {
    waterOnlyReview = !waterOnlyReview;
    renderWater();
  });
  document.getElementById("waterClearFilter")?.addEventListener("click", () => {
    waterOnlyReview = false;
    renderWater();
  });
  view.querySelectorAll("[data-land-open], [data-plan-land]").forEach((el) => {
    el.onclick = () => navigate({
      page: "twin",
      layer: "moisture",
      land: el.dataset.landOpen || el.dataset.planLand,
    });
  });
  view.querySelectorAll("button[data-land]").forEach((btn) => {
    btn.onclick = async () => {
      const r = await api(`/api/irrigation/apply?land_code=${encodeURIComponent(btn.dataset.land)}`, { method: "POST" });
      if (r.ok === false) {
        toast("处方未入队", r.message || "操作被安全锁阻止", "orange");
        return;
      }
      twinFocus = btn.dataset.land;
      toast("待补证据单已保存", r.message || `${btn.dataset.land} 等待补证与人工复核`, "orange");
      renderWater();
    };
  });
  view.querySelectorAll("[data-w-note]").forEach((btn) => {
    btn.onclick = async () => {
      const payload = await requestExpertAudit({ approved: true, comment: "专家初审通过，转入人工门禁；不代表阀泵执行", title: `${btn.dataset.wLand} 水肥证据初审` });
      if (!payload) return;
      await api("/api/expert/review", {
        method: "POST",
        body: JSON.stringify({ ...payload, plan_id: Number(btn.dataset.wNote), land_code: btn.dataset.wLand, title: "水肥证据批注", result: "通过" }),
      });
      toast("专家意见已记录", `${btn.dataset.wLand} · 仍不放行，须补证据、人工确认与设备回执`, "orange");
      renderWater();
    };
  });
  view.querySelectorAll("[data-w-rev]").forEach((btn) => {
    btn.onclick = async () => {
      const payload = await requestExpertAudit({ approved: false, comment: "请补齐田间持水量、根层、ETc、有效降雨、效率与传感器质检", title: `${btn.dataset.wLand} 水肥证据退回` });
      if (!payload) return;
      await api("/api/expert/review", {
        method: "POST",
        body: JSON.stringify({ ...payload, plan_id: Number(btn.dataset.wRev), land_code: btn.dataset.wLand, title: "水肥证据退回", result: "驳回" }),
      });
      toast("已退回", payload.comment, "orange");
      renderWater();
    };
  });
}

async function renderTasks() {
  const token = renderToken;
  const yearQ = historyYear || 2026;
  const landQ = twinFocus || "";
  const [tasks, hist] = await Promise.all([
    api("/api/tasks"),
    api(`/api/tasks/history?year=${yearQ}${landQ ? `&land=${encodeURIComponent(landQ)}` : ""}`),
  ]);
  if (token !== renderToken) return;
  /* 列表卡头说明这份清单被筛成了什么范围——这个有用，去掉前面的「专家视角：」就行 */
  const scopeHint =
    currentRole === "expert" ? "待审核与分析类任务" : currentRole === "gov" ? "高优先级与全场监管任务" : "全部农事任务";
  const execs = (hist && hist.items) || [];
  const isHist = taskTab === "history";
  /* 有聚焦地块时直接翻到它所在那一页——从看田地图带着地块跳过来，
     总不能让人自己一页页找。只在聚焦地块换了的时候跳一次：
     翻页会走同一个 renderTasks()，每次都跳的话手点的页码立刻被弹回去。 */
  if (twinFocus !== taskFocusSeen) {
    taskFocusSeen = twinFocus;
    const idx = twinFocus ? tasks.findIndex((t) => t.land_code === twinFocus) : -1;
    taskPage = idx >= 0 ? Math.floor(idx / TASK_PAGE_SIZE) : 0;
  }
  const taskPages = Math.max(1, Math.ceil(tasks.length / TASK_PAGE_SIZE));
  if (taskPage > taskPages - 1) taskPage = taskPages - 1;
  if (taskPage < 0) taskPage = 0;
  const taskFrom = taskPage * TASK_PAGE_SIZE;
  const tasksPage = tasks.slice(taskFrom, taskFrom + TASK_PAGE_SIZE);
  const taskStatusLabel = (status) => ({
    "已审核": "初审已记录",
    "已驳回": "已退回补证",
    "已完成": "回放归档",
    "执行中": "流程回放",
    "进行中": "流程回放",
  }[status] || status);
  const taskAction = (task) => {
    if (currentRole === "gov") {
      return `<button class="btn ghost" data-gov-watch="${task.id}" data-gov-title="${esc(task.title)}" data-gov-land="${esc(task.land_code)}">关注</button>`;
    }
    if (currentRole === "expert") {
      if (task.status === "待审核") {
        return `<button class="btn" data-audit="${task.id}">记录初审通过</button><button class="btn ghost" data-reject="${task.id}">退回补证</button>`;
      }
      return `<span class="tag gray">审核视图</span>`;
    }
    const map = {
      "待人工确认": ["回放队列", "登记回放队列"],
      "待命": ["待人工确认", "转为人工确认"],
      "待执行": ["待人工确认", "回到人工确认"],
      "已审核": ["回放队列", "登记回放队列"],
      "进行中": ["待审核", "回到证据复核"],
      "执行中": ["待审核", "回到证据复核"],
      "已驳回": ["待人工确认", "补证后重提"],
      "已制止": ["待人工确认", "补证后重提"],
    };
    const action = map[task.status];
    return action
      ? `<button class="btn" data-tid="${task.id}" data-next="${esc(action[0])}" aria-label="${esc(action[1])}：${esc(task.title)}">${esc(action[1])}</button>`
      : `<span class="tag gray">${task.status === "已完成" ? "回放归档" : "等待责任角色处理"}</span>`;
  };
  /* 原来这里是「专家视角：待审核与分析类任务 · 当前队列 N 项」——前半段角色顶栏有、
     任务类型侧栏菜单名有，换成这一页本来就该出现却一直没露面的门禁约束。 */
  document.getElementById("pageSub").textContent = isHist
    ? `系统任务回放记录 · ${yearQ} 年${landQ ? ` · ${landQ}` : ""} · 共 ${execs.length} 条`
    : `当前队列 ${tasks.length} 项 · ${PAGE_SUBTITLES.tasks}`;

  view.innerHTML = `
    <div class="page-shell">
    <div class="seg-tabs panel pg-card" style="display:flex;align-items:center;gap:8px;padding:10px 12px">
      <button type="button" class="seg ${!isHist ? "on" : ""}" data-ttab="current">当前任务</button>
      <button type="button" class="seg ${isHist ? "on" : ""}" data-ttab="history">回放记录</button>
      <button type="button" class="btn ghost" id="taskToArchive" style="margin-left:auto">打开历年档案</button>
      <button type="button" class="btn ghost" id="taskExport">导出台账</button>
    </div>
    ${!isHist ? `
    <div class="item warn" role="note"><b>任务安全边界</b><div class="sub">专家初审只表示材料可进入场长人工确认；“回放队列”不会向任何真实机具、阀泵或无人机发送命令。</div></div>
    ${pgKpis([
      { label: "当前队列", value: tasks.length, cls: "is-ok" },
      { label: "待审核", value: tasks.filter((t) => t.status === "待审核").length, cls: "is-wait" },
      { label: "高优", value: tasks.filter((t) => t.priority === "高").length, cls: "is-urgent" },
      { label: "聚焦地块", value: twinFocus || "全场", cls: twinFocus ? "is-run" : "is-done" },
    ])}
    <div class="pg-split tasks-grid">
      <div class="panel pg-card">
        ${pgCardHd("农事任务列表", `${scopeHint} · 共 ${tasks.length} 条 · 每页 ${TASK_PAGE_SIZE} 条`)}
        <div class="pg-table-wrap">
        <table class="table tasks-table">
          <tr><th>标题</th><th>类型</th><th>地块</th><th>责任智能体</th><th>优先级</th><th>状态</th><th>操作</th></tr>
          ${tasksPage.map((t) => `<tr class="${twinFocus && t.land_code === twinFocus ? "row-focus" : ""}">
            <td>${esc(t.title)}</td><td>${esc(t.task_type)}</td>
            <td class="clickable linkish" data-t-land="${esc(t.land_code)}">${esc(t.land_code)}</td>
            <td>${esc(t.assignee)}</td><td>${esc(t.priority || "-")}</td>
            <td><span class="tag ${statusTone(t.status)}">${esc(taskStatusLabel(t.status))}</span></td>
            <td>
              ${taskAction(t)}
              ${currentRole === "expert" && t.status !== "待审核" && t.audit_note ? `<span class="sub">${esc(t.audit_note)}</span>` : ""}
            </td>
          </tr>`).join("") || `<tr><td colspan="7" class="sub">当前范围内没有任务</td></tr>`}
        </table>
        </div>
        ${tasks.length ? `<div class="pg-pager" role="group" aria-label="农事任务翻页">
          <button class="btn ghost" id="taskPrev" ${taskPage === 0 ? "disabled" : ""} aria-label="上一页">‹ 上一页</button>
          <span class="pg-pager-nums">
            ${Array.from({ length: taskPages }, (_, i) => `<button type="button" class="pg-pager-num${i === taskPage ? " is-on" : ""}" data-task-page="${i}" aria-label="第 ${i + 1} 页"${i === taskPage ? ' aria-current="page"' : ""}>${i + 1}</button>`).join("")}
          </span>
          <button class="btn ghost" id="taskNext" ${taskPage >= taskPages - 1 ? "disabled" : ""} aria-label="下一页">下一页 ›</button>
          <span class="sub">第 ${taskFrom + 1}–${taskFrom + tasksPage.length} 条 / 共 ${tasks.length} 条</span>
        </div>` : ""}
      </div>
      <div class="panel pg-card">
        ${currentRole === "gov" ? `
          ${pgCardHd("监管工作台", "只读监察 · 不直接派工")}
          <div class="item ok"><b>权限边界</b><div class="sub">监管角色可关注、下钻和取证；任务创建、审核与设备控制由农场或专家角色完成。</div></div>
          <div class="item"><b>建议检查顺序</b><div class="sub">高优任务 → 地块证据 → 执行记录 → 年度效果</div></div>
          <div class="pg-toolbar">
            <button class="btn" id="taskGovEvidence">打开历年证据</button>
            <button class="btn ghost" id="taskGovMap">田间一张图</button>
          </div>` : `
          ${pgCardHd("登记仿真草稿", "写入待人工确认队列")}
          <input id="title" aria-label="任务标题" placeholder="任务标题" />
          <input id="type" aria-label="任务类型" placeholder="类型，如灌溉/巡检" value="巡检" />
          <input id="land" aria-label="任务地块编号" placeholder="地块编号" value="${esc(twinFocus || "B-01")}" />
          <input id="assignee" aria-label="任务负责人" value="Farm Master Agent" />
          <select id="priority" aria-label="任务优先级"><option>高</option><option selected>中</option><option>低</option></select>
          <div class="pg-toolbar">
            <button class="btn" id="add">登记草稿</button>
            <button class="btn ghost" id="taskTwin">打开孪生</button>
            <button class="btn ghost" id="taskWater">水肥中心</button>
          </div>
          <div class="sub" style="margin-top:12px">仿真状态会写入当前浏览器的本地记录；真实归档须绑定设备回执、轨迹、实际量、独立验收人与持久化审计。</div>`}
      </div>
    </div>` : `
    ${pgKpis([
      { label: "回放记录", value: execs.length, cls: "is-wait" },
      { label: "回放归档", value: execs.filter((e) => e.status === "已完成").length, cls: "is-wait" },
      { label: "流程回放中", value: execs.filter((e) => e.status === "流程回放").length, cls: "is-wait" },
      { label: "模拟耗时", value: execs.reduce((s, e) => s + (e.duration_min || 0), 0), unit: "分", cls: "is-wait" },
    ])}
    <div class="hist-toolbar panel pg-card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <div class="year-chips">
        ${[2026, 2025, 2024, 2023].map((y) => `<button type="button" class="year-chip ${y === yearQ ? "on" : ""}" data-hy="${y}">${y}</button>`).join("")}
      </div>
      <span class="chip">${landQ ? `地块 ${esc(landQ)}` : "全场"}</span>
      ${landQ ? `<button class="btn ghost" id="clearLand">清除地块筛选</button>` : ""}
    </div>
    <div class="pg-split hist-exec-grid">
      <div class="panel pg-card">
        ${pgCardHd(`仿真履历时间线 · ${yearQ}`, "未验证模拟 · 可下钻地块")}
        <div class="exec-timeline">
          ${execs.length ? execs.map((e) => `
            <div class="exec-item ${e.status === "执行中" ? "running" : "done"}">
              <div class="exec-rail"></div>
              <div class="exec-card">
                <div class="row-between">
                  <b>${esc(e.title)}</b>
                  <span class="tag orange">${esc(taskStatusLabel(e.status))}</span>
                </div>
                <div class="sub">${esc(e.id)} · ${esc(e.task_type)} · ${esc(e.land_code)} · ${esc(e.agent)}</div>
                <div class="exec-meta">
                  <span>开始 ${esc(e.started_at)}</span>
                  <span>结束 ${esc(e.finished_at)}</span>
                  <span>耗时 ${e.duration_min} 分</span>
                </div>
                <div class="exec-result">${esc(e.result)}</div>
                <div class="pg-toolbar">
                  ${e.land_code && e.land_code !== "全场" ? `<button class="btn ghost" data-ex-land="${esc(e.land_code)}">地块档案</button>` : ""}
                  ${e.land_code && e.land_code !== "全场" ? `<button class="btn ghost" data-ex-twin="${esc(e.land_code)}">孪生定位</button>` : ""}
                </div>
              </div>
            </div>`).join("") : `<div class="empty-hint">该年暂无回放记录</div>`}
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("仿真履历摘要", `${yearQ} 年 · 非生产台账`)}
        <div class="metric-grid">
          <div><span class="sub">记录条数</span><b class="num">${execs.length}</b></div>
          <div><span class="sub">回放归档</span><b class="num">${execs.filter((e) => e.status === "已完成").length}</b></div>
          <div><span class="sub">流程回放中</span><b class="num">${execs.filter((e) => e.status === "流程回放").length}</b></div>
          <div><span class="sub">模拟累计耗时</span><b class="num">${execs.reduce((s, e) => s + (e.duration_min || 0), 0)}</b><small> 分</small></div>
        </div>
        <h3 style="margin-top:16px">按类型</h3>
        ${Object.entries(execs.reduce((m, e) => { m[e.task_type] = (m[e.task_type] || 0) + 1; return m; }, {})).map(([k, v]) => `
          <div class="item" style="margin:6px 0"><div class="row-between"><b>${esc(k)}</b><span class="num">${v}</span></div></div>
        `).join("") || "<div class='sub'>无</div>"}
      </div>
    </div>`}
    </div>`;

  view.querySelectorAll("[data-ttab]").forEach((btn) => {
    btn.onclick = () => { taskTab = btn.dataset.ttab; taskPage = 0; renderTasks(); };
  });
  const gotoTaskPage = (n) => {
    taskPage = Math.min(Math.max(0, n), taskPages - 1);
    renderTasks();
  };
  document.getElementById("taskPrev")?.addEventListener("click", () => gotoTaskPage(taskPage - 1));
  document.getElementById("taskNext")?.addEventListener("click", () => gotoTaskPage(taskPage + 1));
  view.querySelectorAll("[data-task-page]").forEach((el) => {
    el.onclick = () => gotoTaskPage(Number(el.dataset.taskPage));
  });
  document.getElementById("taskToArchive")?.addEventListener("click", () => navigate({ page: "history", year: yearQ, land: landQ || undefined }));
  document.getElementById("taskExport")?.addEventListener("click", () => downloadCsv(
    `${isHist ? "任务回放记录" : "当前任务台账"}_${yearQ}.csv`,
    isHist
      ? [["记录号", "任务", "类型", "地块", "智能体", "状态", "开始", "结束", "耗时(分)", "结果"], ...execs.map((e) => [e.id, e.title, e.task_type, e.land_code, e.agent, taskStatusLabel(e.status), e.started_at, e.finished_at, e.duration_min, e.result])]
      : [["编号", "任务", "类型", "地块", "责任人/智能体", "优先级", "状态", "审核说明"], ...tasks.map((t) => [t.id, t.title, t.task_type, t.land_code, t.assignee, t.priority, taskStatusLabel(t.status), t.audit_note || ""])],
  ));
  if (!isHist) {
    const addTask = document.getElementById("add");
    if (addTask) addTask.onclick = async () => {
      const title = document.getElementById("title").value.trim();
      const landCode = document.getElementById("land").value.trim().toUpperCase();
      if (!title || !landCode) {
        toast("请补全任务", "任务标题和地块编号不能为空", "orange");
        return;
      }
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title,
          task_type: document.getElementById("type").value,
          land_code: landCode,
          assignee: document.getElementById("assignee").value,
          priority: document.getElementById("priority").value,
        }),
      });
      toast("仿真草稿已登记", `${landCode} · 待人工确认，未向设备下发`, "orange");
      renderTasks();
    };
    document.getElementById("taskTwin")?.addEventListener("click", () => navigate({ page: "twin", land: document.getElementById("land").value }));
    document.getElementById("taskWater")?.addEventListener("click", () => navigate({ page: "water", land: document.getElementById("land").value }));
    document.getElementById("taskGovEvidence")?.addEventListener("click", () => navigate({ page: "history", land: twinFocus || undefined, year: yearQ }));
    document.getElementById("taskGovMap")?.addEventListener("click", () => navigate({ page: "twin", land: twinFocus || undefined }));
    view.querySelectorAll("[data-t-land]").forEach((el) => {
      el.onclick = () => navigate({ page: "twin", land: el.dataset.tLand === "全场" ? "" : el.dataset.tLand });
    });
    view.querySelectorAll("button[data-tid]").forEach((btn) => {
      btn.onclick = async () => {
        const nextStatus = btn.dataset.next;
        const r = await api(`/api/tasks/${btn.dataset.tid}/status?status=${encodeURIComponent(nextStatus)}`, { method: "POST", body: "{}" });
        if (r.ok === false) {
          toast("状态未变更", r.message || "任务状态转换被拒绝", "orange");
          return;
        }
        toast("仿真状态已登记", `#${btn.dataset.tid} · ${nextStatus} · 未向设备下发`, "orange");
        renderTasks();
      };
    });
    view.querySelectorAll("button[data-audit]").forEach((btn) => {
      btn.onclick = async () => {
        const payload = await requestExpertAudit({ approved: true, comment: "专家初审通过；仍须场长人工确认，不代表允许执行", title: `任务 #${btn.dataset.audit} 专家初审` });
        if (!payload) return;
        const r = await api(`/api/tasks/${btn.dataset.audit}/audit`, { method: "POST", body: JSON.stringify(payload) });
        if (r.ok === false) {
          toast("初审未记录", r.message || "请求被拒绝", "orange");
          return;
        }
        toast("初审意见已记录", `#${btn.dataset.audit} · 不代表允许执行`, "orange");
        renderTasks();
      };
    });
    view.querySelectorAll("button[data-reject]").forEach((btn) => {
      btn.onclick = async () => {
        const payload = await requestExpertAudit({ approved: false, comment: "请补充依据、责任人与停止条件后重提", title: `任务 #${btn.dataset.reject} 退回补证` });
        if (!payload) return;
        await api(`/api/tasks/${btn.dataset.reject}/audit`, { method: "POST", body: JSON.stringify(payload) });
        toast("已退回补证", payload.comment, "orange");
        renderTasks();
      };
    });
    view.querySelectorAll("button[data-gov-watch]").forEach((btn) => {
      btn.onclick = async () => {
        await api("/api/gov/flag", {
          method: "POST",
          body: JSON.stringify({ title: btn.dataset.govTitle, land_code: btn.dataset.govLand, level: "跟踪", note: "任务监察标记" }),
        });
        toast("已加入监管关注", btn.dataset.govTitle, "green");
      };
    });
  } else {
    view.querySelectorAll("[data-hy]").forEach((btn) => {
      btn.onclick = () => { historyYear = Number(btn.dataset.hy); renderTasks(); };
    });
    document.getElementById("clearLand")?.addEventListener("click", () => { twinFocus = ""; renderTasks(); });
    view.querySelectorAll("[data-ex-land]").forEach((btn) => {
      btn.onclick = () => navigate({ page: "history", land: btn.dataset.exLand, year: yearQ });
    });
    view.querySelectorAll("[data-ex-twin]").forEach((btn) => {
      btn.onclick = () => navigate({ page: "twin", land: btn.dataset.exTwin });
    });
  }
}

function sparkBars(series, key) {
  const vals = (series || []).map((s) => s[key] || 0);
  const max = Math.max(...vals, 1);
  return `<div class="spark" title="${vals.join(" → ")}">${vals.map((v, i) =>
    `<i style="height:${Math.max(8, Math.round((v / max) * 100))}%" data-y="${series[i]?.year || ""}"></i>`
  ).join("")}</div>`;
}

async function renderHistory() {
  const token = renderToken;
  const land = twinFocus || "";
  const d = await api(`/api/history?year=${historyYear}${land ? `&land=${encodeURIComponent(land)}` : ""}`);
  if (token !== renderToken) return;
  const s = d.summary || {};
  /* 引擎的 d.note 有 66 字，.sub-t 是 620px 单行截断，实测被切掉 187px——
     切掉的正好是「设备 ACK 与验收证据」这条尾巴。前半段「产量、用水、健康度均为未验证模拟」
     正文里已经有（未验证 ×2、模拟 ×57、仿真 ×5），这里只留正文没有的约束尾。 */
  document.getElementById("pageSub").textContent =
    `${PAGE_SUBTITLES.history} · ${historyYear} 年${land ? ` · ${land}` : " · 全场"}`;

  /* 引擎的 summary.tasks_done / tasks_running 恒为 0（实测），但每块地的 tasks_done 是有值的，
     履历里也带状态。两个恒 0 且跳同一个地方的 KPI 换成一个真算出来的。 */
  const execs = d.executions || [];
  const tasksDone = (d.lands || []).reduce((n, r) => n + (r.tasks_done || 0), 0);
  const tasksRunning = execs.filter((e) => ["流程回放", "执行中"].includes(e.status)).length;

  view.innerHTML = `
    <div class="page-shell">
    <div class="hist-toolbar panel pg-card">
      <div class="year-chips">
        ${(d.years || [2026, 2025, 2024, 2023]).map((y) =>
          `<button type="button" class="year-chip ${y === historyYear ? "on" : ""}" data-hy="${y}" aria-pressed="${y === historyYear}">${y}</button>`
        ).join("")}
      </div>
      <div class="land-chips">
        <button type="button" class="land-chip ${!land ? "on" : ""}" data-hl="" aria-pressed="${!land}">全场</button>
        ${(d.land_series || []).map((l) =>
          `<button type="button" class="land-chip ${land === l.code ? "on" : ""}" data-hl="${esc(l.code)}" aria-pressed="${land === l.code}">${esc(l.code)}</button>`
        ).join("")}
      </div>
      <button type="button" class="btn ghost hist-export" id="histExport">导出年度报告</button>
    </div>

    ${pgKpis([
      { label: "档案地块", value: s.lands || 0, unit: "块", cls: "is-ok", sub: `${historyYear} 年 · ${land || "全场"}` },
      { label: "模拟均产", value: s.avg_yield || 0, unit: "kg/亩", cls: "is-wait", sub: "未验证模拟，非实测产量" },
      { label: "模拟亩均用水", value: s.avg_water || 0, unit: "m³", cls: "is-wait", sub: `节水目标 ${s.water_saving_pct || 0}%（待核验）` },
      { label: "模拟完成任务", value: tasksDone, unit: "项", cls: "is-wait", clickable: true, attrs: `id="histKpiDone"`, sub: `另有 ${tasksRunning} 项流程回放中` },
    ])}

    <div class="pg-split hist-main">
      <div class="panel pg-card">
        ${pgCardHd(`${historyYear} 年地块情况`, `${(d.lands || []).length} 块 · 点击筛选／下钻`)}
        <div class="hist-land-list">
          ${(d.lands || []).map((r) => {
            const series = (d.land_series || []).find((x) => x.code === r.land_code);
            return `
            <div class="hist-land-card ${twinFocus === r.land_code ? "focus" : ""}" data-land-pick="${esc(r.land_code)}"
              tabindex="0" role="button" aria-pressed="${twinFocus === r.land_code}" aria-label="筛选地块 ${esc(r.land_code)} ${esc(r.land_name)}">
              <div class="row-between">
                <div>
                  <b>${esc(r.land_code)} · ${esc(r.land_name)}</b>
                  <div class="sub">${esc(r.crop)} · ${esc(r.variety)} · ${r.area_mu} 亩 · ${esc(r.stage_peak)}</div>
                </div>
                <span class="tag orange">模拟健康 ${r.health_avg}</span>
              </div>
              <div class="hist-metrics">
                <div><span class="sub">模拟产量</span><b class="num">${r.yield_kg_mu}</b><small> kg/亩</small></div>
                <div><span class="sub">模拟用水</span><b class="num">${r.water_m3_mu}</b><small> m³</small></div>
                <div><span class="sub">模拟施肥</span><b class="num">${r.fert_kg_mu}</b><small> kg</small></div>
                <div><span class="sub">模拟病虫</span><b class="num">${r.pest_events}</b><small> 次</small></div>
              </div>
              <div class="hist-spark-row">
                <span class="sub">四年产量</span>${sparkBars(series && series.yields, "yield")}
                <span class="sub">四年用水</span>${sparkBars(series && series.yields, "water")}
              </div>
              <div class="sub">${esc(r.note)} · 当年完成任务约 ${r.tasks_done} 项</div>
              <div class="pg-toolbar">
                <button class="btn ghost" data-h-twin="${esc(r.land_code)}">孪生</button>
                <button class="btn ghost" data-h-tasks="${esc(r.land_code)}">任务记录</button>
              </div>
            </div>`;
          }).join("") || "<div class='empty-hint'>无地块档案</div>"}
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd(`作业履历 · ${historyYear}`, `共 ${execs.length} 条 · 其中 ${tasksRunning} 条回放中 · 非生产记录`)}
        <div class="exec-timeline compact">
          ${execs.slice(0, 12).map((e) => `
            <div class="exec-item ${["流程回放", "执行中"].includes(e.status) ? "running" : "done"}">
              <div class="exec-rail"></div>
              <div class="exec-card">
                <div class="row-between"><b>${esc(e.title)}</b><span class="tag ${["流程回放", "执行中"].includes(e.status) ? "blue" : "green"}">${esc(e.status)}</span></div>
                <div class="sub">${esc(e.started_at)} · ${esc(e.land_code)} · ${esc(e.agent)}</div>
                <div class="exec-result">${esc(e.result)}</div>
              </div>
            </div>`).join("") || "<div class='empty-hint'>暂无执行记录</div>"}
        </div>
        <button class="btn hist-all-tasks" id="histAllTasks">查看完整履历</button>
      </div>
    </div>

    <div class="panel hist-compare pg-card">
      ${pgCardHd("地块四年对比", "模拟产量 kg/亩 · 点击地块编号筛选")}
      <div class="pg-table-wrap">
      <table class="table">
        <thead><tr><th>地块</th><th>作物</th><th>2023</th><th>2024</th><th>2025</th><th>2026</th><th>趋势</th></tr></thead>
        <tbody>
        ${(d.land_series || []).map((l) => {
          const ys = {};
          (l.yields || []).forEach((y) => { ys[y.year] = y.yield; });
          return `<tr class="${land === l.code ? "row-focus" : ""}">
            <td class="clickable linkish" data-cmp="${esc(l.code)}" tabindex="0" role="button" aria-label="筛选地块 ${esc(l.code)}">${esc(l.code)}</td>
            <td>${esc(l.crop)}</td>
            <td class="num">${ys[2023] ?? "—"}</td>
            <td class="num">${ys[2024] ?? "—"}</td>
            <td class="num">${ys[2025] ?? "—"}</td>
            <td class="num">${ys[2026] ?? "—"}</td>
            <td>${sparkBars(l.yields, "yield")}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>
      </div>
    </div>
    </div>`;

  view.querySelectorAll("[data-hy]").forEach((btn) => {
    btn.onclick = () => { historyYear = Number(btn.dataset.hy); renderHistory(); };
  });
  view.querySelectorAll("[data-hl]").forEach((btn) => {
    btn.onclick = () => { twinFocus = btn.dataset.hl || ""; renderHistory(); };
  });
  view.querySelectorAll("[data-land-pick]").forEach((el) => {
    el.onclick = (ev) => {
      if (ev.target.closest("button")) return;
      twinFocus = el.dataset.landPick;
      renderHistory();
    };
  });
  view.querySelectorAll("[data-h-twin]").forEach((btn) => {
    btn.onclick = () => navigate({ page: "twin", land: btn.dataset.hTwin });
  });
  view.querySelectorAll("[data-h-tasks]").forEach((btn) => {
    btn.onclick = () => navigate({ page: "tasks", land: btn.dataset.hTasks, taskTab: "history", year: historyYear });
  });
  view.querySelectorAll("[data-cmp]").forEach((el) => {
    el.onclick = () => { twinFocus = el.dataset.cmp; renderHistory(); };
  });
  /* 地块卡和对比表的地块编号都是 div/td 上挂的 role="button"，键盘要自己补 Enter/Space */
  view.querySelectorAll("[data-land-pick], [data-cmp]").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      el.click();
    });
  });
  document.getElementById("histAllTasks")?.addEventListener("click", () =>
    navigate({ page: "tasks", taskTab: "history", year: historyYear, land: land || undefined })
  );
  document.getElementById("histKpiDone")?.addEventListener("click", () =>
    navigate({ page: "tasks", taskTab: "history", year: historyYear, land: land || undefined })
  );
  document.getElementById("histExport")?.addEventListener("click", () => downloadCsv(
    `年度地块报告_${historyYear}${land ? `_${land}` : "_全场"}.csv`,
    [
      ["年度", "地块", "名称", "作物", "品种", "面积(亩)", "产量(kg/亩)", "用水(m³/亩)", "施肥(kg/亩)", "病虫事件", "健康度", "任务完成", "节水率", "说明"],
      ...(d.lands || []).map((r) => [historyYear, r.land_code, r.land_name, r.crop, r.variety, r.area_mu, r.yield_kg_mu, r.water_m3_mu, r.fert_kg_mu, r.pest_events, r.health_avg, r.tasks_done, `${r.saving_water_pct || s.water_saving_pct || 0}%`, r.note]),
    ]
  ));
}

async function renderAssets() {
  const token = renderToken;
  const [assets, models] = await Promise.all([api("/api/assets"), api("/api/models")]);
  if (token !== renderToken) return;
  let focus = assets[0] || null;
  const jumpOf = (a) => {
    if (a.id === "hist-1") return { page: "history" };
    if (a.asset_type === "GIS") return { page: "twin" };
    if (a.asset_type === "时序") return { page: "devices" };
    if (a.asset_type === "影像") return { page: "ai" };
    if (a.asset_type === "轨迹") return { page: "fleet" };
    if (a.asset_type === "图谱" || a.asset_type === "向量") return { page: "ai" };
    return { page: "arch" };
  };
  const paint = (sel) => {
    focus = sel || focus || assets[0];
    view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 仿真数据资产</span>
      <span class="status-text">目录 · 预览 · 模型能力</span>
      <button class="btn ghost" id="assetSeason">全季装备</button>
      <button class="btn ghost" id="assetExport">导出资产目录</button>
    </div>
    ${pgKpis([
      { label: "资产数", value: (assets || []).length, cls: "is-ok" },
      { label: "模型数", value: (models || []).length, cls: "is-run" },
      { label: "当前资产", value: focus ? focus.name : "—", cls: "is-wait" },
      { label: "类型", value: focus ? focus.asset_type : "—", cls: "is-done" },
    ])}
    <div class="pg-split wide-left">
      <div class="panel pg-card">
        ${pgCardHd("数据资产目录", "点击预览 / 打开关联模块")}
        <div class="pg-table-wrap">
        <table class="table">
          <tr><th>资产</th><th>类型</th><th>规模</th><th>更新</th><th></th></tr>
          ${assets.map((a) => `<tr class="clickable ${focus && focus.id === a.id ? "row-focus" : ""}" data-aid="${esc(a.id)}">
            <td>${esc(a.name)}</td><td>${esc(a.asset_type)}</td><td>${esc(a.volume)}</td><td>${esc(a.updated || "-")}</td>
            <td><button class="btn ghost" data-asset-jump="${esc(jumpOf(a).page)}">打开</button></td>
          </tr>`).join("")}
        </table>
        </div>
      </div>
      <div class="panel pg-card">
        ${pgCardHd("资产预览", focus ? focus.asset_type : "")}
        ${focus ? `
          <div class="item ok"><b>${esc(focus.name)}</b><div class="sub">${esc(focus.asset_type)} · ${esc(focus.owner)} · ${esc(focus.market || "")}</div></div>
          <div class="item"><b>内容摘要</b><div>${esc(focus.preview || focus.value_note)}</div></div>
          <div class="item"><b>价值说明</b><div class="sub">${esc(focus.value_note)}</div></div>
          <div class="pg-toolbar">
            <button class="btn" id="assetOpen">进入关联模块</button>
          </div>` : `<div class="item">选择左侧资产查看摘要</div>`}
        ${pgCardHd("模型能力", "点击进入 AI / Agent")}
        <div class="pg-feed">
          ${models.map((m) => `<div class="card compact clickable" data-model="${esc(m.type)}"><b>${esc(m.name)}</b><div class="sub">${esc(m.type)} ${esc(m.version)} · ${esc(m.status)} · ${esc(m.metric)}</div></div>`).join("")}
        </div>
      </div>
    </div>
    </div>`;
    view.querySelectorAll("[data-aid]").forEach((row) => {
      row.onclick = (ev) => {
        if (ev.target.closest("[data-asset-jump]")) return;
        paint(assets.find((a) => a.id === row.dataset.aid));
      };
    });
    view.querySelectorAll("[data-asset-jump]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        navigate({ page: btn.dataset.assetJump, toast: ["打开资产关联模块", btn.dataset.assetJump, "green"] });
      };
    });
    view.querySelectorAll("[data-model]").forEach((el) => {
      el.onclick = () => navigate({
        page: el.dataset.model === "Vision" || el.dataset.model === "LLM" || el.dataset.model === "Prediction" ? "ai" : "agents",
        toast: ["模型能力", el.querySelector("b")?.textContent || "", "green"],
      });
    });
    const open = document.getElementById("assetOpen");
    if (open && focus) open.onclick = () => navigate({ page: jumpOf(focus).page, toast: ["资产联动", focus.name, "green"] });
    const sea = document.getElementById("assetSeason");
    if (sea) sea.onclick = () => navigate({ page: "season" });
    const exp = document.getElementById("assetExport");
    if (exp) exp.onclick = () => downloadCsv(
      `数据资产目录_${localDateKey()}.csv`,
      [
        ["资产编号", "资产", "类型", "规模", "责任服务", "适用版本/市场", "更新", "价值说明", "内容摘要"],
        ...(assets || []).map((a) => [a.id, a.name, a.asset_type, a.volume, a.owner, a.market, a.updated || "", a.value_note, a.preview || ""]),
      ]
    );
  };
  paint(focus);
}

async function renderArch() {
  const token = renderToken;
  const d = await api("/api/architecture");
  if (token !== renderToken) return;
  const layerJump = { "感知层": "devices", "数据层": "assets", "AI层": "ai", "Agent层": "agents", "执行层": "robots", "商业层": "assets" };
  view.innerHTML = `
    <div class="page-shell">
    <div class="status-strip">
      <span class="live-pill"><span class="dot orange"></span> 云边端目标架构</span>
      <span class="status-text">${esc(d.loop || "")}</span>
      <button class="btn ghost" id="archDash">返回驾驶舱</button>
      <button class="btn" id="archWall">打开态势大屏</button>
    </div>
    ${pgKpis([
      { label: "架构层", value: (d.layers || []).length, cls: "is-ok" },
      { label: "基地面积", value: d.farm?.area_mu || "—", unit: "亩", cls: "is-run" },
      { label: "边缘节点", value: d.farm?.edge_nodes || "—", cls: "is-wait" },
      { label: "当前基地", value: d.farm?.name || "—", cls: "is-done" },
    ])}
    <div class="panel pg-card">
      ${pgCardHd("云-边-端总体架构", "点击进入关联模块")}
      <div class="loop-strip">${esc(d.loop)}</div>
      <div class="arch-grid">
        ${d.layers.map((layer) => `
          <div class="arch-card clickable" data-arch="${esc(layerJump[layer.name] || "dashboard")}">
            <div class="arch-title">${esc(layer.name)}</div>
            <div class="tags">${layer.items.map((i) => `<span class="tag">${esc(i)}</span>`).join("")}</div>
            <div class="sub" style="margin-top:8px">点击进入关联模块</div>
          </div>`).join("")}
      </div>
    </div>
    <div class="pg-split equal">
      <div class="panel pg-card">
        ${pgCardHd("边缘节点 Edge", "网关与互联")}
        <div class="item ok clickable" id="archDev">${esc(d.edge.gateway)}</div>
        <div class="item">${esc(d.edge.edge_ai)}</div>
        <div class="item">${esc(d.edge.cache)}</div>
        <div class="item">协议：${esc(d.edge.protocol)}</div>
        ${pgCardHd("田间互联主题", "MQTT / 主题")}
        ${d.edge.topics.map((t) => `<div class="item mono clickable" data-topic="1">${esc(t)}</div>`).join("")}
      </div>
      <div class="panel pg-card">
        ${pgCardHd("试验基地实施要点", d.farm?.name || "")}
        <div class="item">传感器网络 + 无人机巡田 + 智能水肥</div>
        <div class="item">边缘计算 + AI 决策中心</div>
        <div class="item warn"><b>目标场景，均未验证</b><div class="sub">节水约 20% · 识别目标约 89.5% · 巡检人工下降目标 50%+ · 增收目标 400–600 元/亩；须由基线、验证集与现场台账核验。</div></div>
        <div class="item">试验基地配置：${esc(d.farm.name)} · 模拟 ${Number(d.farm.area_mu || 0).toLocaleString("zh-CN")} 亩 · 规划边缘节点 ${d.farm.edge_nodes}</div>
      </div>
    </div>
    </div>`;
  view.querySelectorAll("[data-arch]").forEach((el) => {
    el.onclick = () => navigate({ page: el.dataset.arch, toast: ["架构联动", el.querySelector(".arch-title")?.textContent || "", "green"] });
  });
  document.getElementById("archDev").onclick = () => navigate({ page: "devices" });
  view.querySelectorAll("[data-topic]").forEach((el) => {
    el.onclick = () => navigate({ page: "devices", toast: ["田间互联", el.textContent, "green"] });
  });
  document.getElementById("archWall").onclick = () => {
    wallMode = true;
    try { localStorage.setItem("agrios-wall", "1"); } catch (e) {}
    FarmWall?.open();
    applyWallMode();
  };
  document.getElementById("archDash").onclick = () => navigate({ page: "dashboard" });
}

/* 顶栏现场状态定时自检；页面渲染时也会顺带刷新，这里兜住长时间停留的情况 */
refreshTopbarStatus();
setInterval(refreshTopbarStatus, 60000);

show("dashboard");
window.show = show;
window.toast = toast;
