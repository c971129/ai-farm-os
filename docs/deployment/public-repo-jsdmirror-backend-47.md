# 公开仓 + JSDMirror 前端 + `47.94.243.26` 后端

完整操作材料：页面入口由 **GitHub Pages** 提供；可选经 [JSDMirror](https://cdn.jsdmirror.com/) 加速公开仓中的 JS/CSS；API / 采集 / SQLite 仅跑在阿里云实例 `47.94.243.26`（`farm.yijxj.com`）。

配套边界说明见 [`farm-yijxj-boundary.md`](./farm-yijxj-boundary.md)。  
示例配置文件见 [`examples/`](./examples/)。

---

## 0. 进度（截至文档更新）

| 状态 | 项 | 说明 |
| --- | --- | --- |
| ✅ 已完成 | 公开 GitHub 仓 | https://github.com/c971129/ai-farm-os （`public`） |
| ✅ 已完成 | 忽略密钥与数据 | `.gitignore` 排除 `.env` / `.venv` / `data/`；未提交密码 |
| ✅ 已完成 | API 基址写入前端 | `meta ai-farm-api-base` = `https://farm.yijxj.com`；`assets/api-base.js` |
| ✅ 已完成 | CDN 标签 | `v1.2.0-cdn` 已推送 |
| ✅ 已完成 | GitHub Pages 入口 | https://c971129.github.io/ai-farm-os/ （`text/html`，可渲染） |
| ✅ 已完成 | Pages Actions 部署 | `.github/workflows/deploy-pages.yml` 已跑通 |
| ✅ 已完成 | 跨域前端代码 | CORS 方法/头扩展；AI Runtime Origin 走 `AI_FARM_ALLOWED_ORIGINS` |
| ✅ 已完成 | 部署示例文件 | `docs/deployment/examples/*` |
| ✅ 已完成 | 边界文档 | `farm-yijxj-boundary.md`（实例/Nginx/隔离约定） |
| ⚠️ 注意 | JSDMirror 直接打开 HTML | CDN 对 `index.html` 返回 `text/plain`/`text/txt`，**不能当页面入口**；仅作资源加速 |
| ⬜ 未完成 | DNS：`farm` → `47.94.243.26` | 边界文档：待备案后再改公网 DNS |
| ⬜ 未完成 | `farm.yijxj.com` 公网 HTTPS | 证书与对外访问 |
| ⬜ 未完成 | 后端 CORS 含 Pages Origin | 服务器 `.env` / systemd 增加 `https://c971129.github.io` |
| ⬜ 未完成 | 本方案下后端联调验收 | `curl https://farm.yijxj.com/api/health` + 浏览器跨域遥测 |
| ⬜ 未完成 | Senoiot 生产 `.env` 落盘 | 仅服务器、权限 600 |
| ⬜ 未完成 | 浏览器端到端联调 | Pages 打开 → API/遥测 → 无密钥泄露 |

---

## 1. 架构

```text
浏览器
  │
  ├─ 页面 HTML/CSS/JS ──► https://c971129.github.io/ai-farm-os/     （GitHub Pages，已完成）
  │                         （可选）资源也可走 JSDMirror gh CDN 加速
  │
  └─ /api/*              ──► https://farm.yijxj.com  ──Nginx──► 127.0.0.1:8080 (ai-farm-os)
                                      │
                                      └─ 公网 IP: 47.94.243.26   （后端联调：未完成）
                                         目录: /opt/ai-farm-os
                                         数据: /opt/ai-farm-os/data/
```

| 层 | 放哪 | 不放什么 | 进度 |
| --- | --- | --- | --- |
| 前端页面 | GitHub Pages（公开仓 `frontend/`） | `.env`、`data/`、Senoiot 密码 | ✅ |
| 静态资源加速（可选） | JSDMirror `gh/c971129/ai-farm-os@tag/...` | 不要当 HTML 入口 | ✅ 仓/标签已有 |
| 后端 | `47.94.243.26` + systemd + Nginx | 不要把厂家账号写进前端或公开仓 | ⬜ 待本方案联调 |

前端通过 `meta[name=ai-farm-api-base]`（或 URL `?api=`）指向 `https://farm.yijxj.com`，再请求 `/api/...`（代码侧 ✅；服务端 CORS/DNS ⬜）。

---

## 2. 前置条件清单

- [x] 已有可推送的 **公开** GitHub 仓库 → `c971129/ai-farm-os`
- [x] 旧站 `yijxj.com` / `59.110.125.73` **不修改**（约定保持）
- [ ] 域名 `farm.yijxj.com` A 记录已指向 `47.94.243.26`（备案允许后）
- [ ] `farm.yijxj.com` HTTPS 证书已安装（Let’s Encrypt / 云证书）
- [ ] 服务器可出网访问 Senoiot（真实采集）
- [ ] 本机可 SSH：`ssh root@47.94.243.26`（或你们的运维账号）

---

## 3. 公开仓准备（前端）— ✅ 已完成

### 3.1 仓库内容 ✅

- 公开仓：https://github.com/c971129/ai-farm-os  
- `.gitignore` 已排除：`.env`、`.venv/`、`data/` 等  
- **禁止**把 `SENOIOT_PASSWORD`、`OPENAI_API_KEY` 写入任何会公开的文件（已遵守）

### 3.2 API 基址 ✅

`frontend/index.html` 已写入：

```html
<base href="/ai-farm-os/" />
<meta name="ai-farm-api-base" content="https://farm.yijxj.com" />
```

本机若用 Pages 同源调试以外的本地服务，可用：

`http://127.0.0.1:8080/?api=http://127.0.0.1:8080`（并视情况去掉/改写 `<base>`）。

### 3.3 标签 ✅

```text
v1.2.0-cdn
```

已推送到 `origin`。后续发版可继续打新 tag 并触发 Pages。

### 3.4 前端访问地址（GitHub Pages）✅

**请用这个入口打开（会正确渲染）：**

```text
https://c971129.github.io/ai-farm-os/
```

已验证：`Content-Type: text/html`，CSS/JS 可加载。

### 3.5 JSDMirror 资源路径（非页面入口）✅ 仓侧就绪

JSDMirror / jsDelivr 对 GitHub 的 `index.html` 会下发 `text/plain`（或 `text/txt`）且 `nosniff`，浏览器会显示源码而非页面——**这是 CDN 行为，不是站点故障**。

资源示例（可用于加速引用，不是首页）：

```text
https://cdn.jsdmirror.com/gh/c971129/ai-farm-os@v1.2.0-cdn/frontend/assets/app.js
```

勿将下列地址当作产品入口：

```text
https://cdn.jsdmirror.com/gh/c971129/ai-farm-os@v1.2.0-cdn/frontend/index.html
```

---

## 4. 后端部署（`47.94.243.26`）— ⬜ 本方案联调未完成

> 边界文档记载该实例上曾有 `ai-farm-os` + Nginx 对本机 Host 的冒烟；**针对 Pages Origin + 公网 DNS/HTTPS + CORS 白名单的验收尚未在本方案中勾完**。

### 4.1 目录与代码 ⬜

```bash
ssh root@47.94.243.26
mkdir -p /opt/ai-farm-os
cd /opt/ai-farm-os
# 示例：git clone <部署源> .   # 可用公开仓拉代码；.env 绝不能进仓
python3.11 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

应用目录约定：`/opt/ai-farm-os`。

### 4.2 环境变量 ⬜

```bash
cp docs/deployment/examples/env.backend.farm.example /opt/ai-farm-os/.env
chmod 600 /opt/ai-farm-os/.env
$EDITOR /opt/ai-farm-os/.env
```

关键项（Pages 上线后 **必须**含 GitHub Pages Origin）：

| 变量 | 值 |
| --- | --- |
| `AI_FARM_ALLOWED_HOSTS` | `farm.yijxj.com,127.0.0.1,localhost` |
| `AI_FARM_ALLOWED_ORIGINS` | `https://c971129.github.io,https://cdn.jsdmirror.com,https://farm.yijxj.com` |
| `SENOIOT_*` | 厂家账号（仅服务器） |
| `AI_FARM_PORT` | `8080`（本机回环） |

### 4.3 systemd ⬜

```bash
cp docs/deployment/examples/ai-farm-os.service /etc/systemd/system/
mkdir -p /etc/systemd/system/ai-farm-os.service.d
cp docs/deployment/examples/zz-farm-host.conf /etc/systemd/system/ai-farm-os.service.d/
systemctl daemon-reload
systemctl enable --now ai-farm-os
systemctl status ai-farm-os --no-pager
```

要求：**单进程 / 单 worker**。

### 4.4 Nginx ⬜

```bash
cp docs/deployment/examples/farm.yijxj.com.conf /etc/nginx/conf.d/
nginx -t && systemctl reload nginx
```

日常用户打开 Pages；`farm.yijxj.com` 提供 HTTPS `/api/*`（及可选同源应急前端）。

### 4.5 本机验收 ⬜

```bash
curl -sS -H 'Host: farm.yijxj.com' http://127.0.0.1/api/health
curl -sS https://farm.yijxj.com/api/health
curl -sS -D- -o /dev/null -X OPTIONS https://farm.yijxj.com/api/health \
  -H 'Origin: https://c971129.github.io' \
  -H 'Access-Control-Request-Method: GET'
```

期望：health `running`；OPTIONS 含  
`Access-Control-Allow-Origin: https://c971129.github.io`。

---

## 5. 联调验收（浏览器）— ⬜ 待后端就绪后做

1. 打开 **https://c971129.github.io/ai-farm-os/**（不要用 JSDMirror 打开 HTML）。  
2. F12 → Network：静态来自 `c971129.github.io`；`health` / 遥测应对准 `farm.yijxj.com`。  
3. 检查厂家观测是否 live 或明确「等待首次同步」。  
4. 确认无 Senoiot 密码、无 `.env`。  
5. AI Runtime 写操作依赖 Origin 白名单（须含 `https://c971129.github.io`）。

---

## 6. 发布与回滚

### 发布前端 ✅ 流程已通

```bash
# 改 frontend → commit → push main
# Actions「Deploy frontend to GitHub Pages」自动发布
# 可选：打新 tag 供 JSDMirror 固定资源版本
git tag -a vX.Y.Z-cdn -m "..."
git push origin vX.Y.Z-cdn
```

### 发布后端 ⬜

```bash
ssh root@47.94.243.26
cd /opt/ai-farm-os
git fetch && git checkout <ref>
. .venv/bin/activate && pip install -r requirements.txt
systemctl restart ai-farm-os
curl -sS https://farm.yijxj.com/api/health
```

### 回滚

- 前端：Actions 重新部署上一 commit，或用户收藏固定 Pages（随 main 发布）  
- 资源 CDN：指回上一 tag  
- 后端：`git checkout` 上一版本 + `systemctl restart`  
- 数据：SQLite 在线备份（见 Senoiot 文档）

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
| Pages 能开，遥测/health 失败 | 后端 DNS/HTTPS/CORS；`ai-farm-api-base` |
| CORS 报错 | `AI_FARM_ALLOWED_ORIGINS` 是否含 `https://c971129.github.io` |
| `ORIGIN_REJECTED`（AI） | 同上 |
| `TrustedHost` 400 | `AI_FARM_ALLOWED_HOSTS` 含 `farm.yijxj.com` |
| 采集停了 | `systemctl status ai-farm-os`；journal / `.runtime` |

---

## 9. 交付物索引

| 文件 | 用途 | 进度 |
| --- | --- | --- |
| 本文 | 总操作手册 + 进度 | ✅ |
| [`farm-yijxj-boundary.md`](./farm-yijxj-boundary.md) | 主机/域名隔离 | ✅（DNS 公网仍待） |
| [`examples/checklist.md`](./examples/checklist.md) | 上线勾选 | ✅ 已按进度勾选 |
| [`examples/env.backend.farm.example`](./examples/env.backend.farm.example) | 后端环境变量模板 | ✅ 模板；服务器落盘 ⬜ |
| [`examples/ai-farm-os.service`](./examples/ai-farm-os.service) | systemd | ✅ 示例 |
| [`examples/zz-farm-host.conf`](./examples/zz-farm-host.conf) | systemd 环境覆盖 | ✅ 示例 |
| [`examples/farm.yijxj.com.conf`](./examples/farm.yijxj.com.conf) | Nginx | ✅ 示例 |
| `frontend/assets/api-base.js` | API 基址 | ✅ |
| GitHub Pages | 可浏览前端 | ✅ |
| `47.94.243.26` 本方案联调 | API + CORS + 遥测 | ⬜ |

---

## 10. 一句话口令

**公开仓 + Pages 发前端（已完成）；JSDMirror 只加速资源、不当 HTML 入口；密码与数据库留在 `47.94.243.26`；接口走 `https://farm.yijxj.com`（后端联调待完成）。**
