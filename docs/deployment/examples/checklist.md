# 上线勾选清单 — 公开仓 + JSDMirror + 47.94.243.26

> 与 [`public-repo-jsdmirror-backend-47.md`](../public-repo-jsdmirror-backend-47.md) §0 进度表同步。

## DNS / TLS

- [ ] `farm` A → `47.94.243.26`
- [ ] HTTPS 证书有效
- [x] 未改动旧站 `yijxj.com` / `59.110.125.73`（约定）

## 公开仓 / 前端

- [x] 仓库为 public → https://github.com/c971129/ai-farm-os
- [x] 无 `.env` / 无密码 / 无 `data/*.db`
- [x] `frontend/index.html` 中 `ai-farm-api-base` = `https://farm.yijxj.com`
- [x] 已打 tag `v1.2.0-cdn` 并 push
- [x] GitHub Pages 可渲染 → https://c971129.github.io/ai-farm-os/
- [x] 已知：JSDMirror 直接打开 `index.html` 会显示源码（CDN `text/plain`），不当入口

## 后端 47.94.243.26

- [ ] `/opt/ai-farm-os` 代码与 venv 按本方案就绪/更新
- [ ] `.env` 权限 600，含 Senoiot
- [ ] `AI_FARM_ALLOWED_ORIGINS` 含 `https://c971129.github.io`（以及按需 `https://cdn.jsdmirror.com`、`https://farm.yijxj.com`）
- [ ] `systemctl is-active ai-farm-os` → active
- [ ] `nginx -t` 通过且站点已 reload
- [ ] `curl https://farm.yijxj.com/api/health` → 200 / running

## 浏览器联调

- [ ] 从 Pages 打开前端
- [ ] `/api/health`、遥测请求发往 `farm.yijxj.com`
- [ ] CORS 无红字（Origin = `https://c971129.github.io`）
- [ ] 厂家观测有数据或明确「等待首次同步」
- [ ] 页面不可见厂家密码

## 运维

- [ ] 已安排 `data/` 备份
- [ ] 已知回滚 tag / 上一后端版本
- [x] 告知：前端角色 ≠ 登录鉴权
