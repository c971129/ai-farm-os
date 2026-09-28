/** 挂载自 docs/FINAL_SPEC.md —— 程序权威常量，避免与文档漂移 */
window.FarmSpec = {
  product: {
    brand: "一级芯界 AI Farm OS",
    tagline: "帮你看田、算账、按时干活",
    concept: "土地数字化 + 单株表型 + 全季装备 + 收贮加工 + 农业大模型 + 多智能体 + IoT",
    loop: "看田 → 出主意 → 派人机干活 → 记结果 → 下季更好",
  },
  farm: {
    name: "新疆AI无人智慧农场",
    region: "新疆·克拉玛依试验田",
    area_mu: 2000,
    crops: "棉花 / 玉米 / 小麦",
  },
  kpis: {
    water_saving: 20,
    fertilizer_saving: 15,
    pesticide_saving: 18,
    pest_accuracy: 89.5,
    labor_cut: 52,
    income_min: 400,
    income_max: 600,
  },
  /**
   * 农户导航：对齐 FieldView / Ops Center
   * Today → Fields → Work → Insights（去掉日频用不上的重复入口）
   * 注：各组的 hint 自 v195 起侧栏不再渲染（副标题只是把下面的菜单名换句话再说一遍，
   * 占掉的竖向空间比菜单项本身还多）。字段保留备用，改文案不会影响侧栏。
   */
  navGroupsFarm: [
    /* 首页单独一组只有一项，分组标题纯属多占一行；不给 label 就直接当首项渲染 */
    {
      items: [
        ["dashboard", "本周农事"],
      ],
    },
    {
      label: "田块",
      hint: "看清再下地",
      items: [
        ["twin", "看田地图"],
        ["devices", "田间设备"],
      ],
    },
    {
      label: "作业",
      hint: "浇水和机具安排",
      items: [
        ["water", "浇水施肥"],
        ["fleet", "机具作业"],
        ["season", "播收到仓"],
      ],
    },
    {
      label: "账本与问答",
      hint: "算账和政策咨询",
      items: [
        ["history", "历年收成"],
        ["council", "专家会诊"],
        ["ai", "问一问"],
        ["ai_assistant", "AI智能管家"],
      ],
    },
  ],
  /** 专家：研判 → 初审 → 人工门禁 → 流程回放 → 资产 */
  navGroupsExpert: [
    {
      label: "今日研判",
      hint: "先看优先事项与冲突",
      items: [
        ["dashboard", "专家驾驶舱"],
        ["twin", "数字孪生"],
        ["history", "历年档案"],
      ],
    },
    {
      label: "审核与协同",
      hint: "人工审核通过才放行",
      items: [
        ["tasks", "任务审核台"],
        ["diagnosis", "联合诊断"],
        ["workbench", "协作工作台"],
        ["collab", "多Agent协同"],
        ["council", "专家委员会"],
        ["agents", "Agent 名册"],
        ["ai", "AI 分析中心"],
        ["ai_assistant", "AI智能管家"],
        ["ai_settings", "AI 与报告"],
      ],
    },
    {
      label: "处方与田块",
      hint: "水肥处方与田块图层",
      items: [
        ["water", "水肥研判中心"],
        ["plants", "植株精细管控"],
      ],
    },
    {
      label: "装备与作业",
      hint: "全季机队与传感",
      items: [
        ["fleet", "多机联合作业"],
        ["robots", "机器人沙箱"],
        ["season", "播收到仓装备"],
        ["devices", "设备与传感网"],
        ["vendors", "厂家接入中心"],
      ],
    },
    {
      label: "收贮与底座",
      hint: "溯源与数据资产",
      items: [
        ["postharvest", "仓储与初加工"],
        ["assets", "数据资产"],
        ["arch", "云边端架构"],
      ],
    },
  ],
  /** 监管：异常优先 → 效果合规 → 追溯运行 */
  navGroupsGov: [
    {
      label: "先看异常",
      hint: "高优任务与田间态势",
      items: [
        ["dashboard", "监管驾驶舱"],
        ["tasks", "高优任务监察"],
        ["twin", "田间一张图"],
        ["history", "历年档案"],
      ],
    },
    {
      label: "效果与合规",
      hint: "节水节肥与政策落实",
      items: [
        ["water", "水肥节量核查"],
        ["season", "全季进度"],
        ["postharvest", "收贮溯源"],
        ["assets", "数据资产"],
        ["ai", "政策问答"],
        ["ai_assistant", "AI智能管家"],
      ],
    },
    {
      label: "运行监察",
      hint: "设备状态与协同事件",
      items: [
        ["fleet", "机队作业"],
        ["devices", "设备状态核验"],
        ["collab", "协同事件"],
        ["council", "专家评议留痕"],
        ["diagnosis", "异常诊断"],
        ["arch", "系统架构"],
      ],
    },
  ],
  get navGroupsPro() {
    return this.navGroupsExpert;
  },
  roleCaps: {
    farm: {
      title: "农户/场长",
      motto: "出门看天，把这一周该干的办完",
      caps: ["本周农事", "看田地图", "浇水施肥", "机具作业", "专家会诊", "历年收成", "大白话问答"],
      path: "看天 → 本周农事 → 采纳/改期/跳过 → 回放/停止 → 留痕",
    },
    expert: {
      title: "农技专家",
      motto: "证据研判 · 初审 · 人工门禁 · 复盘",
      caps: ["任务初审", "联合诊断", "独立专家委员会", "协作工作台", "多 Agent 协同", "水肥初审", "Agent 编排", "孪生图层", "数据资产"],
      path: "研判 → 补证 → 初审 → 人工门禁 → 仿真复盘",
    },
    gov: {
      title: "监管人员",
      motto: "全场效果、合规与可追溯",
      caps: ["监管驾驶舱", "节水节肥核查", "高优任务监察", "收贮溯源", "设备状态核验", "历年档案对比", "政策问答"],
      path: "异常 → 指标 → 取证 → 关注",
    },
  },
  /** 情境提示：点哪去哪（专家/AI 能力入口） */
  contextTips: {
    farm: [
      { text: "本周农事按天排好，建议就在行里", jump: "dashboard", icon: "周" },
      { text: "不对就登记停止请求，你说了算", jump: "dashboard", icon: "停" },
      { text: "复杂问题 → 十位专家会诊", jump: "council", icon: "会" },
      { text: "不会干？大白话问一问", jump: "ai", icon: "问" },
    ],
    expert: [
      { text: "有待审任务 → 任务审核台", jump: "tasks", icon: "审" },
      { text: "冲突要仲裁 → 多Agent协同", jump: "collab", icon: "协" },
      { text: "跨专业异议 → 专家委员会", jump: "council", icon: "会" },
      { text: "水肥缺证据 → 水肥研判中心", jump: "water", icon: "水" },
    ],
    gov: [
      { text: "节水量核查 → 水肥节量", jump: "water", icon: "节" },
      { text: "高优没办完 → 任务监察", jump: "tasks", icon: "督" },
      { text: "评议链条 → 专家留痕", jump: "council", icon: "会" },
      { text: "批次要追溯 → 收贮溯源", jump: "postharvest", icon: "溯" },
    ],
  },
  get navGroups() {
    return this.navGroupsFarm;
  },
  get nav() {
    return this.navGroupsFarm.flatMap((g) => g.items);
  },
  pageGroupOf(page, role) {
    const groups =
      role === "expert" ? this.navGroupsExpert : role === "gov" ? this.navGroupsGov : this.navGroupsFarm;
    for (const g of groups) {
      if ((g.items || []).some((it) => it[0] === page)) return g.label || "";
    }
    return (groups[0] && groups[0].label) || "";
  },
  agents_source: "crop-ai",
  agent_keys: ["master", "crop-vigor", "soil-health", "vri-optimize", "weather", "pest-alert", "yield-predict", "root-growth", "breeding", "phenotype"],
  twinLayers: [
    { id: "moisture", name: "土壤墒情" },
    { id: "crop", name: "作物长势" },
    { id: "plants", name: "单株长势" },
    { id: "risk", name: "病虫风险" },
    { id: "device", name: "机具位置" },
    { id: "sensors", name: "测点分布" },
  ],
  plant_control: {
    principle: "单株级地上冠层 + 地下根系 + 全生育期形态",
  },
};
