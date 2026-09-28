/**
 * 共享田间地理：克拉玛依区白云一路与蓝天二路交叉口示意地块（非测绘边界）。
 * 供态势大屏与看田地图共用。
 */
(function (global) {
  "use strict";

  const MAP_CENTER = [45.43288, 84.93065];
  const IMAGERY_URL =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const VECTOR_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const ADDRESS = "新疆克拉玛依市克拉玛依区 · 白云一路与蓝天二路交叉口";

  const PLOT_LL = (() => {
    const gc = MAP_CENTER;
    const ang = 41.5;
    const cW = 920;
    const cH = 980;
    const cols = 3;
    const rows = 2;
    const mLat = 111320;
    const mLng = 111320 * Math.cos((gc[0] * Math.PI) / 180);
    const rad = (ang * Math.PI) / 180;
    const co = Math.cos(rad);
    const si = Math.sin(rad);
    const tW = cols * cW;
    const tH = rows * cH;
    const toLL = (x, y) => {
      const rx = x * co - y * si;
      const ry = x * si + y * co;
      return [gc[0] + ry / mLat, gc[1] + rx / mLng];
    };
    const layout = {
      "A-01": [0, 0],
      "A-02": [0, 1],
      "B-02": [0, 2],
      "C-02": [1, 0],
      "C-01": [1, 1],
      "B-01": [1, 2],
    };
    const out = {};
    Object.entries(layout).forEach(([code, [row, col]]) => {
      const x0 = -tW / 2 + col * cW;
      const y0 = -tH / 2 + row * cH;
      const coords = [toLL(x0, y0), toLL(x0 + cW, y0), toLL(x0 + cW, y0 + cH), toLL(x0, y0 + cH)];
      out[code] = {
        coords,
        center: [(coords[0][0] + coords[2][0]) / 2, (coords[0][1] + coords[2][1]) / 2],
      };
    });
    return out;
  })();

  const INFRA_LL = {
    "WX-001": [MAP_CENTER[0] - 0.0018, MAP_CENTER[1] - 0.0042],
    "RAIN-001": [MAP_CENTER[0] - 0.0016, MAP_CENTER[1] - 0.0032],
    "PUMP-001": [MAP_CENTER[0] - 0.0014, MAP_CENTER[1] - 0.0022],
    "FLOW-001": [MAP_CENTER[0] - 0.0012, MAP_CENTER[1] - 0.0012],
  };

  const FLEET_TYPES = new Set([
    "tractor",
    "drone",
    "sprayer",
    "robot",
    "yield",
    "harvester",
    "seeder",
    "transport",
  ]);

  function isFleetUnit(device) {
    if (!device || device.mesh) return false;
    if (String(device.asset_state || "") === "planned") return false;
    return FLEET_TYPES.has(String(device.device_type || ""));
  }

  function slotLatLng(item, landCode, slotIndex, slotTotal) {
    if (item && item.code && INFRA_LL[item.code]) return INFRA_LL[item.code];
    const geo = PLOT_LL[landCode];
    if (!geo) {
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
    const cosLat = Math.cos((geo.center[0] * Math.PI) / 180) || 0.7;
    return [
      geo.center[0] + Math.cos(ang) * radius,
      geo.center[1] + (Math.sin(ang) * radius) / cosLat,
    ];
  }

  function ensureLeaflet() {
    if (global.L) return Promise.resolve(global.L);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-farm-leaflet="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(global.L));
        existing.addEventListener("error", () => reject(new Error("Leaflet load failed")));
        return;
      }
      const script = document.createElement("script");
      script.src = "assets/vendor/leaflet/leaflet.js";
      script.dataset.farmLeaflet = "1";
      script.onload = () => resolve(global.L);
      script.onerror = () => reject(new Error("Leaflet load failed"));
      document.head.appendChild(script);
    });
  }

  global.FarmGeo = Object.freeze({
    MAP_CENTER,
    IMAGERY_URL,
    VECTOR_URL,
    ADDRESS,
    PLOT_LL,
    INFRA_LL,
    FLEET_TYPES,
    isFleetUnit,
    slotLatLng,
    ensureLeaflet,
  });
})(window);
