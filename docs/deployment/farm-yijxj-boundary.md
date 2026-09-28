# `farm.yijxj.com` 部署边界

## 范围

| 项目 | 约定 |
| --- | --- |
| 新站点主机名 | `farm.yijxj.com` |
| 新站点实例 | `i-2ze6bookmkpso36pc5vk`（公网 `47.94.243.26`） |
| 旧站点 | `yijxj.com` 的既有部署与实例 `59.110.125.73`；本次不访问、不修改 |
| 应用服务 | `ai-farm-os`，应用目录 `/opt/ai-farm-os` |

## 隔离实现

- Nginx 为子域名单独使用 `/etc/nginx/conf.d/farm.yijxj.com.conf`，仅匹配 `farm.yijxj.com`，反向代理到本机 `127.0.0.1:8080`。
- 应用的允许主机和来源通过 `/etc/systemd/system/ai-farm-os.service.d/zz-farm-host.conf` 覆盖，包含 `farm.yijxj.com` 并保留原有地址。
- 既有 `ai-farm-os.conf` 维持 `yijxj.icu` 的独立虚拟主机；不承载 `farm.yijxj.com`。

## 已验证

在新实例本机使用 Host 请求头完成验证：

- `nginx -t` 通过。
- `ai-farm-os` 与 Nginx 均为 `active`。
- `Host: farm.yijxj.com` 的 `/` 与 `/api/health` 均返回 HTTP 200。

## 公开访问（现行）

- **页面入口：** https://c971129.github.io/ai-farm-os/（GitHub Pages；不依赖 `yijxj.com` DNS）  
- **API 主机：** `farm.lcxlwh.com` A → `47.94.243.26`，HTTPS（Let’s Encrypt）已装  
- `yijxj.com` DNS 不在本运维账号下，**不再**把公网联调卡在 `farm.yijxj.com`  
- 不要将根域 `yijxj.com` / `www` 指向此新实例

## 相关手册

若采用「公开 GitHub + Pages/JSDMirror 前端、API 留在本实例」方案，完整步骤与**进度勾选**见：

[`public-repo-jsdmirror-backend-47.md`](./public-repo-jsdmirror-backend-47.md)

前端公开入口（已完成）：https://c971129.github.io/ai-farm-os/
