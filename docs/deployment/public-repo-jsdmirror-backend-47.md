# 公开仓 + JSDMirror 前端 + `47.94.243.26` 后端

完整操作材料：前端由公开 GitHub 仓库经 [JSDMirror](https://cdn.jsdmirror.com/) 分发；API / 采集 / SQLite 仅跑在阿里云实例 `47.94.243.26`（`farm.yijxj.com`）。

配套边界说明见 [`farm-yijxj-boundary.md`](./farm-yijxj-boundary.md)。  
示例配置文件见 [`examples/`](./examples/)。

---

## 1. 架构

```text
浏览器
  │
  ├─ HTML/JS/CSS ──► https://cdn.jsdmirror.com/gh/<owner>/<repo>@<tag>/frontend/...
  │
  └─ /api/*       ──► https://farm.yijxj.com  ──Nginx──► 127.0.0.1:8080 (ai-farm-os)
                              │
                              └─ 公网 IP: 47.94.243.26
                                 目录: /opt/ai-farm-os
                                 数据: /opt/ai-farm-os/data/
```

| 层 | 放哪 | 不放什么 |
| --- | --- | --- |
| 前端静态 | 公开 GitHub → JSDMirror | `.env`、`data/`、Senoiot 密码 |
| 后端 | `47.94.243.26` + systemd + Nginx | 不要把厂家账号写进前端或公开仓 |

前端通过 `meta[name=ai-farm-api-base]`（或 URL `?api=`）指向 `https://farm.yijxj.com`，再请求 `/api/...`。

---

## 2. 前置条件清单

- [ ] 域名 `farm.yijxj.com` A 记录已指向 `47.94.243.26`（备案允许后）
- [ ] `farm.yijxj.com` HTTPS 证书已安装（Let’s Encrypt / 云证书）
- [ ] 服务器可出网访问 Senoiot（真实采集）
- [ ] 已有可推送的 **公开** GitHub 仓库（或准备新建）
- [ ] 本机可 SSH：`ssh root@47.94.243.26`（或你们的运维账号）
- [ ] 旧站 `yijxj.com` / `59.110.125.73` **不修改**

---

## 3. 公开仓准备（前端）

### 3.1 仓库内容

公开仓只应包含运行前端所需文件（至少 `frontend/`）。建议：

- 使用本仓库的 `frontend/` 目录作为 CDN 根路径前缀
- `.gitignore` 必须排除：`.env`、`.venv/`、`data/`、`*.db`、`*.db-*`、密钥类文件
- **禁止**把 `SENOIOT_PASSWORD`、`OPENAI_API_KEY` 写入任何会公开的文件

### 3.2 发布前写入 API 基址

编辑 `frontend/index.html`：

```html
<meta name="ai-farm-api-base" content="https://farm.yijxj.com" />
```

本机同域调试时保持 `content=""`。  
临时覆盖（不改文件）：  

`https://cdn.jsdmirror.com/gh/.../frontend/index.html?api=https://farm.yijxj.com`

### 3.3 打标签并推送

```bash
git add frontend backend docs
git commit -m "Support JSDMirror frontend with remote API base"
git push origin main
git tag -a v1.2.0-cdn -m "CDN frontend for farm.yijxj.com API"
git push origin v1.2.0-cdn
```

JSDMirror / jsDelivr 对 GitHub 的稳定引用应使用 **tag 或 commit**，避免长期依赖浮动 `main`（缓存与回滚更清晰）。

### 3.4 前端访问地址

把占位符换成真实仓库：

```text
https://cdn.jsdmirror.com/gh/c971129/ai-farm-os@v1.2.0-cdn/frontend/index.html
```

公开仓：https://github.com/c971129/ai-farm-os（`v1.2.0-cdn` 已推送）。

资源链接示例：

```text
https://cdn.jsdmirror.com/gh/c971129/ai-farm-os@v1.2.0-cdn/frontend/assets/app.js
```

验证：浏览器打开上述 `index.html`，开发者工具 Network 中 `/api/health` 应对准 `farm.yijxj.com`，状态 200。

---

## 4. 后端部署（`47.94.243.26`）

### 4.1 目录与代码

```bash
ssh root@47.94.243.26
mkdir -p /opt/ai-farm-os
# 用私有拷贝或部署密钥拉取含 backend 的代码（不要用公开仓塞密码）
cd /opt/ai-farm-os
# 示例：git clone <你的部署源> .
python3.11 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

应用目录约定：`/opt/ai-farm-os`（与边界文档一致）。

### 4.2 环境变量

复制示例并填写真实值（文件权限 `600`，属主运维用户）：

```bash
cp docs/deployment/examples/env.backend.farm.example /opt/ai-farm-os/.env
chmod 600 /opt/ai-farm-os/.env
$EDITOR /opt/ai-farm-os/.env
```

关键项：

| 变量 | 值 |
| --- | --- |
| `AI_FARM_ALLOWED_HOSTS` | `farm.yijxj.com,127.0.0.1,localhost` |
| `AI_FARM_ALLOWED_ORIGINS` | `https://cdn.jsdmirror.com,https://farm.yijxj.com` |
| `SENOIOT_*` | 厂家账号（仅服务器） |
| `AI_FARM_PORT` | `8080`（本机回环，不对外直接暴露） |

`AI_FARM_ALLOWED_ORIGINS` **必须**包含 JSDMirror 源站 `https://cdn.jsdmirror.com`，否则浏览器跨域预检与 AI Runtime 写请求会被拒。

若日后换自定义前端域名，把该 Origin 一并加入白名单。

### 4.3 systemd

安装单元与覆盖（示例文件）：

```bash
cp docs/deployment/examples/ai-farm-os.service /etc/systemd/system/
mkdir -p /etc/systemd/system/ai-farm-os.service.d
cp docs/deployment/examples/zz-farm-host.conf /etc/systemd/system/ai-farm-os.service.d/
systemctl daemon-reload
systemctl enable --now ai-farm-os
systemctl status ai-farm-os --no-pager
```

要求：**单进程 / 单 worker**（采集器不可多副本）。

### 4.4 Nginx（仅 API 与同源兜底）

本方案下日常用户打开的是 JSDMirror 上的页面；`farm.yijxj.com` 仍建议：

1. 提供 HTTPS `/api/*` 给 CDN 前端跨域调用  
2. 可选：同源托管一份 `frontend/` 作应急入口  

```bash
cp docs/deployment/examples/farm.yijxj.com.conf /etc/nginx/conf.d/
nginx -t && systemctl reload nginx
```

证书路径按实际 Let’s Encrypt 或云证书修改。

### 4.5 本机验收（在 `47.94.243.26` 上）

```bash
curl -sS -H 'Host: farm.yijxj.com' http://127.0.0.1/api/health
curl -sS https://farm.yijxj.com/api/health
curl -sS -D- -o /dev/null -X OPTIONS https://farm.yijxj.com/api/health \
  -H 'Origin: https://cdn.jsdmirror.com' \
  -H 'Access-Control-Request-Method: GET'
```

期望：`/api/health` 返回 JSON `status: running`；OPTIONS 响应含  
`Access-Control-Allow-Origin: https://cdn.jsdmirror.com`。

---

## 5. 联调验收（浏览器）

1. 打开 JSDMirror 的 `frontend/index.html`（已配置 `ai-farm-api-base`）。  
2. F12 → Network：  
   - 静态资源主机 = `cdn.jsdmirror.com`  
   - `health` / `telemetry` = `farm.yijxj.com`  
3. 检查「设备与传感网 / 厂家观测」是否出现 live 遥测。  
4. 确认页面源码与 Network 中 **无** Senoiot 密码、无 `.env`。  
5. AI Runtime：会话与写操作依赖 Origin 白名单；白名单正确时应可用。服务重启后内存中的 Key/会话会清空（设计如此）。

---

## 6. 发布与回滚

### 发布前端

```bash
# 改 meta → commit → tag → push
# 用户改书签到新 tag URL，或固定用最新稳定 tag
```

JSDMirror 有边缘缓存；紧急修复可换新 tag，或在 URL 上改 `@commitsha`。

### 发布后端

```bash
ssh root@47.94.243.26
cd /opt/ai-farm-os
git fetch && git checkout <backend-tag>
. .venv/bin/activate && pip install -r requirements.txt
systemctl restart ai-farm-os
curl -sS https://farm.yijxj.com/api/health
```

### 回滚

- 前端：把访问 URL 指回上一 tag  
- 后端：`git checkout` 上一 tag + `systemctl restart ai-farm-os`  
- 数据：恢复 `data/` 的 SQLite 在线备份（含 WAL 策略，见 Senoiot 文档）

---

## 7. 安全与合规要点

1. 前端角色切换 **不是** 登录鉴权；公网暴露前应另加网关鉴权 / IP 限制 / 零信任。  
2. 禁止多 worker；禁止把 `data/*.db` 提交到公开仓。  
3. 不要将根域 `yijxj.com` 或无关子域指到本实例。  
4. 备份：`data/telemetry-*.db` 与 `farm.db` 按运维窗口做在线备份或停服拷贝。  
5. 本方案控制面仍为仿真锁定；生产控制指令不在本仓库范围。

---

## 8. 故障排查

| 现象 | 排查 |
| --- | --- |
| 页面能开，遥测全空 / health 失败 | `ai-farm-api-base` 是否指向 `https://farm.yijxj.com`；证书与 DNS |
| CORS 报错 | `AI_FARM_ALLOWED_ORIGINS` 是否含 `https://cdn.jsdmirror.com`；是否 `systemctl restart` |
| `ORIGIN_REJECTED`（AI） | 同上；请求 Origin 必须与白名单完全一致（含 https） |
| `TrustedHost` 400 | `AI_FARM_ALLOWED_HOSTS` 是否含 `farm.yijxj.com` |
| 采集停了 | `systemctl status ai-farm-os`；看 `.runtime/backend.log` / journalctl |
| JSDMirror 仍是旧 JS | 换新 tag / 强刷；确认 HTML 里 `?v=` 与 tag 一致 |

---

## 9. 交付物索引

| 文件 | 用途 |
| --- | --- |
| 本文 | 总操作手册 |
| [`farm-yijxj-boundary.md`](./farm-yijxj-boundary.md) | 主机/域名隔离边界 |
| [`examples/env.backend.farm.example`](./examples/env.backend.farm.example) | 后端环境变量模板 |
| [`examples/ai-farm-os.service`](./examples/ai-farm-os.service) | systemd 单元 |
| [`examples/zz-farm-host.conf`](./examples/zz-farm-host.conf) | systemd 环境覆盖 |
| [`examples/farm.yijxj.com.conf`](./examples/farm.yijxj.com.conf) | Nginx 站点示例 |
| [`examples/checklist.md`](./examples/checklist.md) | 上线勾选清单 |
| `frontend/assets/api-base.js` | 前端 API 基址解析 |
| `frontend/index.html` → `meta ai-farm-api-base` | CDN 发布时填写 |

---

## 10. 一句话口令

**公开仓只发 `frontend/`；密码与数据库只留在 `47.94.243.26`；浏览器静态走 JSDMirror，接口走 `https://farm.yijxj.com`。**
