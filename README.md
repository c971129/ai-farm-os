# 一级芯界 AI Farm OS

可运行的农业决策支持与受控作业沙箱，已增加真实设备只读接入。首页、设备与传感网、厂家接入中心中的“现场设备观测”展示厂家同步数据；其余农事与控制功能仍使用仿真数据，不会直接控制真实农机、阀泵或无人机。

## 真实设备接入

首次使用将 `.env.example` 复制为 `.env`，填写 `SENOIOT_ACCOUNT`、`SENOIOT_PASSWORD`，然后双击 **`start.bat`**。本机工作副本已配置正式账号；交付压缩包不包含密码、虚拟环境或真实数据库。

默认每 60 秒采集一次最新读数，每 5 分钟补齐历史；首次回补最近 1 小时。服务运行时即使关闭浏览器仍会采集，关闭后台窗口则停止，重启后按保存的进度继续补数。

详见 [真实设备接入说明](docs/SENOIOT_INTEGRATION.md)。真实数据保存在独立的 `data/telemetry-*.db` 中，原有 `data/farm.db` 和浏览器仿真数据不混入真实记录。

## 权威规范

请以 [`docs/FINAL_SPEC.md`](docs/FINAL_SPEC.md) 为产品规范，并以 [`docs/EXPERT_COUNCIL.md`](docs/EXPERT_COUNCIL.md) 的联合专家门禁作为农业、安全与发布约束。

## 启动

真实设备版本：双击 `start.bat`，或：

```bat
powershell -ExecutionPolicy Bypass -File start-live.ps1
```

原有静态仿真与可选 AI 问答入口仍保留：

```bat
powershell -ExecutionPolicy Bypass -File start-web.ps1
```

访问 http://127.0.0.1:8080/。这个入口提供静态前端与可选 AI 问答代理；业务页面默认使用浏览器内的仿真引擎。

## 线上拆分部署（公开仓 + JSDMirror + 云主机）

完整操作材料（含 Nginx / systemd / 环境变量 / 验收清单）：

[`docs/deployment/public-repo-jsdmirror-backend-47.md`](docs/deployment/public-repo-jsdmirror-backend-47.md)

## 运行模式与安全边界

| 模式 | 数据来源 | 写入/控制含义 |
|---|---|---|
| 本地仿真（默认） | 浏览器内固定模拟与规则 | 只改变仿真状态；设备动作均是模拟请求 |
| 后端仿真 | FastAPI + SQLite 模拟快照 | 业务 API 当前标记为 `partial`；所有写操作默认 `423` 锁定 |
| 真实观测（只读） | 设备 HTTPS API → 独立 SQLite | 已实现实时采集、历史补数与来源/时间/质量标记；设备未绑定地块，不能自动用于生产处方或控制 |
| 生产控制 | 本仓库未提供 | 必须另行实现身份认证、租户/农场隔离、设备签名、双人复核、现场联锁与设备 ACK |

若仅为本机沙箱测试而需要开启后端写入，必须同时设置：

```powershell
$env:AI_FARM_ALLOW_DEMO_WRITES = "1"
$env:AI_FARM_WRITE_TOKEN = "请使用本机随机测试令牌"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8090
```

这只解锁“模拟写入”，不是生产授权。不要把测试令牌提交到仓库，也不要把服务暴露到公网。

## 目录结构（按生产生命周期）

1. **指挥中心**：农业驾驶舱 · 数字孪生  
2. **精细农作**：植株精细管控 · 水肥 · 农事  
3. **全季装备**：播收到仓装备 · 多机联合作业 · 机器人 · 传感网 · 厂家接入  
4. **收贮加工**：仓储与初加工  
5. **智能决策**：协同 / 诊断 / 工作台 / Agent / AI  
6. **数据底座**：数据资产 · 云边端架构  

## 关键能力

- 三角色决策首页：农场作业、专家研判、监管合规
- 地块地图优先：以明确标注的资料图与屏幕示意坐标展示地块、作业窗口与资源冲突
- 页面级标准闭环：计划→证据→研判→人工门禁→模拟请求→设备 ACK→独立验收→复盘
- 单株地上/地下长势 + 全生育期形态  
- 播种→秋收全季装备运行态势  
- 机收后仓储控温控湿 + 轧花/烘干/清理初加工  
- 多机联合作业、传感网、厂家接入  
- 周计划、专家研判、监管、设备、水肥、机队、收贮、历史与资产 CSV 台账导出
- 角色化态势大屏，30 秒刷新仿真快照并明确显示数据模式

农业结论采用 fail-closed：缺少采样深度、数据质量码、田间持水量、根层、ETc、天气窗、设备 ACK、作业轨迹等关键证据时，界面返回 `NO_GO`，不自动形成可执行水量、药量或机具指令。

## 验证

安装测试依赖并运行全量门禁：

```powershell
python -m pip install -r requirements-dev.txt
.\verify.ps1
```

验证包含 JavaScript 语法、本地引擎安全链路、Python 编译、PowerShell 启动脚本解析、FastAPI 权限/幂等/数据不变性、HTML 语义与静态资产契约。

如浏览器仍显示旧界面，请执行一次强制刷新后再打开。
