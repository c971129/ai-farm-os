# 上线勾选清单 — 公开仓 + JSDMirror + 47.94.243.26

## DNS / TLS

- [ ] `farm` A → `47.94.243.26`
- [ ] HTTPS 证书有效
- [ ] 未改动旧站 `yijxj.com` / `59.110.125.73`

## 公开仓

- [ ] 仓库为 public
- [ ] 无 `.env` / 无密码 / 无 `data/*.db`
- [ ] `frontend/index.html` 中 `ai-farm-api-base` = `https://farm.yijxj.com`
- [ ] 已打 tag（如 `v1.2.0-cdn`）并 push
- [ ] JSDMirror URL 可打开：`.../gh/<owner>/<repo>@<tag>/frontend/index.html`

## 后端 47.94.243.26

- [ ] `/opt/ai-farm-os` 代码与 venv 就绪
- [ ] `.env` 权限 600，含 Senoiot 与 CORS 白名单
- [ ] `AI_FARM_ALLOWED_ORIGINS` 含 `https://cdn.jsdmirror.com`
- [ ] `systemctl is-active ai-farm-os` → active
- [ ] `nginx -t` 通过且站点已 reload
- [ ] `curl https://farm.yijxj.com/api/health` → 200 / running

## 浏览器联调

- [ ] 静态资源来自 `cdn.jsdmirror.com`
- [ ] `/api/health`、遥测请求发往 `farm.yijxj.com`
- [ ] CORS 无红字
- [ ] 厂家观测有数据或明确「等待首次同步」
- [ ] 页面不可见厂家密码

## 运维

- [ ] 已安排 `data/` 备份
- [ ] 已知回滚 tag / 上一后端版本
- [ ] 告知：前端角色 ≠ 登录鉴权
