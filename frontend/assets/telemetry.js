/* Vendor observations never pass through the local simulation engine. */
(function (global) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const date = (stamp) => stamp ? new Date(stamp).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai", hour12:false}) : "尚无记录";
  const statusNames = {healthy:"同步正常", degraded:"部分设备同步失败", error:"同步失败，保留历史数据", waiting:"等待首次同步", not_configured:"尚未配置厂家账号"};
  let generation = 0, timer, page = "", snapshot, selection = {device:"", property:"", hours:"1"};
  let points = [], historyRequest = 0, busy = 0;
  const root = () => document.getElementById("telemetry-root");
  async function get(path) {
    const requestUrl = (global.FarmApiBase && global.FarmApiBase.apiUrl)
      ? global.FarmApiBase.apiUrl(path)
      : path;
    const response = await fetch(requestUrl, {cache:"no-store", signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`数据服务暂不可用（${response.status}）`);
    return response.json();
  }
  /* 下拉框一条选项都没有时会塌成一个 38px 的箭头（实测「设备」「指标」两个都是），
     界面上分不清是「还没数据」还是「坏了」。这里始终塞一条说明用的占位项并置灰控件——
     占位项只讲状态，不代表任何读数，也不会被当成可选值提交。 */
  function fillSelect(select, options, note) {
    if (!select) return;
    if (options) { select.innerHTML = options; select.disabled = false; return; }
    select.innerHTML = `<option value="">${esc(note)}</option>`;
    select.disabled = true;
  }
  function quality(reading) {
    if (reading.stale) return "数据已过期";
    if (reading.quality === "CHECK_ZERO") return "零值待核查";
    if (reading.quality === "MISSING") return "读数缺失";
    return "厂家读数 · 未做现场校准核验";
  }
  const HIDDEN_METRICS = new Set(["0x05wzktrhum", "0x05wzktrtem"]);
  const PEST_PRIORITY = ["pestCount", "pestSpecies", "mode", "illumination", "dainfallRegime", "disinsectizingTemp", "dryingTemp", "lnglat"];
  const visibleReadings = (readings) => {
    const rows = (readings || []).filter(r => !HIDDEN_METRICS.has(r.property));
    return rows.slice().sort((a, b) => {
      const ia = PEST_PRIORITY.indexOf(a.property);
      const ib = PEST_PRIORITY.indexOf(b.property);
      if (ia === -1 && ib === -1) return String(a.property || "").localeCompare(String(b.property || ""));
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  };
  function readingValue(r) {
    if (r.property === "pestImage" && typeof r.value === "string" && /^https?:\/\//.test(r.value)) {
      return `<a class="tl-pest-thumb" href="${esc(r.value)}" target="_blank" rel="noopener noreferrer" title="打开识别图片"><img src="${esc(r.value)}" alt="虫情识别图片" loading="lazy" referrerpolicy="no-referrer"/></a>`;
    }
    return `<strong>${esc(r.formatted)}</strong>`;
  }
  function cards(devices, compact) {
    if (!devices.length) return '<p class="tl-empty">等待厂家设备列表和首次采集。未收到数据时不会填入仿真读数。</p>';
    return devices.map(d => {
      const readings = visibleReadings(d.readings).filter(r => !r.stale);
      const image = readings.find(r => r.property === "pestImage");
      const metrics = readings.filter(r => r.property !== "pestImage");
      return `<article class="tl-device${/虫情|Infestation/i.test(`${d.name || ""}${d.product_id || ""}`) ? " tl-pest" : ""}">
      <div class="tl-row"><h3>${esc(d.name)}</h3><span class="tl-tag ${d.status_stale ? "tl-warn" : ""}">${esc(d.status_stale ? "在线状态待更新" : d.online)}</span></div>
      <div class="tl-meta">${esc(d.did)} · ${esc(d.location)}</div>
      ${!compact && image ? readingValue(image) : ""}
      <div class="tl-readings">${metrics.length ? metrics.map(r=>`<div class="tl-reading ${r.quality === "CHECK_ZERO" ? "tl-flagged" : ""}">
        <span>${esc(r.name)}</span>${readingValue(r)}
        ${compact ? "" : `<small>${esc(quality(r))}</small><time>${esc(date(r.sample_time))}</time>`}
      </div>`).join("") : '<p class="tl-empty">厂家数据已过期，当前无可展示的实时读数；历史记录仍可查看。</p>'}</div>
      ${compact && metrics.length ? `<div class="tl-meta">${metrics.some(r=>r.quality === "CHECK_ZERO") ? "土壤零值待核查 · " : ""}${image ? "含识别图片 · " : ""}采集时间 ${esc(date(Math.max(0,...metrics.map(r=>r.sample_time))))}</div>` : ""}
    </article>`;
    }).join("");
  }
  function chart(records) {
    const rows = records.filter(r => typeof r.numeric_value === "number" && Number.isFinite(r.numeric_value));
    if (!rows.length) return '<p class="tl-empty">该指标暂无数值曲线，可在下方查看原始记录。</p>';
    const values = rows.map(r => r.numeric_value), min = Math.min(...values), max = Math.max(...values);
    const pad = Math.max((max-min)*0.1, Math.abs(max)*0.01, 0.1), low = min-pad, high = max+pad;
    const left = rows[0].sample_time, right = rows[rows.length-1].sample_time;
    const x = t => 65 + (t-left)/Math.max(1,right-left)*790;
    const y = v => 180 - (v-low)/(high-low)*145;
    let path = "", previous;
    rows.forEach(r => {
      path += `${previous && r.sample_time-previous.sample_time <= 300000 ? "L" : "M"}${x(r.sample_time).toFixed(2)},${y(r.numeric_value).toFixed(2)} `;
      previous = r;
    });
    const ticks = [low,(low+high)/2,high];
    return `<svg class="tl-chart" viewBox="0 0 900 235" role="img" aria-label="${esc(rows[0].name)}历史曲线，${esc(date(left))}至${esc(date(right))}，最小${min}，最大${max}">
      ${ticks.map(v=>`<line x1="65" x2="855" y1="${y(v)}" y2="${y(v)}" class="tl-gridline"/><text x="55" y="${y(v)+5}" text-anchor="end">${v.toFixed(2)}</text>`).join("")}
      <path d="${path}" class="tl-line"/>
      ${rows.length === 1 ? `<circle cx="${x(left)}" cy="${y(rows[0].numeric_value)}" r="4" class="tl-point"/>` : ""}
      <text x="65" y="215">${esc(date(left))}</text><text x="855" y="215" text-anchor="end">${esc(date(right))}</text>
    </svg>`;
  }
  function structure(compact) {
    /* 本周农事上方展示厂家设备卡片与读数（沿用此前完整面板样式）；历史曲线仍在设备/厂家接入页展开。 */
    return `<section class="tl-panel" aria-labelledby="tl-title">
      <div class="tl-row"><div><h2 id="tl-title">现场设备观测</h2></div>
      <div class="tl-strip-ops">
        <button type="button" class="btn ghost" id="tl-refresh">${compact ? "刷新" : "刷新已入库数据"}</button>
        ${compact ? '<button type="button" class="btn ghost" id="tl-detail">设备与曲线</button>' : ""}
      </div></div>
      <p class="tl-status" id="tl-status" role="status" aria-live="polite">正在读取本平台已同步数据…</p>
      <div class="tl-devices" id="tl-devices"></div>
      ${compact ? "" : `<p class="tl-note">仅查看厂家观测；地块位置尚未绑定。土壤温湿度零值需要核查探头或字段映射。下方农事与设备控制仍为仿真。</p>
      <div class="tl-history">
        <h3>历史观测</h3><div class="tl-filters">
          <label>设备<select id="tl-device" aria-label="历史设备" disabled><option value="">正在读取设备列表…</option></select></label>
          <label>指标<select id="tl-metric" aria-label="历史指标" disabled><option value="">正在读取指标…</option></select></label>
          <label>时间范围<select id="tl-hours" aria-label="历史时间范围"><option value="1">最近 1 小时</option><option value="6">最近 6 小时</option><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select></label>
          <button type="button" class="btn ghost" id="tl-export" disabled>导出当前曲线记录</button>
        </div><p class="tl-meta" id="tl-history-status" role="status" aria-live="polite"></p>
        <div id="tl-chart"><p class="tl-empty">正在读取曲线数据…</p></div><details><summary>查看最近 20 条原始读数</summary><div class="tl-table-wrap" id="tl-table"><p class="tl-empty">正在读取原始记录…</p></div></details>
      </div>`}
    </section>`;
  }
  function metrics() {
    const metric = document.getElementById("tl-metric");
    const device = snapshot.devices.find(d=>d.did === selection.device);
    if (!metric) return;
    const readings = visibleReadings(device?.readings);
    if (!readings.some(r=>r.property === selection.property)) selection.property = readings[0]?.property || "";
    fillSelect(metric, readings.map(r=>`<option value="${esc(r.property)}">${esc(r.name)}${r.unit ? `（${esc(r.unit)}）` : ""}</option>`).join(""), "该设备暂无已入库指标");
    if (readings.length) metric.value = selection.property;
  }
  async function history() {
    const message = document.getElementById("tl-history-status"), own = ++historyRequest;
    if (!message) return;
    points = [];
    document.getElementById("tl-export").disabled = true;
    document.getElementById("tl-chart").innerHTML = '<p class="tl-empty">正在读取曲线数据…</p>';
    document.getElementById("tl-table").innerHTML = '<p class="tl-empty">正在读取原始记录…</p>';
    if (!selection.device || !selection.property) {
      message.textContent = "等待设备指标首次入库。";
      /* 选不出设备/指标时曲线区必须自己说清楚，不能留一片空白让人以为是没渲染出来 */
      document.getElementById("tl-chart").innerHTML = '<p class="tl-empty">尚无已入库的设备指标，暂无曲线。此处不填仿真读数。</p>';
      document.getElementById("tl-table").innerHTML = '<p class="tl-empty">尚无已入库的原始记录。</p>';
      return;
    }
    message.textContent = "正在读取历史记录…";
    try {
      const end = Date.now(), start = end - Number(selection.hours)*3600000;
      const query = new URLSearchParams({device:selection.device,property:selection.property,start:String(start),end:String(end),limit:"2000"});
      const result = await get(`/api/telemetry/history?${query}`);
      if (own !== historyRequest || !message.isConnected) return;
      points = result.points;
      message.textContent = `${points.length} 条已入库记录${result.has_more ? "（仅展示最近 2000 条）" : ""} · 北京时间 · 历史补数进度：${date(result.synced_until)}。曲线只表示已收到的观测。`;
      document.getElementById("tl-chart").innerHTML = chart(points);
      document.getElementById("tl-table").innerHTML = `<table><thead><tr><th>采集时间</th><th>指标</th><th>读数</th><th>数据质量</th></tr></thead><tbody>${points.slice(-20).reverse().map(r=>`<tr><td>${esc(date(r.sample_time))}</td><td>${esc(r.name)}</td><td>${esc(r.formatted)}</td><td>${esc(r.quality === "CHECK_ZERO" ? "零值待核查" : r.quality === "MISSING" ? "缺失" : "厂家观测，未校准核验")}</td></tr>`).join("")}</tbody></table>`;
      document.getElementById("tl-export").disabled = !points.length;
    } catch (error) {
      if (own === historyRequest && message.isConnected) message.textContent = error.message + "；没有使用仿真历史替代。";
    }
  }
  async function refresh(own) {
    if (busy === own || own !== generation || !root()) return;
    busy = own;
    try {
      const data = await get("/api/telemetry/devices");
      if (own !== generation) return;
      snapshot = data;
      const s = data.status, message = document.getElementById("tl-status");
      if (!message) return;
      const expiredCount = data.devices.reduce((count, device) => count + visibleReadings(device.readings).filter(reading => reading.stale).length, 0);
      message.textContent = `${expiredCount ? "部分设备读数已过期" : (statusNames[s.status] || "状态待核查")} · ${data.devices.length} 台设备 · 后台每 ${s.poll_seconds} 秒采集 · 最近成功同步：${date(s.last_success)}`;
      if (!s.configured) message.textContent = "尚未配置厂家账号。请在服务器 .env 中填写账号密码，并使用 start.bat 启动。";
      if (s.configured && !s.running) message.textContent += " · 采集任务未运行";
      const issues = [...(s.errors || []), ...(s.history_errors || [])];
      if (issues.length) message.textContent += ` · ${issues[0].message}`;
      message.classList.toggle("tl-warn", issues.length > 0 || expiredCount > 0 || !s.configured);
      const deviceList = document.getElementById("tl-devices");
      if (deviceList) deviceList.innerHTML = cards(data.devices, page === "dashboard");
      const select = document.getElementById("tl-device");
      if (select) {
        if (!data.devices.some(d=>d.did === selection.device)) selection.device = data.devices[0]?.did || "";
        fillSelect(select, data.devices.map(d=>`<option value="${esc(d.did)}">${esc(d.name)} · ${esc(d.did)}</option>`).join(""), "厂家尚未返回设备");
        if (data.devices.length) select.value = selection.device;
        metrics();
        await history();
      }
    } catch (error) {
      if (own !== generation) return;
      const message = document.getElementById("tl-status");
      if (message) {
        message.classList.add("tl-warn");
        message.textContent = "无法读取真实数据服务。请使用 start.bat 启动平台；连接中断期间不更新读数。";
      }
      const stale = document.getElementById("tl-devices");
      if (snapshot && stale) stale.innerHTML = cards(snapshot.devices.map(d=>({...d,status_stale:true,readings:d.readings.map(r=>({...r,stale:true}))})), page === "dashboard");
      /* 首次就连不上时没有 snapshot，设备区、两个下拉框、曲线区会同时是彻底空白，
         界面上分不清「没数据」和「界面坏了」。这几处各自写明状态，措辞照旧不承诺任何读数。 */
      if (!snapshot && stale) stale.innerHTML = '<p class="tl-empty">未连接数据服务，没有可展示的设备。此处不填仿真读数。</p>';
      fillSelect(document.getElementById("tl-device"), "", "未连接数据服务");
      fillSelect(document.getElementById("tl-metric"), "", "未连接数据服务");
      const histNote = document.getElementById("tl-history-status");
      if (histNote) histNote.textContent = "未连接数据服务，历史曲线不可用；没有使用仿真历史替代。";
      const chartBox = document.getElementById("tl-chart");
      if (chartBox) chartBox.innerHTML = '<p class="tl-empty">未连接数据服务，暂无曲线。</p>';
      const tableBox = document.getElementById("tl-table");
      if (tableBox) tableBox.innerHTML = '<p class="tl-empty">未连接数据服务，暂无原始记录。</p>';
      const exportBtn = document.getElementById("tl-export");
      if (exportBtn) exportBtn.disabled = true;
    } finally { if (busy === own) busy = 0; }
  }
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g,'""') + '"';
  }
  function exportCsv() {
    const rows = [["设备编号","指标标识","指标","采集时间(北京时间)","原始值","单位","质量标记"],
      ...points.map(r=>[r.did,r.property,r.name,date(r.sample_time),r.value,r.unit,r.quality])];
    const url = URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "真实设备历史记录.csv"; anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function setPage(next) {
    clearInterval(timer); generation++; historyRequest++;
    page = next; const container = root(); if (!container) return;
    const visible = ["dashboard","devices","vendors"].includes(page);
    container.hidden = !visible;
    if (!visible) { container.innerHTML = ""; return; }
    container.innerHTML = structure(page === "dashboard");
    const own = generation;
    document.getElementById("tl-refresh").onclick = ()=>refresh(own);
    document.getElementById("tl-detail")?.addEventListener("click", ()=>global.navigate({page:"devices"}));
    document.getElementById("tl-device")?.addEventListener("change", event=>{selection.device=event.target.value;metrics();history();});
    document.getElementById("tl-metric")?.addEventListener("change", event=>{selection.property=event.target.value;history();});
    const hours = document.getElementById("tl-hours");
    if (hours) { hours.value=selection.hours; hours.onchange=()=>{selection.hours=hours.value;history();}; }
    document.getElementById("tl-export")?.addEventListener("click", exportCsv);
    refresh(own);
    timer = setInterval(()=>{if(!document.hidden) refresh(own);},30000);
  }
  global.FarmTelemetry = {setPage};
  if (typeof module !== "undefined") module.exports = {esc,chart,quality,csvCell,cards};
})(typeof window !== "undefined" ? window : globalThis);
