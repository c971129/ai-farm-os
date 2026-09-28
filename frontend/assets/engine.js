(function (global) {
  const farm = {
    id: 1,
    name: "新疆AI无人智慧农场",
    region: "新疆·克拉玛依试验田",
    area_mu: 2000,
    crop_focus: "棉花 / 玉米 / 小麦",
    status: "沙箱模式",
    edge_nodes: 3,
    mqtt_online: true,
  };

  const farmsCatalog = [
    { id: "f1", name: "克拉玛依试验田", region: "新疆·克拉玛依试验田", area_mu: 2000, crop_focus: "棉花 / 玉米 / 小麦", edge_nodes: 3, land_codes: ["A-01", "A-02", "B-01", "B-02", "C-01", "C-02"] },
    { id: "f2", name: "阿克苏", region: "新疆·阿克苏灌区", area_mu: 1600, crop_focus: "棉花 / 玉米", edge_nodes: 2, land_codes: ["A-01", "B-01", "B-02"] },
    { id: "f3", name: "石河子", region: "新疆·石河子垦区", area_mu: 1800, crop_focus: "棉花 / 小麦 / 玉米", edge_nodes: 3, land_codes: ["A-02", "C-01", "C-02"] },
  ];
  let farmId = "f1";
  let selectedJointId = "JOINT-001";

  function applyFarm(id) {
    const f = farmsCatalog.find((x) => x.id === id) || farmsCatalog[0];
    farmId = f.id;
    farm.name = f.name.replace(/（.*）/, "") || "新疆AI无人智慧农场";
    farm.region = f.region;
    farm.area_mu = f.area_mu;
    farm.crop_focus = f.crop_focus;
    farm.edge_nodes = f.edge_nodes;
    const board = buildLandBoard();
    const pending = board.filter((b) => b.level !== "ok" && b.level !== "watch").length;
    return {
      farmId,
      farm: { ...farm, land_count: board.length, pending_count: pending },
      catalog: farmsWithStats(),
      land_board: board,
    };
  }

  function currentLands() {
    const f = farmsCatalog.find((x) => x.id === farmId) || farmsCatalog[0];
    const set = new Set(f.land_codes || lands.map((l) => l.code));
    return lands.filter((l) => set.has(l.code));
  }

  function landUrgencyOf(l) {
    if (l.crop_name === "棉花" && String(l.stage || "").includes("吐絮")) {
      const openBoll = Number(l.open_boll || 0);
      const windowState = openBoll < 30
        ? "低于参考区间（不是处方阈值）"
        : openBoll <= 40
          ? "进入参考复核区间，须以属地规则和现场样方判定"
          : "高于参考复核区间，须记录现场依据并由农艺师判定";
      return {
        level: "defoliant",
        score: openBoll < 30 ? 82 : openBoll <= 40 ? 92 : 78,
        tag: "脱叶待核实",
        task_type: "农艺复核",
        cls: "red",
        action: "defoliant",
        jump: "fleet",
        reason: `开絮模拟 ${openBoll}% · ${windowState}`,
        cta: "补齐脱叶证据",
        when: "今天",
        day_offset: 0,
        plan_slot: "待天气、标签与样方核验",
        resource: "SPRAY-002 · UAV-001",
        priority_label: "高",
        agent: "农艺复核建议",
        agent_tip: "需核验未来 7 天温度、风雨、药剂标签、品种长势、剂量与人工批准；当前禁止自动执行",
        confidence: "待核实",
        decision: "NO_GO",
        executable: false,
        evidence_status: "缺失",
        required_evidence: ["开絮率采样记录", "7 日逐小时天气", "药剂登记与标签", "剂量复核", "责任人批准"],
        stop_condition: "天气缺失、最低温不足、风雨超限、剂量未审或现场未清场",
        accountable_person: "待指派农艺师/场长",
        due_at: "2026-09-14 18:00",
        rule_source: "候选依据名称：库尔勒棉花脱叶催熟技术意见（待绑定可核验原文）",
        rule_version: "UNBOUND",
        rule_source_status: "UNVERIFIED",
      };
    }
    if (l.crop_name === "玉米" && l.stage === "成熟期") {
      return {
        level: "harvest",
        score: 88,
        tag: "机收待核实",
        task_type: "收获评估",
        cls: "orange",
        action: "harvest",
        jump: "fleet",
        reason: `模拟籽粒含水约 ${l.grain_moisture != null ? l.grain_moisture : "--"}%`,
        cta: "补齐收获证据",
        when: "明天",
        day_offset: 1,
        plan_slot: "待成熟、试收与道路核验",
        resource: "HARVEST-001 · TRUCK-001",
        priority_label: "紧急",
        agent: "调度建议",
        agent_tip: `${(l.grain_moisture || 0) > 25 ? "模拟含水值高于 25%，需优先核验摘穗/烘干条件" : "模拟含水值不高于 25%，仍须成熟与试收证据"}；未核验前禁止自动执行`,
        confidence: "待核实",
        decision: "NO_GO",
        executable: false,
        evidence_status: "缺失",
        required_evidence: ["黑层/乳线成熟证据", "校准含水率", "试收损失率", "破碎率/含杂率", "运输与烘干产能"],
        stop_condition: "夜间/降雨、道路不可通行、试收损失超限、烘干或仓容不足",
        accountable_person: "待指派机务负责人",
        due_at: "2026-09-15 07:30",
        rule_source: "候选依据名称：玉米机械化收获减损技术意见（待绑定可核验原文）",
        rule_version: "UNBOUND",
        rule_source_status: "UNVERIFIED",
      };
    }
    if (l.crop_name === "小麦" && String(l.stage || "").includes("适播")) {
      return {
        level: "sow",
        score: 75,
        tag: "区域规则待核实",
        task_type: "播种评估",
        cls: "orange",
        action: "sow",
        jump: "tasks",
        reason: "库尔勒地块尚未绑定经本地农技负责人批准的南疆种植制度模板",
        cta: "补齐区域模板",
        when: "本周内",
        day_offset: 3,
        plan_slot: "待本地模板与底墒核验",
        resource: "TRACTOR-001 · SEEDER-001",
        priority_label: "高",
        agent: "农艺建议",
        agent_tip: "不得套用北疆播期；需确认 agro_zone、种植制度、品种目录、千粒重与目标基本苗",
        confidence: "待核实",
        decision: "NO_GO",
        executable: false,
        evidence_status: "区域规则缺失",
        required_evidence: ["农业生态区编码", "种植制度", "本地品种目录版本", "种子批次与发芽率", "千粒重与目标基本苗"],
        stop_condition: "区域模板未批准、底墒或种子质量不合格",
        accountable_person: "待指派本地农艺师",
        due_at: "待本地模板确认",
        rule_source: "候选依据名称：小麦大面积单产提升技术手册（待绑定可核验原文及属地条款）",
        rule_version: "UNBOUND",
        rule_source_status: "UNVERIFIED",
      };
    }
    if (typeof l.moisture === "number" && l.moisture < 22) {
      return {
        level: "irrigation",
        score: 70 + (22 - l.moisture),
        tag: "墒情待复核",
        task_type: "水肥评估",
        cls: "orange",
        action: "irrigation",
        jump: "water",
        reason: `含水模拟 ${l.moisture}%，但缺少作物/生育期专用水分模型`,
        cta: "补齐水肥输入",
        when: l.moisture < 18 ? "今天" : "明天",
        day_offset: l.moisture < 18 ? 0 : 1,
        plan_slot: "待水量模型与阀泵状态核验",
        resource: "泵房轮灌",
        priority_label: "高",
        agent: "水肥建议",
        agent_tip: "需田间持水量、根层、有效降雨、ETc、滴灌效率与传感器 QC；当前禁止自动执行",
        confidence: "待核实",
        decision: "NO_GO",
        executable: false,
        evidence_status: "关键输入缺失",
        required_evidence: ["田间持水量", "根层深度", "有效降雨", "ETc", "灌溉效率", "传感器 QC"],
        stop_condition: "传感器过期/异常、土壤通行性不足、作物阶段不匹配",
        accountable_person: "待指派水肥负责人",
        due_at: "2026-09-14 17:00",
        rule_source: "候选依据名称：水肥一体化技术指导意见（待绑定可核验原文及本地参数）",
        rule_version: "UNBOUND",
        rule_source_status: "UNVERIFIED",
      };
    }
    if ((l.pest_risk || 0) > 45) {
      return {
        level: "vision",
        score: 55 + (l.pest_risk || 0) / 5,
        tag: "调查待补充",
        task_type: "巡田",
        cls: "orange",
        action: "scout",
        jump: "diagnosis",
        reason: `风险模拟值 ${l.pest_risk}，尚无物种、虫态、密度与经济阈值证据`,
        cta: "补齐调查与飞行证据",
        when: "本周内",
        day_offset: 2,
        plan_slot: "待飞行前证据与人工门禁核验",
        resource: "UAV-002",
        priority_label: "中",
        agent: "看田建议",
        agent_tip: "先核验空域、航线、天气、电池、返航点与人员隔离；调查产出齐全前不得形成施药处方",
        confidence: "待核实",
        decision: "NO_GO",
        executable: false,
        evidence_status: "飞行前证据与调查证据均缺失",
        required_evidence: ["空域与航线批准", "风速/能见度/降水", "电池/RTK/返航点", "人员隔离", "防治对象", "虫态/病级", "调查方法", "样点与密度", "当地经济阈值"],
        stop_condition: "禁飞天气、空域/人员未确认、调查证据不足",
        accountable_person: "植保员（待指派）",
        due_at: "本周内",
      };
    }
    if (l.crop_name === "玉米" && l.stage === "乳熟期") {
      return {
        level: "watch",
        score: 25,
        tag: "待现场核验",
        task_type: "巡田",
        cls: "blue",
        action: "watch",
        jump: "twin",
        reason: "模拟数据未触发规则；现场物候、墒情与病虫调查尚未核验",
        cta: "核对地块证据",
        when: "周末前",
        day_offset: 5,
        plan_slot: "按巡田计划",
        resource: "—",
        priority_label: "低",
        agent: "看田建议",
        agent_tip: "先核验现场物候、墒情、病虫调查和数据质量，再决定是否维持管护方案",
        confidence: "待核实",
        decision: "OBSERVATION_ONLY",
        executable: false,
        evidence_status: "现场观测缺失",
        required_evidence: ["物候调查", "墒情采样与质量码", "病虫调查", "责任人复核"],
      };
    }
    return {
      level: "ok",
      score: 0,
      tag: "待现场核验",
      task_type: "巡田",
      cls: "green",
      action: "watch",
      jump: "twin",
      reason: "模拟数据未触发规则，不能据此判断现场正常或达标",
      cta: "核对地块证据",
      when: "本周内",
      day_offset: 4,
      plan_slot: "按巡田计划",
      resource: "—",
      priority_label: "低",
      agent: "规则引擎",
      agent_tip: "请核验观测来源、时间、单位、质量码及现场调查后再形成结论",
      confidence: "待核实",
      decision: "OBSERVATION_ONLY",
      executable: false,
      evidence_status: "生产观测未接入",
      required_evidence: ["观测来源", "观测时间", "单位与采样深度", "质量码", "现场复核"],
    };
  }

  /** 人在环闸门：建议→补证→人工确认→回放队列→回执核查→验收留痕。 */
  const SAFETY_LOCK_KEY = "agrios-emergency-lock-v1";

  function storedEmergencyLock() {
    try {
      return !!(global.localStorage && global.localStorage.getItem(SAFETY_LOCK_KEY) === "1");
    } catch (_) {
      return false;
    }
  }

  function persistEmergencyLock(locked) {
    try {
      if (global.localStorage) global.localStorage.setItem(SAFETY_LOCK_KEY, locked ? "1" : "0");
    } catch (_) {
      /* 浏览器存储不可用时仍保留本次会话内的软件锁。 */
    }
  }

  const initialEmergencyLock = storedEmergencyLock();
  let humanGate = {
    auto_paused: initialEmergencyLock,
    emergency_locked: initialEmergencyLock,
    safety_review: null,
    command_seq: 0,
    vetoed: {},
    deferred: {},
    halted: {},
    running: {},
    dispatched: {},
    accepting: {},
    completed: {},
    last_action: null,
    last_at: "",
    log: [],
    cmd_log: [],
  };

  function commandId(prefix) {
    humanGate.command_seq += 1;
    return `${prefix || "SIM"}-${String(humanGate.command_seq).padStart(4, "0")}`;
  }

  function safeFailure(code, message, extra) {
    return {
      ok: false,
      error_code: code,
      retryable: false,
      message,
      ...(extra || {}),
    };
  }

  function declaredExpertIdentity(body) {
    const reviewerId = String(body.reviewer_id || "").trim();
    const qualificationScope = String(body.qualification_scope || "").trim();
    const credentialRef = String(body.credential_ref || "").trim();
    const evidenceRefs = (Array.isArray(body.evidence_refs) ? body.evidence_refs : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    if (reviewerId.length < 2 || qualificationScope.length < 2 || credentialRef.length < 3 || !evidenceRefs.length) {
      return { ok: false, error: safeFailure("EXPERT_IDENTITY_REQUIRED", "专家初审必须提交签核人、资质范围、资质/授权凭证编号及至少一个证据引用；页面角色不能替代身份认证") };
    }
    return {
      ok: true,
      value: {
        reviewer_id: reviewerId.slice(0, 40),
        qualification_scope: qualificationScope.slice(0, 40),
        credential_ref: credentialRef.slice(0, 80),
        evidence_refs: evidenceRefs.map((item) => item.slice(0, 120)),
        identity_assurance: "DECLARED_UNVERIFIED",
        gate_scope: "ADVISORY_ONLY",
      },
    };
  }

  function currentFarmOwnsLand(code) {
    return code === "全场" || currentLands().some((land) => land.code === code);
  }

  function currentFarmOwnsDevice(device) {
    if (!device) return false;
    const locationIsLand = lands.some((land) => land.code === device.location);
    return !locationIsLand || currentFarmOwnsLand(device.location);
  }

  function isEmergencyBlocked(path, method, body) {
    if (method === "GET" || !humanGate.emergency_locked) return false;
    if (path === "/api/lands/execute" || path === "/api/robots/dispatch" || path === "/api/irrigation/apply") return true;
    if (path === "/api/season/advance" || path === "/api/fleet/advance" || path === "/api/postharvest/advance") return true;
    if (path.startsWith("/api/devices/") && path.endsWith("/control")) {
      return !["stop", "close", "idle"].includes(String(body.action || "").toLowerCase());
    }
    if (path === "/api/human/decide") {
      return ["approve", "start", "begin", "resume_one", "continue", "resume_halted", "resume_batch"].includes(body.action);
    }
    return false;
  }

  function weekRangeLabel() {
    const start = new Date();
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    return `${fmt(start)}–${fmt(end)}`;
  }

  function buildWeekDays() {
    const wd = ["日", "一", "二", "三", "四", "五", "六"];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + i);
      days.push({
        key: `d${i}`,
        offset: i,
        label: i === 0 ? "今天" : i === 1 ? "明天" : `周${wd[d.getDay()]}`,
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        weekday: wd[d.getDay()],
        is_today: i === 0,
      });
    }
    return days;
  }

  function whenFromOffset(offset) {
    if (offset <= 0) return "今天";
    if (offset === 1) return "明天";
    if (offset <= 3) return "本周内";
    return "周末前";
  }

  function buildWeekPlan(list) {
    const board = buildLandBoard(list);
    const cal = buildWeekDays();
    const conflictPack = {
      lands: ["B-01", "B-02"],
      level: "中",
      text: "排程草案显示 B-01 脱叶复核与 B-02 机收转运可能共用道路时段",
      resolve: "先补齐两项作业证据，再由场长与机务负责人确认错峰安排",
      resource: "田间主干道 / 机具编队时段",
      jump: "fleet",
      options: [
        { id: "defer_b02", label: "B-02 改期至午后", action: "defer", land: "B-02" },
        { id: "focus", label: "只看冲突地块", action: "focus" },
      ],
    };
    const boardItems = board
      .filter((b) => !humanGate.vetoed[b.code])
      .map((b) => {
        const deferred = !!humanGate.deferred[b.code];
        const halted = !!humanGate.halted[b.code];
        const ruleBlocked = b.executable === false;
        const accepting = !ruleBlocked && !!humanGate.accepting[b.code] && !halted;
        const running = !ruleBlocked && !!humanGate.running[b.code] && !halted && !accepting;
        const dispatched = !ruleBlocked && !!humanGate.dispatched[b.code] && !running && !halted && !accepting;
        const completed = !ruleBlocked && !!humanGate.completed[b.code] && !halted && !running && !accepting;
        const needsOk = b.level !== "ok" && b.level !== "watch";
        let day_offset = deferred ? 6 : typeof b.day_offset === "number" ? b.day_offset : 3;
        day_offset = Math.max(0, Math.min(6, day_offset));
        const dayMeta = cal[day_offset] || cal[0];
        const urgency =
          b.priority_label ||
          (b.score >= 85 ? "紧急" : b.score >= 55 || needsOk ? "高" : "低");
        let run_state = "ok";
        let state = "巡田中";
        if (halted) {
          run_state = "paused";
          state = "已暂停";
        } else if (accepting) {
          run_state = "accepting";
          state = "待验收";
        } else if (running) {
          run_state = "running";
          state = "执行中";
        } else if (completed) {
          run_state = "done";
          state = "已验收";
        } else if (dispatched) {
          run_state = "queued";
          state = "待人工确认";
        } else if (deferred) {
          run_state = "deferred";
          state = "已改期";
        } else if (needsOk) {
          run_state = humanGate.auto_paused || humanGate.emergency_locked ? "locked" : "pending";
          state = humanGate.emergency_locked ? "安全锁定" : humanGate.auto_paused ? "批量已锁" : (ruleBlocked ? "证据待补" : "待登记");
        }
        const inConflict = conflictPack.lands.includes(b.code) || !!b.conflict;
        return {
          ...b,
          task_type: b.task_type || (needsOk ? "农事" : "巡田"),
          plan_slot: b.plan_slot || (day_offset === 0 ? "07:00–18:00" : "按日计划"),
          resource: b.resource || "—",
          priority_label: urgency,
          when: dayMeta.label,
          day_offset,
          day_key: dayMeta.key,
          day_date: dayMeta.date,
          urgency,
          agent: b.agent || "推荐",
          agent_tip: b.agent_tip || b.reason,
          confidence: b.confidence || "中",
          deferred,
          halted,
          running,
          dispatched,
          accepting,
          completed,
          run_state,
          state,
          conflict: inConflict,
          conflict_text: inConflict ? conflictPack.text : "",
          needs_confirm: needsOk && !running && !halted && !completed && !dispatched && !accepting,
          can_dispatch: (run_state === "pending" || run_state === "locked") && !humanGate.emergency_locked,
          can_start: b.executable === true && b.decision === "GO_APPROVED" && run_state === "queued",
          can_pause: b.executable === true && b.decision === "GO_APPROVED" && run_state === "running",
          can_resume: b.executable === true && b.decision === "GO_APPROVED" && run_state === "paused",
          can_complete: b.executable === true && b.decision === "GO_APPROVED" && run_state === "running",
          can_accept: b.executable === true && b.decision === "GO_APPROVED" && run_state === "accepting",
          can_defer: run_state === "pending" || run_state === "queued",
          can_cancel: run_state === "pending" || run_state === "queued" || run_state === "paused",
          halt_at: (humanGate.halted[b.code] && humanGate.halted[b.code].at) || "",
          halt_reason: (humanGate.halted[b.code] && humanGate.halted[b.code].reason) || "",
          run_title: (humanGate.running[b.code] && humanGate.running[b.code].title) || "",
          cmd_status: (humanGate.running[b.code] && humanGate.running[b.code].cmd_status) ||
            (humanGate.halted[b.code] && humanGate.halted[b.code].cmd_status) ||
            "",
        };
      });

    const extraItems = extraWeekJobs.map((job) => {
      const gateKey = job.job_key || `${job.code}-${job.tag || job.task_type}`;
      const landCode = job.code;
      const safety = operationSafety(job);
      const deferred = !!humanGate.deferred[gateKey];
      const halted = !!humanGate.halted[gateKey];
      const accepting = !!humanGate.accepting[gateKey] && !halted;
      const running = !!humanGate.running[gateKey] && !halted && !accepting;
      const dispatched = !!humanGate.dispatched[gateKey] && !running && !halted && !accepting;
      const completed = safety.executable === true && safety.decision === "GO_APPROVED" && !!humanGate.completed[gateKey] && !halted && !running && !accepting;
      let day_offset = deferred ? 6 : typeof job.day_offset === "number" ? job.day_offset : 2;
      day_offset = Math.max(0, Math.min(6, day_offset));
      const dayMeta = cal[day_offset] || cal[0];
      const needsOk = true;
      let run_state = "pending";
      let state = safety.executable ? "待登记" : "证据待补";
      if (halted) {
        run_state = "paused";
        state = "已暂停";
      } else if (accepting) {
        run_state = "accepting";
        state = "待验收";
      } else if (running) {
        run_state = "running";
        state = "执行中";
      } else if (completed) {
        run_state = "done";
        state = "已验收";
      } else if (dispatched) {
        run_state = "queued";
        state = "待人工确认";
      } else if (deferred) {
        run_state = "deferred";
        state = "已改期";
      } else if (humanGate.auto_paused || humanGate.emergency_locked) {
        run_state = "locked";
        state = humanGate.emergency_locked ? "停机锁定" : "批量已锁";
      }
      const inConflict = !!job.conflict || conflictPack.lands.includes(landCode);
      return {
        ...job,
        ...safety,
        code: gateKey,
        land_code: landCode,
        name: `${landCode} · ${job.tag || job.task_type}`,
        score: job.score || 60,
        level: job.level || "watch",
        task_type: job.task_type || "农事",
        plan_slot: job.plan_slot || "按日计划",
        resource: job.resource || "—",
        priority_label: job.priority_label || "中",
        when: dayMeta.label,
        day_offset,
        day_key: dayMeta.key,
        day_date: dayMeta.date,
        urgency: job.priority_label || "中",
        agent: job.agent || "推荐",
        agent_tip: job.agent_tip || job.reason,
        confidence: "中",
        deferred,
        halted,
        running,
        dispatched,
        accepting,
        completed,
        run_state,
        state,
        conflict: inConflict,
        conflict_text: inConflict ? conflictPack.text : "",
        needs_confirm: needsOk && run_state === "pending",
        can_dispatch: (run_state === "pending" || run_state === "locked") && !humanGate.emergency_locked,
        can_start: safety.executable === true && safety.decision === "GO_APPROVED" && run_state === "queued",
        can_pause: safety.executable === true && safety.decision === "GO_APPROVED" && run_state === "running",
        can_resume: safety.executable === true && safety.decision === "GO_APPROVED" && run_state === "paused",
        can_complete: safety.executable === true && safety.decision === "GO_APPROVED" && run_state === "running",
        can_accept: safety.executable === true && safety.decision === "GO_APPROVED" && run_state === "accepting",
        can_defer: run_state === "pending" || run_state === "queued",
        can_cancel: run_state === "pending" || run_state === "queued" || run_state === "paused",
        halt_at: (humanGate.halted[gateKey] && humanGate.halted[gateKey].at) || "",
        halt_reason: (humanGate.halted[gateKey] && humanGate.halted[gateKey].reason) || "",
        run_title: (humanGate.running[gateKey] && humanGate.running[gateKey].title) || "",
        cmd_status:
          (humanGate.running[gateKey] && humanGate.running[gateKey].cmd_status) ||
          (humanGate.halted[gateKey] && humanGate.halted[gateKey].cmd_status) ||
          "",
      };
    });

    const items = [...boardItems, ...extraItems].sort((a, b) => {
        const rank = {
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
        return (
          (rank[a.run_state] ?? 8) - (rank[b.run_state] ?? 8) ||
          a.day_offset - b.day_offset ||
          b.score - a.score ||
          String(a.code).localeCompare(String(b.code))
        );
      });

    const days = cal.map((day) => {
      const dayItems = items.filter((it) => it.day_offset === day.offset);
      return {
        ...day,
        count: dayItems.length,
        pending: dayItems.filter((it) =>
          ["pending", "queued", "running", "paused", "locked"].includes(it.run_state)
        ).length,
        items: dayItems,
      };
    });

    const byDay = {};
    items.forEach((it) => {
      const key = it.when || whenFromOffset(it.day_offset);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(it);
    });
    const dayOrder = cal.map((d) => d.label);
    const groups = dayOrder
      .filter((k) => byDay[k] && byDay[k].length)
      .map((k) => ({ when: k, items: byDay[k] }));

    const operationAreaOf = (pred) => items.filter(pred).reduce((s, i) => s + (Number(i.area_mu) || 0), 0);
    const uniqueLandAreaOf = (pred) => {
      const seen = new Set();
      return items.filter(pred).reduce((sum, item) => {
        const landCode = item.land_code || String(item.code || "").split("::")[0];
        if (!landCode || seen.has(landCode)) return sum;
        seen.add(landCode);
        const land = currentLands().find((entry) => entry.code === landCode);
        return sum + (Number((land && land.area_mu) || item.area_mu) || 0);
      }, 0);
    };
    const pending = items.filter((i) => i.run_state === "pending" || i.run_state === "locked").length;
    const queued = items.filter((i) => i.run_state === "queued").length;
    const haltedN = items.filter((i) => i.run_state === "paused").length;
    const runningN = items.filter((i) => i.run_state === "running").length;
    const acceptingN = items.filter((i) => i.run_state === "accepting").length;
    const doneN = items.filter((i) => i.run_state === "done").length;
    const workItems = items.filter((i) => i.run_state !== "ok");
    const area_total = currentLands().reduce((sum, land) => sum + (Number(land.area_mu) || 0), 0) || farm.area_mu || 2000;
    const operation_mu_times = operationAreaOf(() => true);
    const area_done = uniqueLandAreaOf((i) => i.run_state === "done");
    const area_running = uniqueLandAreaOf((i) => i.run_state === "running");
    const area_queued = uniqueLandAreaOf((i) => i.run_state === "queued" || i.run_state === "pending" || i.run_state === "locked");
    const area_risk = uniqueLandAreaOf((i) => i.conflict || i.run_state === "paused");
    const area_suitable_today = 0;
    const progress_task = workItems.length ? Math.round((doneN / workItems.length) * 100) : 100;
    const progress_area = area_total ? Math.round((area_done / area_total) * 100) : 0;

    return {
      range: weekRangeLabel(),
      total: items.length,
      work_total: workItems.length,
      pending,
      queued,
      halted: haltedN,
      running: runningN,
      accepting: acceptingN,
      done: doneN,
      progress: progress_task,
      progress_task,
      progress_area,
      area_total,
      operation_mu_times,
      area_done,
      area_running,
      area_queued,
      area_risk,
      area_suitable_today,
      conflict: conflictPack,
      days,
      groups,
      items,
      safety: {
        auto_paused: !!humanGate.auto_paused,
        emergency_locked: !!humanGate.emergency_locked,
        running: runningN,
        halted: haltedN,
        last_action: humanGate.last_action,
        last_at: humanGate.last_at,
        log: humanGate.log.slice(0, 8),
        cmd_log: humanGate.cmd_log.slice(0, 8),
      },
    };
  }

  function buildLandBoard(list) {
    const src = list || currentLands();
    return src
      .map((l) => {
        const u = landUrgencyOf(l);
        return {
          code: l.code,
          name: l.name,
          crop_name: l.crop_name,
          stage: l.stage,
          area_mu: l.area_mu,
          moisture: l.moisture,
          growth: l.growth,
          pest_risk: l.pest_risk,
          open_boll: l.open_boll,
          grain_moisture: l.grain_moisture,
          ...u,
        };
      })
      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  }

  function farmsWithStats() {
    return farmsCatalog.map((f) => {
      const set = new Set(f.land_codes || []);
      const board = buildLandBoard(lands.filter((l) => set.has(l.code)));
      const pending = board.filter((b) => b.level !== "ok" && b.level !== "watch").length;
      return {
        ...f,
        land_count: board.length,
        pending_count: pending,
        top_tag: (board[0] && board[0].tag) || "正常",
      };
    });
  }

  function executeLands(codes, action) {
    const list = Array.isArray(codes) ? codes : [codes];
    const results = [];
    const nowStr = new Date().toLocaleString("zh-CN");
    if (humanGate.emergency_locked) {
      return {
        ok: false,
        error_code: "SAFETY_LOCKED",
        retryable: false,
        results: list.map((code) => ({ code, ok: false, message: "紧急停机锁定中，禁止下发" })),
        land_board: buildLandBoard(),
        week_plan: buildWeekPlan(),
        summary: "紧急停机锁定中，禁止下发",
      };
    }
    if (!list.length || !list.some(Boolean)) {
      return safeFailure("LAND_REQUIRED", "请至少选择一个地块", {
        results: [],
        land_board: buildLandBoard(),
        week_plan: buildWeekPlan(),
        summary: "未选择地块",
      });
    }
    const allowedActions = new Set(["auto", "defoliant", "harvest", "irrigation", "sow", "scout", "watch"]);
    if (!allowedActions.has(action || "auto")) {
      return safeFailure("INVALID_ACTION", "不支持的作业动作", {
        results: [],
        land_board: buildLandBoard(),
        week_plan: buildWeekPlan(),
        summary: "不支持的作业动作",
      });
    }
    list.forEach((code) => {
      const operation = operationMeta(code);
      const gateCode = operation.operation_key;
      const landCode = operation.land_code;
      const l = lands.find((x) => x.code === landCode);
      if (!l) {
        results.push({ code, ok: false, message: "地块不存在" });
        return;
      }
      if (!currentFarmOwnsLand(landCode)) {
        results.push({ code, ok: false, message: "地块不属于当前农场" });
        return;
      }
      if (humanGate.halted[gateCode]) {
        results.push({ code, ok: false, message: `${code} 已暂停，请先继续作业` });
        return;
      }
      const snapshot = operationSnapshot(gateCode);
      const canonicalAction = snapshot.canonical_action;
      const requestedAction = !action ? "auto" : action;
      if (requestedAction !== "auto" && requestedAction !== canonicalAction) {
        results.push({
          code,
          land_code: landCode,
          ok: false,
          error_code: "ACTION_MISMATCH",
          requested_action: requestedAction,
          canonical_action: canonicalAction,
          message: `请求动作「${requestedAction}」与任务规范动作「${canonicalAction}」不一致，已拒绝`,
        });
        return;
      }
      const act = canonicalAction;
      const u = snapshot.safety;
      if (u.executable === false) {
        const reviewId = commandId("REVIEW");
        const evidence = (u.required_evidence || []).join("、") || "关键证据";
        const title = `${landCode} ${u.tag}证据补全`;
        tasks.push({
          id: ++seq,
          title: title.slice(0, 28),
          task_type: "证据复核",
          land_code: landCode,
          operation_key: gateCode,
          assignee: u.accountable_person || "待指派责任人",
          status: "待审核",
          scheduled_at: nowStr,
          priority: u.score >= 70 ? "高" : "中",
          audit_note: `NO_GO：缺少 ${evidence}`,
          review_id: reviewId,
          simulated: true,
        });
        results.push({
          code,
          land_code: landCode,
          ok: true,
          action: act,
          executable: false,
          decision: "NO_GO",
          review_id: reviewId,
          title: `${landCode} 已登记证据补全任务`,
          message: `当前禁止执行；需补齐 ${evidence}`,
          tag: u.tag,
        });
        return;
      }
      let title = `${landCode} 已登记回放队列：${operation.job?.tag || u.tag}`;
      let message = u.reason;
      if (act === "defoliant") {
        title = `${landCode} 脱叶喷药申请已入队`;
        message = `开絮仿真快照保持 ${l.open_boll || "—"}%，等待现场样方、处方复核与设备回执`;
      } else if (act === "harvest") {
        title = `${landCode} 机收转运申请已入队`;
        message = `籽粒含水仿真快照保持 ${l.grain_moisture || "—"}%，等待校准测量、机手确认与设备回执`;
      } else if (act === "irrigation") {
        title = `${landCode} 补灌处方申请已入队`;
        message = `墒情仿真快照保持 ${l.moisture}%，等待传感器 QC、人工复核与阀泵回执`;
      } else if (act === "sow") {
        title = `${landCode} 备播整地任务已写入`;
        message = "适播清单已进入回放队列，待机手确认";
      } else if (act === "scout") {
        title = `${landCode} 复飞诊断申请已入队`;
        message = `风险指数保持 ${l.pest_risk}，待新影像回传后重新判定`;
      } else {
        title = `${landCode} 已记入巡田`;
        message = "暂无紧急执行项";
      }
      const status = "待人工确认";
      const cmdId = commandId("SIM-CMD");
      tasks.push({
        id: ++seq,
        title: title.slice(0, 28),
        task_type: act === "irrigation" ? "灌溉" : act === "scout" ? "巡检" : act === "harvest" ? "收获" : "农事",
        land_code: landCode,
        operation_key: gateCode,
        assignee: act === "scout" ? "Vision Agent" : "场长复核",
        status,
        scheduled_at: nowStr,
        priority: u.score >= 70 ? "高" : "中",
        audit_note: message,
        command_id: cmdId,
        simulated: true,
      });
      delete humanGate.halted[gateCode];
      delete humanGate.deferred[gateCode];
      delete humanGate.completed[gateCode];
      delete humanGate.accepting[gateCode];
      if (act !== "watch") {
        delete humanGate.running[gateCode];
        humanGate.dispatched[gateCode] = {
          action: act,
          at: nowStr,
          title,
          command_id: cmdId,
          cmd_status: "回放队列 · 待设备回执",
          gate_decision: u.decision || "UNVERIFIED",
          preflight_verified: u.preflight_verified === true,
          device_interlock_verified: u.device_interlock_verified === true,
          simulated: true,
        };
      } else {
        delete humanGate.running[gateCode];
        delete humanGate.dispatched[gateCode];
      }
      results.push({ code, land_code: landCode, ok: true, action: act, title, message, command_id: cmdId, simulated: true, tag: operation.job?.tag || u.tag });
    });
    const okCount = results.filter((r) => r.ok).length;
    const reviewCount = results.filter((r) => r.ok && r.executable === false).length;
    const commandCount = okCount - reviewCount;
    return {
      ok: okCount > 0 && okCount === results.length,
      results,
      land_board: buildLandBoard(),
      week_plan: buildWeekPlan(),
      summary: reviewCount
        ? `已登记 ${reviewCount} 项证据补全任务；${commandCount ? `${commandCount} 项仿真命令入队；` : ""}NO_GO 项未执行`
        : `已将 ${commandCount} 项仿真命令写入队列（未连接真实设备）`,
    };
  }

  function haltLand(land, reason) {
    if (!land) return 0;
    let n = 0;
    const wasRunning = !!humanGate.running[land];
    tasks.forEach((t) => {
      if (taskMatchesOperation(t, land) && (t.status === "进行中" || t.status === "执行中" || t.status === "待执行" || t.status === "待人工确认")) {
        t.status = "已制止";
        t.audit_note = (t.audit_note ? t.audit_note + " · " : "") + (reason || "场长干预停止");
        n += 1;
      }
    });
    humanGate.halted[land] = {
      at: new Date().toLocaleString("zh-CN"),
      reason: reason || "暂停作业",
      was_running: wasRunning,
      action: (humanGate.running[land] && humanGate.running[land].action) || "auto",
      cmd_status: "安全停止请求待设备回执",
      simulated: true,
    };
    delete humanGate.running[land];
    delete humanGate.dispatched[land];
    humanGate.cmd_log.unshift({
      at: new Date().toLocaleString("zh-CN"),
      land,
      phase: "安全停止请求",
      detail: reason || "暂停作业",
    });
    return n;
  }

  function resumeLand(land, rawReview) {
    if (humanGate.emergency_locked) return safeFailure("SAFETY_LOCKED", "紧急停机锁定中，禁止继续作业");
    if (!land || !humanGate.halted[land]) return { ok: false, message: `${land || "该项"} 未处于暂停状态` };
    const review = rawReview || {};
    const evidenceRefs = Array.isArray(review.evidence_refs) ? review.evidence_refs.filter((item) => String(item || "").trim()) : [];
    const reviewOk = review.stop_ack === true && review.fault_cleared === true && review.area_clear === true &&
      review.implement_safe === true && review.position_verified === true && review.geofence_verified === true &&
      review.weather_verified === true && String(review.operator_id || "").trim().length >= 2 &&
      String(review.supervisor_id || "").trim().length >= 2 &&
      String(review.operator_id || "").trim() !== String(review.supervisor_id || "").trim() &&
      String(review.stop_ack_ref || "").trim().length >= 3 && evidenceRefs.length > 0;
    if (!reviewOk) {
      return safeFailure("RESUME_INTERLOCK_REQUIRED", "继续作业前须核验停机 ACK、故障消除、清场、机具安全位、定位/围栏、天气，填写可追查证据编号，并由机手与监护人分别确认");
    }
    const safety = operationSnapshot(land).safety;
    if (safety.decision !== "GO_APPROVED" || safety.executable !== true) {
      return safeFailure("GO_APPROVAL_REQUIRED", "原任务尚未取得 GO_APPROVED，保持暂停并等待证据复核");
    }
    const snap = humanGate.halted[land];
    delete humanGate.halted[land];
    let n = 0;
    tasks.forEach((t) => {
      if (taskMatchesOperation(t, land) && t.status === "已制止") {
        t.status = "进行中";
        t.audit_note = (t.audit_note ? t.audit_note + " · " : "") + "继续作业";
        n += 1;
      }
    });
    const nowStr = new Date().toLocaleString("zh-CN");
    if (n > 0 || snap.was_running) {
      humanGate.running[land] = {
        action: snap.action || "auto",
        at: nowStr,
        title: `${land} 继续作业`,
        cmd_status: "继续请求 · 待设备回执",
        gate_decision: "GO_APPROVED",
        preflight_verified: true,
        device_interlock_verified: true,
        resume_review: {
          ...review,
          operator_id: String(review.operator_id).trim().slice(0, 40),
          supervisor_id: String(review.supervisor_id).trim().slice(0, 40),
          stop_ack_ref: String(review.stop_ack_ref).trim().slice(0, 80),
          evidence_refs: evidenceRefs.map((item) => String(item).trim().slice(0, 120)).slice(0, 20),
        },
        simulated: true,
      };
      humanGate.cmd_log.unshift({ at: nowStr, land, phase: "继续请求", detail: "仿真请求已登记，待设备回执" });
      if (!n) {
        tasks.push({
          id: ++seq,
          title: `${land} 继续作业`.slice(0, 28),
          task_type: "农事",
          land_code: operationMeta(land).land_code,
          operation_key: land,
          assignee: "场长续执",
          status: "进行中",
          scheduled_at: nowStr,
          priority: "高",
          audit_note: "暂停后继续作业",
        });
      }
      return { ok: true, mode: "resume", message: `${land} 继续请求已登记，等待设备回执确认` };
    }
    return { ok: true, mode: "unlock", message: `${land} 已解除暂停，可重新下发` };
  }

  function buildCoDecision() {
    const week = buildWeekPlan();
    const pending = week.items.filter((b) => b.needs_confirm);
    const proposals = pending.slice(0, 5).map((b) => ({
      id: `prop-${b.code}`,
      land: b.code,
      agent: b.agent || "系统建议",
      title: `${b.code} · ${b.cta || b.tag}`,
      reason: b.agent_tip || b.reason,
      action: b.action,
      tag: b.tag,
      when: b.when,
      status: humanGate.auto_paused ? "待你拍板" : "建议办理",
    }));
    const running = tasks
      .filter((t) => t.status === "进行中" || t.status === "执行中")
      .slice()
      .reverse()
      .slice(0, 4)
      .map((t) => ({
        id: t.id,
        title: t.title,
        land: t.land_code,
        assignee: t.assignee,
        status: t.status,
      }));
    return {
      motto: "系统出建议，你定干不干、何时干；不对随时停",
      proposals,
      running,
      auto_paused: !!humanGate.auto_paused,
      last_action: humanGate.last_action,
      last_at: humanGate.last_at,
      log: humanGate.log.slice(0, 5),
      week_plan: week,
    };
  }

  function decidePayload(extra) {
    return {
      ok: true,
      ...extra,
      co_decision: buildCoDecision(),
      week_plan: buildWeekPlan(),
      land_board: extra.land_board || buildLandBoard(),
    };
  }

  function normalizeAcceptanceEvidence(raw) {
    const evidence = raw || {};
    const deviceAck = String(evidence.device_ack || "").trim();
    const trackRef = String(evidence.track_ref || "").trim();
    const actuals = String(evidence.actuals || "").trim();
    const acceptedBy = String(evidence.accepted_by || "").trim();
    const ackOk = /^(?:ACK|MANUAL)-[A-Z0-9][A-Z0-9._-]{2,119}$/i.test(deviceAck);
    const trackOk = /^(?:TRACK|LOG|REC|FILE)-[A-Z0-9][A-Z0-9._/-]{2,119}$/i.test(trackRef);
    const actualsOk = actuals.length >= 5 && /\d/.test(actuals) && /(亩|公顷|ha|kg|千克|t|吨|L|升|次|km|公里)/i.test(actuals);
    const acceptorOk = acceptedBy.length >= 2 && acceptedBy.length <= 40;
    if (!ackOk || !trackOk || !actualsOk || !acceptorOk) return null;
    return {
      device_ack: deviceAck.slice(0, 120),
      track_ref: trackRef.slice(0, 120),
      actuals: actuals.slice(0, 240),
      accepted_by: acceptedBy,
    };
  }

  function humanDecide(body) {
    const act = body.action || "";
    const nowStr = new Date().toLocaleString("zh-CN");
    const land = body.land_code || body.land || "";
    if (act === "approve") {
      const codes = body.land_codes || (land ? [land] : []);
      if (humanGate.emergency_locked) {
        return safeFailure("SAFETY_LOCKED", "紧急停机锁定中，禁止下发", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      if (!codes.length || codes.some((code) => !currentFarmOwnsOperation(code))) {
        return safeFailure("LAND_SCOPE_DENIED", "所选地块为空或不属于当前农场", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      codes.forEach((c) => {
        delete humanGate.vetoed[c];
        delete humanGate.deferred[c];
        delete humanGate.completed[c];
      });
      const r = executeLands(codes, body.exec_action || "auto");
      humanGate.last_action = "采纳并写入回放队列";
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "采纳", detail: r.summary, by: "场长" });
      return decidePayload({ ok: r.ok, message: r.summary || "已写入回放队列", land_board: r.land_board, results: r.results });
    }
    if (act === "undefer") {
      if (land) delete humanGate.deferred[land];
      humanGate.last_action = `${land || "该项"} 改回近期`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "改回", detail: `${land || "该项"} 已改回今天/近期`, by: "场长" });
      return decidePayload({ message: `${land || "该项"} 已改回近期排程` });
    }
    if (act === "complete" || act === "done") {
      if (!land) return { ok: false, message: "请指定地块", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      const runningPack = humanGate.running[land];
      if (!runningPack && !humanGate.accepting[land]) {
        return safeFailure("NOT_RUNNING", `${land} 当前不在执行中，无法提交完成`, {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      if (!runningPack || runningPack.gate_decision !== "GO_APPROVED" || runningPack.preflight_verified !== true || runningPack.device_interlock_verified !== true) {
        return safeFailure("GO_APPROVAL_REQUIRED", "未取得 GO_APPROVED、飞行/作业前证据和设备安全联锁，禁止提交完成", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      const area = (currentLands().find((l) => l.code === operationMeta(land).land_code) || {}).area_mu;
      delete humanGate.running[land];
      delete humanGate.halted[land];
      humanGate.accepting[land] = {
        at: nowStr,
        by: "场长",
        area_mu: area,
        cmd_status: "待验收",
        note: body.note || "已提交作业结果，待验收",
        gate_decision: runningPack.gate_decision,
        preflight_verified: runningPack.preflight_verified,
        device_interlock_verified: runningPack.device_interlock_verified,
      };
      humanGate.cmd_log.unshift({ at: nowStr, land, phase: "结果已提交", detail: `${land} 进入待验收` });
      humanGate.last_action = `${land} 待验收`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "提交完成", detail: `${land} 已提交作业结果，待验收`, by: "场长" });
      return decidePayload({ message: `${land} 已提交完成，进入待验收（请核对面积与轨迹）` });
    }
    if (act === "accept" || act === "verify") {
      if (!land) return { ok: false, message: "请指定地块", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      if (!humanGate.accepting[land]) {
        return safeFailure("NOT_AWAITING_ACCEPTANCE", `${land} 不在待验收`, {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      const evidence = normalizeAcceptanceEvidence(body.acceptance_evidence);
      if (!evidence) {
        return safeFailure("ACCEPTANCE_EVIDENCE_REQUIRED", "归档前须提供可解析的 ACK/MANUAL 编号、TRACK/LOG/REC/FILE 引用、含数值与单位的实际量及独立验收人", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      if (humanGate.accepting[land].gate_decision !== "GO_APPROVED" || humanGate.accepting[land].preflight_verified !== true || humanGate.accepting[land].device_interlock_verified !== true) {
        return safeFailure("GO_APPROVAL_REQUIRED", "该结果缺少可验证的放行与安全联锁记录，禁止验收归档", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      if (String(evidence.accepted_by).trim() === String(humanGate.accepting[land].by || "").trim()) {
        return safeFailure("INDEPENDENT_ACCEPTOR_REQUIRED", "验收人必须与结果提交人不同", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      let n = 0;
      tasks.forEach((t) => {
        if (taskMatchesOperation(t, land) && (t.status === "进行中" || t.status === "执行中" || t.status === "待执行" || t.status === "待人工确认" || t.status === "待验收")) {
          t.status = "已完成";
          t.audit_note = (t.audit_note ? t.audit_note + " · " : "") + `验收通过：ACK ${evidence.device_ack}；记录 ${evidence.track_ref}；实际 ${evidence.actuals}；验收人 ${evidence.accepted_by}`;
          n += 1;
        }
      });
      const pack = humanGate.accepting[land];
      delete humanGate.accepting[land];
      delete humanGate.running[land];
      delete humanGate.halted[land];
      delete humanGate.deferred[land];
      delete humanGate.dispatched[land];
      humanGate.completed[land] = { at: nowStr, by: evidence.accepted_by, area_mu: pack.area_mu, evidence: { ...evidence } };
      if (!n) {
        tasks.push({
          id: ++seq,
          title: `${land} 本周作业已验收`.slice(0, 28),
          task_type: "农事",
          land_code: operationMeta(land).land_code,
          operation_key: land,
          assignee: "场长验收",
          status: "已完成",
          scheduled_at: nowStr,
          priority: "中",
          audit_note: `验收通过：ACK ${evidence.device_ack}；记录 ${evidence.track_ref}；实际 ${evidence.actuals}；验收人 ${evidence.accepted_by}`,
        });
      }
      humanGate.cmd_log.unshift({ at: nowStr, land, phase: "验收通过", detail: `${land} 已完成留痕` });
      humanGate.last_action = `${land} 已完成`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "验收", detail: `${land} 验收通过，记入已完成`, by: "场长" });
      return decidePayload({ message: `${land} 验收证据齐全，已归档并计入完成面积` });
    }
    if (act === "start" || act === "begin") {
      if (!land) return { ok: false, message: "请指定地块", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      if (humanGate.emergency_locked) return { ok: false, message: "紧急停机锁定中，禁止启动", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      if (!currentFarmOwnsOperation(land)) return { ok: false, message: "地块不属于当前农场", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      const dispatched = humanGate.dispatched[land];
      if (!dispatched) {
        return safeFailure("DISPATCH_REQUIRED", "该任务尚未进入经批准的派工队列，禁止启动", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      const snapshot = operationSnapshot(land);
      if (dispatched.action !== snapshot.canonical_action) {
        return safeFailure("ACTION_MISMATCH", "派工动作与不可变任务规范不一致，禁止启动", {
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      if (snapshot.safety.decision !== "GO_APPROVED" || snapshot.safety.executable !== true ||
          dispatched.gate_decision !== "GO_APPROVED" || dispatched.preflight_verified !== true || dispatched.device_interlock_verified !== true) {
        return safeFailure("GO_APPROVAL_REQUIRED", "任务仍为 NO_GO 或缺少作业前证据/设备安全联锁，禁止启动", {
          decision: snapshot.safety.decision || "NO_GO",
          executable: false,
          required_evidence: snapshot.safety.required_evidence || [],
          co_decision: buildCoDecision(),
          week_plan: buildWeekPlan(),
        });
      }
      const title = dispatched.title || `${land} 开始流程回放`;
      delete humanGate.dispatched[land];
      humanGate.running[land] = {
        action: snapshot.canonical_action,
        at: nowStr,
        title,
        command_id: commandId("SIM-START"),
        cmd_status: "启动请求 · 待设备回执",
        gate_decision: "GO_APPROVED",
        preflight_verified: true,
        device_interlock_verified: true,
        simulated: true,
      };
      humanGate.cmd_log.unshift({ at: nowStr, land, phase: "启动请求", detail: `仿真请求：启动 ${land}，待设备回执` });
      tasks.forEach((t) => {
        if (taskMatchesOperation(t, land) && (t.status === "待执行" || t.status === "待人工确认" || t.status === "已下发")) t.status = "进行中";
      });
      humanGate.last_action = `${land} 开始流程回放`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "开始", detail: `${land} 仿真启动请求已登记`, by: "场长" });
      return decidePayload({ message: `${land} 启动请求已登记（仿真，不代表设备已接收）` });
    }
    if (act === "defer") {
      if (land) {
        humanGate.deferred[land] = true;
        delete humanGate.halted[land];
      }
      humanGate.last_action = "改到本周后半";
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "改期", detail: `${land || "该项"} 改到周末前`, by: "场长" });
      return decidePayload({ message: `${land || "该项"} 已改到本周后半` });
    }
    if (act === "veto") {
      if (land) {
        humanGate.vetoed[land] = true;
        delete humanGate.deferred[land];
        delete humanGate.halted[land];
        delete humanGate.running[land];
      }
      humanGate.last_action = "本周跳过";
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "跳过", detail: `${land || "该项"} 本周不做`, by: "场长" });
      tasks.push({
        id: ++seq,
        title: `${land || "事项"} 本周跳过`.slice(0, 28),
        task_type: "农事",
        land_code: land ? operationMeta(land).land_code : "全场",
        operation_key: land || undefined,
        assignee: "场长",
        status: "已驳回",
        scheduled_at: nowStr,
        priority: "中",
        audit_note: body.reason || "场长决定本周不做",
      });
      return decidePayload({ message: `${land || "该项"} 本周已跳过` });
    }
    if (act === "halt_one" || act === "pause") {
      if (!land) return { ok: false, message: "请指定地块", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      const n = haltLand(land, body.reason || "场长干预停止本项");
      humanGate.last_action = `${land} 干预停止`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "单项停止", detail: `${land} 已停${n ? `（叫停 ${n} 条作业）` : ""}`, by: "场长" });
      return decidePayload({
        message: n ? `${land} 已干预停止，叫停 ${n} 条作业；复核安全联锁后方可继续` : `${land} 已干预停止；复核安全联锁后方可继续`,
      });
    }
    if (act === "halt_batch") {
      const codes = body.land_codes || [];
      let n = 0;
      codes.forEach((c) => {
        if (c) n += haltLand(c, body.reason || "批量干预停止");
      });
      humanGate.last_action = `批量停止 ${codes.length} 项`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "批量停止", detail: `已停 ${codes.join("、")}`, by: "场长" });
      return decidePayload({ message: codes.length ? `已干预停止 ${codes.length} 项（叫停作业 ${n} 条）` : "未选择地块" });
    }
    if (act === "resume_one" || act === "continue") {
      if (!land) return { ok: false, message: "请指定地块", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
      const r = resumeLand(land, body.safety_review);
      humanGate.last_action = r.ok ? `${land} 继续执行` : humanGate.last_action;
      humanGate.last_at = nowStr;
      if (r.ok) humanGate.log.unshift({ at: nowStr, act: "继续", detail: r.message, by: "场长" });
      return decidePayload({ ok: r.ok, message: r.message });
    }
    if (act === "resume_halted") {
      const codes = Object.keys(humanGate.halted);
      let okN = 0;
      codes.forEach((c) => {
        const r = resumeLand(c, body.safety_review);
        if (r.ok) okN += 1;
      });
      humanGate.last_action = "恢复全部已停";
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "继续", detail: `已恢复 ${okN} 项已停任务`, by: "场长" });
      return decidePayload({ message: okN ? `已继续执行 ${okN} 项` : "当前没有已停任务" });
    }
    if (act === "resume_batch") {
      const codes = body.land_codes || [];
      let okN = 0;
      codes.forEach((c) => {
        if (!c || !humanGate.halted[c]) return;
        const r = resumeLand(c, body.safety_review);
        if (r.ok) okN += 1;
      });
      humanGate.last_action = `继续已选 ${okN}`;
      humanGate.last_at = nowStr;
      humanGate.log.unshift({ at: nowStr, act: "继续", detail: `已选继续 ${okN} 项`, by: "场长" });
      return decidePayload({ message: okN ? `已继续执行 ${okN} 项` : "所选中没有已停任务" });
    }
    if (act === "halt" || act === "halt_all" || act === "pause_all") {
      let n = 0;
      const landsHit = new Set();
      tasks.forEach((t) => {
        if (t.status === "进行中" || t.status === "执行中") landsHit.add(t.land_code);
      });
      Object.keys(humanGate.running).forEach((c) => landsHit.add(c));
      landsHit.forEach((c) => {
        if (c) n += haltLand(c, body.reason || "暂停全部作业");
      });
      humanGate.auto_paused = true;
      humanGate.last_action = "暂停全部作业";
      humanGate.last_at = nowStr;
      humanGate.cmd_log.unshift({ at: nowStr, land: "全场", phase: "指令发送中", detail: "暂停全部作业" });
      humanGate.log.unshift({
        at: nowStr,
        act: "暂停全部",
        detail: `已暂停 ${n} 项，原因：${body.reason || "未填"}`,
        by: "场长",
      });
      return decidePayload({
        message: n ? `已暂停 ${n} 项仿真作业（批量登记/启动已锁）` : "当前无模拟进行项，批量登记/启动已锁定",
      });
    }
    if (act === "emergency_stop") {
      let n = 0;
      const landsHit = new Set();
      tasks.forEach((t) => {
        if (t.status === "进行中" || t.status === "执行中" || t.status === "待执行") landsHit.add(t.land_code);
      });
      Object.keys(humanGate.running).forEach((c) => landsHit.add(c));
      Object.keys(humanGate.dispatched).forEach((c) => landsHit.add(c));
      landsHit.forEach((c) => {
        if (c) n += haltLand(c, body.reason || "紧急停机");
      });
      humanGate.auto_paused = true;
      humanGate.emergency_locked = true;
      persistEmergencyLock(true);
      humanGate.last_action = "远程安全停止请求";
      humanGate.last_at = nowStr;
      humanGate.safety_review = null;
      humanGate.cmd_log.unshift({ at: nowStr, land: "全场", phase: "安全停止请求", detail: body.reason || "紧急停机" });
      humanGate.log.unshift({
        at: nowStr,
        act: "安全停止",
        detail: `已登记 ${n} 项停止请求并启用软件锁，设备状态仍需现场确认`,
        by: "场长",
      });
      return decidePayload({
        message: `远程安全停止请求已登记：${n} 项进入停止待回执，软件已禁止新下发；请现场确认设备确已停止`,
      });
    }
    if (act === "resume") {
      if (humanGate.emergency_locked) {
        const review = body.safety_review || {};
        const operatorId = String(review.operator_id || "").trim();
        const supervisorId = String(review.supervisor_id || "").trim();
        const stopAckRef = String(review.stop_ack_ref || "").trim();
        const evidenceRefs = Array.isArray(review.evidence_refs) ? review.evidence_refs.filter((item) => String(item || "").trim()) : [];
        const reviewed = body.clear_emergency === true && review.stop_ack === true && review.fault_cleared === true &&
          review.area_clear === true && review.machine_isolated === true && review.implement_safe === true &&
          review.position_verified === true && review.geofence_verified === true && review.weather_verified === true &&
          review.operator_confirmed === true && operatorId.length >= 2 && supervisorId.length >= 2 && operatorId !== supervisorId &&
          stopAckRef.length >= 3 && evidenceRefs.length > 0;
        if (!reviewed) {
          return safeFailure("SAFETY_REVIEW_REQUIRED", "仍处于紧急锁定：解除前须核验停机 ACK、故障消除、清场、动力与机具隔离、定位/围栏、天气，并由机手和监护人双人确认", {
            co_decision: buildCoDecision(),
            week_plan: buildWeekPlan(),
          });
        }
        humanGate.safety_review = {
          area_clear: true,
          machine_isolated: true,
          stop_ack: true,
          fault_cleared: true,
          implement_safe: true,
          position_verified: true,
          geofence_verified: true,
          weather_verified: true,
          operator_confirmed: true,
          operator_id: operatorId.slice(0, 40),
          supervisor_id: supervisorId.slice(0, 40),
          stop_ack_ref: stopAckRef.slice(0, 80),
          evidence_refs: evidenceRefs.map((item) => String(item).trim().slice(0, 120)).slice(0, 20),
          confirmed_at: nowStr,
        };
        humanGate.emergency_locked = false;
        persistEmergencyLock(false);
      }
      humanGate.auto_paused = false;
      humanGate.last_action = humanGate.emergency_locked ? "恢复批量（仍紧急锁定）" : "恢复批量登记/启动";
      humanGate.last_at = nowStr;
      humanGate.log.unshift({
        at: nowStr,
        act: "恢复",
        detail: humanGate.emergency_locked
          ? "批量登记/启动仍受紧急锁定限制"
          : "批量登记/启动已解锁；已暂停单项仍需人工继续",
        by: "场长",
      });
      return decidePayload({
        message: humanGate.emergency_locked
          ? "批量通道未完全恢复：仍处于紧急锁定，请先安全复核"
          : Object.keys(humanGate.halted).length
            ? "批量登记/启动已恢复；仍有单项暂停，须人工继续"
            : `软件锁已解除${humanGate.safety_review ? `（复核人：${humanGate.safety_review.confirmed_by}）` : ""}；仍需以现场设备状态为准`,
      });
    }
    return { ok: false, message: "未知操作", co_decision: buildCoDecision(), week_plan: buildWeekPlan() };
  }

  const lands = [
    { id: 1, code: "A-01", name: "北区一号田", area_mu: 280, soil_type: "砂壤土", health_index: 90, moisture: 26.8, n: 40, p: 17, k: 34, temp: 24.2, pest_risk: 16, crop_name: "棉花", variety: "新陆中67", stage: "吐絮盛期", expected_yield: 455, growth: 88, open_boll: 72, geojson: { type: "Polygon", coordinates: [[[80, 80], [240, 80], [240, 180], [80, 180], [80, 80]]] }, center: [160, 130] },
    { id: 2, code: "A-02", name: "北区二号田", area_mu: 260, soil_type: "壤土", health_index: 86, moisture: 25.4, n: 38, p: 16, k: 31, temp: 24.6, pest_risk: 22, crop_name: "棉花", variety: "新陆中67", stage: "吐絮盛期", expected_yield: 468, growth: 85, open_boll: 68, geojson: { type: "Polygon", coordinates: [[[260, 80], [420, 80], [420, 180], [260, 180], [260, 80]]] }, center: [340, 130] },
    { id: 3, code: "B-01", name: "中区棉花田", area_mu: 340, soil_type: "黏壤土", health_index: 82, moisture: 23.6, n: 42, p: 15, k: 28, temp: 25.1, pest_risk: 28, crop_name: "棉花", variety: "新陆早61", stage: "吐絮盛期", expected_yield: 442, growth: 83, open_boll: 58, geojson: { type: "Polygon", coordinates: [[[80, 210], [280, 210], [280, 330], [80, 330], [80, 210]]] }, center: [180, 270] },
    { id: 4, code: "B-02", name: "中区玉米田", area_mu: 310, soil_type: "壤土", health_index: 93, moisture: 19.8, n: 46, p: 19, k: 38, temp: 23.4, pest_risk: 10, crop_name: "玉米", variety: "郑单958", stage: "成熟期", expected_yield: 720, growth: 94, grain_moisture: 24.5, geojson: { type: "Polygon", coordinates: [[[300, 210], [500, 210], [500, 330], [300, 330], [300, 210]]] }, center: [400, 270] },
    { id: 5, code: "C-01", name: "南区小麦田", area_mu: 420, soil_type: "砂壤土", health_index: 84, moisture: 21.2, n: 34, p: 16, k: 30, temp: 22.8, pest_risk: 12, crop_name: "小麦", variety: "新冬20", stage: "适播准备", expected_yield: 430, growth: 78, geojson: { type: "Polygon", coordinates: [[[80, 360], [300, 360], [300, 500], [80, 500], [80, 360]]] }, center: [190, 430] },
    { id: 6, code: "C-02", name: "南区轮作田", area_mu: 390, soil_type: "壤土", health_index: 87, moisture: 27.5, n: 41, p: 17, k: 33, temp: 24.0, pest_risk: 18, crop_name: "玉米", variety: "先玉335", stage: "乳熟期", expected_yield: 660, growth: 89, grain_moisture: 32.0, geojson: { type: "Polygon", coordinates: [[[320, 360], [540, 360], [540, 500], [320, 500], [320, 360]]] }, center: [430, 430] },
  ];

  /**
   * 农情实景媒体库（按作物×生育期匹配公开农情摄影）
   * 统一供 dashboard / twin / wall 消费，避免多处硬编码漂移
   */
  const MEDIA_SCENES = {
    satellite: {
      id: "satellite",
      name: "卫星资料图",
      img: "assets/img/farm-real/farm-orthophoto.jpg",
      credit: "仿真用农田正射影像（非实时）",
    },
    field: {
      id: "field",
      name: "田间资料图",
      img: "assets/img/farm-real/cotton-field.jpg",
      credit: "仿真用吐絮期棉田影像（非实时）",
    },
    aerial: {
      id: "aerial",
      name: "机队资料图",
      img: "assets/img/farm-real/cotton-harvest.jpg",
      credit: "仿真用棉花机收影像（非实时）",
    },
    growth: {
      id: "growth",
      name: "长势伪彩",
      img: "assets/img/farm-real/cotton-closeup.jpg",
      credit: "仿真用棉花冠层与棉铃近景（非实时）",
    },
  };

  const CROP_MEDIA = {
    棉花: {
      field: "assets/img/farm-real/cotton-field.jpg",
      aerial: "assets/img/farm-real/cotton-harvest.jpg",
      closeup: "assets/img/farm-real/cotton-closeup.jpg",
      growth: "assets/img/farm-real/cotton-field.jpg",
      credit: "新疆棉花吐絮期仿真资料图",
    },
    玉米: {
      field: "assets/img/farm-real/corn-field.jpg",
      aerial: "assets/img/farm-real/farm-orthophoto.jpg",
      closeup: "assets/img/farm-real/corn-closeup.jpg",
      growth: "assets/img/farm-real/corn-field.jpg",
      credit: "新疆玉米成熟期仿真资料图",
    },
    小麦: {
      field: "assets/img/farm-real/wheat-seedbed.jpg",
      aerial: "assets/img/farm-real/farm-orthophoto.jpg",
      closeup: "assets/img/farm-real/wheat-seedbed.jpg",
      growth: "assets/img/farm-real/wheat-seedbed.jpg",
      credit: "新疆冬小麦适播整地仿真资料图",
    },
  };

  function landMedia(land) {
    const pack = CROP_MEDIA[land.crop_name] || CROP_MEDIA["棉花"];
    const captured = "数据日期 2026-09-12";
    return {
      thumb: pack.field,
      field: pack.field,
      aerial: pack.aerial,
      closeup: pack.closeup,
      growth: pack.growth,
      credit: pack.credit,
      captured_at: captured,
      crop: land.crop_name,
      stage: land.stage,
      source: "本地真实感资料图（按作物与生育期匹配，非本场实时影像或诊断证据）",
      realtime: false,
      verified: false,
    };
  }

  function buildLandMediaMap() {
    const map = {};
    lands.forEach((l) => {
      map[l.code] = landMedia(l);
    });
    return map;
  }

  function landPhotoUrl(code, kind) {
    const m = buildLandMediaMap()[code];
    if (!m) return MEDIA_SCENES.field.img;
    return m[kind] || m.thumb || m.field;
  }

  const eqCat = (typeof window !== "undefined" && window.FarmEquipmentCatalog) || null;
  const catById = (id) => (eqCat && eqCat.byId ? eqCat.byId(id) : null);
  function attachCatalog(dev, catalogId, overrides) {
    const c = catById(catalogId);
    const clean = {};
    Object.entries(overrides || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") clean[k] = v;
    });
    if (!c) return { ...dev, ...clean };
    return {
      ...dev,
      catalog_id: c.id,
      category: c.category,
      type_name: c.type_name,
      model: c.model,
      vendor_name: c.vendor,
      vendor_id: clean.vendor_id != null ? clean.vendor_id : c.vendor_id,
      params: c.params,
      units: c.units,
      interfaces: c.interfaces,
      derived: c.derived,
      tips: c.tips,
      docs_url: c.docs_url,
      image_url: c.image_url,
      application: c.application,
      ...clean,
    };
  }

  const devices = [
    attachCatalog(
      { id: 1, code: "SOIL-GW-A01", name: "A-01 土壤网关", device_type: "gateway", status: "在线", location: "A-01", last_value: "汇聚 TEROS 12 测点", mqtt: "farm/1/device/SOIL-GW-A01/data", x: 150, y: 120, battery: 100, vendor_id: "xinjie", mesh: false },
      null,
      { category: "土壤墒情", type_name: "边缘汇聚网关", model: "芯界 SoilHub", params: ["测点汇聚", "SDI-12/Modbus 转发", "MQTT 上行"], interfaces: ["MQTT", "SDI-12", "Modbus"], tips: "汇聚根区 TEROS 12 分层测点" }
    ),
    attachCatalog(
      { id: 2, code: "SOIL-GW-B01", name: "B-01 土壤网关", device_type: "gateway", status: "在线", location: "B-01", last_value: "汇聚 TEROS 12 测点", mqtt: "farm/1/device/SOIL-GW-B01/data", x: 170, y: 260, battery: 100, vendor_id: "topcloud", mesh: false },
      null,
      { category: "土壤墒情", type_name: "边缘汇聚网关", model: "托普 SoilHub", params: ["测点汇聚", "MQTT 上行"], interfaces: ["MQTT", "Modbus"], tips: "汇聚根区墒情网格" }
    ),
    attachCatalog(
      { id: 3, code: "SOIL-GW-C01", name: "C-01 土壤网关", device_type: "gateway", status: "在线", location: "C-01", last_value: "汇聚 TEROS 12 测点", mqtt: "farm/1/device/SOIL-GW-C01/data", x: 180, y: 420, battery: 100, vendor_id: "huade", mesh: false },
      null,
      { category: "土壤墒情", type_name: "边缘汇聚网关", model: "华德 SoilHub", params: ["测点汇聚", "阀控联动"], interfaces: ["MQTT", "Modbus TCP"], tips: "墒情与水肥阀控联动" }
    ),
    attachCatalog(
    { id: 4, code: "WX-001", name: "场部气象站 · WXT536", device_type: "weather", status: "在线", location: "场部", last_value: "气温 24.5 ℃ / 风速 2.1 m/s · 相对湿度 48%", mqtt: "farm/1/device/WX-001/data", x: 280, y: 190, battery: 100, vendor_id: "vaisala", mesh: false },
      "vaisala-wxt536"
    ),
    attachCatalog(
      { id: 12, code: "RAIN-001", name: "称重雨量计 · Pluvio² L", device_type: "rain", status: "在线", location: "场部", last_value: "累计降水 12.4mm · 雨强 1.8mm/h", mqtt: "farm/1/device/RAIN-001/data", x: 295, y: 205, battery: 100, vendor_id: "ott", mesh: false },
      "ott-pluvio2"
    ),
    attachCatalog(
      { id: 13, code: "SCAN-U3", name: "土壤走航扫描 · Veris U3", device_type: "soil_scan", status: "整备", location: "C-01", last_value: "pH 7.8 · OM 1.2% · ECa 浅/深 28/41", mqtt: "farm/1/device/SCAN-U3/data", x: 220, y: 440, battery: 76, vendor_id: "veris", mesh: false },
      "veris-u3"
    ),
    attachCatalog(
      { id: 14, code: "PAR-001", name: "PAR 传感器 · LI-190R", device_type: "par", status: "在线", location: "A-01", last_value: "PPFD 1480 µmol·m⁻²·s⁻¹", mqtt: "farm/1/device/PAR-001/data", x: 160, y: 135, battery: 100, vendor_id: "licor", mesh: false },
      "licor-li190r"
    ),
    attachCatalog(
      { id: 15, code: "IR-001", name: "冠层红外温度 · SI-111SS", device_type: "canopy", status: "在线", location: "B-01", last_value: "冠层 26.8℃ · 本体 25.1℃", mqtt: "farm/1/device/IR-001/data", x: 200, y: 250, battery: 100, vendor_id: "apogee", mesh: false },
      "apogee-si111ss"
    ),
    attachCatalog(
      { id: 16, code: "LWS-001", name: "叶面湿度 · LWS", device_type: "leafwet", status: "在线", location: "A-02", last_value: "湿润 · 累计 42 min · 318 mV", mqtt: "farm/1/device/LWS-001/data", x: 340, y: 155, battery: 100, vendor_id: "meter", mesh: false },
      "meter-lws"
    ),
    attachCatalog(
      { id: 5, code: "PUMP-001", name: "智能水泵001", device_type: "irrigation", status: "待机", location: "场部泵房", last_value: "秋收窗口暂停轮灌", mqtt: "farm/1/device/PUMP-001/cmd", x: 200, y: 290, battery: 100, vendor_id: "huade", mesh: false },
      null,
      { category: "水情灌溉", type_name: "智能水泵", model: "华德 SmartPump", params: ["启停", "频率", "出口压力"], interfaces: ["MQTT", "Modbus TCP"] }
    ),
    attachCatalog(
      { id: 17, code: "FLOW-001", name: "超声波灌溉水表 · Octave", device_type: "irrigation", status: "在线", location: "场部泵房", last_value: "流量 12.6 m³/h · 累计 1864 m³", mqtt: "farm/1/device/FLOW-001/data", x: 215, y: 305, battery: 100, vendor_id: "netafim", mesh: false },
      "netafim-octave"
    ),
    attachCatalog(
      { id: 6, code: "VALVE-012", name: "电磁阀012", device_type: "irrigation", status: "关闭", location: "A-02", last_value: "阀位 0%", mqtt: "farm/1/device/VALVE-012/cmd", x: 340, y: 140, battery: 100, vendor_id: "huade", mesh: false },
      null,
      { category: "水情灌溉", type_name: "电磁阀", model: "华德 Valve-12", params: ["阀位", "开关状态"], interfaces: ["MQTT", "Modbus"] }
    ),
    attachCatalog(
      { id: 18, code: "CROP-NODE-001", name: "作物感知节点 · Mark 3", device_type: "crop_node", status: "在线", location: "B-01", last_value: "VPD 1.4 kPa · 冠层 27.2℃ · 辐射 612 W/m²", mqtt: "farm/1/device/CROP-NODE-001/data", x: 185, y: 270, battery: 91, vendor_id: "arable", mesh: false },
      "arable-mark3"
    ),
    attachCatalog(
      { id: 7, code: "UAV-001", name: "植保无人机001", device_type: "drone", status: "编队中", location: "B-01", last_value: "电量 81% / 脱叶航线", mqtt: "farm/1/device/UAV-001/cmd", x: 190, y: 255, battery: 81, vendor_id: "dji", mesh: false },
      null,
      { category: "遥感巡田", type_name: "植保无人机", model: "大疆 T 系列", params: ["航线", "药量", "高度", "电量"], interfaces: ["Cloud API", "MQTT", "RTK"] }
    ),
    attachCatalog(
      { id: 11, code: "UAV-002", name: "多光谱测绘无人机 · Mavic 3M", device_type: "drone", status: "巡田", location: "B-02", last_value: "NDVI 航测完成 · 电量 88% · RTK 固定", mqtt: "farm/1/device/UAV-002/cmd", x: 400, y: 260, battery: 88, vendor_id: "dji", mesh: false },
      "dji-mavic3m"
    ),
    attachCatalog(
      { id: 19, code: "PEST-001", name: "AI 虫情诱捕器 · Trapview", device_type: "pest", status: "在线", location: "B-01", last_value: "日虫压 18 头 · 棉铃虫成虫高峰窗口", mqtt: "farm/1/device/PEST-001/data", x: 230, y: 280, battery: 74, vendor_id: "trapview", mesh: false },
      "trapview-aura"
    ),
    attachCatalog(
      { id: 8, code: "TRACTOR-001", name: "无人拖拉机001", device_type: "tractor", status: "整备", location: "C-01", last_value: "油量 71% · 冬麦播前整地", mqtt: "farm/1/device/TRACTOR-001/cmd", x: 200, y: 430, battery: 71, vendor_id: "lovol", mesh: false },
      null,
      { category: "收获产量", type_name: "无人拖拉机", model: "雷沃无人拖拉机", params: ["油量", "航迹", "机具挂载"], interfaces: ["ISOBUS", "MQTT", "CAN"] }
    ),
    attachCatalog(
      { id: 20, code: "YIELD-001", name: "联合收割测产 · InCommand", device_type: "yield", status: "整备", location: "B-02", last_value: "产量模拟值 6820 kg/ha · 含水模拟值 18.6%", calibration_status: "NOT_VERIFIED", calibration_label: "校准证据待导入", calibration_required: ["流量校准记录", "水分仪比对记录", "割台宽度与延迟参数", "操作人与日期"], mqtt: "farm/1/device/YIELD-001/data", x: 380, y: 280, battery: 100, vendor_id: "agleader", mesh: false },
      "agleader-yield"
    ),
    attachCatalog(
      { id: 9, code: "ROBOT-001", name: "田间机器人001", device_type: "robot", status: "待命", location: "A-01", last_value: "电量 90%", mqtt: "farm/1/device/ROBOT-001/cmd", x: 120, y: 150, battery: 90, vendor_id: "xinjie", mesh: false },
      null,
      { category: "综合作物", type_name: "田间机器人", model: "芯界 FieldBot", params: ["电量", "任务队列", "定位"], interfaces: ["MQTT", "WebSocket"] }
    ),
    attachCatalog(
      { id: 10, code: "SPRAY-002", name: "变量喷雾机002", device_type: "sprayer", status: "编队中", location: "B-01", last_value: "药箱液位模拟值 68% · 非药液浓度或施用剂量", measurement_name: "药箱液位", measurement_unit: "%", calibration_status: "NOT_VERIFIED", calibration_label: "流量与喷幅校准证据待导入", calibration_required: ["流量计校准", "喷嘴型号与磨损检查", "喷幅/速度比对", "药剂标签与处方批准"], mqtt: "farm/1/device/SPRAY-002/cmd", x: 210, y: 275, battery: 88, vendor_id: "lovol", mesh: false },
      null,
      { category: "遥感巡田", type_name: "变量喷雾机", model: "雷沃变量喷雾", params: ["药液余量", "喷幅", "处方跟踪"], interfaces: ["ISOBUS", "MQTT", "CAN"] }
    ),
  ];

  /** 地块稠密传感网：以 TEROS 12 为代表型号（VWC / EC / 土温，多深度） */
  function buildSensorMesh() {
    const list = [];
    let sid = 2000;
    const depths = ["10cm", "20cm", "40cm"];
    const kinds = [
      { id: "moisture", label: "含水率", unit: "%", param: "体积含水量（VWC）" },
      { id: "ec", label: "EC", unit: "dS/m", param: "土壤体积电导率（Bulk EC）" },
      { id: "temp", label: "土温", unit: "℃", param: "土壤温度" },
    ];
    const teros = catById("meter-teros-12");
    lands.forEach((land) => {
      const ring = land.geojson.coordinates[0];
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const density = Math.max(12, Math.min(24, Math.round(land.area_mu / 18)));
      const cols = Math.ceil(Math.sqrt(density));
      const rows = Math.ceil(density / cols);
      let n = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (n >= density) break;
          const x = +(minX + ((c + 0.35 + (r % 2) * 0.15) / cols) * (maxX - minX)).toFixed(1);
          const y = +(minY + ((r + 0.4) / rows) * (maxY - minY)).toFixed(1);
          const kind = kinds[n % kinds.length];
          const depth = depths[n % depths.length];
          const sampleUnit = (salt) => {
            const text = `${land.code}|${n}|${salt}`;
            let hash = 2166136261;
            for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
            return (hash >>> 0) / 4294967295;
          };
          const jitter = (sampleUnit("jitter") - 0.5) * 4;
          let val;
          if (kind.id === "moisture") val = +(land.moisture + jitter).toFixed(1);
          else if (kind.id === "ec") val = +(1.2 + land.pest_risk / 80 + sampleUnit("ec") * 0.6).toFixed(2);
          else val = +(land.temp + (sampleUnit("temp") - 0.5)).toFixed(1);
          const online = sampleUnit("status") > 0.07;
          const base = {
            id: ++sid,
            code: `${land.code}-S${String(n + 1).padStart(2, "0")}`,
            name: `${land.code} TEROS12 · ${kind.label}@${depth}`,
            device_type: "sensor",
            sensor_kind: kind.id,
            depth,
            status: online ? "在线" : "弱信号",
            location: land.code,
            last_value: `${kind.label} ${val}${kind.unit} @${depth}`,
            mqtt: `farm/1/land/${land.code}/sensor/${n + 1}/data`,
            x,
            y,
            battery: online ? 72 + Math.round(sampleUnit("battery") * 26) : 18 + Math.round(sampleUnit("battery-low") * 20),
            vendor_id: "meter",
            mesh: true,
            value: val,
            metric: kind.param,
          };
          list.push(
            attachCatalog(base, "meter-teros-12", {
              name: base.name,
              last_value: base.last_value,
              depth,
              sensor_kind: kind.id,
              metric: kind.param,
              tips: teros ? `${teros.tips} · 当前测点深度 ${depth}` : base.tips,
            })
          );
          n += 1;
        }
      }
      land.sensor_count = n;
      land.sensor_online = list.filter((s) => s.location === land.code && s.status === "在线").length;
    });
    return list;
  }

  const sensorMesh = buildSensorMesh();
  devices.push(...sensorMesh);
  devices.filter((d) => d.device_type === "gateway").forEach((gw) => {
    const n = devices.filter((s) => s.mesh && s.location === gw.location).length;
    const on = devices.filter((s) => s.mesh && s.location === gw.location && s.status === "在线").length;
    if (n) gw.last_value = `汇聚 ${on}/${n} 点`;
  });
  function annotateDemoDevice(device) {
    device.simulated = true;
    device.production_connected = false;
    device.observed_at = null;
    device.quality_code = "DEMO_UNVERIFIED";
    device.display_status = String(device.status || "未知").startsWith("模拟 · ") ? device.status : `模拟 · ${device.status || "未知"}`;
    device.last_value = String(device.last_value || "暂无模拟").startsWith("模拟 · ") ? device.last_value : `模拟 · ${device.last_value || "暂无模拟"}`;
    return device;
  }
  devices.forEach(annotateDemoDevice);

  /** 作物全生育期形态学谱系（地上冠层 + 地下根系） */
  const MORPHOLOGY = {
    棉花: [
      { key: "emerge", name: "出苗", canopy: "子叶展开", root: "主根下扎 5–8cm", days: "0–15d" },
      { key: "seedling", name: "苗期", canopy: "真叶 3–5 片", root: "侧根发生", days: "15–35d" },
      { key: "bud", name: "蕾期", canopy: "现蕾、果枝分化", root: "根系扩幅加速", days: "35–55d" },
      { key: "bloom", name: "花铃期", canopy: "开花结铃、叶面积高峰", root: "根深 40–60cm、吸水旺盛", days: "55–95d" },
      { key: "boll", name: "吐絮期", canopy: "铃开裂吐絮", root: "根系功能维持", days: "95–120d" },
      { key: "mature", name: "成熟期", canopy: "叶片衰老、纤维成熟", root: "根系老化", days: "120d+" },
    ],
    玉米: [
      { key: "emerge", name: "出苗", canopy: "胚芽鞘出土", root: "初生根", days: "0–10d" },
      { key: "joint", name: "拔节", canopy: "茎节伸长", root: "次生根层形成", days: "10–35d" },
      { key: "tassel", name: "抽雄", canopy: "雄穗抽出", root: "气生根支撑", days: "35–55d" },
      { key: "silk", name: "吐丝", canopy: "雌穗吐丝授粉", root: "根冠比峰值", days: "55–70d" },
      { key: "fill", name: "灌浆", canopy: "籽粒灌浆、叶色深绿", root: "根系维持供水", days: "70–100d" },
      { key: "mature", name: "成熟", canopy: "籽粒脱水、苞叶干枯", root: "根系衰退", days: "100d+" },
    ],
    小麦: [
      { key: "sow", name: "适播准备", canopy: "播前整地、底墒调控", root: "播层土壤待建", days: "秋播窗口" },
      { key: "emerge", name: "出苗", canopy: "第1叶展开", root: "胚根伸长", days: "0–15d" },
      { key: "tiller", name: "分蘖", canopy: "分蘖发生", root: "次生根丛生", days: "15–45d" },
      { key: "joint", name: "拔节", canopy: "茎秆拔节", root: "根层下移", days: "45–70d" },
      { key: "head", name: "抽穗", canopy: "穗抽出扬花", root: "根系吸肥高峰", days: "70–90d" },
      { key: "fill", name: "灌浆", canopy: "籽粒灌浆", root: "根系维持", days: "90–110d" },
      { key: "mature", name: "成熟", canopy: "籽粒黄熟", root: "根系老化", days: "110d+" },
    ],
  };

  const STAGE_ALIAS = {
    蕾期: "bud", 花铃期: "bloom", 吐絮期: "boll", 吐絮盛期: "boll", 苗期: "seedling", 成熟期: "mature",
    拔节期: "joint", 抽雄期: "tassel", 灌浆期: "fill", 乳熟期: "fill", 分蘖期: "tiller", 抽穗期: "head",
    适播准备: "sow",
  };

  function morphFor(crop, stageName) {
    const list = MORPHOLOGY[crop] || MORPHOLOGY["棉花"];
    const key = STAGE_ALIAS[stageName] || list[Math.min(3, list.length - 1)].key;
    const idx = Math.max(0, list.findIndex((m) => m.key === key));
    return { list, current: list[idx], index: idx };
  }

  /** 单株数字孪生采样网：每田代表性单株（精细表型点），支持地上/地下全形态 */
  function buildPlantMesh() {
    const list = [];
    let pid = 5000;
    lands.forEach((land) => {
      const ring = land.geojson.coordinates[0];
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const density = Math.max(18, Math.min(36, Math.round(land.area_mu / 12)));
      const cols = Math.ceil(Math.sqrt(density * 1.2));
      const rows = Math.ceil(density / cols);
      const morph = morphFor(land.crop_name, land.stage);
      let n = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (n >= density) break;
          const x = +(minX + ((c + 0.28 + (r % 2) * 0.12) / cols) * (maxX - minX)).toFixed(1);
          const y = +(minY + ((r + 0.35) / rows) * (maxY - minY)).toFixed(1);
          const sampleUnit = (salt) => {
            const text = `${land.code}|${n}|plant|${salt}`;
            let hash = 2166136261;
            for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
            return (hash >>> 0) / 4294967295;
          };
          const jitter = (sampleUnit("jitter") - 0.5) * 14;
          const canopyVigor = Math.max(42, Math.min(98, Math.round(land.growth + jitter)));
          const rootVigor = Math.max(40, Math.min(97, Math.round(land.growth * 0.92 + land.moisture * 0.35 + jitter * 0.6)));
          const stress = [];
          if (land.moisture < 20 && sampleUnit("dry") > 0.55) stress.push("根区偏旱");
          if (land.crop_name === "棉花" && (land.open_boll || 0) < 65 && sampleUnit("boll") > 0.55) stress.push("吐絮偏慢待脱叶");
          if (land.pest_risk > 40 && sampleUnit("pest") > 0.55) stress.push("叶部病斑残留");
          if (canopyVigor < 70) stress.push("冠层弱势");
          if (rootVigor < 68) stress.push("根系活力偏低");
          const morphShift = sampleUnit("morph") > 0.82 ? (sampleUnit("morph-dir") > 0.5 ? 1 : -1) : 0;
          const mIdx = Math.max(0, Math.min(morph.list.length - 1, morph.index + morphShift));
          const m = morph.list[mIdx];
          const health = Math.round((canopyVigor * 0.55 + rootVigor * 0.45) * (stress.length ? 0.92 : 1));
          list.push({
            id: ++pid,
            code: `${land.code}-P${String(n + 1).padStart(3, "0")}`,
            land_code: land.code,
            row: r + 1,
            col: c + 1,
            x,
            y,
            crop_name: land.crop_name,
            variety: land.variety,
            morph_key: m.key,
            morph_name: m.name,
            morph_index: mIdx,
            morph_total: morph.list.length,
            morph_canopy_desc: m.canopy,
            morph_root_desc: m.root,
            morph_window: m.days,
            canopy: {
              vigor: canopyVigor,
              height_cm: Math.round(35 + canopyVigor * 0.9 + (land.crop_name === "玉米" ? 80 : land.crop_name === "小麦" ? -10 : 20)),
              lai: +(1.2 + canopyVigor / 40).toFixed(2),
              leaf_color: canopyVigor > 85 ? "深绿" : canopyVigor > 70 ? "正常绿" : canopyVigor > 55 ? "黄绿" : "萎黄",
              fruit_load: land.crop_name === "棉花"
                ? Math.round((land.open_boll || 60) / 8 + canopyVigor / 20)
                : land.crop_name === "玉米" ? Math.round(canopyVigor / 25) : Math.round(canopyVigor / 15),
              ndvi: +(0.35 + canopyVigor / 160).toFixed(3),
            },
            root: {
              vigor: rootVigor,
              depth_cm: Math.round(18 + rootVigor * 0.45 + (land.moisture < 22 ? -6 : 4)),
              density: rootVigor > 80 ? "密" : rootVigor > 65 ? "中" : "稀",
              rhizosphere_moisture: +(land.moisture + (sampleUnit("rhizo") - 0.5) * 5).toFixed(1),
              root_health: rootVigor > 78 ? "优" : rootVigor > 62 ? "良" : "弱",
              tip_activity: rootVigor > 75 ? "活跃" : "一般",
            },
            phenotype: {
              stem_diameter_mm: +(4 + canopyVigor / 25).toFixed(1),
              canopy_width_cm: Math.round(20 + canopyVigor * 0.55),
              biomass_proxy: Math.round(canopyVigor * 1.1 + rootVigor * 0.4),
              symmetry: sampleUnit("symmetry") > 0.15 ? "对称" : "偏冠",
            },
            stress,
            health,
            status: stress.length >= 2 ? "需干预" : stress.length === 1 ? "关注" : "正常",
            updated_at: "模拟数据",
            simulated: true,
            verified: false,
          });
          n += 1;
        }
      }
      land.plant_count = n;
      land.plant_watch = list.filter((p) => p.land_code === land.code && p.status !== "正常").length;
      land.canopy_avg = Math.round(list.filter((p) => p.land_code === land.code).reduce((s, p) => s + p.canopy.vigor, 0) / n);
      land.root_avg = Math.round(list.filter((p) => p.land_code === land.code).reduce((s, p) => s + p.root.vigor, 0) / n);
    });
    return list;
  }

  const plants = buildPlantMesh();
  let selectedPlantId = plants[0] ? plants[0].id : null;

  /** 播种→秋收全季流程回放链；不是现场作业实况。 */
  const seasonCycle = {
    season: "2026 新疆秋收季 · 模拟模拟回放",
    current_stage: "defoliant",
    progress: 78,
    note: "回放进度，不代表现场已作业；秋收、施药与播种均须补齐证据并人工批准",
    stages: [
      { id: "till", name: "整地深松", window: "模拟 03-15 ~ 03-28", status: "回放归档", progress: 100, devices: ["TRACTOR-001"], ops: "回放记录：深松 25cm · 未核验", hours: 186, fuel: "模拟 1.2t", land: "全场" },
      { id: "sow", name: "精量播种", window: "模拟 04-02 ~ 04-18", status: "回放归档", progress: 100, devices: ["TRACTOR-001", "UAV-002", "SEEDER-001"], ops: "回放记录：铺膜播种 · 未核验", hours: 214, fuel: "模拟 1.6t", land: "A/B 区" },
      { id: "scout", name: "苗期巡田", window: "模拟 04-20 ~ 05-20", status: "回放归档", progress: 100, devices: ["UAV-001", "ROBOT-001"], ops: "回放记录：出苗密度复测 · 未核验", hours: 96, fuel: "模拟", land: "全场" },
      { id: "irrigate", name: "水肥轮灌", window: "模拟 05-01 ~ 08-30", status: "回放归档", progress: 100, devices: ["PUMP-001", "VALVE-012", "SOIL-GW-A01"], ops: "回放记录：水肥轮灌 · 未核验", hours: 520, fuel: "模拟电耗 56 万 kWh", land: "全场" },
      { id: "protect", name: "病虫防治", window: "模拟 06-10 ~ 08-25", status: "回放归档", progress: 100, devices: ["UAV-001", "SPRAY-002"], ops: "回放记录：防控收尾 · 未核验", hours: 148, fuel: "模拟 0.5t", land: "棉花区" },
      { id: "defoliant", name: "脱叶催熟", window: "待现场天气与标签核验", status: "NO_GO", progress: 46, devices: ["UAV-001", "SPRAY-002", "UAV-002"], ops: "候选流程回放 · 缺少天气、药剂标签与人工批准", hours: 36, fuel: "模拟 0.12t", land: "B-01 / A 区" },
      { id: "harvest", name: "机收采摘", window: "待成熟度、试收与道路核验", status: "NO_GO", progress: 18, devices: ["HARVEST-001", "UAV-002"], ops: "候选流程回放 · 未取得试收损失与收储能力证据", hours: 42, fuel: "模拟 0.6t", land: "B-02" },
      { id: "haul", name: "田间转运", window: "待采收放行、道路隔离与仓容核验", status: "NO_GO", progress: 12, devices: ["TRUCK-001"], ops: "候选转运流程 · 待道路隔离与仓容确认", hours: 18, fuel: "模拟值", land: "场部仓线" },
      { id: "winter_sow", name: "冬麦备播", window: "待本地生态区模板核验", status: "NO_GO", progress: 8, devices: ["TRACTOR-001", "SEEDER-001"], ops: "候选备播流程 · 不套用北疆播期", hours: 6, fuel: "模拟 0.4t", land: "C-01" },
    ],
    fleet_extra: [
      { code: "HARVEST-001", name: "采棉机/联合收割机", device_type: "harvester", status: "计划接入", location: "B-02", stage: "harvest", vendor_id: "lovol", asset_state: "planned" },
      { code: "TRUCK-001", name: "田间转运车", device_type: "transport", status: "计划接入", location: "B-02→仓", stage: "haul", vendor_id: "xinjie", asset_state: "planned" },
      { code: "SEEDER-001", name: "精量播种机", device_type: "seeder", status: "计划接入", location: "机库", stage: "winter_sow", vendor_id: "lovol", asset_state: "planned" },
    ],
  };

  const postHarvest = {
    note: "仿真收贮回放；库存、批次、产线与质量值均为模拟，须由过磅、质检与仓储系统核验",
    warehouses: [
      { id: "WH-01", name: "一号籽棉仓", crop: "棉花", capacity_t: 800, stock_t: 86, moisture: 8.0, temp: 21.8, status: "模拟·待收储", updated: "数据截至 2026-09-14" },
      { id: "WH-02", name: "二号粮食仓", crop: "玉米", capacity_t: 1200, stock_t: 528, moisture: 13.4, temp: 18.2, status: "模拟·收储中", updated: "数据截至 2026-09-14" },
      { id: "WH-03", name: "低温保质仓", crop: "精品批次", capacity_t: 200, stock_t: 52, moisture: 7.6, temp: 12.0, status: "模拟·控温", updated: "数据截至 2026-09-14" },
    ],
    lines: [
      { id: "PL-GIN", name: "轧花初加工线", crop: "棉花", status: "模拟待机", throughput: "模拟 8 t/班", steps: ["喂料", "清理", "轧花", "打包"], batch: "—", quality: "模拟待机采籽棉" },
      { id: "PL-DRY", name: "烘干清理线", crop: "玉米", status: "模拟回放", throughput: "模拟 18 t/班", steps: ["接收", "烘干", "筛选", "入仓"], batch: "BATCH-0912", quality: "模拟含水 13.4% · 待质检" },
      { id: "PL-PACK", name: "分级打包线", crop: "混合作物", status: "模拟回放", throughput: "模拟 8 t/班", steps: ["分级", "计量", "打包", "贴标"], batch: "BATCH-0912", quality: "模拟追溯码 · 未核验" },
    ],
    batches: [
      { id: "BATCH-0912", crop: "玉米", land: "B-02", weight_t: 118, grade: "一等", stage: "烘干入仓", workflow_index: 5, replay_index: 5, warehouse: "WH-02", next: "筛选入库" },
      { id: "BATCH-0908", crop: "玉米", land: "B-02", weight_t: 96, grade: "一等", stage: "已入库", workflow_index: 6, replay_index: 6, warehouse: "WH-02", next: "按需出库" },
      { id: "BATCH-PLAN", crop: "棉花", land: "A/B", weight_t: 0, grade: "—", stage: "待机收", workflow_index: 0, replay_index: 0, warehouse: "WH-01", next: "脱叶后机采进仓" },
    ],
    flow: ["测产确认", "机收", "田间转运", "过磅质检", "仓储控温控湿", "初加工（轧花/烘干）", "分级打包", "出库/溯源"],
  };

  const vendors = [
    { id: "dji", name: "大疆农业", region: "中国", protocols: ["Cloud API", "MQTT", "RTK"], category: "无人机/遥感", devices: devices.filter((d) => d.vendor_id === "dji").length, status: "适配验证", sla: "待生产验证", adapter: "DJI-Bridge v2.1", note: "植保航线与 Mavic 3M 多光谱能力" },
    { id: "lovol", name: "雷沃重工", region: "中国", protocols: ["ISOBUS", "MQTT", "CAN"], category: "拖拉机/喷雾", devices: devices.filter((d) => d.vendor_id === "lovol").length, status: "适配验证", sla: "待生产验证", adapter: "ISOBUS-Gateway", note: "机具联合作业与工况能力" },
    { id: "topcloud", name: "托普云农", region: "中国", protocols: ["MQTT", "Modbus", "HTTP"], category: "传感网关", devices: devices.filter((d) => d.vendor_id === "topcloud").length, status: "适配验证", sla: "待生产验证", adapter: "Modbus-MQTT", note: "地块网关汇聚能力" },
    { id: "huade", name: "华德水肥", region: "中国", protocols: ["MQTT", "Modbus TCP"], category: "水肥/阀控", devices: devices.filter((d) => d.vendor_id === "huade").length, status: "适配验证", sla: "待生产验证", adapter: "Valve-Hub", note: "泵阀与流量闭环能力" },
    { id: "xinjie", name: "芯界自研", region: "中国", protocols: ["MQTT", "WebSocket"], category: "网关/机器人", devices: devices.filter((d) => d.vendor_id === "xinjie").length, status: "适配验证", sla: "待生产验证", adapter: "Native", note: "边缘汇聚与田间机器人能力" },
    { id: "vaisala", name: "Vaisala 维萨拉", region: "芬兰", protocols: ["Modbus RTU", "SDI-12", "RS-485"], category: "气象环境", devices: devices.filter((d) => d.vendor_id === "vaisala").length, status: "适配验证", sla: "待生产验证", adapter: "WXT-Bridge", note: "WXT536 一体化气象能力" },
    { id: "ott", name: "OTT HydroMet", region: "德国", protocols: ["SDI-12", "Modbus"], category: "气象/水文", devices: devices.filter((d) => d.vendor_id === "ott").length, status: "适配验证", sla: "待生产验证", adapter: "Pluvio-Ingest", note: "称重式雨量 Pluvio² L 能力" },
    { id: "meter", name: "METER Group", region: "美国", protocols: ["SDI-12", "ZENTRA Cloud"], category: "土壤/叶面", devices: devices.filter((d) => d.vendor_id === "meter").length, status: "适配验证", sla: "待生产验证", adapter: "TEROS-ZENTRA", note: "TEROS 12 墒情网格与 LWS 能力" },
    { id: "veris", name: "Veris Technologies", region: "美国", protocols: ["Bluetooth", "GPS", "File/Cloud"], category: "土壤走航", devices: devices.filter((d) => d.vendor_id === "veris").length, status: "接口预留", sla: "待生产验证", adapter: "U3-FieldFusion", note: "U3 车载土壤快速扫描能力" },
    { id: "licor", name: "LI-COR", region: "美国", protocols: ["模拟电流", "DAQ"], category: "作物光温", devices: devices.filter((d) => d.vendor_id === "licor").length, status: "适配验证", sla: "待生产验证", adapter: "PAR-DAQ", note: "LI-190R 光合有效辐射能力" },
    { id: "apogee", name: "Apogee / Campbell", region: "美国", protocols: ["模拟毫伏", "Campbell Logger"], category: "作物光温", devices: devices.filter((d) => d.vendor_id === "apogee").length, status: "适配验证", sla: "待生产验证", adapter: "SI111-Logger", note: "SI-111SS 红外冠层温度能力" },
    { id: "netafim", name: "Netafim", region: "以色列", protocols: ["脉冲", "Modbus"], category: "水情灌溉", devices: devices.filter((d) => d.vendor_id === "netafim").length, status: "适配验证", sla: "待生产验证", adapter: "Octave-Meter", note: "Octave 超声波灌溉水表能力" },
    { id: "arable", name: "Arable", region: "美国", protocols: ["蜂窝", "Cloud API"], category: "综合作物", devices: devices.filter((d) => d.vendor_id === "arable").length, status: "适配验证", sla: "待生产验证", adapter: "Mark3-API", note: "Mark 3 田间一体化节点能力" },
    { id: "trapview", name: "Trapview", region: "斯洛文尼亚", protocols: ["蜂窝", "Cloud API"], category: "病虫监测", devices: devices.filter((d) => d.vendor_id === "trapview").length, status: "适配验证", sla: "待生产验证", adapter: "Trap-API", note: "自动虫情诱捕能力" },
    { id: "agleader", name: "Ag Leader", region: "美国", protocols: ["CAN", "AgFiniti"], category: "收获测产", devices: devices.filter((d) => d.vendor_id === "agleader").length, status: "接口预留", sla: "待生产验证", adapter: "Yield-InCommand", note: "联合收割机产量监测能力" },
    { id: "senseagro", name: "SenseAgro", region: "荷兰/中国", protocols: ["MQTT", "REST"], category: "土壤探针", devices: devices.filter((d) => d.vendor_id === "senseagro").length, status: "接口预留", sla: "待生产验证", adapter: "REST-Ingest", note: "备选多深度探针能力" },
    { id: "john-deere", name: "John Deere Ops", region: "美国", protocols: ["Operations Center API"], category: "机队平台", devices: 0, status: "接口预留", sla: "待生产验证", adapter: "OC-Connector", note: "国际机队数据互通预留能力" },
  ];
  vendors.forEach((vendor) => {
    vendor.note = `能力目录模拟 · ${vendor.note}`;
    vendor.simulated = true;
    vendor.production_connected = false;
  });

  const jointOps = [
    {
      id: "JOINT-001",
      title: "B-01 棉花脱叶催熟 · 侦察—喷雾联合编队",
      land: "B-01",
      scene: "秋收脱叶",
      status: "NO_GO",
      progress: 46,
      window: "待逐小时天气、药剂标签与人工批准",
      machines: [
        { code: "UAV-001", role: "开絮/冠层侦察", vendor: "大疆农业", status: "仿真待确认", agent: "Vision Agent" },
        { code: "SPRAY-002", role: "脱叶剂变量喷施", vendor: "雷沃重工", status: "禁止执行", agent: "Robot Agent" },
        { code: "UAV-002", role: "作业后复测", vendor: "大疆农业", status: "待命", agent: "Vision Agent" },
      ],
      agents: [
        { name: "Farm Master", duty: "窗口与停机条件" },
        { name: "Vision Agent", duty: "开絮率与叶色处方图" },
        { name: "Robot Agent", duty: "喷雾航迹与避障" },
        { name: "Crop Expert", duty: "脱叶剂剂量边界" },
      ],
      timeline: [
        { t: "模拟", event: "候选窗口尚未取得可追溯逐小时天气" },
        { t: "模拟", event: "开絮率 58% 为仿真快照，待现场样方核验" },
        { t: "NO_GO", event: "药剂标签、剂量、清场与人工批准未齐全，禁止喷施" },
        { t: "待补证", event: "补齐证据后重新计算窗口与处方" },
      ],
    },
    {
      id: "JOINT-002",
      title: "B-02 春玉米机收 + 转运进仓",
      land: "B-02",
      scene: "机收转运",
      status: "NO_GO",
      progress: 34,
      window: "待成熟度、试收、道路和仓容证据",
      machines: [
        { code: "HARVEST-001", role: "联合收割", vendor: "雷沃重工", status: "禁止执行", agent: "Robot Agent" },
        { code: "TRUCK-001", role: "籽粒转运", vendor: "芯界自研", status: "待确认", agent: "Robot Agent" },
        { code: "UAV-002", role: "测产航线", vendor: "大疆农业", status: "仿真待确认", agent: "Yield Agent" },
      ],
      agents: [
        { name: "Robot Agent", duty: "机收路径与卸粮点" },
        { name: "Yield Agent", duty: "实收测产校准" },
        { name: "Finance Agent", duty: "吨成本与损耗" },
      ],
      timeline: [
        { t: "模拟", event: "籽粒含水 24.5% 为仿真快照，待校准测量" },
        { t: "NO_GO", event: "试收损失、道路隔离、烘干与仓容证据未齐全" },
        { t: "待补证", event: "完成现场复核后再由机务负责人排程" },
      ],
    },
    {
      id: "JOINT-003",
      title: "C-01 冬麦适播 · 播前整地备播",
      land: "C-01",
      scene: "秋种备播",
      status: "NO_GO",
      progress: 8,
      window: "待本地农业生态区模板批准",
      machines: [
        { code: "TRACTOR-001", role: "播前整地", vendor: "雷沃重工", status: "整备", agent: "Robot Agent" },
        { code: "SEEDER-001", role: "精量条播", vendor: "雷沃重工", status: "整备待播", agent: "Robot Agent" },
      ],
      agents: [
        { name: "Farm Master", duty: "适播期与腾茬节奏" },
        { name: "Weather", duty: "底墒与初霜风险" },
        { name: "Crop Expert", duty: "品种与播量" },
      ],
      timeline: [
        { t: "计划", event: "完成播前整地与底墒核验" },
        { t: "NO_GO", event: "库尔勒不得直接套用北疆适播期，需本地农艺师复核" },
      ],
    },
  ];

  const agents = [
    { id: 1, name: "Farm Master Agent", role: "农业生产总控", status: "规则分析", last_action: "已生成协同编排草稿，等待人工复核", memory: ["B-01 脱叶待补证", "B-02 机收待补证", "C-01 区域模板待核实"], tools: ["任务编排", "Agent通信", "KPI评估"], score: null, score_label: "未验证", recent: [] },
    { id: 2, name: "Crop Expert Agent", role: "作物生长分析", status: "规则分析", last_action: "开絮快照仅用于触发样方核验，不形成施药结论", memory: ["模拟开絮 68–72%", "本地阈值待核实"], tools: ["长势评估", "处方建议"], score: null, score_label: "未验证", recent: [] },
    { id: 3, name: "Irrigation Agent", role: "智能灌溉决策", status: "规则分析", last_action: "关键水量输入不完整，处方 NO_GO", memory: ["节水 20% 为目标值", "田间持水量/ETc 待补"], tools: ["墒情计算", "候选处方"], score: null, score_label: "未验证", recent: [] },
    { id: 4, name: "Vision Agent", role: "视觉识别", status: "规则分析", last_action: "仅生成关键词规则仿真结果，等待原始影像与验证集", memory: ["样本量为界面模拟", "89.5% 为待验证目标"], tools: ["开絮检测", "长势分割"], score: null, score_label: "未验证", recent: [] },
    { id: 5, name: "Robot Agent", role: "无人设备调度", status: "安全锁定", last_action: "高风险机收/喷雾缺证据，未生成设备命令", memory: ["设备 ACK 未接入", "作业边界待核验"], tools: ["路径草拟", "调度建议"], score: null, score_label: "未验证", recent: [] },
    { id: 6, name: "Yield Agent", role: "产量预测", status: "规则分析", last_action: "仿真产量估算尚无本场测产校准", memory: ["历史基线为模拟", "实收校准待导入"], tools: ["产量模型", "偏差分析"], score: null, score_label: "未验证", recent: [] },
    { id: 7, name: "Finance Agent", role: "收益分析", status: "规则分析", last_action: "增收为目标区间，缺基线与成本台账", memory: ["节水减药目标", "成本与价格待导入"], tools: ["成本测算", "ROI 草稿"], score: null, score_label: "未验证", recent: [] },
  ];

  const tasks = [
    { id: 1, title: "B-01 脱叶候选处方复核", task_type: "植保", land_code: "B-01", operation_key: "B-01-defoliant", assignee: "Crop Expert Agent", status: "待审核", scheduled_at: "待证据齐全", priority: "高", audit_note: "缺 7 日天气、药剂标签、样方、剂量校准与人工批准，当前 NO_GO" },
    { id: 2, title: "B-02 机收条件与试收复核", task_type: "机收", land_code: "B-02", operation_key: "B-02-harvest", assignee: "Robot Agent", status: "待审核", scheduled_at: "待证据齐全", priority: "高", audit_note: "缺成熟度、校准含水率、试收损失、道路隔离和仓容证据，当前 NO_GO" },
    { id: 3, title: "A 区开絮样方与候选航线复核", task_type: "巡检", land_code: "A-01", operation_key: "A-01-scout", assignee: "Vision Agent", status: "待人工确认", scheduled_at: "模拟 2026-09-14 14:00", priority: "中", audit_note: "仅限调查取证；须核对空域、天气、返航点与人员隔离，当前不可执行" },
    { id: 4, title: "C-01 冬麦本地规则复核", task_type: "农机", land_code: "C-01", operation_key: "C-01-sow", assignee: "Crop Expert Agent", status: "待审核", scheduled_at: "待本地模板批准", priority: "高", audit_note: "库尔勒不可套用北疆模板，当前 NO_GO" },
    { id: 5, title: "秋收测产周报模拟", task_type: "分析", land_code: "全场", assignee: "Yield Agent", status: "已完成", scheduled_at: "模拟 2026-09-11 18:00", priority: "低", audit_note: "仿真归档，不代表现场测产结论", simulated: true },
    { id: 6, title: "籽棉仓容与质检能力复核", task_type: "仓储", land_code: "全场", assignee: "Finance Agent", status: "待审核", scheduled_at: "模拟 2026-09-13 16:00", priority: "中", audit_note: "缺仓容、含水阈值、质检流程和负责人确认，当前 NO_GO" },
    { id: 7, title: "B-01 脱叶候选方案证据复核", task_type: "分析", land_code: "B-01", assignee: "Crop Expert Agent", status: "待审核", scheduled_at: "模拟 2026-09-13 08:40", priority: "高", audit_note: "开絮 58% 为模拟；缺药剂标签、剂量校准、天气、样方和批准，当前 NO_GO" },
    { id: 8, title: "C-01 播前底墒证据补全", task_type: "水肥", land_code: "C-01", assignee: "Irrigation Agent", status: "待审核", scheduled_at: "模拟 2026-09-13 11:00", priority: "中", audit_note: "水量未计算；缺田间持水量、根层、ETc、有效降雨和传感器 QC，当前 NO_GO" },
    { id: 9, title: "全场节水节肥目标核验", task_type: "分析", land_code: "全场", assignee: "Finance Agent", status: "待审核", scheduled_at: "模拟 2026-09-13 17:30", priority: "高", audit_note: "20%/15% 为目标场景；需基线、计量口径和实测台账，当前不可用于绩效结论" },
    { id: 10, title: "A-02 吐絮长势调查候选", task_type: "巡检", land_code: "A-02", operation_key: "A-02-fly", assignee: "Vision Agent", status: "待人工确认", scheduled_at: "模拟 2026-09-14 10:00", priority: "中", audit_note: "缺空域、天气、航线和人员隔离复核，当前 NO_GO" },
    { id: 11, title: "A-01 脱叶后叶色样方复核", task_type: "植保", land_code: "A-01", operation_key: "A-01-defol-check", assignee: "Crop Expert Agent", status: "待审核", scheduled_at: "模拟 2026-09-15 09:00", priority: "高", audit_note: "仅登记样方复核；缺原始影像、调查记录和专家签署，当前 NO_GO" },
    { id: 12, title: "B-02 卸粮能力与道路隔离复核", task_type: "机收", land_code: "B-02", operation_key: "B-02-haul", assignee: "Robot Agent", status: "待审核", scheduled_at: "模拟 2026-09-13 15:30", priority: "高", audit_note: "道路隔离、卸粮能力和机手确认未完成，当前 NO_GO" },
    { id: 13, title: "C-02 乳熟期营养证据复核", task_type: "水肥", land_code: "C-02", operation_key: "C-02-k", assignee: "Irrigation Agent", status: "待审核", scheduled_at: "模拟 2026-09-16 08:00", priority: "中", audit_note: "历史草案曾写 6 kg/亩；关键输入不全，不生成剂量，当前 NO_GO" },
    { id: 14, title: "A-02 机采通道与人员隔离复核", task_type: "农机", land_code: "A-02", operation_key: "A-02-path", assignee: "Robot Agent", status: "待审核", scheduled_at: "模拟 2026-09-17 06:30", priority: "中", audit_note: "缺道路踏勘、障碍物记录、人员隔离和机手确认，当前 NO_GO" },
    { id: 15, title: "B-01 北条带脱叶证据补全", task_type: "植保", land_code: "B-01", operation_key: "B-01-respray", assignee: "Robot Agent", status: "待审核", scheduled_at: "模拟 2026-09-14 08:30", priority: "高", audit_note: "缺原始影像、样方、天气窗、药剂标签与独立复核，当前 NO_GO" },
    { id: 16, title: "全场病虫风险模拟图复核", task_type: "巡检", land_code: "全场", assignee: "Vision Agent", status: "待人工确认", scheduled_at: "模拟 2026-09-13 11:20", priority: "中", audit_note: "风险指数为仿真值，需原始影像、物种/病级、调查方法和当地阈值，当前不可执行" },
    { id: 17, title: "C-01 播量与品种证据复核", task_type: "分析", land_code: "C-01", operation_key: "C-01-seed", assignee: "Crop Expert Agent", status: "待审核", scheduled_at: "模拟 2026-09-17 14:00", priority: "高", audit_note: "历史草案曾写新冬20、18 kg/亩；区域模板与种子证据未核验，当前 NO_GO" },
    { id: 18, title: "B-02 实收测产校准候选", task_type: "分析", land_code: "B-02", operation_key: "B-02-yield", assignee: "Yield Agent", status: "待人工确认", scheduled_at: "模拟 2026-09-14 16:00", priority: "中", audit_note: "缺称重、面积、含水率、抽样和仪表校准证据，当前 NO_GO" },
    { id: 19, title: "一号仓温湿度模拟核验", task_type: "仓储", land_code: "全场", assignee: "Finance Agent", status: "待人工确认", scheduled_at: "模拟 2026-09-13 18:00", priority: "低", audit_note: "需接入校准仪表和仓储台账后确认；当前不代表真实仓况" },
  ];

  /** 本周农事额外作业（补充地块主任务之外的专项） */
  const extraWeekJobs = [
    { code: "A-01", name: "北区一号田", crop_name: "棉花", area_mu: 120, task_type: "巡田", tag: "开絮复测", cls: "orange", score: 72, day_offset: 0, plan_slot: "待飞行前证据与人工门禁核验", resource: "UAV-001", priority_label: "中", agent: "Vision Agent", agent_tip: "A 区开絮样方复核", action: "scout", jump: "robots", reason: "开絮率样方抽检", level: "vision", job_key: "A-01-scout" },
    { code: "A-02", name: "北区二号田", crop_name: "棉花", area_mu: 90, task_type: "巡田", tag: "长势复飞", cls: "orange", score: 68, day_offset: 1, plan_slot: "待飞行前证据与人工门禁核验", resource: "UAV-002", priority_label: "中", agent: "Vision Agent", agent_tip: "吐絮长势热力更新", action: "scout", jump: "robots", reason: "叶色与开絮同步复测", level: "vision", job_key: "A-02-fly" },
    { code: "A-01", name: "北区一号田", crop_name: "棉花", area_mu: 150, task_type: "植保复核", tag: "叶色证据复核", cls: "orange", score: 80, day_offset: 2, plan_slot: "待证据与人工门禁核验", resource: "Crop Expert", priority_label: "高", agent: "Crop Expert Agent", agent_tip: "脱叶后叶色边界证据复核", action: "defoliant", jump: "fleet", reason: "脱叶效果证据待补", level: "defoliant", job_key: "A-01-defol-check" },
    { code: "B-02", name: "中区玉米田", crop_name: "玉米", area_mu: 80, task_type: "机收复核", tag: "卸粮与道路复核", cls: "orange", score: 84, day_offset: 0, plan_slot: "待证据与人工门禁核验", resource: "TRUCK-001", priority_label: "高", agent: "Robot Agent", agent_tip: "卸粮能力、道路隔离与错峰草案待核验", action: "harvest", jump: "fleet", reason: "转运能力与道路证据待补", level: "harvest", job_key: "B-02-haul" },
    { code: "C-02", name: "南区轮作田", crop_name: "玉米", area_mu: 160, task_type: "水肥复核", tag: "营养证据复核", cls: "orange", score: 66, day_offset: 3, plan_slot: "待证据与人工门禁核验", resource: "泵房轮灌", priority_label: "中", agent: "Irrigation Agent", agent_tip: "乳熟期钾素与水肥输入证据复核", action: "irrigation", jump: "water", reason: "钾素模拟指标偏低，待化验与处方证据", level: "irrigation", job_key: "C-02-k" },
    { code: "A-02", name: "北区二号田", crop_name: "棉花", area_mu: 110, task_type: "农机复核", tag: "通道安全复核", cls: "orange", score: 62, day_offset: 4, plan_slot: "待证据与人工门禁核验", resource: "TRACTOR-001", priority_label: "中", agent: "Robot Agent", agent_tip: "道路踏勘、障碍记录与人员隔离待核验", action: "auto", jump: "fleet", reason: "机采通道安全证据待补", level: "watch", job_key: "A-02-path" },
    { code: "B-01", name: "中区棉花田", crop_name: "棉花", area_mu: 95, task_type: "植保复核", tag: "北带证据补全", cls: "red", score: 90, day_offset: 1, plan_slot: "待证据与人工门禁核验", resource: "SPRAY-002", priority_label: "紧急", agent: "Robot Agent", agent_tip: "北条带原始影像、样方、天气与标签证据待补", action: "defoliant", jump: "fleet", reason: "覆盖不足为模拟判断，需现场复核", level: "defoliant", job_key: "B-01-respray", conflict: true },
    { code: "C-01", name: "南区小麦田", crop_name: "小麦", area_mu: 200, task_type: "分析", tag: "播量证据复核", cls: "orange", score: 70, day_offset: 4, plan_slot: "待证据与人工门禁核验", resource: "Crop Expert", priority_label: "高", agent: "Crop Expert Agent", agent_tip: "品种、种子批次与播量证据复核", action: "sow", jump: "tasks", reason: "适播参数尚未获属地批准", level: "sow", job_key: "C-01-seed" },
    { code: "B-02", name: "中区玉米田", crop_name: "玉米", area_mu: 120, task_type: "分析", tag: "测产证据校准", cls: "orange", score: 74, day_offset: 1, plan_slot: "待飞行前证据与人工门禁核验", resource: "UAV-002", priority_label: "中", agent: "Yield Agent", agent_tip: "实收样点、面积、含水率与仪表校准待补", action: "scout", jump: "history", reason: "测产模型等待实收证据", level: "vision", job_key: "B-02-yield" },
    { code: "C-02", name: "南区轮作田", crop_name: "玉米", area_mu: 100, task_type: "巡田", tag: "乳熟巡查", cls: "orange", score: 58, day_offset: 5, plan_slot: "待飞行前证据与人工门禁核验", resource: "UAV-001", priority_label: "低", agent: "Vision Agent", agent_tip: "乳熟期倒伏与穗腐排查", action: "scout", jump: "diagnosis", reason: "后期管护巡查", level: "vision", job_key: "C-02-scout" },
  ];

  function operationMeta(code) {
    const operationKey = String(code || "");
    const job = extraWeekJobs.find((item) => (item.job_key || `${item.code}-${item.tag || item.task_type}`) === operationKey) || null;
    return {
      operation_key: job ? job.job_key : operationKey,
      land_code: job ? job.code : operationKey,
      job,
    };
  }

  function operationSafety(job) {
    const templates = {
      scout: {
        required_evidence: ["飞行计划与属地要求", "风速/能见度/降水", "电池/RTK/返航点", "人员隔离", "带时间位置的原始影像"],
        stop_condition: "超风限、降水、失去 RTK/链路、人员进入作业区或电量不足",
        accountable_person: "飞手 + 田间调查员",
      },
      defoliant: {
        required_evidence: ["开絮样方", "未来 7 天天气", "药剂标签", "品种长势", "校准剂量", "人工批准"],
        stop_condition: "天气不符标签、漂移风险、人员隔离失败或样方不支持",
        accountable_person: "植保员 + 农艺师",
      },
      harvest: {
        required_evidence: ["成熟/黑层证据", "校准含水率", "试收损失与破碎率", "道路隔离", "运输/烘干/仓容"],
        stop_condition: "降雨/夜间风险、道路冲突、试收损失超限或收储能力不足",
        accountable_person: "机务负责人 + 仓储负责人",
      },
      irrigation: {
        required_evidence: ["采样深度与 QC", "田间持水量", "根层", "ETc 与有效降雨", "灌溉效率", "阀泵现场状态"],
        stop_condition: "数据过期/异常、处方未复核、阀泵或管路状态不可确认",
        accountable_person: "水肥管理员 + 农艺师",
      },
      sow: {
        required_evidence: ["本地农业生态区模板", "批准品种与批次", "发芽率/千粒重", "目标基本苗", "播层墒情", "机具校准"],
        stop_condition: "区域模板未批准、种子或底墒不合格、播种机未校准",
        accountable_person: "本地农艺师 + 机手",
      },
      auto: {
        required_evidence: ["作业边界与障碍图", "道路/人员隔离", "机具点检", "机手与监护人", "天气和地面通行性"],
        stop_condition: "人员进入、障碍未清、定位/通信异常、机具故障或地面不可通行",
        accountable_person: "机务负责人 + 现场监护人",
      },
    };
    const template = templates[(job && job.action) || "auto"] || templates.auto;
    return {
      decision: "NO_GO",
      executable: false,
      evidence_status: job && (job.action === "scout" || job.action === "watch")
        ? "飞行前证据与任务产出证据待核验"
        : "关键证据缺失",
      required_evidence: template.required_evidence,
      stop_condition: template.stop_condition,
      accountable_person: template.accountable_person,
      due_at: job && (job.action === "scout" || job.action === "watch") ? "起飞前完成" : "人工门禁前完成",
    };
  }

  function operationSnapshot(code) {
    const operation = operationMeta(code);
    const land = lands.find((item) => item.code === operation.land_code) || null;
    const baseRule = land ? landUrgencyOf(land) : {
      action: "watch",
      decision: "NO_GO",
      executable: false,
      required_evidence: ["有效地块与任务规范"],
    };
    const canonicalAction = (operation.job && operation.job.action) || baseRule.action || "watch";
    const safety = operation.job
      ? {
          ...baseRule,
          ...operationSafety(operation.job),
          action: canonicalAction,
          tag: operation.job.tag,
          reason: operation.job.reason,
          score: operation.job.score,
        }
      : { ...baseRule, action: canonicalAction };
    return { operation, land, canonical_action: canonicalAction, safety };
  }

  function currentFarmOwnsOperation(code) {
    return currentFarmOwnsLand(operationMeta(code).land_code);
  }

  function taskMatchesOperation(task, code) {
    const meta = operationMeta(code);
    return task.operation_key === meta.operation_key || (!task.operation_key && task.land_code === meta.land_code);
  }

  /* 仅水合回放队列；高风险作业由 operationSafety 持续保持 NO_GO。 */
  (function hydrateOpsFromTasks() {
    const board = buildLandBoard();
    const byCode = Object.fromEntries(board.map((b) => [b.code, b]));
    tasks.forEach((t) => {
      const landCode = t.land_code;
      const code = t.operation_key || landCode;
      if (!landCode || landCode === "全场") return;
      const meta = byCode[landCode];
      const dayOff = meta && typeof meta.day_offset === "number" ? meta.day_offset : 0;
      const snapshot = operationSnapshot(code);
      const verifiedGate = snapshot.safety.decision === "GO_APPROVED" && snapshot.safety.executable === true &&
        t.gate_decision === "GO_APPROVED" && t.preflight_verified === true && t.device_interlock_verified === true;
      if (["进行中", "执行中", "待执行", "待人工确认", "已下发"].includes(t.status) && !verifiedGate) {
        t.status = "待审核";
        t.audit_note = (t.audit_note ? `${t.audit_note} · ` : "") + "缺 GO_APPROVED、作业前证据或设备安全联锁，已阻断状态水合";
        return;
      }
      if (t.status === "进行中" || t.status === "执行中") {
        if (dayOff > 0) {
          t.status = "待执行";
          if (!humanGate.dispatched[code] && !humanGate.running[code] && !humanGate.halted[code]) {
            humanGate.dispatched[code] = {
              action: snapshot.canonical_action,
              at: t.scheduled_at || new Date().toLocaleString("zh-CN"),
              title: t.title,
              cmd_status: "回放队列 · 无设备回执",
              gate_decision: "GO_APPROVED",
              preflight_verified: true,
              device_interlock_verified: true,
              simulated: true,
            };
          }
          return;
        }
        if (humanGate.halted[code] || humanGate.running[code]) return;
        humanGate.running[code] = {
          action: snapshot.canonical_action,
          at: t.scheduled_at || new Date().toLocaleString("zh-CN"),
          title: t.title,
          cmd_status: "模拟执行状态 · 无设备回执",
          gate_decision: "GO_APPROVED",
          preflight_verified: true,
          device_interlock_verified: true,
          simulated: true,
        };
        return;
      }
      if (t.status === "待执行" || t.status === "待人工确认" || t.status === "已下发") {
        if (humanGate.running[code] || humanGate.halted[code] || humanGate.dispatched[code]) return;
        humanGate.dispatched[code] = {
          action: snapshot.canonical_action,
          at: t.scheduled_at || new Date().toLocaleString("zh-CN"),
          title: t.title,
          cmd_status: "回放队列 · 无设备回执",
          gate_decision: "GO_APPROVED",
          preflight_verified: true,
          device_interlock_verified: true,
          simulated: true,
        };
      }
    });
  })();

  const expertReviews = [];
  const govFlags = [];

  const plans = [
    { id: 1, land_code: "B-01", water_mm: null, calculation_status: "NOT_CALCULATED", fertilizer: "脱叶候选处方草稿；药剂与剂量尚未核验", reason: "开絮 58% 为仿真快照，缺天气、标签、样方和人工批准", status: "NO_GO · 待补证据", created_at: "数据记录 2026-09-12 07:20", executable: false },
    { id: 2, land_code: "C-01", water_mm: null, calculation_status: "NOT_CALCULATED", fertilizer: "播前底墒候选方案；未计算实际水量", reason: "缺田间持水量、根层、ETc、有效降雨、效率和传感器 QC", status: "NO_GO · 待补证据", created_at: "数据记录 2026-09-12 08:10", executable: false },
  ];

  const robotMissions = [
    { id: 1, device: "UAV-001", mission: "B-01 开絮侦察仿真航线", status: "待人工确认", progress: 58, eta: "待空域/天气核验", simulated: true },
    { id: 2, device: "HARVEST-001", mission: "B-02 机收候选路线回放", status: "NO_GO", progress: 34, eta: "待试收/道路/仓容证据", simulated: true },
    { id: 3, device: "SPRAY-002", mission: "B-01 脱叶变量喷施处方回放", status: "NO_GO", progress: 41, eta: "待标签/剂量/人工批准", simulated: true },
    { id: 4, device: "TRACTOR-001", mission: "C-01 冬麦播前整地候选路线", status: "NO_GO", progress: 0, eta: "待本地模板批准", simulated: true },
  ];

  const knowledge = [
    { id: 1, title: "棉花脱叶证据清单（仿真摘要）", source: "待绑定属地农技原文与版本", snippet: "须同时核验开絮样方、未来天气、登记药剂标签、剂量校准、清场和人工批准；摘要不可替代标签与属地规程。", verified: false },
    { id: 2, title: "玉米机械收获减损核查（仿真摘要）", source: "待绑定官方技术意见原文", snippet: "成熟度和含水率不能单独决定开机；需试收损失、破碎/含杂、道路、运输、烘干与仓容证据。", verified: false },
    { id: 3, title: "冬小麦播种区域规则（仿真摘要）", source: "待绑定当地生态区与种植制度", snippet: "不得把北疆日期直接套用于库尔勒；应确认本地品种目录、种子批次、目标基本苗、底墒与机具校准。", verified: false },
    { id: 4, title: "灌溉与水肥证据清单（仿真摘要）", source: "待绑定官方指南、计量基线与田间台账", snippet: "处方应基于根层、田间持水量、ETc、有效降雨、灌溉效率和传感器 QC；20% 节水仅为待验证目标。", verified: false },
  ];

  /** 历年地块档案（2023–2026，对齐新疆棉/粮轮作） */
  function buildLandHistory() {
    const years = [2023, 2024, 2025, 2026];
    const base = {
      "A-01": { crop: "棉花", y: [428, 441, 452, 455], w: [320, 305, 292, 286], f: [46, 42, 40, 38], p: [4, 3, 2, 1], h: [84, 86, 88, 90] },
      "A-02": { crop: "棉花", y: [435, 448, 460, 468], w: [315, 300, 290, 284], f: [45, 41, 39, 37], p: [5, 3, 2, 2], h: [80, 83, 85, 86] },
      "B-01": { crop: "棉花", y: [410, 425, 438, 442], w: [335, 318, 302, 295], f: [48, 44, 41, 39], p: [6, 4, 3, 2], h: [74, 77, 80, 82] },
      "B-02": { crop: "玉米", y: [650, 680, 705, 720], w: [280, 268, 255, 248], f: [52, 48, 45, 43], p: [2, 2, 1, 1], h: [88, 90, 92, 93] },
      "C-01": { crop: "小麦", y: [390, 405, 418, 430], w: [260, 250, 242, 236], f: [40, 38, 36, 34], p: [3, 2, 2, 1], h: [78, 80, 82, 84] },
      "C-02": { crop: "玉米", y: [610, 630, 645, 660], w: [290, 278, 265, 258], f: [50, 47, 44, 42], p: [3, 2, 2, 1], h: [80, 83, 85, 87] },
    };
    const notes = {
      2023: "偏旱年，中后期补灌次数偏多",
      2024: "模拟场景：温光条件较适宜，节水目标进入回放",
      2025: "病虫压力中等，局部复飞防控",
      2026: "吐絮盛期推进脱叶与机收，冬麦备播",
    };
    const rows = [];
    lands.forEach((land) => {
      const b = base[land.code];
      if (!b) return;
      years.forEach((year, i) => {
        rows.push({
          year,
          land_code: land.code,
          land_name: land.name,
          area_mu: land.area_mu,
          crop: year === 2026 ? land.crop_name : b.crop,
          variety: land.variety,
          yield_kg_mu: b.y[i],
          water_m3_mu: b.w[i],
          fert_kg_mu: b.f[i],
          pest_events: b.p[i],
          health_avg: b.h[i],
          stage_peak: year === 2026 ? land.stage : (b.crop === "棉花" ? "吐絮期" : b.crop === "小麦" ? "灌浆—成熟" : "灌浆—成熟"),
          note: notes[year],
          tasks_done: 18 + i * 3 + (land.id % 4),
          saving_water_pct: Math.round(12 + i * 2.5),
        });
      });
    });
    return rows;
  }
  const landHistory = buildLandHistory();
  landHistory.forEach((row) => {
    row.simulated = true;
    row.verified = false;
    row.source = "仿真档案快照";
    row.note = `模拟 · ${row.note}`;
  });

  /** 系统任务执行记录（可追溯） */
  let taskExecLog = [
    { id: "EX-260912-01", task_id: 1, title: "B-01 脱叶流程回放", task_type: "植保", land_code: "B-01", agent: "Robot Agent", status: "流程回放", started_at: "记录 2026-09-12 09:32", finished_at: "—", duration_min: 48, result: "回放进度 41%；不代表施药，当前 NO_GO", year: 2026, simulated: true },
    { id: "EX-260912-02", task_id: 2, title: "B-02 机收流程回放", task_type: "机收", land_code: "B-02", agent: "Robot Agent", status: "流程回放", started_at: "记录 2026-09-12 07:05", finished_at: "—", duration_min: 186, result: "回放进度 34%；不代表机具已作业，当前 NO_GO", year: 2026, simulated: true },
    { id: "EX-260911-01", task_id: 5, title: "秋收测产周报模拟", task_type: "分析", land_code: "全场", agent: "Yield Agent", status: "回放归档", started_at: "模拟 2026-09-11 16:10", finished_at: "模拟 2026-09-11 17:48", duration_min: 98, result: "仿真估算：棉花 442–468 kg/亩、玉米约 720 kg/亩；未经本场测产校准", year: 2026, simulated: true },
    { id: "EX-260910-03", task_id: 0, title: "A-01/A-02 开絮航测模拟", task_type: "巡检", land_code: "A-01", agent: "Vision Agent", status: "回放归档", started_at: "模拟 2026-09-10 10:00", finished_at: "模拟 2026-09-10 11:22", duration_min: 82, result: "模拟识别：A-01 72%、A-02 68%；缺原始影像与人工样方复核", year: 2026, simulated: true },
    { id: "EX-260908-02", task_id: 0, title: "全场控水流程模拟", task_type: "水肥", land_code: "全场", agent: "Irrigation Agent", status: "回放归档", started_at: "模拟 2026-09-08 08:00", finished_at: "模拟 2026-09-08 09:15", duration_min: 75, result: "仅仿真秋收期控水流程；不代表阀泵已切换", year: 2026, simulated: true },
    { id: "EX-250928-01", task_id: 0, title: "B-01 机采流程历史模拟", task_type: "机收", land_code: "B-01", agent: "Robot Agent", status: "回放归档", started_at: "模拟 2025-09-28 07:00", finished_at: "模拟 2025-09-30 18:40", duration_min: 2140, result: "模拟折籽棉估算约 438 kg/亩；无称重、面积与含水校准证据", year: 2025, simulated: true },
    { id: "EX-250920-04", task_id: 0, title: "C-01 冬麦播种历史模拟", task_type: "农机", land_code: "C-01", agent: "Robot Agent", status: "回放归档", started_at: "模拟 2025-09-22 06:30", finished_at: "模拟 2025-09-23 17:00", duration_min: 2070, result: "模拟出苗率 91%；无本地播期模板与田间验收记录", year: 2025, simulated: true },
    { id: "EX-250715-02", task_id: 0, title: "花铃期变量追肥", task_type: "水肥", land_code: "B-01", agent: "Irrigation Agent", status: "已完成", started_at: "2025-07-15 09:00", finished_at: "2025-07-15 14:20", duration_min: 320, result: "节肥约 14%，长势回升", year: 2025 },
    { id: "EX-240925-01", task_id: 0, title: "全场棉花脱叶联合作业", task_type: "植保", land_code: "全场", agent: "Farm Master Agent", status: "已完成", started_at: "2024-09-18 09:00", finished_at: "2024-09-19 16:00", duration_min: 1860, result: "机采效率提升，品级稳定", year: 2024 },
    { id: "EX-240610-03", task_id: 0, title: "B-02 玉米中耕追肥", task_type: "农机", land_code: "B-02", agent: "Robot Agent", status: "已完成", started_at: "2024-06-10 07:30", finished_at: "2024-06-10 15:50", duration_min: 500, result: "作业质量达标", year: 2024 },
    { id: "EX-231005-01", task_id: 0, title: "干旱年应急补灌", task_type: "水肥", land_code: "B-01", agent: "Irrigation Agent", status: "已完成", started_at: "2023-07-22 05:40", finished_at: "2023-07-22 11:10", duration_min: 330, result: "保住花铃，单产仍低于常年", year: 2023 },
    { id: "EX-230930-02", task_id: 0, title: "秋收测产归档", task_type: "分析", land_code: "全场", agent: "Yield Agent", status: "已完成", started_at: "2023-09-30 14:00", finished_at: "2023-09-30 17:30", duration_min: 210, result: "年度档案入库", year: 2023 },
  ];
  taskExecLog = taskExecLog.map((entry) => ({
    ...entry,
    title: /模拟|仿真/.test(String(entry.title || "")) ? entry.title : `${entry.title}（历史模拟）`,
    status: entry.status === "流程回放" ? entry.status : "回放归档",
    started_at: /^模拟|^—/.test(String(entry.started_at || "")) ? entry.started_at : `模拟 ${entry.started_at}`,
    finished_at: /^模拟|^—/.test(String(entry.finished_at || "")) ? entry.finished_at : `模拟 ${entry.finished_at}`,
    simulated: true,
    verified: false,
    source: "作业履历",
    result: String(entry.result || "").startsWith("模拟") || String(entry.result || "").startsWith("模拟")
      ? entry.result
      : `模拟 · ${entry.result}`,
  }));

  const models = [
    { name: "AgrLLM-Farm-7B", type: "LLM", version: "v2.4-demo", status: "仿真模型", metric: "可用率目标 93% · 未验证" },
    { name: "PestVision-X", type: "Vision", version: "v3.1-demo", status: "仿真模型", metric: "准确率目标 89.5% · 无本场验证集" },
    { name: "YieldPredict-V3", type: "Prediction", version: "v3.2-demo", status: "仿真模型", metric: "RMSE 目标 18.6 kg/亩 · 未校准" },
    { name: "IrrigateOpt", type: "Simulation", version: "v1.8-demo", status: "仿真模型", metric: "节水目标约 20% · 待基线核验" },
  ];

  const assets = [
    { id: "gis-1", name: "地块边界与权属图层", asset_type: "GIS", volume: "模拟 · 2,000 亩 / 6 地块", owner: "地块服务", value_note: "仿真一张图底图", market: "农场版", preview: "A-01~C-02 屏幕示意边界 · 无坐标系与测绘来源", updated: "2026-09-14 模拟" },
    { id: "hist-1", name: "历年地块与任务履历", asset_type: "时序", volume: "模拟 · 2023–2026 / 6 地块", owner: "归档服务", value_note: "产量/用水/健康度与作业回放", market: "农场版", preview: "仿真按年、按地块对比与回放时间线", updated: "2026-09-14 模拟" },
    { id: "ts-1", name: "土壤含水率时序", asset_type: "时序", volume: "模拟 · 多深度", owner: "设备服务", value_note: "灌溉与秋收控水决策", market: "企业版", preview: "B-01 20cm 含水 23.6% · 模拟趋势", updated: "2026-09-14 模拟" },
    { id: "img-1", name: "开絮与脱叶影像库", asset_type: "影像", volume: "仿真索引 1.8 万张", owner: "影像服务", value_note: "仿真识别指标约 89.5%", market: "模型市场", preview: "B-01 模拟航线资料", updated: "2026-09-14 模拟" },
    { id: "kg-1", name: "农业知识图谱", asset_type: "图谱", volume: "仿真规模 · 4.8 万节点", owner: "检索服务", value_note: "仿真吐絮/机收/适播问答", market: "政府版", preview: "仿真索引；官方原文与版本待绑定", updated: "2026-09-14 模拟" },
    { id: "md-1", name: "产量预测模型 V3.2", asset_type: "模型", volume: "棉花/玉米/小麦", owner: "模型服务", value_note: "仿真校准中", market: "模型市场", preview: "模拟预测：棉花 442–468 kg/亩 · 玉米 720 kg/亩", updated: "2026-09-14 模拟" },
    { id: "tr-1", name: "无人作业轨迹包", asset_type: "轨迹", volume: "仿真：脱叶+机收编队", owner: "设备调度", value_note: "处方回放模拟", market: "Agent市场", preview: "JOINT-001/002 模拟轨迹可回放", updated: "2026-09-14 模拟" },
    { id: "vec-1", name: "向量知识库", asset_type: "向量", volume: "仿真规模 · 86 万条", owner: "检索服务", value_note: "仿真检索增强问答", market: "企业版", preview: "仿真索引；原文授权与版本待核验", updated: "2026-09-14 模拟" },
  ];

  const edge = {
    gateway: "田间汇聚网关 · 仿真拓扑",
    cache: "本地模拟缓存 · 未接生产链路",
    edge_ai: "田间智能节点 ×3 · 规划模拟",
    protocol: "设备互联协议 · 能力目录",
    topics: ["田间传感上送主题", "候选机具指令主题", "智能体事件总线主题"],
  };

  const architecture = {
    layers: [
      { name: "感知层", items: ["单株表型", "传感网格", "无人机", "卫星", "农机"] },
      { name: "数据层", items: ["PostgreSQL", "PostGIS", "TimescaleDB", "Milvus", "Neo4j", "MinIO"] },
      { name: "AI层", items: ["农业大模型", "RAG", "Vision", "Prediction", "Simulation"] },
      { name: "Agent层", items: ["Farm Master", "Crop", "Irrigation", "Vision", "Robot", "Yield", "Finance"] },
      { name: "执行层", items: ["水肥设备", "无人机", "无人农机", "机器人"] },
      { name: "商业层", items: ["SaaS", "数据资产", "Agent市场", "模型市场"] },
    ],
    loop: "单株感知 → 数据平台 → 农业大模型 → 多智能体 → 无人设备 → 生产反馈",
  };

  let seq = 100;
  let role = "farm"; // farm | expert | gov

  function kpis() {
    const gateways = devices.filter((d) => !d.mesh);
    const sensors = devices.filter((d) => d.mesh);
    const onlineGw = gateways.filter((d) => d.status !== "离线" && d.status !== "故障" && d.status !== "弱信号").length;
    const onlineSensor = sensors.filter((d) => d.status === "在线").length;
    const avgHealth = +(lands.reduce((s, l) => s + l.health_index, 0) / lands.length).toFixed(1);
    const yieldAvg = Math.round(lands.reduce((s, l) => s + l.expected_yield, 0) / lands.length);
    const avgRisk = Math.round(lands.reduce((s, l) => s + l.pest_risk, 0) / lands.length);
    const plantWatch = plants.filter((p) => p.status !== "正常").length;
    const canopyAvg = Math.round(plants.reduce((s, p) => s + p.canopy.vigor, 0) / Math.max(1, plants.length));
    const rootAvg = Math.round(plants.reduce((s, p) => s + p.root.vigor, 0) / Math.max(1, plants.length));
    return {
      area_mu: farm.area_mu,
      agents: agents.length,
      devices_online: onlineGw,
      devices_total: gateways.length,
      sensors_online: onlineSensor,
      sensors_total: sensors.length,
      plants_total: plants.length,
      plants_watch: plantWatch,
      canopy_avg: canopyAvg,
      root_avg: rootAvg,
      water_saving: 20,
      fertilizer_saving: 15,
      pesticide_saving: 18,
      income_per_mu: 560,
      pest_accuracy: 89.5,
      labor_cut: 52,
      land_health: avgHealth,
      predicted_yield: yieldAvg,
      pest_risk_avg: avgRisk,
    };
  }

  function chatAnswer(q) {
    const hits = knowledge.filter((k) => k.title.includes(q.slice(0, 2)) || k.snippet.includes(q.slice(0, 2)) || /灌溉|水|墒|病|虫|产量|无人|农机|无人机|脱叶|吐絮|秋收|冬麦|玉米|政策|合规|节水/.test(q));
    const cotton = lands.filter((l) => l.crop_name === "棉花");
    const corn = lands.filter((l) => l.crop_name === "玉米");
    const focusLand = lands.find((l) => q.includes(l.code));
    let answer;
    let actions = [];
    if (/智能体|Agent|联合作业|编队|在干什么|调度链|多智能体/.test(q)) {
      const lines = agents.map((a) => `${a.name.replace(/\s*Agent$/i, "")}（${a.status}）：${a.last_action}`);
      answer = `当前展示 ${agents.length} 个本地规则智能体的仿真状态；均未连接真实模型或设备：\n` + lines.join("\n");
      const op = jointOps[0];
      if (op) {
        answer += `\n联合作业「${op.title}」为流程回放，回放进度 ${op.progress}%（${op.status}），窗口 ${op.window}。`;
      }
      actions = [
        { label: "打开智能体", jump: "agents" },
        { label: "多机协同", jump: "fleet", land: op ? op.land : "B-01" },
        { label: "本周农事", jump: "dashboard" },
      ];
    } else if (/冲突|争道|排程|调度|优先|作业窗|机具利用率|本周怎么排|先做哪/.test(q)) {
      const plan = buildWeekPlan(lands);
      const c = plan.conflict;
      answer = [
        `本周仿真农事 ${plan.work_total} 项 / ${plan.area_total} 亩：模拟进行 ${plan.running}、待登记/确认 ${plan.pending + plan.queued}。`,
        c ? `冲突：${c.text}。建议：${c.resolve}（${c.resource}）。` : "当前无资源冲突。",
        "作业窗数据源未接入，当前不可判定；可查看冲突草稿并补齐道路、人员、天气与设备证据。",
      ].join("");
      actions = [
        { label: "处理冲突", jump: "dashboard", land: "B-01" },
        { label: "看机具编队", jump: "fleet", land: "B-01" },
        { label: "打开本周农事", jump: "dashboard" },
      ];
    } else if (/脱叶|吐絮|棉花/.test(q)) {
      answer = `棉花生育期与开絮率均为仿真快照：${cotton.map((l) => `${l.code} 模拟 ${l.open_boll}%`).join("、")}。当前缺现场样方、7 日逐小时天气、药剂标签、剂量校准、清场与人工批准，结论为 NO_GO；不得据此施药。`;
      actions = [
        { label: "查看脱叶证据缺口", jump: "fleet", land: "B-01" },
        { label: "看开絮田块", jump: "twin", land: "B-01", layer: "crop" },
        { label: "联合诊断", jump: "diagnosis", land: "B-01" },
      ];
    } else if (/玉米|机收|收晒/.test(q)) {
      answer = `玉米成熟期与含水为仿真快照。机收前必须核验黑层/乳线、校准含水率、试收损失与破碎率、道路隔离、运输、烘干和仓容；当前 NO_GO。`;
      actions = [
        { label: "查看机收证据缺口", jump: "fleet", land: "B-02" },
        { label: "查看收储模拟", jump: "postharvest", land: "B-02" },
      ];
    } else if (/冬麦|小麦|播种|适播/.test(q)) {
      answer = "C-01 位于克拉玛依试验田，不得直接套用北疆播期。先绑定经属地农艺师批准的生态区与种植制度模板，并核验品种目录、种子批次/发芽率/千粒重、目标基本苗、播层墒情与机具校准；当前 NO_GO。";
      actions = [
        { label: "打开备播待办", jump: "tasks", land: "C-01" },
        { label: "看墒情图", jump: "twin", land: "C-01", layer: "moisture" },
      ];
    } else if (/历年|档案|历史|产量对比/.test(q)) {
      answer = "可在「历年档案」查看仿真产量、用水、健康度与作业履历。当前均为未验证模拟；真实归档必须绑定来源、时间戳、设备 ACK、轨迹、实际量与独立验收人。";
      actions = [{ label: "打开历年档案", jump: "history" }, { label: "看收成账", jump: "history" }];
    } else if (/灌溉|水|墒|浇/.test(q)) {
      answer = "墒情为仿真快照，缺田间持水量、根层、ETc、有效降雨、灌溉效率、流量计与传感器 QC，不能计算实际水量；当前处方为 NO_GO。20% 仅是待基线和实测台账核验的节水目标。";
      actions = [
        { label: "补齐水肥证据", jump: "water", land: focusLand ? focusLand.code : "B-01" },
        { label: "墒情图层", jump: "twin", layer: "moisture", land: focusLand ? focusLand.code : "" },
      ];
    } else if (/病|虫|叶片|黄斑/.test(q)) {
      answer = "风险指数为仿真值，不能证明病虫害可控。应先确认物种、虫态/病级、调查方法、样点与当地经济阈值；证据不足时仅可安排安全调查，不得形成施药处方。";
      actions = [
        { label: "联合诊断", jump: "diagnosis", land: focusLand ? focusLand.code : "B-01" },
        { label: "风险热力", jump: "twin", layer: "risk", land: focusLand ? focusLand.code : "B-01" },
        { label: "登记调查取证", jump: "robots", land: focusLand ? focusLand.code : "B-01" },
      ];
    } else if (/产量|增收|收益|测产/.test(q)) {
      answer = "棉花 442–468 kg/亩、玉米 720 kg/亩与亩均增收 400–600 元均为仿真估算/目标，不是本场实测结论。正式使用须补齐分地块测产、商品率、投入成本、历史基线、价格与模型验证报告。";
      actions = [{ label: "历年收成", jump: "history" }, { label: "产量预测表", jump: "ai" }];
    } else if (/无人|农机|无人机|调度|机队/.test(q)) {
      answer = "机队页面只展示候选路线和流程回放。脱叶喷雾、玉米机收与冬麦整地均缺现场证据并保持 NO_GO；没有向真实设备下发命令。";
      actions = [
        { label: "机具作业", jump: "fleet" },
        { label: "无人机调度", jump: "robots" },
      ];
    } else if (/政策|合规|节水|节肥|监管/.test(q)) {
      answer = "节水 20%、节肥 15%、减药 18% 均为目标模拟数据，当前未核验。监管可从合规目标核验板下钻，补齐基线、计量、投入品、产量与成本收益证据。";
      actions = [
        { label: "水肥节量核查", jump: "water" },
        { label: "历年档案", jump: "history" },
        { label: "收贮溯源", jump: "postharvest" },
      ];
    } else {
      answer = `当前为 2026 年 9 月新疆秋收仿真场景，不是现场实况。关于「${q}」，请先在本周农事与对应页面核验证据、属地规则和责任人，再作人工决定。`;
      actions = [
        { label: "本周农事", jump: "dashboard" },
        { label: "看田地图", jump: "twin", land: focusLand ? focusLand.code : "" },
        { label: "农事待办", jump: "tasks" },
      ];
    }
    return {
      answer,
      actions,
      rag: (hits.length ? hits : knowledge.slice(0, 2)).map((k) => {
        let jump = "ai";
        if (/脱叶|吐絮/.test(k.title)) jump = "fleet";
        else if (/冬麦|小麦|播种/.test(k.title)) jump = "tasks";
        else if (/灌溉|水|墒/.test(k.title)) jump = "water";
        else if (/病|虫/.test(k.title)) jump = "diagnosis";
        else if (/产量|测产/.test(k.title)) jump = "history";
        return { title: k.title, source: k.source, snippet: k.snippet, jump };
      }),
    };
  }

  function adaptPriorityForRole(priority, r) {
    if (!priority) return priority;
    const p = { ...priority };
    if (r === "expert") {
      p.kicker = "优先研判";
      if (p.level === "defoliant") {
        p.title = `${p.land_code} 开絮偏低 · 待审脱叶处方`;
        p.cta = "进入审核 / 诊断";
        p.jump = "tasks";
        p.desc = (p.desc || "") + " 专家请复核原始影像、样方、天气窗、药剂标签与剂量证据后再决定；当前不可执行。";
      } else if (p.level === "harvest") {
        p.title = `${p.land_code} 机收条件 · 证据待补`;
        p.cta = "核查收获证据";
        p.jump = "fleet";
        p.desc = (p.desc || "") + " 专家须复核成熟度、校准含水率、试收损失、道路隔离、运输与仓容；当前 NO_GO。";
      } else if (p.level === "vision") {
        p.cta = "打开联合诊断";
        p.jump = "diagnosis";
      } else if (p.level === "irrigation") {
        p.cta = "批注水肥证据";
        p.jump = "water";
      } else {
        p.cta = p.cta || "进入研判";
        p.jump = p.jump || "diagnosis";
      }
    } else if (r === "gov") {
      p.kicker = "优先监察";
      if (p.level === "defoliant" || p.level === "harvest") {
        p.title = `${p.land_code} 秋收窗口 · 合规跟踪`;
        p.cta = "打开高优监察";
        p.jump = "tasks";
        p.desc = "关注高风险建议的证据缺口、人工批准和流程回放痕迹；当前不得视为现场执行。";
      } else if (p.level === "irrigation") {
        p.cta = "核查节水指标";
        p.jump = "water";
      } else {
        p.cta = "查看合规板";
        p.jump = "dashboard";
      }
    }
    return p;
  }

  function agentResult(name, goal) {
    if (/Irrigation|灌溉/.test(name + goal)) return `规则分析草稿：${goal}。缺少田间持水量、根层、ETc、有效降雨、灌溉效率和传感器 QC，当前 NO_GO。`;
    if (/Vision|病|识别/.test(name + goal)) return `规则分析草稿：${goal}。风险模拟须经原始影像、复飞和样方调查确认；89.5% 是待验证目标值。`;
    if (/Robot|无人|调度/.test(name + goal)) return `仿真排程草稿：${goal}。仅生成待人工确认队列，未向真实设备下发。`;
    if (/Yield|产量/.test(name + goal)) return `仿真估算草稿：${goal}。约 520 kg/亩来自模拟公式，未经本场验证，不用于结算。`;
    if (/Finance|收益/.test(name + goal)) return `仿真收益目标：${goal}。亩增收 400–600 元待基线与实测台账核验。`;
    if (/Crop|作物|生长/.test(name + goal)) return `仿真作物分析草稿：${goal}。须补充生育期、化验、盐分和田间调查后再形成处方。`;
    if (/Master|总控|协同|编排/.test(name + goal)) return `仿真编排草稿：${goal}。仅写入待人工审核队列，未执行设备动作。`;
    return `${name} 已生成规则分析草稿：${goal}。等待人工复核，未执行设备动作。`;
  }

  function orchestrate(goal) {
    const chain = [
      agents.find((a) => a.name.includes("Master")),
      agents.find((a) => a.name.includes("Irrigation")),
      agents.find((a) => a.name.includes("Vision")),
      agents.find((a) => a.name.includes("Robot")),
    ].filter(Boolean);
    const steps = chain.map((a) => {
      const result = agentResult(a.name, goal);
      const task = { id: ++seq, goal, status: "待人工复核", result };
      a.recent.unshift(task);
      a.status = "分析草稿";
      a.last_action = result;
      a.memory.unshift(goal.slice(0, 24));
      if (a.memory.length > 5) a.memory.pop();
      return { agent: a.name, result };
    });
    tasks.push({
      id: ++seq,
      title: "协同任务：" + goal.slice(0, 18),
      task_type: "协同",
      land_code: "全场",
      assignee: "Farm Master Agent",
      status: "待审核",
      scheduled_at: new Date().toLocaleString("zh-CN"),
      priority: "高",
    });
    return { goal, steps, summary: "多智能体仿真编排草稿已生成：总控→灌溉→视觉→机器人；等待人工审核，未执行设备动作", simulated: true, executable: false };
  }

  function roleCaps(r) {
    const map = (global.FarmSpec && FarmSpec.roleCaps) || {};
    return map[r] || map.farm || { title: r, motto: "", caps: [] };
  }

  function buildRoleDesk(r) {
    const k = kpis();
    const audit = tasks.filter((t) => t.status === "待审核");
    const high = tasks.filter((t) => t.priority === "高");
    const running = tasks.filter((t) => ["进行中", "执行中"].includes(t.status));
    if (r === "expert") {
      return {
        role: "expert",
        title: "专家工作台",
        motto: "研判 · 补证 · 人工门禁 · 复盘",
        metrics: {
          audit: audit.length,
          running: running.length,
          agents: agents.filter((a) => a.status === "运行中" || a.status === "执行中").length,
          plans: plans.filter((p) => p.executable === false || p.status === "待审核").length,
        },
        audit_queue: audit.map((t) => ({
          id: t.id,
          title: t.title,
          land_code: t.land_code,
          task_type: t.task_type,
          priority: t.priority,
          note: t.audit_note || "待专家确认",
          scheduled_at: t.scheduled_at,
        })),
        prescriptions: plans.map((p) => ({
          id: p.id,
          land_code: p.land_code,
          water_mm: p.water_mm,
          fertilizer: p.fertilizer,
          reason: p.reason,
          status: p.status,
          created_at: p.created_at,
        })),
        shortcuts: [
          { page: "diagnosis", label: "联合诊断", desc: "感知→分析→决策→复盘" },
          { page: "workbench", label: "协作工作台", desc: "多专家并行研判" },
          { page: "collab", label: "多Agent协同", desc: "冲突仲裁与人工待办" },
          { page: "agents", label: "Agent 调度", desc: "单点/总控编排" },
          { page: "water", label: "水肥研判", desc: "证据批注与人工门禁" },
          { page: "twin", label: "数字孪生", desc: "全图层研判" },
        ],
        reviews: expertReviews.slice(0, 8),
      };
    }
    if (r === "gov") {
      const online = devices.filter((d) => ["在线", "巡田", "运行", "执行中", "编队中"].includes(d.status)).length;
      return {
        role: "gov",
        title: "监管驾驶舱",
        motto: "全场效果、合规与可追溯",
        metrics: {
          area_mu: k.area_mu,
          water_saving: k.water_saving,
          fertilizer_saving: k.fertilizer_saving,
          pesticide_saving: k.pesticide_saving,
          income_per_mu: k.income_per_mu,
          high_tasks: high.length,
          device_online_pct: Math.round((online / Math.max(1, devices.length)) * 100),
          device_sample_count: devices.length,
          device_sample_available: online,
          production_telemetry_connected: false,
          audit_open: audit.length,
        },
        compliance: [
          { name: "节水目标", target: "目标场景 ≥18%", actual: `模拟值 ${k.water_saving}%`, ok: false, verified: false, result: "待基线与水表台账核验", jump: "water" },
          { name: "节肥目标", target: "目标场景 ≥12%", actual: `模拟值 ${k.fertilizer_saving}%`, ok: false, verified: false, result: "待投入品台账核验", jump: "water" },
          { name: "减药目标", target: "目标场景 ≥15%", actual: `模拟值 ${k.pesticide_saving}%`, ok: false, verified: false, result: "待植保基线与用药台账核验", jump: "history" },
          { name: "亩增收", target: "目标场景 400–600 元", actual: `模拟值 ${k.income_per_mu} 元`, ok: false, verified: false, result: "待成本、产量与价格台账核验", jump: "history" },
          { name: "设备状态核验", target: "生产遥测接入率 ≥85%", actual: "未接生产遥测", ok: false, verified: false, result: `仅有 ${online}/${devices.length} 条前端模拟状态，不计作在线率`, jump: "devices" },
        ],
        high_tasks: high.slice(0, 8),
        flags: govFlags.slice(0, 8),
        shortcuts: [
          { page: "history", label: "历年档案", desc: "产量/用水对比" },
          { page: "tasks", label: "高优任务", desc: "全场监察队列" },
          { page: "postharvest", label: "收贮溯源", desc: "仓容与批次" },
          { page: "devices", label: "设备状态核验", desc: "传感与机具待生产接入" },
          { page: "assets", label: "数据资产", desc: "可审计目录" },
          { page: "ai", label: "政策问答", desc: "规程检索" },
        ],
      };
    }
    return {
      role: "farm",
      title: "本周农事",
      motto: "出门看天，把这一周该干的办完",
      metrics: { jobs: running.length, area_mu: k.area_mu },
      shortcuts: [
        { page: "twin", label: "看田", desc: "" },
        { page: "tasks", label: "干活", desc: "" },
        { page: "history", label: "记账", desc: "" },
      ],
    };
  }

  function handle(path, options) {
    const method = String((options && options.method) || "GET").toUpperCase();
    let body = {};
    try {
      body = options && options.body ? JSON.parse(options.body) : {};
    } catch (error) {
      return safeFailure("INVALID_JSON", "请求内容不是有效 JSON");
    }
    const url = new URL(path, "http://local.farm");
    const p = url.pathname;

    if (isEmergencyBlocked(p, method, body)) {
      return safeFailure("SAFETY_LOCKED", "紧急停机锁定中：该操作已被阻止，现场安全复核后方可恢复", {
        interlock: "emergency_stop",
      });
    }

    if (p === "/api/role" && method === "POST") {
      if (!["farm", "expert", "gov"].includes(body.role)) return safeFailure("INVALID_ROLE", "不支持的角色");
      role = body.role;
      return { role, caps: roleCaps(role) };
    }
    if (p === "/api/role") return { role, caps: roleCaps(role) };
    if (p === "/api/role/desk") {
      return buildRoleDesk(role);
    }

    if (p === "/api/farms") {
      const catalog = farmsWithStats();
      const board = buildLandBoard();
      return {
        farmId,
        farm: { ...farm, land_count: board.length, pending_count: board.filter((b) => b.level !== "ok" && b.level !== "watch").length },
        catalog,
      };
    }
    if (p === "/api/farm" && method === "POST") {
      const requestedFarm = body.id || body.farmId;
      if (!farmsCatalog.some((item) => item.id === requestedFarm)) return safeFailure("FARM_NOT_FOUND", "农场不存在");
      return applyFarm(requestedFarm);
    }
    if (p === "/api/lands/board") return { farmId, land_board: buildLandBoard(), farm: { ...farm } };
    if (p === "/api/lands/execute" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色为查看/审核视图，不能登记农机作业请求");
      if (humanGate.auto_paused) {
        return {
          ok: false,
          summary: "场长已登记紧急停止，批量登记/启动已锁定。请先完成现场停机确认与安全复核。",
          results: [],
          land_board: buildLandBoard(),
          week_plan: buildWeekPlan(),
          co_decision: buildCoDecision(),
        };
      }
      return executeLands(
        body.land_codes || body.codes || (body.land_code ? [body.land_code] : []),
        body.action || "auto"
      );
    }
    if (p === "/api/human/decide" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能执行农场控制操作");
      return humanDecide(body);
    }
    if (p === "/api/co-decision") return { farmId, co_decision: buildCoDecision() };

    if (p === "/api/search") {
      const q = (url.searchParams.get("q") || body.q || "").trim().toLowerCase();
      const pages = [
        ["dashboard", "本周农事"], ["twin", "看田地图"], ["history", "历年收成"], ["plants", "看单株"],
        ["season", "播收到仓"], ["fleet", "机具作业"], ["postharvest", "收粮进仓"],
        ["collab", "请人帮忙"], ["diagnosis", "找病因"], ["workbench", "协作台"],
        ["council", "专家会诊"],
        ["agents", "助手名册"], ["devices", "田间设备"], ["vendors", "厂家接入"],
        ["robots", "无人机/机手"], ["ai", "问一问"], ["water", "浇水施肥"],
        ["tasks", "农事待办"], ["assets", "数据资产"], ["arch", "系统架构"],
      ].filter(([, n]) => !q || n.toLowerCase().includes(q) || n.includes(q));
      return {
        q,
        pages: pages.map(([id, name]) => ({ type: "page", id, name, jump: id })),
        lands: lands.filter((l) => !q || l.code.toLowerCase().includes(q) || l.name.includes(q) || l.crop_name.includes(q))
          .map((l) => ({ type: "land", id: l.code, name: `${l.code} ${l.name}`, jump: "twin", land: l.code })),
        devices: devices.filter((d) => !q || d.code.toLowerCase().includes(q) || d.name.includes(q))
          .map((d) => ({ type: "device", id: d.code, name: `${d.code} ${d.name}`, jump: "devices", device: d.code, land: d.location })),
        plants: plants.filter((pl) => !q || pl.code.toLowerCase().includes(q) || pl.crop_name.includes(q) || pl.land_code.toLowerCase().includes(q))
          .slice(0, 12)
          .map((pl) => ({ type: "plant", id: pl.code, name: `${pl.code} ${pl.crop_name}·${pl.morph_name}`, jump: "plants", plant: pl.code, land: pl.land_code })),
        agents: agents.filter((a) => !q || a.name.toLowerCase().includes(q) || a.role.includes(q))
          .map((a) => ({ type: "agent", id: a.id, name: a.name, jump: "agents" })),
      };
    }

    if (p === "/api/dashboard") {
      const farmLands = currentLands();
      const land_board = buildLandBoard(farmLands);
      const top = land_board.find((b) => b.level !== "ok" && b.level !== "watch") || land_board[0];
      const cotton = farmLands.filter((l) => l.crop_name === "棉花" && String(l.stage).includes("吐絮"))
        .sort((a, b) => (a.open_boll || 0) - (b.open_boll || 0))[0];
      const harvestCorn = farmLands.filter((l) => l.crop_name === "玉米" && l.stage === "成熟期")[0];
      const sowWheat = farmLands.find((l) => l.crop_name === "小麦" && l.stage === "适播准备");
      const dry = farmLands.filter((l) => l.moisture < 18).sort((a, b) => a.moisture - b.moisture)[0];
      const risky = farmLands.filter((l) => l.pest_risk > 45).sort((a, b) => b.pest_risk - a.pest_risk)[0];
      let priority;
      if (cotton && (cotton.open_boll || 0) < 70) {
        priority = {
          level: "defoliant",
          kicker: "本周优先",
          title: `${cotton.code} 脱叶条件待核实`,
          desc: `${cotton.area_mu} 亩 · 开絮 ${cotton.open_boll}% 为仿真快照，不能据此直接施药。`,
          why: "需现场样方、7 日逐小时天气、药剂标签、剂量校准与人工批准。",
          delay_cost: "证据不全时继续作业的漂移、药害与合规风险不可接受",
          weather_hint: "天气源未接入，当前不可判定喷施窗口",
          materials: "药剂与喷雾机状态均待现场核验",
          trust: [`开絮模拟 ${cotton.open_boll}%`, "逐小时天气缺失", "药剂标签与人工批准缺失"],
          cta: "补齐脱叶证据",
          jump: "fleet",
          land_code: cotton.code,
        };
      } else if (harvestCorn) {
        priority = {
          level: "harvest",
          kicker: "本周优先",
          title: `${harvestCorn.code} 机收条件待核实`,
          desc: `${harvestCorn.area_mu} 亩 · 含水约 ${harvestCorn.grain_moisture || 25}% 为仿真快照，不能单独作为开机依据。`,
          why: "需成熟证据、校准含水率、试收损失、道路隔离、运输和仓容核验。",
          delay_cost: "证据不全时开机可能造成高损失、机械伤害或收储拥堵",
          weather_hint: "逐小时天气与道路通行数据未接入",
          materials: "收割机、转运车和仓容均待现场确认",
          trust: [`含水模拟 ${harvestCorn.grain_moisture || 25}%`, "试收损失缺失", "道路与仓容证据缺失"],
          cta: "补齐收获证据",
          jump: "fleet",
          land_code: harvestCorn.code,
        };
      } else if (sowWheat) {
        priority = {
          level: "sow",
          kicker: "本周优先",
          title: `${sowWheat.code} 本地播种规则待绑定`,
          desc: `${sowWheat.area_mu} 亩 · 库尔勒地块不得直接套用北疆播期。`,
          why: "需本地生态区、种植制度、批准品种、种子质量、目标基本苗和播层墒情。",
          delay_cost: "错误地区模板可能导致播期、播量与品种选择失配",
          weather_hint: "天气与播层墒情证据未接入",
          materials: "机具校准、种子批次和本地模板待核验",
          trust: ["区域模板缺失", "种子证据缺失", "机具校准缺失"],
          cta: "补齐区域模板",
          jump: "tasks",
          land_code: sowWheat.code,
        };
      } else if (dry) {
        priority = {
          level: "irrigation",
          kicker: "本周优先",
          title: `${dry.code} 墒情证据待复核`,
          desc: `${dry.area_mu} 亩 · 含水 ${dry.moisture}% 为仿真快照，尚不能计算实际灌水量。`,
          why: "缺田间持水量、根层、ETc、有效降雨、效率和传感器 QC。",
          delay_cost: "证据不全时灌溉可能造成过灌、欠灌或养分淋失",
          weather_hint: "预报与有效降雨源未接入",
          materials: "泵阀现场状态与流量计量待核验",
          trust: [`含水模拟 ${dry.moisture}%`, "作物水分模型缺失", "传感器 QC 缺失"],
          cta: "补齐水肥输入",
          jump: "water",
          land_code: dry.code,
        };
      } else if (risky) {
        priority = {
          level: "vision",
          kicker: "本周优先",
          title: `${risky.code} 先飞一眼再决定打不打药`,
          desc: `病虫风险偏高（${risky.pest_risk}）。先局部看清楚，别整田普治浪费药钱。`,
          why: "不确定就全田打药，费药又伤天敌。",
          delay_cost: "真爆发再治，损失和用药都会翻倍",
          weather_hint: "飞行天气、空域与人员隔离待确认",
          materials: "无人机电池、RTK、返航点与航线待现场核验",
          trust: [`风险指数 ${risky.pest_risk}`, "建议局部确认", "精准打药更省钱"],
          cta: "登记调查取证",
          jump: "diagnosis",
          land_code: risky.code,
          secondary_jump: "robots",
        };
      } else {
        priority = {
          level: "ok",
          kicker: "本周暂无急事",
          title: "暂无基于完整证据的高优结论",
          desc: "继续补齐田间观测、设备回执和本地规则，再由责任人确认计划。",
          why: "仿真数据不能证明现场处于安全区。",
          delay_cost: "保持巡检并记录异常",
          weather_hint: "天气数据源未接入",
          materials: "设备与物资状态待现场核验",
          trust: ["本地仿真数据", "现场证据待补", "未连接生产遥测"],
          cta: "去看田",
          jump: "twin",
          land_code: "全场",
        };
      }
      const today_jobs = [
        cotton && (cotton.open_boll || 0) < 70
          ? { id: "j1", title: `${cotton.code} 补齐脱叶证据`, land: cotton.code, when: "今天", status: "NO_GO", why: "开絮为模拟值，天气/标签/剂量/批准缺失", jump: "fleet", money: "先核验再决策" }
          : null,
        harvestCorn
          ? { id: "j2", title: `${harvestCorn.code} 完成机收条件复核`, land: harvestCorn.code, when: "本周内", status: "NO_GO", why: "成熟、试收、道路与仓容证据缺失", jump: "fleet", money: "先试收并核验收储能力" }
          : null,
        sowWheat
          ? { id: "j3", title: `${sowWheat.code} 绑定本地播种模板`, land: sowWheat.code, when: "本周内", status: "NO_GO", why: "区域规则和种子证据缺失", jump: "tasks", money: "避免套用错误播期" }
          : null,
        { id: "j4", title: "核对墒情采样与设备回执", land: "全场", when: "随时", status: "取证", why: "区分模拟与现场观测", jump: "twin", money: "形成可追溯证据" },
        { id: "j5", title: "补齐节水节肥基线台账", land: "全场", when: "收工后", status: "待核验", why: "目标模拟数据不可作经营结论", jump: "history", money: "目标值待实测核验" },
      ].filter(Boolean);
      const weatherDev = devices.find((d) => d.device_type === "weather");
      const onlineDev = devices.filter((d) => d.status === "在线" || d.status === "巡田").length;
      const now = new Date();
      const hhmm = now.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
      const alerts = [
        {
          id: "a-season",
          level: "ok",
          text: "全疆大部棉花吐絮盛期 · 春玉米收晒窗口开启",
          jump: "season",
          land_code: "全场",
          at: hhmm,
        },
        {
          id: "a-weather",
          level: "ok",
          text: "未来数日总体利于吐絮与收晒，棉区宜抢晴脱叶",
          jump: "fleet",
          land_code: cotton ? cotton.code : "全场",
          at: hhmm,
        },
          { id: "a-field", level: "warn", text: "田间传感与机具仅有未核验模拟状态，生产链路待接入", jump: "devices", land_code: "全场", at: "模拟" },
        { id: "a-saving", level: "warn", text: "节水 20%、节肥 15% 为目标场景，待基线和实测台账核验", jump: "water", land_code: "全场", at: "模拟" },
      ];
      const feed = [
        { t: "模拟", agent: "总调度", event: cotton ? `${cotton.code} 脱叶候选流程保持 NO_GO，等待证据` : "未形成高优执行结论", jump: "fleet", land: cotton ? cotton.code : "" },
        { t: "模拟", agent: "看田", event: cotton ? `${cotton.code} 开絮 ${cotton.open_boll}% 为仿真快照，需现场样方` : "开絮证据待导入", jump: "robots", land: cotton ? cotton.code : "B-01", device: "UAV-001" },
        { t: "模拟", agent: "机务", event: harvestCorn ? `${harvestCorn.code} 机收路线仅作回放，未生成设备命令` : "机具实况未接入", jump: "fleet", land: harvestCorn ? harvestCorn.code : "B-02", device: "HARVEST-001" },
        { t: "模拟", agent: "测产", event: "产量数字为仿真估算，缺少本场测产校准", jump: "history", land: "全场" },
        { t: "模拟", agent: "农技", event: sowWheat ? `${sowWheat.code} 本地播种模板待批准` : "管护建议等待属地规则", jump: "tasks", land: sowWheat ? sowWheat.code : "C-02" },
        { t: "模拟", agent: "设备", event: "设备状态为界面模拟，未连接生产遥测或 ACK", jump: "devices", land: "" },
      ];
      const fleetTypes = new Set(["tractor", "sprayer", "drone", "robot", "yield", "soil_scan", "harvester", "seeder", "transport"]);
      const fleetDevices = devices.filter((d) => !d.mesh && fleetTypes.has(d.device_type));
      const fleetBusy = fleetDevices.filter((d) => ["巡田", "运行", "执行中", "编队中", "作业中", "转运中"].includes(d.status)).length;
      const fleetIdle = fleetDevices.filter((d) => ["待机", "待命", "关闭", "在线", "整备", "整备待播"].includes(d.status)).length;
      const ai_dispatch = {
        window: {
          title: "24 小时作业窗 · 待数据",
          score: null,
          slot: "不可判定",
          reason: "逐小时天气、叶湿、道路和设备状态未接入",
          hours: [
            { range: "00:00–07:00", tip: "资料缺失 · NO_GO", ok: false },
            { range: "07:00–12:00", tip: "资料缺失 · NO_GO", ok: false },
            { range: "12:00–18:30", tip: "资料缺失 · NO_GO", ok: false },
            { range: "18:30–24:00", tip: "夜间作业受限 · NO_GO", ok: false },
          ],
          suitable_mu: 0,
        },
        conflicts: [
          {
            level: "中",
            text: "排程草案显示 B-01 与 B-02 可能争用道路；现场资源尚未核验",
            resolve: "由机务负责人核对道路隔离、机具与人员后人工排程",
            resource: "田间主干道 / 编队时段",
            lands: ["B-01", "B-02"],
            jump: "fleet",
          },
          { level: "低", text: "排程草案未显示 C-01 备播整地与机收道路硬冲突", resolve: "草案暂列 9/18 后；仍待本地农艺师、机务负责人和场长确认", jump: "season" },
        ],
        load: {
          busy: fleetBusy,
          idle: fleetIdle,
          total: fleetBusy + fleetIdle,
          util: Math.round((fleetBusy / Math.max(1, fleetBusy + fleetIdle)) * 100),
          sensors: devices.filter((d) => d.mesh).length,
          label: `${fleetBusy}/${Math.max(1, fleetBusy + fleetIdle)}台`,
        },
        insights: [
          { title: "节水目标", text: "20% 为目标场景，待基线、水表和作业台账核验", jump: "water" },
          { title: "秋收条件", text: harvestCorn ? `${harvestCorn.code} 含水 ${harvestCorn.grain_moisture}% 为模拟；试收与仓容证据缺失` : "收获证据待补", jump: "season", land: harvestCorn?.code },
          { title: "开絮核验", text: cotton ? `${cotton.code} 开絮 ${cotton.open_boll}% 为模拟；不能直接形成脱叶处方` : "开絮证据待补", jump: "plants", land: cotton?.code },
          { title: "联合作业", text: "机队仅展示流程回放；高风险动作保持 NO_GO", jump: "fleet", land: jointOps[0]?.land },
        ],
        timeline: [
          { t: "模拟", act: "核对玉米成熟与试收证据", agent: "机务" },
          { t: "模拟", act: "登记棉花开絮样方", agent: "看田" },
          { t: "NO_GO", act: "脱叶与机收命令未生成", agent: "安全门禁" },
          { t: "待补证", act: "导入测产、天气与设备 ACK", agent: "数据治理" },
        ],
      };
      const mediaMap = buildLandMediaMap();
      const cams = [
        { id: "cam-n", label: "北区棉花资料图", land: "A-01", zone: "北区", updated: mediaMap["A-01"].captured_at, kind: "field",
          img: landPhotoUrl("A-01", "field"), credit: mediaMap["A-01"].credit, captured_at: mediaMap["A-01"].captured_at },
        { id: "cam-c", label: "中区航拍资料图", land: "B-01", zone: "中区", updated: mediaMap["B-01"].captured_at, kind: "aerial",
          img: landPhotoUrl("B-01", "aerial"), credit: mediaMap["B-01"].credit, captured_at: mediaMap["B-01"].captured_at, device: "UAV-001" },
        { id: "cam-s", label: "南区玉米资料图", land: "C-02", zone: "南区", updated: mediaMap["C-02"].captured_at, kind: "field",
          img: landPhotoUrl("C-02", "field"), credit: mediaMap["C-02"].credit, captured_at: mediaMap["C-02"].captured_at },
        { id: "cam-p", label: "中区玉米航拍资料图", land: "B-02", zone: "中区", updated: mediaMap["B-02"].captured_at, kind: "aerial",
          img: landPhotoUrl("B-02", "aerial"), credit: mediaMap["B-02"].credit, captured_at: mediaMap["B-02"].captured_at, device: "UAV-002" },
      ];
      const land_photos = {};
      Object.keys(mediaMap).forEach((code) => {
        land_photos[code] = mediaMap[code].thumb;
      });
      const decisionTop = land_board.find((item) => item.level !== "ok" && item.level !== "watch") || land_board[0];
      if (decisionTop) {
        priority = {
          level: decisionTop.level,
          kicker: decisionTop.executable === false ? "NO_GO · 先补证据" : "本周优先 · 仅仿真",
          title: `${decisionTop.code} ${decisionTop.tag}`,
          desc: decisionTop.reason,
          why: decisionTop.agent_tip || decisionTop.reason,
          delay_cost: decisionTop.stop_condition || "异常时停止并人工复核",
          weather_hint: "逐小时天气源未接入，当前不可判定作业窗",
          materials: (decisionTop.required_evidence || []).join(" · ") || "待补原始证据",
          trust: [
            decisionTop.evidence_status || "证据待核验",
            decisionTop.confidence || "待核实",
            decisionTop.rule_source_status === "VERIFIED" ? (decisionTop.rule_version || "规则版本已核验") : "规则原文待绑定",
          ],
          cta: decisionTop.cta || "补齐证据",
          jump: decisionTop.jump || "twin",
          land_code: decisionTop.code,
          accountable_person: decisionTop.accountable_person,
          due_at: decisionTop.due_at,
          stop_condition: decisionTop.stop_condition,
          required_evidence: decisionTop.required_evidence || [],
          rule_source: decisionTop.rule_source || "规则依据待绑定",
          rule_source_status: decisionTop.rule_source_status || "UNVERIFIED",
          decision: decisionTop.decision || "REVIEW",
          executable: decisionTop.executable !== false,
        };
      }
      alerts.splice(0, alerts.length,
        { id: "a-evidence", level: "warn", text: "高优建议存在证据缺口，NO_GO 项不得自动执行", jump: "tasks", land_code: decisionTop ? decisionTop.code : "全场", at: "模拟" },
        { id: "a-weather", level: "warn", text: "逐小时天气、叶湿与道路通行数据源未接入，作业窗不可判定", jump: "devices", land_code: "全场", at: "模拟" },
        { id: "a-data", level: "warn", text: "当前为本地仿真数据，设备在线与效益指标均待现场核验", jump: "assets", land_code: "全场", at: "模拟" }
      );
      ai_dispatch.window = {
        title: "作业天气窗 · 不可判定",
        score: null,
        slot: "等待逐小时预报与现场数据",
        reason: "缺少预报来源/发布时间、阵风、降水、叶湿与道路承载性，禁止显示绿色可执行窗口",
        hours: [
          { range: "00:00–06:00", tip: "资料缺失 · NO_GO", ok: false },
          { range: "06:00–12:00", tip: "资料缺失 · NO_GO", ok: false },
          { range: "12:00–18:00", tip: "资料缺失 · NO_GO", ok: false },
          { range: "18:00–24:00", tip: "夜间作业受限 · NO_GO", ok: false },
        ],
        suitable_mu: 0,
        data_quality: "missing",
      };
      priority = adaptPriorityForRole(priority, role);
      const pendingBoard = land_board.filter((b) => b.level !== "ok" && b.level !== "watch");
      const boardJobs = land_board
        .filter((b) => b.level !== "ok" && b.level !== "watch" && Number(b.day_offset || 0) <= 0)
        .slice(0, 6)
        .map((b, i) => ({
          id: `lb-${b.code}`,
          title: `${b.code} ${b.tag}`,
          land: b.code,
          when: b.when || (i === 0 ? "本周优先" : "本周内"),
          status: b.score >= 70 ? "紧急" : b.level === "watch" ? "日常" : "待办",
          why: b.reason,
          jump: b.jump,
          money: b.cta,
          action: b.action,
          evidence_status: b.evidence_status,
          accountable_person: b.accountable_person,
          due_at: b.due_at,
          stop_condition: b.stop_condition,
          required_evidence: b.required_evidence,
          executable: b.executable,
        }));
      /* 顶部状态条只报运行概览；具体预警仅出现在 priority 卡片 */
      const statusLine = `本地仿真快照 · 未接生产遥测或天气预报 · ${weatherDev ? weatherDev.last_value : "无天气模拟"}`;
      const farmCodes = new Set(farmLands.map((l) => l.code));
      const week_plan = buildWeekPlan(farmLands);
      return {
        farm: {
          ...farm,
          land_count: farmLands.length,
          pending_count: pendingBoard.length,
        },
        farmId,
        role,
        kpis: kpis(),
        lands: farmLands,
        land_board,
        week_plan,
        land_summary: {
          total: farmLands.length,
          pending: pendingBoard.length,
          ok: land_board.filter((b) => b.level === "ok" || b.level === "watch").length,
          top: top || null,
        },
        devices: devices.map((d) => ({ ...d, status_code: d.status, status: d.display_status })),
        agents,
        tasks: tasks.slice().reverse().slice(0, 8),
        alerts,
        feed,
        ai_dispatch,
        cams: cams.filter((c) => farmCodes.has(c.land)),
        land_photos,
        land_media: mediaMap,
        scenes: MEDIA_SCENES,
        statusLine,
        refreshed_at: now.toLocaleString("zh-CN"),
        live: false,
        data_meta: {
          mode: "demo",
          source: "FarmEngine 本地规则引擎",
          source_label: "本地仿真数据",
          as_of: "2026-09-14",
          simulated: true,
        },
        priority,
        today_jobs: boardJobs.length ? boardJobs : today_jobs.filter((job) => ["今天", "随时", "收工后"].some((label) => String(job.when || "").includes(label))),
        weather: (() => {
          const raw = weatherDev ? weatherDev.last_value : "";
          const visibleRaw = String(raw || "").replace(/^模拟\s*·\s*/, "");
          const airTemp = Number((/气温\s*([\d.]+)/.exec(raw) || [])[1]) || 26.2;
          const wind = Number((/风速\s*([\d.]+)/.exec(raw) || [])[1]) || 2.8;
          /* 没有预报来源就不要编一个天气类型出来；留空由各处自行决定怎么显示 */
          const condition = "";
          const oneDecimal = (values) => values.map((value) => Number.isFinite(value) ? +value.toFixed(1) : value);
          const moistVals = farmLands.map((l) => Number(l.moisture)).filter((n) => !Number.isNaN(n));
          const soilTemps = farmLands.map((l) => Number(l.temp)).filter((n) => !Number.isNaN(n));
          const soil_moisture =
            moistVals.length ? +(moistVals.reduce((s, n) => s + n, 0) / moistVals.length).toFixed(1) : null;
          const soil_temp =
            soilTemps.length ? +(soilTemps.reduce((s, n) => s + n, 0) / soilTemps.length).toFixed(1) : null;
          const driest = farmLands.slice().sort((a, b) => (a.moisture || 99) - (b.moisture || 99))[0];
          return {
            summary: visibleRaw || "气温 --",
            sync: "模拟快照",
            link: "设备链路待生产核验",
            last_sync: "数据刷新",
            farmer_line: weatherDev
              ? `天气快照：${visibleRaw} · 未接预报来源，不可判定作业窗口`
              : "出门看天：天气数据源未接入",
            jump: "devices",
            land: weatherDev ? weatherDev.location : "全场",
            air_temp: airTemp,
            wind,
            condition,
            soil_moisture,
            soil_temp,
            data_quality: "demo_unverified",
            verified: false,
            executable: false,
            driest_land: driest ? driest.code : "",
            driest_moisture: driest ? driest.moisture : null,
            params: [
              { k: "气温", v: `${airTemp} ℃` },
              { k: "风速", v: `${wind} m/s` },
              { k: "天气", v: condition || "未接预报源" },
              { k: "墒情", v: soil_moisture != null ? `${soil_moisture}%` : "--" },
              { k: "土温", v: soil_temp != null ? `${soil_temp} ℃` : "--" },
              ...(driest && driest.moisture < 22
                ? [{ k: "偏旱", v: `${driest.code} ${driest.moisture}%`, warn: true }]
                : []),
            ],
            trends: {
              air_temp: oneDecimal([airTemp - 2.1, airTemp - 1.4, airTemp - 0.6, airTemp + 0.2, airTemp - 0.3, airTemp + 0.8, airTemp]),
              wind: oneDecimal([Math.max(0.6, wind - 0.8), Math.max(0.6, wind - 0.3), wind + 0.4, Math.max(0.6, wind - 0.1), wind + 0.6, Math.max(0.6, wind - 0.2), wind]),
              soil_moisture: soil_moisture != null
                ? oneDecimal([soil_moisture + 1.2, soil_moisture + 0.6, soil_moisture - 0.4, soil_moisture - 0.9, soil_moisture - 0.2, soil_moisture + 0.3, soil_moisture])
                : [24, 23.5, 23.1, 22.8, 23.2, 23.6, 24],
              soil_temp: soil_temp != null
                ? oneDecimal([soil_temp - 1.1, soil_temp - 0.7, soil_temp - 0.2, soil_temp + 0.3, soil_temp - 0.1, soil_temp + 0.5, soil_temp])
                : [22, 22.4, 23, 23.2, 23.6, 23.8, 24],
            },
            forecast: [
              { label: "今天", cond: "未接预报源", high: Math.round(airTemp + 1.5), low: Math.round(airTemp - 8), rain: 5, verified: false, ok: false },
              { label: "明天", cond: "未接预报源", high: Math.round(airTemp + 0.5), low: Math.round(airTemp - 7.5), rain: 10, verified: false, ok: false },
              { label: "后日", cond: "未接预报源", high: Math.round(airTemp + 2), low: Math.round(airTemp - 7), rain: 0, verified: false, ok: false },
              { label: "周四", cond: "未接预报源", high: Math.round(airTemp + 1), low: Math.round(airTemp - 8), rain: 15, verified: false, ok: false },
              { label: "周五", cond: "未接预报源", high: Math.round(airTemp + 1.8), low: Math.round(airTemp - 7.2), rain: 8, verified: false, ok: false },
            ],
          };
        })(),
        architecture,
        edge,
        loop: "看天 → 本周农事 → 采纳/改期/跳过 → 流程回放/停止 → 留痕",
        tips: ((global.FarmSpec && FarmSpec.contextTips) || {})[role] || [],
        co_decision: buildCoDecision(),
      };
    }

    if (p === "/api/architecture") return { ...architecture, edge, farm };

    if (p === "/api/twin") {
      const layer = url.searchParams.get("layer") || "moisture";
      const focus = url.searchParams.get("land") || "";
      const plantFocus = url.searchParams.get("plant") || "";
      const farmLands = currentLands();
      const dry = farmLands.filter((l) => l.moisture < 25).sort((a, b) => a.moisture - b.moisture)[0];
      const risky = farmLands.filter((l) => l.pest_risk > 50).sort((a, b) => b.pest_risk - a.pest_risk)[0];
      const farmDevices = devices.filter(currentFarmOwnsDevice);
      const mesh = farmDevices.filter((d) => d.mesh);
      const fleet = farmDevices.filter((d) => !d.mesh);
      const landPlants = focus ? plants.filter((pl) => pl.land_code === focus) : plants.filter((pl) => farmLands.some((l) => l.code === pl.land_code));
      const land_board = buildLandBoard(farmLands);
      return {
        data_meta: { mode: "demo", source: "FarmEngine 本地规则引擎", source_label: "本地仿真数据", as_of: "2026-09-14", simulated: true },
        geometry_meta: { coordinate_space: "screen_demo", crs: null, version: "demo-layout-v1", survey_status: "未测绘，不得用于导航或面积结算" },
        lands: farmLands,
        land_board,
        devices: fleet.map((d) => ({ ...d, status_code: d.status, status: d.display_status })),
        sensors: (focus ? mesh.filter((s) => s.location === focus) : mesh).map((d) => ({ ...d, status_code: d.status, status: d.display_status })),
        sensors_all: mesh.map((d) => ({ ...d, status_code: d.status, status: d.display_status })),
        plants: landPlants,
        plants_all: plants.filter((pl) => farmLands.some((l) => l.code === pl.land_code)),
        plant: plants.find((pl) => String(pl.id) === String(plantFocus) || pl.code === plantFocus) || null,
        morphology: MORPHOLOGY,
        layer,
        focus,
        land_photos: Object.fromEntries(lands.map((l) => [l.code, landPhotoUrl(l.code, "thumb")])),
        land_media: buildLandMediaMap(),
        scenes: MEDIA_SCENES,
        layers: [
          { id: "moisture", name: "土壤墒情" },
          { id: "crop", name: "作物长势" },
          { id: "plants", name: "单株表型" },
          { id: "risk", name: "风险热力" },
          { id: "device", name: "机队设备" },
          { id: "sensors", name: "传感网格" },
        ],
        decisions: [
          { text: dry ? `Irrigation Agent：${dry.code} 墒情模拟偏低，但关键水肥输入缺失，NO_GO` : "Irrigation Agent：仿真数据暂不触发处方", jump: "water", land: dry ? dry.code : "" },
          { text: risky ? `影像识别：${risky.code} 仅登记调查取证，处置不放行` : "影像识别：风险值为模拟，仍待现场调查", jump: "diagnosis", land: risky ? risky.code : "" },
          { text: `单株表型：全场 ${plants.filter((pl) => pl.status !== "正常").length} 株需关注（地上/地下）`, jump: "plants", land: focus || "" },
          { text: "设备调度：C-02 深松缺边界、道路、机手与设备回执，不放行", jump: "fleet", land: "C-02" },
        ],
        ops: {
          online: fleet.filter((d) => ["在线", "巡田", "运行", "编队中"].includes(d.status)).length,
          total: fleet.length,
          sensors_online: mesh.filter((s) => s.status === "在线").length,
          sensors_total: mesh.length,
          plants_total: plants.length,
          plants_watch: plants.filter((pl) => pl.status !== "正常").length,
          canopy_avg: Math.round(plants.reduce((s, pl) => s + pl.canopy.vigor, 0) / Math.max(1, plants.length)),
          root_avg: Math.round(plants.reduce((s, pl) => s + pl.root.vigor, 0) / Math.max(1, plants.length)),
          agents_running: agents.filter((a) => a.status === "运行中" || a.status === "执行中").length,
          agents_total: agents.length,
        },
        loop: architecture.loop,
      };
    }

    if (p === "/api/plants" && method === "GET") {
      const land = url.searchParams.get("land") || "";
      const status = url.searchParams.get("status") || "";
      const crop = url.searchParams.get("crop") || "";
      const viewMode = url.searchParams.get("view") || "all";
      let list = plants.slice();
      if (land) list = list.filter((pl) => pl.land_code === land);
      if (status === "watch") list = list.filter((pl) => pl.status !== "正常");
      if (status && status !== "watch") list = list.filter((pl) => pl.status === status);
      if (crop) list = list.filter((pl) => pl.crop_name === crop);
      const selected =
        plants.find((pl) => pl.id === selectedPlantId || pl.code === url.searchParams.get("id")) ||
        list[0] ||
        plants[0];
      return {
        items: list,
        selected,
        morphology: MORPHOLOGY,
        summary: {
          total: plants.length,
          watch: plants.filter((pl) => pl.status !== "正常").length,
          canopy_avg: Math.round(plants.reduce((s, pl) => s + pl.canopy.vigor, 0) / Math.max(1, plants.length)),
          root_avg: Math.round(plants.reduce((s, pl) => s + pl.root.vigor, 0) / Math.max(1, plants.length)),
          by_land: lands.map((l) => ({
            code: l.code,
            crop: l.crop_name,
            stage: l.stage,
            count: l.plant_count || 0,
            watch: l.plant_watch || 0,
            canopy_avg: l.canopy_avg || 0,
            root_avg: l.root_avg || 0,
          })),
          by_morph: Object.fromEntries(
            Object.keys(MORPHOLOGY).map((cropName) => [
              cropName,
              MORPHOLOGY[cropName].map((m) => ({
                ...m,
                count: plants.filter((pl) => pl.crop_name === cropName && pl.morph_key === m.key).length,
              })),
            ])
          ),
        },
        note: "单株数字孪生采样网：地上冠层 + 地下根系 + 全生育期形态；点击可下钻处方与联合诊断",
        view: viewMode,
      };
    }
    if (p === "/api/plants/select" && method === "POST") {
      const pl = plants.find((x) => x.id === body.id || x.code === body.code || x.code === body.id);
      if (pl) selectedPlantId = pl.id;
      return pl || { ok: false };
    }
    if (p.startsWith("/api/plants/") && method === "GET") {
      const key = p.split("/")[3];
      const pl = plants.find((x) => String(x.id) === key || x.code === key);
      if (!pl) return { error: "植株不存在" };
      const morphList = MORPHOLOGY[pl.crop_name] || [];
      return {
        plant: pl,
        morphology: morphList,
        neighbors: plants.filter((x) => x.land_code === pl.land_code && x.id !== pl.id).slice(0, 8),
        prescriptions: [
          pl.stress.includes("根区偏旱") || pl.stress.includes("根区干旱胁迫")
            ? { type: "水肥", text: `根区含水 ${pl.root.rhizosphere_moisture}% 为模拟；补齐田间持水量、根层、ETc 与 QC 后再计算水量`, jump: "water" }
            : null,
          pl.stress.includes("吐絮偏慢待脱叶")
            ? { type: "植保", text: "开絮为模拟；脱叶证据不全，维持 NO_GO", jump: "fleet" }
            : null,
          pl.stress.includes("叶部病斑疑似") || pl.stress.includes("叶部病斑残留")
            ? { type: "植保", text: "先复飞并做样方调查；物种、发生期与当地阈值未确认前不形成处置处方", jump: "fleet" }
            : null,
          pl.canopy.vigor < 70
            ? { type: "营养", text: "冠层弱势模拟；先核查采样、土壤/植株检测与属地阈值", jump: "diagnosis" }
            : null,
          pl.root.vigor < 68
            ? { type: "根系", text: "根系活力偏低，观察根际墒情与通气性", jump: "twin" }
            : null,
        ].filter(Boolean),
      };
    }

    if (p === "/api/agents" && method === "GET") return agents;
    if (p === "/api/agents/dispatch") {
      const agent = agents.find((a) => a.id === body.agent_id) || agents[0];
      const result = agentResult(agent.name, body.goal);
      const task = { id: ++seq, goal: body.goal, status: "待人工复核", result, simulated: true, executable: false };
      agent.recent.unshift(task);
      agent.status = "分析草稿";
      agent.last_action = result;
      agent.memory.unshift(body.goal.slice(0, 24));
      if (agent.memory.length > 5) agent.memory.pop();
      return { ...task, message: "本地规则草稿已生成；未调用真实模型、工单或设备" };
    }
    if (p === "/api/agents/orchestrate") return orchestrate(body.goal || "全场今日精准作业协同");

    if (p === "/api/equipment-catalog" && method === "GET") {
      const cat = eqCat || { title: "设备清单", items: [], note: "", retrieved_at: "" };
      return {
        title: cat.title,
        note: cat.note,
        retrieved_at: cat.retrieved_at,
        items: cat.items || [],
        deployed: (cat.items || []).map((c) => ({
          ...c,
          deployed_count: devices.filter((d) => d.catalog_id === c.id).length,
        })),
      };
    }

    if (p === "/api/devices" && method === "GET") {
      const code = url.searchParams.get("code") || "";
      const land = url.searchParams.get("land") || "";
      const vendor = url.searchParams.get("vendor") || "";
      const mesh = url.searchParams.get("mesh");
      let list = devices.filter(currentFarmOwnsDevice);
      if (mesh === "1") list = list.filter((d) => d.mesh);
      else if (mesh === "0") list = list.filter((d) => !d.mesh);
      if (land) list = list.filter((d) => d.location === land || d.code === land);
      if (vendor) list = list.filter((d) => d.vendor_id === vendor);
      if (code) list = list.filter((d) => d.code === code || d.location === code);
      return {
        items: list.map((d) => ({ ...d, status_code: d.status, status: d.display_status })),
        summary: {
          fleet: list.filter((d) => !d.mesh).length,
          sensors: list.filter((d) => d.mesh).length,
          sensors_online: list.filter((d) => d.mesh && d.status === "在线").length,
          by_land: currentLands().map((l) => ({
            code: l.code,
            count: l.sensor_count || 0,
            online: list.filter((d) => d.mesh && d.location === l.code && d.status === "在线").length,
          })),
        },
      };
    }
    if (p === "/api/fleet") {
      const want = url.searchParams.get("id") || selectedJointId;
      return {
        ops: jointOps,
        selected: jointOps.find((j) => j.id === want) || jointOps[0],
        note: "候选编队流程回放：高风险动作保持 NO_GO；未连接真实机具、遥测或设备 ACK",
      };
    }
    if (p === "/api/fleet/select" && method === "POST") {
      const op = jointOps.find((j) => j.id === body.id);
      if (!op) return safeFailure("FLEET_OPERATION_NOT_FOUND", "机具协同任务不存在");
      selectedJointId = op.id;
      return op;
    }
    if (p === "/api/vendors") {
      return {
        vendors,
        protocols: ["MQTT", "Modbus", "ISOBUS", "Cloud API", "REST", "WebSocket", "CAN"],
        note: "厂家与协议为能力目录仿真，不代表本场已授权或接入；生产接入须完成证书、权限、沙箱、验收与 SLA 验证",
      };
    }
    if (p === "/api/vendors/connect" && method === "POST") {
      const v = vendors.find((x) => x.id === body.id);
      if (v && v.status === "接口预留") {
        v.status = "沙箱申请待配置";
        v.note = "仿真登记：等待用户提供证书、权限范围与厂商沙箱";
      } else if (v && v.status === "沙箱申请待配置") {
        v.status = "适配验证";
        v.note = "仅完成界面适配回放；未连接生产账号或真实设备";
      }
      return v ? { ...v, simulated: true, production_connected: false } : { ok: false };
    }
    if (p === "/api/devices/register" && method === "POST") {
      if (role === "gov") return safeFailure("VIEW_ONLY", "监管视图不能注册设备");
      const catalogId = body.catalog_id || "";
      const fromCat = catalogId && catById(catalogId);
      const requestedCode = String(body.code || `DEV-${seq + 1}`).trim().toUpperCase();
      const requestedLocation = String(body.location || "场部").trim();
      if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(requestedCode)) return safeFailure("INVALID_DEVICE_CODE", "设备编号仅允许 1–32 位大写字母、数字、点、下划线或短横线");
      if (devices.some((item) => item.code === requestedCode)) return safeFailure("DEVICE_CODE_EXISTS", "设备编号已存在");
      if (lands.some((item) => item.code === requestedLocation) && !currentFarmOwnsLand(requestedLocation)) return safeFailure("LAND_SCOPE_DENIED", "设备位置不属于当前农场");
      const d = attachCatalog(
        {
          id: ++seq,
          code: requestedCode,
          name: body.name || (fromCat ? `${fromCat.type_name} · ${fromCat.model}` : "新设备"),
          device_type: body.device_type || (fromCat && fromCat.device_type) || "sensor",
          status: "沙箱待联调",
          location: requestedLocation,
          last_value: body.last_value || (fromCat && fromCat.sample_value) || "已登记，等待沙箱模拟首包",
          mqtt: `farm/${farmId}/device/${requestedCode}/data`,
          x: 300,
          y: 300,
          battery: 100,
          vendor_id: body.vendor_id || (fromCat && fromCat.vendor_id) || "xinjie",
          mesh: false,
        },
        catalogId || null,
        {
          model: body.model,
          category: body.category,
          type_name: body.type_name,
          params: body.params,
          units: body.units,
          interfaces: body.interfaces,
          derived: body.derived,
          tips: body.tips,
          docs_url: body.docs_url,
          image_url: body.image_url,
          application: body.application,
          vendor_name: body.vendor_name,
        }
      );
      annotateDemoDevice(d);
      devices.push(d);
      const ven = vendors.find((v) => v.id === d.vendor_id);
      if (ven) ven.devices = devices.filter((x) => x.vendor_id === ven.id).length;
      return { ...d, status_code: d.status, status: d.display_status, message: "设备仅登记到沙箱目录；未建立生产连接、凭据或控制权限" };
    }
    if (p.startsWith("/api/devices/") && p.endsWith("/control") && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能登记设备控制请求");
      const id = Number(p.split("/")[3]);
      const device = devices.find((d) => d.id === id);
      if (!device || !currentFarmOwnsDevice(device)) return safeFailure("DEVICE_NOT_FOUND", "设备不存在或不属于当前农场");
      const action = String(body.action || "").toLowerCase();
      const allowed = new Set(["start", "stop", "open", "close", "patrol", "idle"]);
      if (!allowed.has(action)) return safeFailure("INVALID_DEVICE_ACTION", "不支持的设备动作");
      const command = {
        id: null,
        action,
        status: "沙箱请求已登记",
        requested_at: new Date().toLocaleString("zh-CN"),
        simulated: true,
        executable: false,
      };
      device.desired_state_demo = action;
      device.last_command = command;
      return { ok: true, executable: false, simulation_request_id: commandId("SIM-DEV"), device: { ...device, status_code: device.status, status: device.display_status }, command, message: "仿真控制请求已登记；未连接真实设备，不代表动作已执行" };
    }

    if (p === "/api/robots") {
      return {
        missions: robotMissions.map((m) => ({ ...m, simulated: true, executable: false })),
        devices: devices.filter((d) => ["drone", "tractor", "robot", "sprayer"].includes(d.device_type)).map((d) => ({ ...d, status_code: d.status, status: d.display_status })),
        joint: jointOps.slice(0, 2),
        data_meta: { mode: "demo", simulated: true, production_connected: false },
      };
    }
    if (p === "/api/robots/dispatch" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能登记无人设备任务");
      const device = devices.find((d) => d.code === body.device);
      if (!device || !currentFarmOwnsDevice(device) || !["drone", "tractor", "robot", "sprayer"].includes(device.device_type)) {
        return safeFailure("DEVICE_NOT_FOUND", "所选无人设备不存在、不属于当前农场或类型不兼容");
      }
      const m = {
        id: ++seq,
        device: device.code,
        mission: String(body.mission || "临时巡田任务").slice(0, 120),
        status: "待人工确认",
        progress: 0,
        eta: "等待机手/设备回执",
        command_id: null,
        simulation_job_id: commandId("SIM-ROBOT"),
        simulated: true,
        executable: false,
      };
      robotMissions.unshift(m);
      agents.find((a) => a.name.includes("Robot")).last_action = `已登记 ${m.device} 仿真任务：${m.mission}`;
      return { ...m, ok: true, message: "仿真任务已入队，等待人工确认；未向真实设备下发" };
    }

    if (p === "/api/ai/chat") return chatAnswer(body.question || "");
    if (p === "/api/ai/vision") {
      const s = body.symptom || "";
      if (/斑|霉|枯萎|虫/.test(s)) {
        return { crop: body.crop, disease: "文字规则命中：斑/霉/枯萎/虫相关症状", confidence: null, level: "待核查", advice: "先补充带时间、位置和比例尺的原始影像，再由植保员复飞与样方调查；未确认物种、发生期和当地阈值前禁止施药。", model: "keyword-demo-rule v1", mode: "demo", validated: false, executable: false, limitations: "本接口只处理文字症状，不是图像识别或确诊" };
      }
      if (/黄|落叶|弱/.test(s)) {
        return { crop: body.crop, disease: "文字规则命中：黄化/落叶/弱势症状", confidence: null, level: "待核查", advice: "先核对叶位、发生比例、土壤/叶片化验、盐分和根区水分；未确认原因前不生成施肥剂量。", model: "keyword-demo-rule v1", mode: "demo", validated: false, executable: false, limitations: "同类症状可能来自养分、盐害、水分、病害或衰老，不能凭文字确诊" };
      }
      return { crop: body.crop, disease: "文字规则未命中已配置症状", confidence: null, level: "未知", advice: "规则未命中不代表无病害；请采集原始影像并由植保员核查。", model: "keyword-demo-rule v1", mode: "demo", validated: false, executable: false, limitations: "关键词仿真不能排除病虫害" };
    }
    if (p === "/api/ai/yield") {
      const items = lands.map((l) => {
        const adj = (l.health_index - 80) * 1.2 - Math.max(0, 25 - l.moisture) * 2 - l.pest_risk * 0.3;
        const predicted = Math.round(l.expected_yield + adj);
        return { code: l.code, name: l.crop_name, stage: l.stage, predicted, delta: predicted - l.expected_yield, risk: l.pest_risk };
      });
      return { avg_kg_per_mu: Math.round(items.reduce((s, i) => s + i.predicted, 0) / items.length), items, note: "仿真估算 · 种子数据的简化算式，不可用于生产承诺、保险或结算", model: "yield-demo-formula v1", mode: "demo", validated: false };
    }
    if (p === "/api/ai/rag") return { knowledge, models };
    if (p === "/api/ai/risk") {
      return {
        items: lands.map((l) => ({
          code: l.code,
          name: l.name,
          pest_risk: l.pest_risk,
          moisture_risk: l.moisture < 22 ? "高" : l.moisture < 28 ? "中" : "低",
          advice: l.pest_risk > 50 ? "优先复飞与样方调查；未确认前禁止防治处方" : l.moisture < 25 ? "核验传感深度、QC 与灌溉关键输入" : "继续现场监测与证据留痕",
          decision: "NO_GO",
          executable: false,
        })),
        mode: "demo",
        note: "风险分数为未核验模拟，不能直接触发施药、灌溉或机具动作",
      };
    }

    if (p === "/api/irrigation") {
      const focusLand = url.searchParams.get("land") || "";
      let suggestions = lands.map((l) => ({
        land_code: l.code,
        land_name: l.name,
        moisture: l.moisture,
        k: l.k,
        water_mm: null,
        calculation_status: "NOT_CALCULATED",
        fertilizer: "不生成肥料或剂量",
        priority: l.moisture < 25 ? "复核" : "观察",
        decision: "NO_GO",
        executable: false,
        missing_inputs: ["field_capacity", "root_depth_cm", "effective_rainfall", "ETc", "irrigation_efficiency", "sensor_qc"],
        reason: `含水率 ${l.moisture}% 为未核验模拟；缺关键水量与质量证据，不判断是否灌溉，也不计算剂量`,
      }));
      if (focusLand) suggestions = suggestions.slice().sort((a, b) => (a.land_code === focusLand ? -1 : b.land_code === focusLand ? 1 : 0));
      return {
        plans,
        suggestions,
        focus: focusLand,
        saving_target: "目标场景：节水约 20%（待实测核验）",
        protocol: "仿真处方计算 · 未连接真实阀泵",
        data_meta: { mode: "demo", source: "FarmEngine 本地规则引擎", as_of: "2026-09-14", simulated: true },
      };
    }
    if (p === "/api/irrigation/apply" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能登记灌溉请求");
      const code = url.searchParams.get("land_code");
      const land = lands.find((l) => l.code === code);
      if (!land || !currentFarmOwnsLand(code)) return safeFailure("LAND_NOT_FOUND", "地块不存在或不属于当前农场");
      const water = null;
      const fert = "不生成肥料或剂量；等待完整证据与属地处方";
      plans.unshift({ id: ++seq, land_code: code, water_mm: water, calculation_status: "NOT_CALCULATED", fertilizer: fert, reason: "仅登记证据缺口；缺少田间持水量、根层、ETc、有效降雨、效率与传感器 QC，禁止计算或执行", status: "NO_GO · 待补证据", created_at: `记录于 ${new Date().toLocaleString("zh-CN")}`, command_id: null, simulated: true, executable: false });
      return {
        ok: true,
        decision: "NO_GO",
        executable: false,
        land_code: code,
        water_mm: water,
        calculation_status: "NOT_CALCULATED",
        fertilizer: fert,
        command_id: null,
        simulated: true,
        missing_inputs: ["field_capacity", "root_depth_cm", "effective_rainfall", "ETc", "irrigation_efficiency", "sensor_qc"],
        message: "已保存仿真处方，但关键农艺输入不完整，禁止自动执行；墒情仿真快照未改写",
      };
    }

    if (p === "/api/tasks" && method === "GET") {
      let list = tasks.slice().reverse();
      const scope = url.searchParams.get("scope") || "";
      if (role === "expert" && scope === "audit") {
        list = list.filter((t) => t.status === "待审核");
      } else if (role === "expert" && scope !== "all") {
        // 默认：待审核置顶，其后为分析/水肥/进行中
        const audit = list.filter((t) => t.status === "待审核");
        const rest = list.filter((t) => t.status !== "待审核");
        list = [...audit, ...rest];
      }
      if (role === "gov" && scope !== "all") {
        list = list.filter((t) => t.priority === "高" || t.land_code === "全场" || t.status === "待审核");
      }
      return list;
    }
    if (p === "/api/tasks" && method === "POST") {
      const title = String(body.title || "").trim();
      const landCode = String(body.land_code || "").trim();
      const taskType = String(body.task_type || "农事").trim();
      const priority = String(body.priority || "中").trim();
      if (!title || title.length > 80) return safeFailure("INVALID_TASK_TITLE", "任务标题需为 1–80 个字符");
      if (!currentFarmOwnsLand(landCode)) return safeFailure("LAND_SCOPE_DENIED", "任务地块不属于当前农场");
      if (!new Set(["高", "中", "低"]).has(priority)) return safeFailure("INVALID_PRIORITY", "任务优先级只能为高、中或低");
      const t = {
        id: ++seq,
        title,
        task_type: taskType.slice(0, 24),
        land_code: landCode,
        assignee: String(body.assignee || "Farm Master Agent").slice(0, 60),
        status: "待人工确认",
        scheduled_at: `模拟 ${new Date().toLocaleString("zh-CN")}`,
        priority,
      };
      tasks.push(t);
      return t;
    }
    if (p.startsWith("/api/tasks/") && p.endsWith("/status") && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "仅农场角色可推进任务状态");
      const id = Number(p.split("/")[3]);
      const t = tasks.find((x) => x.id === id);
      if (!t || !currentFarmOwnsLand(t.land_code)) return safeFailure("TASK_NOT_FOUND", "任务不存在或不属于当前农场");
      const nextStatus = url.searchParams.get("status") || "已完成";
      if (humanGate.emergency_locked && ["待执行", "进行中"].includes(nextStatus)) {
        return safeFailure("SAFETY_LOCKED", "紧急停机锁定中，禁止启动或恢复任务");
      }
      const allowedStatus = new Set(["待人工确认", "回放队列", "待审核", "已审核", "已驳回", "已制止"]);
      if (!allowedStatus.has(nextStatus)) return safeFailure("INVALID_TASK_STATUS", "不支持的任务状态");
      const transitions = {
        "待人工确认": ["回放队列", "待审核", "已制止"],
        "回放队列": ["待审核", "已制止"],
        "待执行": ["待人工确认", "待审核", "已制止"],
        "待命": ["待人工确认", "已制止"],
        "已审核": ["回放队列", "已制止"],
        "进行中": ["待审核", "已制止"],
        "执行中": ["待审核", "已制止"],
        "待审核": ["已审核", "已驳回"],
        "已驳回": ["待人工确认"],
        "已制止": ["待人工确认"],
        "已完成": [],
      };
      if (!(transitions[t.status] || []).includes(nextStatus)) {
        return safeFailure("INVALID_TRANSITION", `不允许从「${t.status}」直接变为「${nextStatus}」`);
      }
      if (nextStatus === "已完成") {
        const evidence = body.evidence || {};
        const valid = evidence.device_ack === true && String(evidence.track_ref || "").trim().length >= 3 &&
          String(evidence.actuals || "").trim().length >= 3 && String(evidence.accepted_by || "").trim().length >= 2;
        if (!valid) {
          return safeFailure("ACCEPTANCE_EVIDENCE_REQUIRED", "归档前必须提供设备 ACK、轨迹引用、实际用量/面积和独立验收人");
        }
        t.acceptance_evidence = {
          device_ack: true,
          track_ref: String(evidence.track_ref).slice(0, 120),
          actuals: String(evidence.actuals).slice(0, 240),
          accepted_by: String(evidence.accepted_by).slice(0, 40),
          accepted_at: new Date().toLocaleString("zh-CN"),
        };
      }
      t.status = nextStatus;
      t.simulated = true;
      t.executable = false;
      t.audit_note = (t.audit_note ? `${t.audit_note} · ` : "") + `仿真状态变更为「${nextStatus}」；未向设备下发`;
      if (t.status === "已完成") {
        const now = new Date();
        taskExecLog.unshift({
          id: `EX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(t.id).padStart(2, "0")}`,
          task_id: t.id,
          title: t.title,
          task_type: t.task_type,
          land_code: t.land_code,
          agent: t.assignee,
          status: "已完成",
          started_at: t.scheduled_at || now.toLocaleString("zh-CN"),
          finished_at: now.toLocaleString("zh-CN"),
          duration_min: Number(body.duration_min) > 0 ? Math.round(Number(body.duration_min)) : null,
          result: `仿真验收归档 · 用户登记 ACK · 轨迹 ${t.acceptance_evidence.track_ref} · ${t.acceptance_evidence.actuals}`,
          acceptance_evidence: t.acceptance_evidence,
          simulated: true,
          verified: false,
          source: "浏览器仿真会话",
          year: now.getFullYear(),
        });
      }
      return { ...t, simulated: true, executable: false, message: "仅更新浏览器内仿真状态；未向设备下发" };
    }
    if (p === "/api/history") {
      const year = Number(url.searchParams.get("year") || 2026);
      const land = url.searchParams.get("land") || "";
      let landRows = landHistory.filter((r) => r.year === year);
      if (land && land !== "全场") landRows = landRows.filter((r) => r.land_code === land);
      let execs = taskExecLog.filter((e) => e.year === year);
      if (land && land !== "全场") execs = execs.filter((e) => e.land_code === land || e.land_code === "全场");
      const years = [...new Set(landHistory.map((r) => r.year))].sort((a, b) => b - a);
      const landSeries = lands.map((l) => ({
        code: l.code,
        name: l.name,
        area_mu: l.area_mu,
        crop: l.crop_name,
        yields: landHistory.filter((r) => r.land_code === l.code).sort((a, b) => a.year - b.year).map((r) => ({ year: r.year, yield: r.yield_kg_mu, water: r.water_m3_mu, health: r.health_avg })),
      }));
      const summary = {
        year,
        lands: landRows.length,
        avg_yield: landRows.length ? Math.round(landRows.reduce((s, r) => s + r.yield_kg_mu, 0) / landRows.length) : 0,
        avg_water: landRows.length ? Math.round(landRows.reduce((s, r) => s + r.water_m3_mu, 0) / landRows.length) : 0,
        tasks_done: execs.filter((e) => e.status === "已完成").length,
        tasks_running: execs.filter((e) => e.status === "执行中").length,
        water_saving_pct: landRows.length ? Math.round(landRows.reduce((s, r) => s + r.saving_water_pct, 0) / landRows.length) : 0,
      };
      return {
        year,
        years,
        land,
        summary,
        lands: landRows,
        land_series: landSeries,
        executions: execs,
        note: "仿真档案：产量、用水、健康度与作业履历均为未验证模拟；真实使用须绑定来源、计量、设备 ACK 与验收证据",
      };
    }
    if (p === "/api/tasks/history") {
      const year = Number(url.searchParams.get("year") || 0);
      const land = url.searchParams.get("land") || "";
      let list = taskExecLog.slice();
      if (year) list = list.filter((e) => e.year === year);
      if (land && land !== "全场") list = list.filter((e) => e.land_code === land || e.land_code === "全场");
      return { items: list, total: list.length };
    }
    if (p.startsWith("/api/tasks/") && p.endsWith("/audit") && method === "POST") {
      if (role !== "expert") return safeFailure("EXPERT_ROLE_REQUIRED", "仅专家审核视图可审核任务");
      const identity = declaredExpertIdentity(body);
      if (!identity.ok) return identity.error;
      const id = Number(p.split("/")[3]);
      const t = tasks.find((x) => x.id === id);
      if (!t || !currentFarmOwnsLand(t.land_code)) return safeFailure("TASK_NOT_FOUND", "任务不存在或不属于当前农场");
      const pass = !(body.approved === false || body.pass === false);
      t.status = pass ? "已审核" : "已驳回";
      t.audit_by = identity.value.reviewer_id;
      t.audit_identity = identity.value;
      t.audit_at = new Date().toLocaleString("zh-CN");
      t.audit_comment = body.comment || (pass ? "专家初审通过；仍须场长人工确认，不代表允许执行" : "退回补证");
      expertReviews.unshift({
        id: `RV-${t.id}-${Date.now()}`,
        task_id: t.id,
        title: t.title,
        land_code: t.land_code,
        result: pass ? "初审通过 · 待人工确认" : "退回补证",
        comment: t.audit_comment,
        reviewer_id: identity.value.reviewer_id,
        qualification_scope: identity.value.qualification_scope,
        credential_ref: identity.value.credential_ref,
        evidence_refs: identity.value.evidence_refs,
        identity_assurance: identity.value.identity_assurance,
        gate_scope: identity.value.gate_scope,
        at: t.audit_at,
      });
      if (pass && t.task_type === "水肥") {
        const plan = plans.find((x) => x.land_code === t.land_code && x.status === "待执行");
        if (plan) plan.status = "专家初审通过 · 待人工门禁";
      }
      return t;
    }
    if (p === "/api/expert/review" && method === "POST") {
      if (role !== "expert") return safeFailure("EXPERT_ROLE_REQUIRED", "仅专家审核视图可记录专家意见");
      const identity = declaredExpertIdentity(body);
      if (!identity.ok) return identity.error;
      const row = {
        id: `RV-${++seq}`,
        target: body.target || "prescription",
        land_code: body.land_code || "",
        title: body.title || "专家批注",
        comment: body.comment || "",
        result: body.result || "已批注",
        reviewer_id: identity.value.reviewer_id,
        qualification_scope: identity.value.qualification_scope,
        credential_ref: identity.value.credential_ref,
        evidence_refs: identity.value.evidence_refs,
        identity_assurance: identity.value.identity_assurance,
        gate_scope: identity.value.gate_scope,
        at: new Date().toLocaleString("zh-CN"),
      };
      expertReviews.unshift(row);
      if (body.plan_id) {
        const plan = plans.find((x) => x.id === Number(body.plan_id));
        if (plan) {
          plan.expert_note = body.comment || plan.expert_note;
          plan.status = body.result === "驳回" ? "专家驳回" : (plan.status === "待执行" ? "专家初审通过 · 待人工门禁" : plan.status);
        }
      }
      return row;
    }
    if (p === "/api/gov/flag" && method === "POST") {
      const row = {
        id: `GF-${++seq}`,
        title: body.title || "监管关注",
        land_code: body.land_code || "全场",
        level: body.level || "关注",
        note: body.note || "",
        at: new Date().toLocaleString("zh-CN"),
      };
      govFlags.unshift(row);
      return row;
    }

    if (p === "/api/assets") return assets;
    if (p === "/api/models") return models;
    if (p === "/api/knowledge") return knowledge;

    if (p === "/api/season") {
      return {
        ...seasonCycle,
        data_meta: { mode: "demo", source: "全季流程回放", as_of: "2026-09-14", simulated: true, verified: false },
        live_devices: [
          ...devices.filter((d) => !d.mesh).map((d) => ({
            code: d.code,
            name: d.name,
            status: d.display_status,
            location: d.location,
            type: d.device_type,
            simulated: true,
            production_connected: false,
          })),
          ...seasonCycle.fleet_extra.map((d) => ({
            ...d,
            status: String(d.status || "待核验").startsWith("模拟 · ") ? d.status : `模拟 · ${d.status || "待核验"}`,
            simulated: true,
            production_connected: false,
          })),
        ],
        kpis: {
          stages_done: seasonCycle.stages.filter((s) => ["回放归档", "流程回放完成"].includes(s.status)).length,
          stages_total: seasonCycle.stages.length,
          running: seasonCycle.stages.filter((s) => s.status === "执行中").length,
          progress: seasonCycle.progress,
        },
        context: {
          region: "新疆",
          as_of: "2026-09-12",
          summary: "棉花吐絮盛期、春玉米成熟收晒、冬麦适播准备",
        },
      };
    }
    if (p === "/api/season/advance" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能推进生产环节");
      const stage = seasonCycle.stages.find((s) => s.id === body.id);
      if (!stage) return safeFailure("SEASON_STAGE_NOT_FOUND", "生育期环节不存在");
      if (stage.status !== "GO_APPROVED" || stage.executable !== true || stage.evidence_verified !== true || stage.interlock_verified !== true) {
        return safeFailure("EVIDENCE_REQUIRED", "仅 GO_APPROVED 且证据包、设备联锁均已核验的环节可推进；当前保持禁行", {
          decision: stage.status === "GO_APPROVED" ? "GO_APPROVAL_INCOMPLETE" : "NO_GO",
          executable: false,
          stage,
        });
      }
      stage.progress = Math.min(100, stage.progress + 12);
      if (stage.progress >= 100) {
        stage.status = "流程回放完成";
        stage.progress = 100;
      } else {
        stage.status = "流程回放";
      }
      const done = seasonCycle.stages.filter((s) => ["回放归档", "流程回放完成"].includes(s.status)).length;
      const replay = seasonCycle.stages.filter((s) => s.status === "流程回放");
      seasonCycle.progress = Math.round((done * 100 + replay.reduce((sum, item) => sum + item.progress, 0) / Math.max(1, replay.length)) / seasonCycle.stages.length);
      return { ok: true, stage, progress: seasonCycle.progress, simulated: true, executable: false, message: "仅推进界面回放，未生成任何设备命令" };
    }
    if (p === "/api/fleet/advance" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能推进机具协同任务");
      const op = jointOps.find((j) => j.id === (body.id || selectedJointId));
      if (!op) return safeFailure("FLEET_OPERATION_NOT_FOUND", "机具协同任务不存在");
      if (op.status !== "GO_APPROVED" || op.executable !== true || op.evidence_verified !== true || op.interlock_verified !== true) {
        return safeFailure("EVIDENCE_REQUIRED", "仅 GO_APPROVED 且证据包、机具联锁均已核验的联合任务可推进；当前保持禁行", {
          decision: op.status === "GO_APPROVED" ? "GO_APPROVAL_INCOMPLETE" : "NO_GO",
          executable: false,
          op,
        });
      }
      op.progress = Math.min(100, (op.progress || 0) + 10);
      if (op.progress >= 100) {
        op.status = "流程回放完成";
        op.timeline.push({ t: "仿真推进", event: "模拟编队任务完成，进入复核归档" });
      } else {
        op.status = "流程回放";
        op.timeline.push({ t: "仿真推进", event: `回放进度推进至 ${op.progress}%` });
      }
      selectedJointId = op.id;
      return { ok: true, op, simulated: true, executable: false, message: "仅推进界面回放，未生成任何设备命令" };
    }
    if (p === "/api/postharvest") {
      return {
        ...postHarvest,
        data_meta: { mode: "demo", simulated: true, verified: false, production_connected: false, source: "固定收贮回放模拟" },
        summary: {
          stock_t: postHarvest.warehouses.reduce((s, w) => s + w.stock_t, 0),
          capacity_t: postHarvest.warehouses.reduce((s, w) => s + w.capacity_t, 0),
          lines_running: postHarvest.lines.filter((l) => l.status === "运行").length,
          batches: postHarvest.batches.length,
        },
      };
    }
    if (p === "/api/postharvest/advance" && method === "POST") {
      if (role !== "farm") return safeFailure("VIEW_ONLY", "当前角色不能推进采后批次");
      const b = postHarvest.batches.find((x) => x.id === body.id);
      if (!b) return safeFailure("BATCH_NOT_FOUND", "采后批次不存在");
      const lastIndex = postHarvest.flow.length - 1;
      const currentReplayIndex = Math.max(Number(b.workflow_index || 0), Number(b.replay_index || 0));
      if (currentReplayIndex >= lastIndex) {
        return safeFailure("REPLAY_COMPLETE", "该批次回放已到末环节；真实批次状态仍须由过磅、质检、仓储或产线凭证更新", {
          batch: { ...b, replay_stage: postHarvest.flow[lastIndex], simulated: true, verified: false },
          simulated: true,
          executable: false,
        });
      }
      b.replay_index = currentReplayIndex + 1;
      b.replay_stage = postHarvest.flow[b.replay_index];
      b.replay_updated_at = "模拟回放";
      return {
        ok: true,
        batch: { ...b, simulated: true, verified: false },
        simulated: true,
        executable: false,
        message: `仅将流程回放推进至“${b.replay_stage}”；真实环节、库存、重量、质检和产线状态均未改写`,
      };
    }

    throw new Error("未知接口 " + p);
  }

  global.FarmEngine = { handle };
})(window);
