# 上线勾选清单 — GitHub Pages + 47.94.243.26

> 与 [`public-repo-jsdmirror-backend-47.md`](../public-repo-jsdmirror-backend-47.md) §0 进度表同步。  
> **公网访问入口：** https://c971129.github.io/ai-farm-os/  
> **API：** https://farm.lcxlwh.com

## DNS / TLS

- [x] API 主机 A → `47.94.243.26`（`farm.lcxlwh.com`）
- [x] HTTPS 证书有效（Let’s Encrypt）
- [x] 未改动旧站 `yijxj.com` / `59.110.125.73`（约定）

## 公开仓 / 前端

- [x] 仓库为 public → https://github.com/c971129/ai-farm-os
- [x] 无 `.env` / 无密码 / 无 `data/*.db`
- [x] `frontend/index.html` 中 `ai-farm-api-base` = `https://farm.lcxlwh.com`
- [x] 已打 tag `v1.2.0-cdn` 并 push
- [x] GitHub Pages 可渲染 → https://c971129.github.io/ai-farm-os/
- [x] 已知：JSDMirror 直接打开 `index.html` 会显示源码（CDN `text/plain`），不当入口

## 后端 47.94.243.26

- [x] `/opt/ai-farm-os` 代码已用云助手自公开仓同步（venv=`/opt/ai-farm-venv`）
- [x] `.env` 权限 600，Senoiot 已配置且遥测 `healthy`
- [x] `AI_FARM_ALLOWED_ORIGINS` 含 `https://c971129.github.io`
- [x] `systemctl is-active ai-farm-os` → active
- [x] Nginx HTTPS 反代本机 8080
- [x] `curl https://farm.lcxlwh.com/api/health` → 200 / running

## 浏览器联调

- [x] 从 Pages 打开前端（唯一推荐入口）
- [x] `/api/health`、遥测请求发往 `farm.lcxlwh.com`
- [x] CORS 对 Pages Origin 放行
- [x] 厂家观测 `telemetry/status` = healthy（或明确告警列表）
- [x] 页面不可见厂家密码

## 运维

- [x] 已安排 `data/` 备份（`/etc/cron.d/ai-farm-backup`）
- [x] 已知回滚：Pages 上一 commit；后端 zip/备份 + restart
- [x] 告知：前端角色 ≠ 登录鉴权
