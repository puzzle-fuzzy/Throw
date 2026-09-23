# Throw API 部署清单

> 单进程内存态服务（v1 明确不做多实例，见 [docs/architecture.md §9](../docs/architecture.md)）。
> 环境变量说明见根目录 [.env.example](../.env.example)。

## 前置要求

- Bun（版本以根目录 `.bun-version` 为准）
- 反向代理提供 TLS 终止（必须：公网下 WebSocket 需 `wss://`，浏览器 P2P (WebRTC) 也要求安全上下文）

## 必做清单

- [ ] `APP_ENV=production`（缺失 `PUBLIC_ORIGIN` 时服务拒绝启动，属预期的 fail fast）
- [ ] `PUBLIC_ORIGIN` 配置为前端实际 origin（逗号分隔多个）；它同时驱动 CORS 与 WS Origin 校验
- [ ] 反向代理正确传递 `X-Forwarded-For`（服务按其首段做限流；**仅信任可信代理**，直连暴露时不要开启）
- [ ] 反向代理支持 WebSocket 升级（`Upgrade`/`Connection` 头透传），且不缓冲 `/ws`
- [ ] `TMP_DIR` 指向本机临时目录（默认系统 tmp 下 `throw-relay`）；服务启动时若发现带归属 marker 的残留目录会先清空重建
- [ ] 磁盘余量 ≥ 预期并发中转总量（单文件上限 100MB × 每房间并发 1 上传）
- [ ] 进程管理器（systemd / launchd / Docker 等）配置 `SIGTERM` 优雅关停：关停时会清理全部中转临时文件
- [ ] 如需公网直连（无反代），自行在 `apps/api` 前加 TLS（v1 未内置）

## Caddy 示例

```caddyfile
throw.example.com {
	# 前端静态资源（阶段③部署 apps/web 构建产物）
	handle {
		root * /srv/throw/web
		try_files {path} /index.html
		file_server
	}

	# API：同域反代，避免跨域与额外 CORS 配置
	handle /api/* {
		uri strip_prefix /api
		reverse_proxy 127.0.0.1:3000
	}
}

# PUBLIC_ORIGIN=https://throw.example.com
# 前端用相对路径 /api/* 请求，或 PUBLIC_ORIGIN 配 https://throw.example.com 并让 API 走子域
```

## systemd 示例

```ini
[Unit]
Description=Throw API
After=network.target

[Service]
WorkingDirectory=/srv/throw
ExecStart=/usr/local/bin/bun run apps/api/src/index.ts
Environment=APP_ENV=production
Environment=PORT=3000
Environment=PUBLIC_ORIGIN=https://throw.example.com
Environment=TMP_DIR=/var/lib/throw/relay
Environment=LOG_LEVEL=info
Restart=on-failure
# 优雅关停：先 SIGTERM，宽限后再 SIGKILL
KillSignal=SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
```

## 运维要点

- **验证**：`curl -fsS https://<host>/api/health` → `{"status":"ok"}`
- **日志**：结构化 JSON（pino）；房间码只记 sha256 前 8 位，不记录文件名与消息内容
- **清理**：三重保障——接收方下载完成即删、文件 TTL 60 分钟兜底、房间销毁全删；另有 60s 周期清扫任务
- **升级/重启**：房间与中转文件全部丢失（产品语义：临时会话），无需迁移
