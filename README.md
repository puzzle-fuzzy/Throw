# Throw

临时一对一传输房间：无需登录，创建或加入房间后像聊天一样互发文本与文件。文件优先 P2P 直传、不落云端，P2P 不可用时自动回退服务器中转（即传即删）。单文件 ≤ 100MB。

> **当前状态：阶段①②③全部交付**——设计文档、后端（`packages/contracts` + `apps/api`）与前端（`apps/web`）均已实现并通过验证（P2P 数据面在本机特殊网络环境的复验除外，见 docs/architecture.md §9.2）。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [PRODUCT.md](./PRODUCT.md) | 产品定位、用户、核心流程、信息架构与已确认决策 |
| [docs/architecture.md](./docs/architecture.md) | monorepo 结构、房间生命周期、自适应传输策略、API/WS 协议、安全与限制、实现备注 |
| [docs/frontend-design.md](./docs/frontend-design.md) | 页面与线框、HeroUI v3 组件方案、交互细节、状态模型、验证计划 |
| [deploy/README.md](./deploy/README.md) | 部署清单、Caddy/systemd 示例 |

## 快速开始

```bash
bun install
bun run --cwd apps/api dev        # 后端：127.0.0.1:3000（watch）
bun run --cwd apps/web dev        # 前端：Vite（默认 5173，/rooms /relay /health /ws 代理到 3000）
bun run verify                    # typecheck + 全部测试（bun test + vitest）+ lint
```

浏览器打开前端地址即可创建/加入房间。调试参数：房间链接加 `?relay=1` 强制中转通道、`?hostonly=1` 禁用 STUN 仅 host 候选。

- REST 前缀无：`GET /health`、`POST /rooms`、`GET /rooms/:code`、`POST /rooms/:code/join`、`POST /relay/rooms/:code/files`、`GET /relay/files/:fileId`、`DELETE /relay/files/:fileId`
- WebSocket：`/ws`，首帧 `{"type":"hello","token":"..."}` 鉴权
- 环境变量见 [.env.example](./.env.example)；production 必须配置 `PUBLIC_ORIGIN`（fail fast）

## 技术栈

Bun + Turborepo monorepo · `apps/web`（React 19 + Vite + HeroUI v3 + Tailwind v4，阶段③）· `apps/api`（Elysia + Bun，REST + WebSocket + 临时中转存储）· `packages/contracts`（TypeBox 契约与限制常量）· pino 结构化日志 · Biome · `bun test`

## 阶段规划

1. **阶段①（已完成）**：架构与前端设计文档
2. **阶段②（已完成）**：`packages/contracts` + `apps/api`（房间状态机、WS 信令、中转通道、清理与限流）；`bun run verify` 全绿（41 测试，含双客户端 WS 端到端）+ 真实进程 smoke
3. **阶段③（待开始）**：`apps/web` 全部页面与交互，接通后端并完成双端浏览器验证与参数标定
