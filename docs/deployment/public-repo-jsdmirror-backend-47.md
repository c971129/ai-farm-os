# 公开仓 + GitHub Pages 前端 + `47.94.243.26` 后端

完整操作材料：**公网页面入口**为 [GitHub Pages](https://c971129.github.io/ai-farm-os/)；可选经 [JSDMirror](https://cdn.jsdmirror.com/) 加速公开仓中的 JS/CSS；API / 采集 / SQLite 仅跑在阿里云实例 `47.94.243.26`。

API 公网主机名（本账号可管 DNS）：**`https://farm.lcxlwh.com`**（不再依赖 `farm.yijxj.com`）。  
配套边界说明见 [`farm-yijxj-boundary.md`](./farm-yijxj-boundary.md)。  
示例配置文件见 [`examples/`](./examples/)。

---

## 0. 进度（截至文档更新）

| 状态 | 项 | 说明 |
| --- | --- | --- |
| ✅ 已完成 | 公开 GitHub 仓 | https://github.com/c971129/ai-farm-os （`public`） |
| ✅ 已完成 | 忽略密钥与数据 | `.gitignore` 排除 `.env` / `.venv` / `data/`；未提交密码 |
| ✅ 已完成 | API 基址写入前端 | `meta ai-farm-api-base` = `https://farm.lcxlwh.com`；`assets/api-base.js` |
| ✅ 已完成 | CDN 标签 | `v1.2.0-cdn` 已推送（资源加速用；页面入口用 Pages） |
| ✅ 已完成 | GitHub Pages 入口 | https://c971129.github.io/ai-farm-os/ （**唯一推荐公网访问入口**） |
| ✅ 已完成 | Pages Actions 部署 | `.github/workflows/deploy-pages.yml` 已跑通 |
| ✅ 已完成 | 跨域前端代码 | CORS 方法/头扩展；AI Runtime Origin 走 `AI_FARM_ALLOWED_ORIGINS` |
| ✅ 已完成 | 部署示例文件 | `docs/deployment/examples/*` |
| ✅ 已完成 | 边界文档 | `farm-yijxj-boundary.md`（实例/Nginx/隔离约定） |
| ⚠️ 注意 | JSDMirror 直接打开 HTML | CDN 对 `index.html` 返回 `text/plain`/`text/txt`，**不能当页面入口**；仅作资源加速 |
| ✅ 已完成 | 云助手后端部署通道 | 阿里云客户端 Session Manager / Cloud Assistant RunCommand（本机 SSH:22 超时，未用密码 SSH） |
| ✅ 已完成 | 后端代码同步 | `/opt/ai-farm-os` 自公开仓更新；`ai-farm-os` systemd **active**；venv=`/opt/ai-farm-venv` |
| ✅ 已完成 | 后端 CORS 含 Pages Origin | `AI_FARM_ALLOWED_ORIGINS` 含 `https://c971129.github.io` |
| ✅ 已完成 | DNS：API 主机 → `47.94.243.26` | `farm.lcxlwh.com` A → `47.94.243.26`（本账号 Aliyun DNS；`yijxj.com` DNS 不在本账号，已放弃强依赖） |
| ✅ 已完成 | API 公网 HTTPS | Let’s Encrypt：`https://farm.lcxlwh.com`（acme.sh + Nginx 443） |
| ✅ 已完成 | 域名 HTTPS 联调验收 | `curl https://farm.lcxlwh.com/api/health` → running；OPTIONS CORS → Pages Origin |
| ✅ 已完成 | Senoiot 生产密钥核验 | `.env` chmod 600；`SENOIOT_ENABLED=1`；`/api/telemetry/status` → `healthy` / configured |
| ✅ 已完成 | 浏览器端到端联调路径 | Pages → `https://farm.lcxlwh.com/api/*`；前端无厂家密码 |
| ✅ 已完成 | `data/` 备份 | cron `/etc/cron.d/ai-farm-backup` + `/opt/ai-farm-backups/` |

---

## 1. 架构

```text
浏览器
  │
  ├─ 页面 HTML/CSS/JS ──► https://c971129.github.io/ai-farm-os/     （GitHub Pages，公网入口）
  │                         （可选）资源也可走 JSDMirror gh CDN 加速
  │
  └─ /api/*              ──► https://farm.lcxlwh.com  ──Nginx──► 127.0.0.1:8080 (ai-farm-os)
                                      │
                                      └─ 公网 IP: 47.94.243.26
                                         目录: /opt/ai-farm-os
                                         数据: /opt/ai-farm-data/farm.db + /opt/ai-farm-os/data/
```

| 层 | 放哪 | 不放什么 | 进度 |
| --- | --- | --- | --- |
| 前端页面 | GitHub Pages（公开仓 `frontend/`） | `.env`、`data/`、Senoiot 密码 | ✅ |
| 静态资源加速（可选） | JSDMirror `gh/c971129/ai-farm-os@tag/...` | 不要当 HTML 入口 | ✅ |
| 后端 API | `farm.lcxlwh.com` → `47.94.243.26` | 不要把厂家账号写进前端或公开仓 | ✅ |

前端通过 `meta[name=ai-farm-api-base]`（或 URL `?api=`）指向 `https://farm.lcxlwh.com`，再请求 `/api/...`。

---

## 2. 前置条件清单

- [x] 已有可推送的 **公开** GitHub 仓库 → `c971129/ai-farm-os`
- [x] 旧站 `yijxj.com` / `59.110.125.73` **不修改**（约定保持）
- [x] API 域名 A 记录已指向 `47.94.243.26` → `farm.lcxlwh.com`
- [x] API HTTPS 证书已安装（Let’s Encrypt / acme.sh）
- [x] 服务器可出网访问 Senoiot（`openapi.senoiot.com`；遥测 `healthy`）
- [x] 运维通道：Cloud Assistant（替代本机直连 SSH:22）

---

## 3. 公开仓准备（前端）— ✅ 已完成

### 3.1 仓库内容 ✅

- 公开仓：https://github.com/c971129/ai-farm-os  
- `.gitignore` 已排除：`.env`、`.venv/`、`data/` 等  
- **禁止**把 `SENOIOT_PASSWORD`、`OPENAI_API_KEY` 写入任何会公开的文件（已遵守）

### 3.2 API 基址 ✅

`frontend/index.html`：

```html
<meta name="ai-farm-api-base" content="https://farm.lcxlwh.com" />
```

### 3.3 公网入口 ✅

**打开：** https://c971129.github.io/ai-farm-os/

不要用 JSDMirror 直接打开 `index.html`（会显示源码）。

---

## 4. 后端部署（`47.94.243.26` / `farm.lcxlwh.com`）— ✅

> 运维以 **Cloud Assistant RunCommand** 为准。  
> 页面入口固定 Pages；本机 Nginx 只保证 API HTTPS。

### 4.1–4.5 摘要

| 项 | 状态 |
| --- | --- |
| 代码目录 `/opt/ai-farm-os` | ✅ |
| `.env`（Senoiot + CORS）chmod 600 | ✅ |
| systemd `ai-farm-os` active | ✅ |
| Nginx HTTP→HTTPS + 443 反代 8080 | ✅ |
| Let’s Encrypt `farm.lcxlwh.com` | ✅ |
| CORS 含 `https://c971129.github.io` | ✅ |

冒烟：

```bash
curl -sS https://farm.lcxlwh.com/api/health
curl -sS -D- -o /dev/null -X OPTIONS https://farm.lcxlwh.com/api/health \
  -H 'Origin: https://c971129.github.io' \
  -H 'Access-Control-Request-Method: GET'
curl -sS https://farm.lcxlwh.com/api/telemetry/status
```

---

## 5. 联调验收（浏览器）— ✅ 路径已通

1. 打开 **https://c971129.github.io/ai-farm-os/**  
2. F12 → Network：静态来自 `c971129.github.io`；`health` / 遥测对准 `farm.lcxlwh.com`  
3. 厂家观测：`/api/telemetry/status` 为 `healthy`（个别点位时间戳异常可能被拒写，属采集侧告警）  
4. 确认无 Senoiot 密码、无 `.env`  
5. AI Runtime Origin 白名单含 `https://c971129.github.io`

---

## 6. 发布与回滚

### 发布前端 ✅

```bash
# 改 frontend → commit → push main
# Actions「Deploy frontend to GitHub Pages」自动发布
```

### 发布后端 ✅（云助手）

```bash
# 拉取公开仓 zip → 同步到 /opt/ai-farm-os → systemctl restart ai-farm-os
curl -sS https://farm.lcxlwh.com/api/health
```

### 回滚

- 前端：Actions 重新部署上一 commit  
- 后端：恢复备份包 / 上一 zip + `systemctl restart`  
- 数据：`/opt/ai-farm-backups/`

---

## 7. 安全与合规要点

1. 前端角色切换 **不是** 登录鉴权。  
2. 禁止多 worker；禁止把 `data/*.db` 提交到公开仓。  
3. 不要将根域 `yijxj.com` 指到本实例。  
4. 备份 `data/`；密钥仅服务器。  
5. 控制面仍为仿真锁定。

---

## 8. 故障排查

| 现象 | 排查 |
| --- | --- |
| JSDMirror 打开 HTML 只显示源码 | **预期行为**；改用 Pages 入口 |
| Pages 能开，遥测/health 失败 | `farm.lcxlwh.com` DNS/HTTPS/CORS；`ai-farm-api-base` |
| CORS 报错 | `AI_FARM_ALLOWED_ORIGINS` 是否含 `https://c971129.github.io` |
| `ORIGIN_REJECTED`（AI） | 同上 |
| `TrustedHost` 400 | `AI_FARM_ALLOWED_HOSTS` 含 `farm.lcxlwh.com` |
| 采集停了 | `systemctl status ai-farm-os`；`/api/telemetry/status` |

---

## 9. 交付物索引

| 文件 | 用途 | 进度 |
| --- | --- | --- |
| 本文 | 总操作手册 + 进度 | ✅ |
| [`farm-yijxj-boundary.md`](./farm-yijxj-boundary.md) | 主机/域名隔离 | ✅ |
| [`examples/checklist.md`](./examples/checklist.md) | 上线勾选 | ✅ |
| [`examples/env.backend.farm.example`](./examples/env.backend.farm.example) | 后端环境变量模板 | ✅ |
| GitHub Pages | 可浏览前端 | ✅ |
| `https://farm.lcxlwh.com` | API + CORS + 遥测 | ✅ |

---

## 10. 一句话口令

**打开 https://c971129.github.io/ai-farm-os/；接口走 https://farm.lcxlwh.com；密码与数据库留在 47.94.243.26。**
