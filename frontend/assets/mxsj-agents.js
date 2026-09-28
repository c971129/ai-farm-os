/**
 * 作物 AI 智能体规格落地
 * - 专家名录、协同中心、联合诊断、协作工作台
 * - 规则编排仿真，不宣称真实模型或设备执行
 */
(function (global) {
  const EXPERT_CATALOG = [
    { key: "master", name: "Farm Master Agent", role: "总管拆解与汇总", duty: "任务规划、动态组队、交叉复核汇总", tools: ["任务编排", "专家选择", "结论汇总"] },
    { key: "crop-vigor", name: "作物长势专家", role: "作物长势评估", duty: "胁迫表现与生育期影响", tools: ["长势评估", "NDVI解读"] },
    { key: "soil-health", name: "土壤健康专家", role: "土壤健康评估", duty: "盐分、根区与返盐风险", tools: ["EC评估", "返盐风险"] },
    { key: "vri-optimize", name: "水肥优化专家", role: "变量水肥优化", duty: "补水条件、方案约束与安全边界", tools: ["墒情计算", "处方约束"] },
    { key: "weather", name: "气象分析专家", role: "气象窗口评估", duty: "蒸散、降雨与作业时间窗", tools: ["蒸散估算", "窗口判断"] },
    { key: "pest-alert", name: "病虫害预警专家", role: "病虫害监测预警", duty: "病斑/虫害风险识别", tools: ["病斑检测", "预警分级"] },
    { key: "yield-predict", name: "产量预测专家", role: "产量预测", duty: "单产与偏差分析", tools: ["产量模型"] },
    { key: "root-growth", name: "根系生长专家", role: "根系生长分析", duty: "根区水分与生长限制", tools: ["根区诊断"] },
    { key: "breeding", name: "生物育种专家", role: "生物育种咨询", duty: "品种适应性与育种建议", tools: ["品种匹配"] },
    { key: "phenotype", name: "表型分析专家", role: "作物表型分析", duty: "表型指标与影像特征", tools: ["表型分割"] },
    { key: "robot", name: "Robot Agent", role: "无人设备调度", duty: "巡田与农机路径", tools: ["路径规划"] },
    { key: "finance", name: "Finance Agent", role: "收益分析", duty: "成本与亩均增收", tools: ["ROI"] },
  ];

  /*
   * 独立专家委员会：每个 Agent 只读取本专业的证据包、独立给出风险与缺口，
   * 汇总器只能归并结果，不能覆盖任一 Agent 的 NO_GO，也没有设备控制权。
   * 这是规则编排仿真契约，不代表已接入真实模型、气象、设备或生产数据。
   */
  const INDEPENDENT_EXPERT_AGENTS = [
    {
      key: "agronomy",
      short: "农艺",
      name: "农艺与作物健康专家",
      domain: "作物制度、生育期、样方与田间健康",
      scope: "只判断作物—生育期—属地制度是否匹配，以及现场观测是否足以进入下一步研判。",
      isolation: "独立读取农艺证据包；不读取同伴结论，也不下发处方。",
      evidence: ["作物/品种/生育期与属地种植制度", "带坐标、时间和方法的样方", "田间异常照片及原始观测记录"],
      hard_stops: ["作物、生育期或属地模板不匹配", "样方没有位置、时间或采样方法", "把仿真指数当作现场结论"],
      output: "生育期判断、观察缺口、复核优先级",
      finding: "B-01 开絮与叶色均为仿真快照；未绑定本地样方和制度，不能形成脱叶或采收判断。",
      next: "先由属地农艺师登记样方与区域模板，再进行候选方案比较。",
      standard: "FAO 数字农业 / 本地农艺规程",
      reference_url: "https://www.fao.org/e-agriculture/",
      tone: "blue",
    },
    {
      key: "water-nutrition",
      short: "水肥",
      name: "水肥与灌溉效率专家",
      domain: "根层水分、盐分、ETc、流量与养分边界",
      scope: "只校验灌溉时机、用量和速率所需输入是否齐全；不计算或下发真实剂量。",
      isolation: "独立读取水肥证据包；不读取作业调度结论，也不控制阀泵。",
      evidence: ["田间持水量、根层深度与传感器 QC", "ETc、有效降雨与灌溉效率", "流量计、泵阀现场状态与盐分剖面"],
      hard_stops: ["水分单位、深度或传感器质量码未知", "ETc/有效降雨/效率缺失", "泵阀、流量或排盐条件未核验"],
      output: "输入完整性、节水风险、停止条件",
      finding: "当前墒情和 EC 是固定展示值，缺根层、ETc、有效降雨与流量证据；水量保持未计算。",
      next: "补齐计量与根区证据后，由具有本地授权的人员复核时机、用量与速率。",
      standard: "FAO-56 / USDA NRCS 449",
      reference_url: "https://www.nrcs.usda.gov/resources/guides-and-instructions/irrigation-water-management-ac-449-conservation-practice-standard",
      tone: "cyan",
    },
    {
      key: "plant-protection",
      short: "植保",
      name: "植保与生物安全专家",
      domain: "病虫害证据、IPM、标签、漂移和隔离",
      scope: "只判断是否具备调查与风险分级条件；不推荐药剂、剂量或喷施动作。",
      isolation: "独立读取植保调查包；不读取设备路径结果，也不生成喷施指令。",
      evidence: ["物种/病级/发生期与地面调查", "属地登记标签、缓冲区和人员隔离", "逐小时天气、风速来源与喷雾机校准"],
      hard_stops: ["未确认对象、发生程度或本地阈值", "标签、缓冲区、清场或漂移条件缺失", "将影像草稿直接转为用药决定"],
      output: "调查优先级、非化学选项、禁止条件",
      finding: "页面没有原始影像、地面真值、标签或气象来源；任何施药相关建议均维持 NO_GO。",
      next: "先建立带时间位置的调查记录，按 IPM 原则比较非化学与最小风险方案。",
      standard: "FAO Integrated Pest Management",
      reference_url: "https://www.fao.org/pest-and-pesticide-management/ipm/integrated-pest-management/en",
      tone: "orange",
    },
    {
      key: "machinery-safety",
      short: "农机",
      name: "农机装备与功能安全专家",
      domain: "机具互操作、作业区、人机隔离、ACK 与安全停机",
      scope: "只检查安全相关控制链和任务交换证据；不接管、启停或移动任何农机。",
      isolation: "独立读取机具与安全联锁证据；不接受其他 Agent 的执行授权。",
      evidence: ["设备身份、兼容性和任务交换记录", "地块边界、道路、地况与人员隔离", "急停、位置、地理围栏、机手与设备 ACK"],
      hard_stops: ["未验证设备身份、互操作或 ACK", "安全停机/人员隔离/围栏未确认", "把流程回放或模拟状态标作设备已执行"],
      output: "安全接口缺口、联锁状态、人工放行前提",
      finding: "现有机具均为模拟档案且未连接生产 ACK；仅能回放候选路径，不能形成作业许可。",
      next: "接入前分别完成兼容性、功能安全、边界和现场交接验收。",
      standard: "ISO 11783 / ISO 25119（设计参考）",
      reference_url: "https://www.iso.org/standard/57556.html",
      tone: "red",
    },
    {
      key: "postharvest-quality",
      short: "收贮",
      name: "收贮加工与质量专家",
      domain: "试收、含水、批次、仓容、卫生与追溯",
      scope: "只审阅收获和收贮的证据链；不确认真实库存、质量等级或发运。",
      isolation: "独立读取批次与质量证据；不读取产量预测结果作为放行依据。",
      evidence: ["校准含水率、试收损失与破碎率", "运输、烘干、仓容与交接记录", "批次标识、卫生控制点与追溯链"],
      hard_stops: ["含水率或试收数据未校准", "仓容、交接或批次标识缺失", "把模拟库存或质检值用于结算/发运"],
      output: "收贮能力缺口、批次证据、质量风险",
      finding: "机收和仓储容量当前没有现场记录；界面台账仅是流程演示，不能用于质量或库存结论。",
      next: "以试收—交接—入仓的连续批次记录补齐收贮证据后再排程。",
      standard: "Codex CXC 1-1969",
      reference_url: "https://www.fao.org/fao-who-codexalimentarius/en/",
      tone: "green",
    },
    {
      key: "geo-data",
      short: "空间",
      name: "空间数据与遥感专家",
      domain: "地块边界、坐标系、影像时间、地图精度与遥感证据",
      scope: "只验证空间数据能否用于展示、巡检或结算；不把屏幕示意坐标当作导航坐标。",
      isolation: "独立读取空间元数据与影像证据；不从视觉模型结论推断真实边界。",
      evidence: ["CRS、测绘来源、版本和精度说明", "影像采集时间、分辨率、云量与质控", "地块权属/边界变更和现场核验记录"],
      hard_stops: ["无 CRS 或测绘来源的图层用于导航/面积结算", "影像时间或质量未知", "边界更新未复核"],
      output: "空间适用范围、精度限制、补测建议",
      finding: "当前地图标明为 screen_demo 坐标，未测绘；可用于界面教学，不能用于导航、面积或结算。",
      next: "生产接入采用可追溯的 CRS、版本、精度和地块变更审计。",
      standard: "OGC API Features（互操作参考）",
      reference_url: "https://www.ogc.org/standards/ogcapi-features/",
      tone: "blue",
    },
    {
      key: "trusted-ai",
      short: "可信AI",
      name: "数据治理与可信 AI专家",
      domain: "数据来源、模型边界、置信度、漂移与人工监督",
      scope: "只审查模型输出的可追溯性与适用边界；不把概率、分数或聊天答案升级为生产决定。",
      isolation: "独立读取数据与模型元数据；不接受业务压力改变风险结论。",
      evidence: ["数据来源、采集时间、单位、质量码和授权", "模型版本、验证集、适用范围和漂移监控", "可复核证据、人工监督与纠错路径"],
      hard_stops: ["来源、版本、适用范围或质量码缺失", "模拟指标冒充实时/已验证能力", "高风险决定无人工监督和可追溯证据"],
      output: "可信度说明、模型限制、复核与反馈要求",
      finding: "本项目明确使用本地规则与固定模拟数据；模型分数和预测均不具备本场验证证据。",
      next: "生产前为每个模型绑定数据卡、版本、验证记录、监控阈值与人工纠错闭环。",
      standard: "NIST AI RMF 1.0（风险管理参考）",
      reference_url: "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10",
      tone: "purple",
    },
    {
      key: "iot-security",
      short: "IoT安全",
      name: "农业物联网安全专家",
      domain: "设备身份、配置、更新、数据保护、日志与异常状态",
      scope: "只审查设备和数据链的安全能力；不绕过令牌、权限、急停或人工门禁。",
      isolation: "独立读取资产、安全状态与审计证据；不接收业务侧的越权请求。",
      evidence: ["唯一设备标识、资产清单与责任人", "接口访问控制、配置基线和安全更新状态", "事件日志、告警、数据保护和退役记录"],
      hard_stops: ["身份、最小权限或审计记录缺失", "设备控制接口未完成安全验收", "安全状态未知却标记为已连接/在线"],
      output: "安全能力缺口、最小权限建议、审计要求",
      finding: "生产设备未接入，系统默认锁定写操作；这符合未知设备状态不得自动执行的边界。",
      next: "生产接入前建立设备身份、配置、更新、日志和异常通报的闭环。",
      standard: "NISTIR 8259A（IoT 基线参考）",
      reference_url: "https://csrc.nist.gov/pubs/ir/8259/a/final",
      tone: "red",
    },
    {
      key: "field-ux",
      short: "现场UX",
      name: "现场交互与无障碍专家",
      domain: "户外可读性、键盘操作、触控目标、状态表达与响应式布局",
      scope: "只检查人能否看懂、访问和安全地操作页面；不替用户或责任人确认现场事实。",
      isolation: "独立读取界面语义与交互状态；不将视觉美观等同于作业安全。",
      evidence: ["键盘焦点、可访问名称和状态播报", "对比度、文字/图标冗余与触控尺寸", "窄屏、弱网、强光和异常状态下的任务完成路径"],
      hard_stops: ["关键状态只靠颜色表达", "关键动作无键盘或无可访问名称", "窄屏下遮挡人工门禁或停止入口"],
      output: "可访问性缺口、现场可读性、交互回归项",
      finding: "新版委员会采用可聚焦按钮、文字化状态和窄屏重排；仍需在实机强光和网络中断条件下验证。",
      next: "将桌面、平板、手机和大屏的关键任务纳入可访问性回归。",
      standard: "W3C WCAG 2.2（可访问性参考）",
      reference_url: "https://www.w3.org/TR/WCAG22/",
      tone: "green",
    },
    {
      key: "test-reliability",
      short: "测试",
      name: "测试与可靠性专家",
      domain: "回归测试、异常注入、降级、状态一致性与发布门禁",
      scope: "只验证系统是否可重复地拒绝危险或不完整请求；不替代生产验收或责任人签字。",
      isolation: "独立读取测试证据与失败记录；不因演示需要降低门禁。",
      evidence: ["单元/API/浏览器回归结果", "离线、接口失败、越权和异常输入用例", "发布版本、变更范围和可复现缺陷记录"],
      hard_stops: ["高风险路径无自动回归", "后端与本地状态静默分叉", "失败降级后仍显示成功或已执行"],
      output: "验证覆盖、故障路径、发布阻断项",
      finding: "当前系统通过确定性规则和默认拒绝来演示安全边界；每次变更都应重新验证前后端契约与三角色权限。",
      next: "持续执行静态检查、API 冒烟、角色门禁、响应式和大屏视觉回归。",
      standard: "项目发布门禁 / 安全案例",
      reference_url: "docs/EXPERT_COUNCIL.md",
      tone: "purple",
    },
  ];

  const COUNCIL_CONTEXT = {
    title: "B-01 棉花吐絮偏慢 · 跨专业证据复核",
    description: "案例数据均为本地仿真快照；用于演示独立评议、异议保留与人工门禁，不能用于生产操作。",
    default_goal: "核查 B-01 当前是否具备进入下一步作业研判的证据条件，并列出停止条件。",
  };
  let councilReview = null;

  function councilPayload() {
    return {
      title: "独立专家委员会",
      mode: "local_rules_simulation",
      source: "FarmMxsj 本地规则编排",
      non_executable: true,
      no_device_control: true,
      protocol: "先独立取证与评议，后只读汇总；任一 NO_GO 不可被汇总器覆盖。",
      current_case: COUNCIL_CONTEXT,
      agents: INDEPENDENT_EXPERT_AGENTS.map((agent) => ({ ...agent })),
      review: councilReview,
      references: [
        { label: "FAO-56 / 灌溉作物蒸散", url: "https://www.fao.org/4/ah861e/ah861e.pdf" },
        { label: "USDA NRCS 449 / 灌溉水管理", url: "https://www.nrcs.usda.gov/resources/guides-and-instructions/irrigation-water-management-ac-449-conservation-practice-standard" },
        { label: "ISO 11783 / 农机数据网络", url: "https://www.iso.org/standard/57556.html" },
        { label: "NIST IoT 基线", url: "https://csrc.nist.gov/pubs/ir/8259/a/final" },
        { label: "WCAG 2.2", url: "https://www.w3.org/TR/WCAG22/" },
      ],
    };
  }

  function buildCouncilReview(goal) {
    const brief = String(goal || COUNCIL_CONTEXT.default_goal).replace(/\s+/g, " ").trim().slice(0, 500) || COUNCIL_CONTEXT.default_goal;
    const outputs = INDEPENDENT_EXPERT_AGENTS.map((agent, index) => ({
      agent_key: agent.key,
      agent_name: agent.name,
      domain: agent.domain,
      independent: true,
      no_execution: true,
      order: index + 1,
      finding: agent.finding,
      evidence_missing: agent.evidence.slice(0, 3),
      gate: `NO_GO · ${agent.hard_stops[0]}`,
      recommendation: agent.next,
      confidence: "低 · 本地仿真，未接生产证据",
    }));
    return {
      id: `COUNCIL-${Date.now().toString().slice(-8)}`,
      mode: "local_rules_simulation",
      goal: brief,
      reviewed_at: new Date().toLocaleString("zh-CN"),
      independent_agents: outputs.length,
      executable: false,
      device_command_count: 0,
      outputs,
      coordinator: {
        role: "只读汇总器",
        conclusion: "10/10 专家均保留 NO_GO：需要先补齐分域证据，再由具备属地授权的责任人复核。",
        rule: "不投票稀释硬性门禁；不生成工单、处方、剂量或设备命令。",
      },
    };
  }

  const collabTasks = [
    {
      id: "CASE-DEMO-001",
      title: "B-01 棉花吐絮偏慢 · 脱叶窗口联合研判",
      land: "B-01",
      scene: "秋收脱叶",
      stage: "NO_GO · 证据待补",
      risk: "高",
      agents: ["master", "crop-vigor", "phenotype", "weather", "pest-alert"],
      conflict: "模拟开絮率不足 vs 过早脱叶风险：当前证据不足，不能形成喷施结论",
      gaps: ["带时间位置的开絮样方", "未来 7 日逐小时天气", "登记药剂标签与剂量校准", "清场与人工批准"],
      master: "NO_GO：先补齐现场样方、天气、标签、剂量与责任人批准；本案例不生成设备命令。",
      todos: ["补齐脱叶证据包", "指派农艺师与场长复核"],
      trace: [
        { t: "模拟", agent: "Farm Master", event: "接收仿真事件并拆解证据问题" },
        { t: "模拟", agent: "作物长势/表型/气象", event: "生成分析草稿，标记证据缺口" },
        { t: "NO_GO", agent: "安全门禁", event: "未形成可执行处方，等待人工复核" },
      ],
      selected: true,
    },
    {
      id: "CASE-DEMO-002",
      title: "B-02 春玉米机收含水与进仓节奏",
      land: "B-02",
      scene: "机收转运",
      stage: "NO_GO · 条件待核验",
      risk: "中",
      agents: ["master", "yield-predict", "robot", "weather"],
      conflict: "模拟含水与烘干吞吐均未由现场系统核验",
      gaps: ["成熟/黑层证据", "校准含水率", "试收损失与破碎率", "道路隔离", "运输、烘干与仓容"],
      master: "NO_GO：完成试收与收储能力核验后，由机务和仓储负责人共同排程。",
      todos: ["完成试收证据包", "核验道路与仓储能力"],
      trace: [{ t: "NO_GO", agent: "Robot Agent", event: "仅生成路线回放，未启动机收编队" }],
      selected: false,
    },
    {
      id: "CASE-DEMO-003",
      title: "C-01 冬麦适播准备证据核查",
      land: "C-01",
      scene: "秋种备播",
      stage: "证据待补充",
      risk: "中",
      agents: ["master", "weather", "vri-optimize", "crop-vigor"],
      conflict: "库尔勒本地种植制度未绑定，不得套用北疆适播日期",
      gaps: ["农业生态区编码与批准模板", "种子批次/发芽率/千粒重", "目标基本苗", "播层底墒", "机具校准"],
      master: "NO_GO：先由本地农艺师批准区域模板，再核验种子、底墒与机具。",
      todos: ["绑定属地模板", "补齐种子与底墒证据"],
      trace: [{ t: "NO_GO", agent: "气象/水肥", event: "区域规则缺失，未生成播种或灌水处方" }],
      selected: false,
    },
  ];

  let diagnosis = {
    stage: 1,
    executionState: "awaiting_approval",
    feedbackOutcome: "normal",
    caseId: "CASE-DEMO-001",
    label: "案例仿真",
  };

  let workbench = {
    conversations: [
      { id: "wb-1", title: "新协作任务", status: "仿真草稿", updatedAt: "模拟 2026-09-12 18:20", callCount: 5, agents: 3 },
    ],
    active: null,
    messages: [],
    mode: "规则编排仿真（非真实模型计费）",
  };

  function selectedTask() {
    return collabTasks.find((t) => t.selected) || collabTasks[0];
  }

  function catalogAgents() {
    return EXPERT_CATALOG.map((a, i) => ({
      id: 100 + i,
      key: a.key,
      name: a.name,
      role: a.role,
      status: a.key === "master" ? "仿真编排" : "仿真待机",
      last_action: a.duty,
      memory: [a.duty],
      tools: a.tools,
      score: null,
      score_label: "未验证",
      recent: [],
      source: "mxsj",
    }));
  }

  function diagnosisExperts() {
    const task = selectedTask();
    if (task.scene === "秋收脱叶") {
      return [
        { key: "crop-vigor", name: "作物长势专家", duty: "开絮进度与叶色", status: diagnosis.stage >= 2 ? "草稿完成" : "等待", ms: 760, evidence: 0, gap: "原始样方与条带复核" },
        { key: "phenotype", name: "表型分析专家", duty: "开絮热力候选图", status: diagnosis.stage >= 2 ? "草稿完成" : "等待", ms: 840, evidence: 0, gap: "原始影像与地面真值" },
        { key: "weather", name: "气象分析专家", duty: "脱叶喷施窗口", status: diagnosis.stage >= 2 ? "不可判定" : "等待", ms: 620, evidence: 0, gap: "逐小时预报与叶湿" },
        { key: "pest-alert", name: "病虫害预警专家", duty: "吐絮期残留风险", status: diagnosis.stage >= 2 ? "草稿完成" : "等待", ms: 700, evidence: 0, gap: "物种/病级与局部取样" },
      ];
    }
    if (task.scene === "机收转运") {
      return [
        { key: "yield-predict", name: "产量预测专家", duty: "实收与测产偏差", status: diagnosis.stage >= 2 ? "草稿完成" : "等待", ms: 780, evidence: 0, gap: "实收校准与地磅记录" },
        { key: "robot", name: "Robot Agent", duty: "机收路径与卸粮", status: diagnosis.stage >= 2 ? "NO_GO" : "等待", ms: 710, evidence: 0, gap: "边界、道路、试收与 ACK" },
        { key: "weather", name: "气象分析专家", duty: "收晒窗口", status: diagnosis.stage >= 2 ? "不可判定" : "等待", ms: 600, evidence: 0, gap: "逐小时天气" },
      ];
    }
    return [
      { key: "weather", name: "气象分析专家", duty: "适播窗与初霜风险", status: diagnosis.stage >= 2 ? "不可判定" : "等待", ms: 640, evidence: 0, gap: "属地模板与逐小时天气" },
      { key: "vri-optimize", name: "水肥优化专家", duty: "播前底墒", status: diagnosis.stage >= 2 ? "草稿完成" : "等待", ms: 760, evidence: 0, gap: "底墒剖面与传感器 QC" },
      { key: "crop-vigor", name: "作物长势专家", duty: "播前地力与茬口", status: diagnosis.stage >= 2 ? "草稿完成" : "等待", ms: 720, evidence: 0, gap: "区域种植制度与整地记录" },
    ];
  }

  function runWorkbench(question) {
    const experts = ["crop-vigor", "soil-health", "vri-optimize"].map((k) => EXPERT_CATALOG.find((a) => a.key === k));
    const run = {
      id: "RUN-" + Date.now().toString().slice(-6),
      status: "draft_pending_human_review",
      stage: "草稿待人工复核",
      question,
      callCount: 5,
      providerName: "本地规则编排",
      model: "mxsj-demo-orchestrator",
      selectedAgents: experts.map((e) => ({ key: e.key, name: e.name, role: e.role, status: "草稿完成", ms: 700 + Math.round(Math.random() * 200) })),
      timeline: [
        { name: "总管拆解", status: "完成", note: "选择 3 位专家：长势 / 土壤 / 水肥" },
        { name: "专家并行", status: "草稿完成", note: "3/3 完成规则仿真" },
        { name: "交叉复核", status: "草稿完成", note: "发现 1 项分歧、2 项证据缺口" },
        { name: "总管汇总", status: "草稿完成", note: "生成安全纯文本答复" },
        { name: "人工复核边界", status: "待人工", note: "不调用工具/不控制设备" },
      ],
      conflicts: 1,
      gaps: 2,
      answer:
        "综合长势下降、墒情偏低与 EC 偏高信息：不能排除缺水与盐分叠加。" +
        "建议先核验排盐条件与最近灌溉实绩；若试验补水，仅采用小水分次并设置停止条件。" +
        "本答复不生成可直接下发设备的处方，高风险操作须场长结合现场数据复核。",
    };
    workbench.active = run;
    workbench.messages.push({ role: "user", text: question, at: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
    workbench.messages.push({ role: "stage", text: "总管已选择 3 位专家并开始并行分析", at: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
    workbench.messages.push({ role: "assistant", text: run.answer, at: new Date().toLocaleTimeString("zh-CN", { hour12: false }), run });
    const conv = workbench.conversations[0] || { id: "wb-1", title: "", status: "", updatedAt: "", callCount: 0, agents: 0 };
    conv.title = question.slice(0, 18) || "协作任务";
    conv.status = "草稿待复核";
    conv.updatedAt = new Date().toLocaleString("zh-CN");
    conv.callCount = run.callCount;
    conv.agents = experts.length;
    workbench.conversations[0] = conv;
    return run;
  }

  function handle(path, options, fallback) {
    const method = (options && options.method) || "GET";
    const url = new URL(path, "http://local.farm");
    const p = url.pathname;
    let body = {};
    if (options && options.body) {
      try {
        body = JSON.parse(options.body);
      } catch (e) {
        // Preserve the underlying engine's fail-closed invalid-JSON response
        // for routes that this optional collaboration layer does not own.
        if (typeof fallback === "function") return fallback(path, options);
        throw e;
      }
    }

    if (p === "/api/agents/council") {
      return councilPayload();
    }

    if (p === "/api/agents/council/review") {
      councilReview = buildCouncilReview(url.searchParams.get("goal") || COUNCIL_CONTEXT.default_goal);
      return councilReview;
    }

    if (p === "/api/agents/catalog") {
      return { catalog: EXPERT_CATALOG, source: "crop-ai", note: "作物 AI 管家专家能力名录" };
    }

    if (p === "/api/collab/center") {
      const task = selectedTask();
      return {
        label: "案例仿真",
        metrics: {
          running: collabTasks.filter((t) => t.stage.includes("分析") || t.stage.includes("确认")).length,
          human: collabTasks.filter((t) => t.stage.includes("确认")).length,
          conflict: collabTasks.filter((t) => !!t.conflict).length,
          traceable: collabTasks.length,
        },
        tasks: collabTasks,
        selected: task,
        safety: "协同中心不直接生成真实工单，不控制设备；人工确认进入分步诊断页。",
      };
    }

    if (p === "/api/collab/select" && method === "POST") {
      collabTasks.forEach((t) => { t.selected = t.id === body.id; });
      return selectedTask();
    }

    if (p === "/api/diagnosis") {
      const task = selectedTask();
      diagnosis.caseId = task.id;
      const pack = task.scene === "秋收脱叶"
        ? {
            problem: `${task.land} 的开絮率仅为仿真快照；需判断证据是否足以进入脱叶评估，当前默认 NO_GO。`,
            evidence: [
              { name: "开絮率", value: "模拟约 58%", tag: "缺原始样方", ok: false },
              { name: "风速", value: "模拟 1.4 m/s", tag: "缺来源/时间戳", ok: false },
              { name: "未来 7 日", value: "未接入", tag: "逐小时预报缺失", ok: false },
              { name: "药剂与剂量", value: "未绑定", tag: "标签/校准/批准缺失", ok: false },
            ],
            conflict: {
              a: "表型草稿：模拟开絮率可触发现场复核",
              b: "农艺安全：过早或错误条件施药可能影响衣分、品级并产生漂移/药害",
              resolve: "NO_GO：补齐样方、天气、标签、剂量、清场和人工批准后重新研判；仅可模拟回放。",
            },
          }
        : task.scene === "机收转运"
          ? {
              problem: `${task.land} 的成熟期与含水均为仿真快照；需核验是否具备安全机收与收储条件。`,
              evidence: [
                { name: "籽粒含水", value: "模拟 24.5%", tag: "缺校准记录", ok: false },
                { name: "成熟/试收", value: "未导入", tag: "损失与破碎率缺失", ok: false },
                { name: "运输/烘干/仓容", value: "未接入", tag: "能力待核验", ok: false },
                { name: "天气与道路", value: "未接入", tag: "窗口不可判定", ok: false },
              ],
              conflict: {
                a: "机务草稿：成熟期模拟提示可准备试收",
                b: "安全与仓储：缺试收、道路、运输和收储证据，不得开机",
                resolve: "NO_GO：由机务与仓储负责人完成试收和容量核验，再人工排程；仅可模拟回放。",
              },
            }
          : {
              problem: `${task.land} 位于克拉玛依试验田；区域模板、种子与底墒证据不足，当前 NO_GO。`,
              evidence: [
                { name: "区域模板", value: "未绑定", tag: "不得套用北疆日期", ok: false },
                { name: "底墒剖面", value: "待补采", tag: "证据缺口", ok: false },
                { name: "种子与播量", value: "未核验", tag: "批次/发芽率/千粒重缺失", ok: false },
                { name: "机具校准", value: "未确认", tag: "播种参数缺失", ok: false },
              ],
              conflict: {
                a: "总管草稿：可先登记区域规则与证据补全任务",
                b: "农艺与水肥：属地模板、种子和底墒不全，不得确定播期、播量或水量",
                resolve: "NO_GO：由本地农艺师批准模板，补齐种子、底墒与机具校准后再研判。",
              },
            };
      return {
        label: diagnosis.label,
        caseId: diagnosis.caseId,
        land: task.land,
        scene: task.scene,
        stage: diagnosis.stage,
        executionState: diagnosis.executionState,
        feedbackOutcome: diagnosis.feedbackOutcome,
        problem: pack.problem,
        evidence: pack.evidence,
        experts: diagnosisExperts(),
        conflict: pack.conflict,
        track: ["仿真事件进入总管", "总管拆解证据问题", "专家规则草稿", "交叉复核", "人工门禁与模拟回放", "反馈复盘"],
        stages: ["证据检查", "联合分析草稿", "协同决策", "模拟回放与复盘"],
      };
    }

    if (p === "/api/diagnosis/advance" && method === "POST") {
      if (diagnosis.stage < 4) diagnosis.stage += 1;
      if (diagnosis.stage === 4) diagnosis.executionState = "awaiting_approval";
      return handle("/api/diagnosis", { method: "GET" });
    }
    if (p === "/api/diagnosis/reset" && method === "POST") {
      diagnosis = { stage: 1, executionState: "awaiting_approval", feedbackOutcome: "normal", caseId: "CASE-DEMO-001", label: "案例仿真" };
      return handle("/api/diagnosis", { method: "GET" });
    }
    if (p === "/api/diagnosis/approve" && method === "POST") {
      diagnosis.executionState = "queued";
      return handle("/api/diagnosis", { method: "GET" });
    }
    if (p === "/api/diagnosis/exec" && method === "POST") {
      const order = ["queued", "running", "feedback", "reviewed"];
      const i = order.indexOf(diagnosis.executionState);
      diagnosis.executionState = order[Math.min(i + 1, order.length - 1)];
      if (diagnosis.executionState === "feedback") diagnosis.feedbackOutcome = body.outcome === "abnormal" ? "abnormal" : "normal";
      return handle("/api/diagnosis", { method: "GET" });
    }
    if (p === "/api/diagnosis/reopen" && method === "POST") {
      diagnosis.stage = 2;
      diagnosis.executionState = "awaiting_approval";
      diagnosis.feedbackOutcome = "abnormal";
      return handle("/api/diagnosis", { method: "GET" });
    }

    if (p === "/api/workbench") {
      return {
        ...workbench,
        catalog: EXPERT_CATALOG.filter((a) => a.key !== "master"),
        safety: "只回答、不调用工具、不直接执行设备。高风险建议须人工复核。",
      };
    }
    if (p === "/api/workbench/ask" && method === "POST") {
      const q = (body.question || "").trim();
      if (!q) throw new Error("请输入问题");
      if (q.length > 4000) throw new Error("问题超过 4000 字符上限");
      return runWorkbench(q);
    }
    if (p === "/api/workbench/new" && method === "POST") {
      workbench.messages = [];
      workbench.active = null;
      workbench.conversations.unshift({
        id: "wb-" + Date.now(),
        title: "新协作任务",
        status: "准备中",
        updatedAt: new Date().toLocaleString("zh-CN"),
        callCount: 0,
        agents: 0,
      });
      return workbench;
    }

    if (typeof fallback === "function") return fallback(path, options);
    throw new Error("未知 mxsj 接口 " + p);
  }

  // 包装原 FarmEngine，优先处理 mxsj 路由
  const prev = global.FarmEngine && global.FarmEngine.handle;
  global.FarmEngine = {
    handle(path, options) {
      try {
        return handle(path, options, prev);
      } catch (e) {
        if (String(e.message || "").startsWith("未知 mxsj") && prev) return prev(path, options);
        throw e;
      }
    },
    catalog: EXPERT_CATALOG,
    collabTasks,
  };

  // 将 mxsj 名录合并进既有 agents 列表（若原引擎暴露内部则跳过；页面通过 /api/agents/catalog 读取）
  global.FarmMxsj = { EXPERT_CATALOG, INDEPENDENT_EXPERT_AGENTS, catalogAgents };
})(window);
