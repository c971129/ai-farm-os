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

## 公开访问前置条件

本次未变更 DNS、未提交备案。公开发布前，需要在备案允许新网站/接入 IP 后创建记录：

```text
记录类型：A
主机记录：farm
记录值：47.94.243.26
```

DNS 生效后再申请并安装 `farm.yijxj.com` 的 HTTPS 证书；不要将根域或 `www` 指向此新实例。

## 相关手册

若采用「公开 GitHub + Pages/JSDMirror 前端、API 留在本实例」方案，完整步骤与**进度勾选**见：

[`public-repo-jsdmirror-backend-47.md`](./public-repo-jsdmirror-backend-47.md)

前端公开入口（已完成）：https://c971129.github.io/ai-farm-os/
