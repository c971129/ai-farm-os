/* Resolve API origin for split deploy (e.g. JSDMirror frontend + remote backend).
   Priority: ?api= → meta[name=ai-farm-api-base] → window.__AI_FARM_API_BASE__ → same origin. */
(function (global) {
  "use strict";

  function normalize(value) {
    const text = String(value || "").trim().replace(/\/+$/, "");
    if (!text) return "";
    try {
      const url = new URL(text);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.origin;
    } catch (_) {
      return "";
    }
  }

  function fromQuery() {
    try {
      return normalize(new URLSearchParams(global.location.search).get("api"));
    } catch (_) {
      return "";
    }
  }

  function fromMeta() {
    const node = global.document && global.document.querySelector('meta[name="ai-farm-api-base"]');
    return normalize(node && node.getAttribute("content"));
  }

  function fromGlobal() {
    return normalize(global.__AI_FARM_API_BASE__);
  }

  const base = fromQuery() || fromMeta() || fromGlobal() || "";

  function apiUrl(path) {
    const raw = String(path || "");
    if (/^https?:\/\//i.test(raw)) return raw;
    const suffix = raw.startsWith("/") ? raw : `/${raw}`;
    return base ? `${base}${suffix}` : suffix;
  }

  global.FarmApiBase = { base, apiUrl };
})(window);
