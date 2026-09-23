# Throw 部署（生产：p2p.yxswy.com）

> 单进程内存态服务（v1 明确不做多实例，见 [docs/architecture.md §9](../docs/architecture.md)）。
> 实际部署：yxswy.com（OpenCloudOS 9）· API 为 Bun 单二进制 + systemd · 前端静态 + nginx 反代。

## 服务器布局

| 项 | 值 |
| --- | --- |
| 前端静态 | `/srv/throw/web`（`apps/web` 构建产物，SPA） |
| API 二进制 | `/srv/throw/api/throw-api`（`bun build --compile --target=bun-linux-x64`） |
| 中转临时目录 | `/var/lib/throw/relay` |
| systemd | `throw-api.service`（127.0.0.1:3100，`HOST=127.0.0.1`） |
| nginx | `/etc/nginx/conf.d/p2p.yxswy.com.conf`（证书 Let's Encrypt，含 `turn.p2p` SAN） |
| 日志 | journald：`journalctl -u throw-api -f` |

## 发布流程

```bash
# 1. 构建（版本=git rev-parse --short HEAD 可追加到文件名）
bun build --compile --target=bun-linux-x64 apps/api/src/index.ts --outfile throw-api
bun run --cwd apps/web build

# 2. 上传
rsync -az throw-api yxswy.com:/srv/throw/api/throw-api
rsync -az --delete apps/web/dist/ yxswy.com:/srv/throw/web/

# 3. 重启（优雅关停会清空中转临时文件；房间为内存态，重启即清空——产品语义如此）
ssh yxswy.com 'chmod +x /srv/throw/api/throw-api && systemctl restart throw-api'

# 4. 验证
curl -fsS https://p2p.yxswy.com/health   # {"status":"ok"}
```

## nginx 要点（已固化在 conf 中）

- `/ws` 单独 location：HTTP/1.1 + `Upgrade`/`Connection` 透传，`proxy_read_timeout 1h`（心跳 15s，留足余量）
- `/rooms` `/relay` `/health` 反代：`client_max_body_size 8m`（中转分片上限 4MB + 头部余量）、`proxy_buffering off`（Range 下载流式）
- `X-Forwarded-For` 透传（API 按其首段做限流，仅信任本机反代）
- `/assets/` 一年强缓存（内容寻址文件名）
- 80 端口保留 `p2p` 与 `turn.p2p` 的 ACME webroot（`/var/www/p2p-acme`，certbot 续期）

## 运维要点

- **环境变量**：`APP_ENV=production`、`PUBLIC_ORIGIN=https://p2p.yxswy.com`（驱动 CORS 与 WS Origin 校验）、`PORT=3100`、`HOST=127.0.0.1`
- **端口选择**：服务器 3000 已被占用（dht-observer），Throw 用 3100，只绑回环
- **验证**：`curl -fsS https://p2p.yxswy.com/health`；双端浏览器建房/发消息/传文件
- **日志**：结构化 JSON（pino → journald）；房间码只记 sha256 前 8 位，不记录文件名与消息内容
- **清理**：三重保障——接收方下载完成即删、文件 TTL 60 分钟兜底、房间销毁全删；另有 60s 周期清扫任务
- **升级/重启**：房间与中转文件全部丢失（产品语义：临时会话），无需迁移
- **回滚**：保留上一版二进制为 `/srv/throw/api/throw-api.prev` 后再覆盖（首次部署未保留）

## 历史

2026-09-23 首次部署，全量替换旧 p2p 服务（browser-transfer compose 项目、desklink-diagnostics systemd、desklink-relay、相关镜像/卷/目录/nginx 备份均已清除；`turn.p2p.yxswy.com` 的 80 端口 ACME 块保留用于证书续期）。
