# Throw 架构设计

> 状态：**阶段①②已交付（设计文档 + `packages/contracts` + `apps/api` 后端实现）；阶段③前端待开始。**
> 产品边界见根目录 [PRODUCT.md](../PRODUCT.md)，本文只负责技术架构；三者冲突时以 PRODUCT.md 为准并先更新它。
> 参数表中标注「待标定」的数值为初始默认值，需在阶段③实测后修订。

## 1. 总体形态

Bun + Turborepo monorepo（用户指定 Bun workspaces；HTTP 服务用 Elysia）：

```
Throw/
├── PRODUCT.md
├── README.md
├── docs/                  # 工程文档（中文）
│   ├── architecture.md    # 本文
│   └── frontend-design.md
├── deploy/                # 部署清单与反代/进程管理示例
│   └── README.md
├── apps/
│   ├── web/               # React 19 + Vite + HeroUI v3 + Tailwind v4（阶段③实现）
│   └── api/               # Elysia + Bun：REST + WebSocket + 中转存储（阶段②已实现）
└── packages/
    └── contracts/         # 房间码/WS 消息/限制常量的 TypeBox 契约（阶段②已实现）
```

- 工具链：根 `package.json` workspaces + `turbo.json`（dev/build/typecheck/test/lint）、根 `biome.json`（Biome，不引入 ESLint/Prettier）、`packageManager` + `bun.lock` + `.bun-version`
- 测试：`bun test`（api / contracts / 领域逻辑）；阶段③前端组件用 Vitest + RTL

### 关键决策与理由

| 决策 | 理由 |
| --- | --- |
| **无数据库** | 产品定位「临时」：唯一需要落盘的是中转文件，而它本身就是要尽快删除的数据。房间/成员/消息元数据全部存进程内存 |
| Elysia 单进程承载 REST + WS | 1v1 房间的信令与转发量极小，单进程足够；多实例需迁移房间状态到 Redis，v1 明确不做（见 §9） |
| contracts 用 TypeBox | Elysia 原生 schema 体系；前后端共享同一份类型与运行时校验，前端 REST 走 `@elysia/eden` treaty |
| 不部署 TURN（用户已确认） | 打洞失败直接回退「上传 → 下载」中转模式；中转通道天然承担了 TURN 的兜底职能，且文件即传即删 |
| 中转文件存本地磁盘临时目录 | 100MB 上限下单文件内存驻留风险可控但没必要；磁盘 tmp 目录 + TTL 清理 + 房间关闭即删。存储路径收敛在 storage adapter 后面，便于测试注入与未来替换 |

## 2. 房间生命周期

```
                创建 POST /rooms
                     │
                 ┌───▼───┐
     第二人加入  │waiting│  超时无人加入（waiting-expire）
   ┌───────────►│       ├──────────────────────────┐
   │            └───┬───┘                          │
   │                │ 双方就绪                      ▼
   │            ┌───▼───┐                     ┌─────┐
   │  双方离线超 │active │  任一方主动关闭      │closed│
   │  idle-expire│       ├──────────────────►│      │
   └────────────┴───────┘  peer 全部离开      └──┬───┘
                                            销毁：删除全部中转文件与内存状态
```

- **房间码**：6 位 Crockford Base32（字符集排除 I、L、O、U），大写展示，熵 32⁶ ≈ 10.7 亿；输入时自动大写、忽略分隔符
- **1v1 锁定**：`waiting` 状态只接受一名加入者；转入 `active` 后第三人的 join 请求返回 `room-full`
- **成员宽限**：成员 WS 断开后 5 分钟（grace）内可用原 token 重连恢复身份；宽限过后视为离开
- **过期规则**：`waiting` 超过 2 小时无人加入 → 销毁；成员断线超过宽限未重连即从房间移除，**双方均被移除后房间立即销毁**（隐私优先：文件尽早清理）；任何房间达到绝对寿命（24 小时）强制销毁。REST 创建/加入后一直未建立 WS 的占位成员，60 秒（join-grace）后释放名额
- **销毁清理**：立即删除该房间全部中转文件与内存状态；这是删除操作的唯一触发源之一，另一源是「下载完成即删」（§5）

## 3. 连接与信令

一条 WebSocket 连接承担全部实时职责：成员事件、WebRTC 信令透传、文本消息转发、传输控制、心跳。

- 握手顺序：`POST /rooms`（创建方）或 `POST /rooms/:code/join`（加入方）换取 member token（128 bit 随机串，内存态）→ 建立 WS → 首帧 `hello {token}` 完成鉴权。token 不放 URL query，避免进入访问日志
- 心跳：客户端 15s 一次 `ping`，服务端 3 次未收到判定离线（宽限期开始）
- 断线重连：客户端指数退避（1s/2s/4s…上限 30s）重连 + 同 token `hello`；重连成功回到 `active`，否则展示 peer-left / closed
- 文本消息**只在 WS 上转发，服务器不存储、不落日志**

## 4. 自适应传输策略（核心）

设计目标：文件尽可能 P2P 直传；P2P 建不通或明显更慢时自动用服务器中转，用户无感（仅通道标识不同）。

### 4.1 决策流程（每个文件独立决策，结果在会话内缓存）

```
发送文件
   │
   ├─ 文本？ ──► 恒走 WS 中继（小、要求可靠送达；服务器只转发）
   │
   └─ 文件：
       1) DataChannel 是否可用？
          ├─ 未建立 → 尝试建立（ICE，超时 ice-timeout 8s）
          │    ├─ 成功 → 进入 2)
          │    └─ 失败 → 标记 p2pUsable=false，本房间后续文件直接走中转；
          │               每 p2p-retry-interval 5min 允许重试一次 P2P
          2) 吞吐探测：该方向首个文件发送前，用 2MB 探测块实测 DataChannel 吞吐
             ├─ ≥ p2p-min-throughput 500KB/s → P2P
             └─ 否则 → 中转，并缓存该结果（后续文件不再重复探测）
       3) 传输中不自动切换通道；失败重试时换另一条通道
```

### 4.2 P2P 通道（WebRTC DataChannel）

- `ordered: true, binary` 的 DataChannel；无 TURN（用户决策），ICE 仅 host + srflx（公共 STUN）
- 分块 256KB；`bufferedAmount ≥ 4MB` 时暂停发送实现背压， drained 后继续
- 接收方按 chunk 序确认（滑动 ack 窗口），双方据此驱动进度、速度与剩余时间
- 元数据先行：发送 `file-offer {fileId, name, size, mime}` → 直接开始传输（产品决策：不做接收确认弹窗，接收方可中途取消）
- 简化决策：DataChannel 中途断开即传输失败，**不做 P2P 断点续传**，重试从头传（重试自动换中转通道时天然获得分片续传能力，见下）

### 4.3 中转通道

```
发送方                     apps/api（磁盘 tmp，房间隔离目录）           接收方
  │ POST 分片上传(4MB/片, offset 幂等) ──►│                              │
  │◄─ {received: n} 逐片确认 ────────────│                              │
  │ 完成标记 done=1 ────────────────────►│ WS relay-notify{fileId,meta} ─►│
  │                                      │◄─ GET 下载(支持 Range 断点续传)─│
  │      WS relay-downloaded{fileId} ───►│ 立即删除文件与元数据            │
```

- 上传分片 4MB，`offset` 确认幂等，可安全重试；服务器逐片累计校验总量 ≤ 100MB
- 下载支持 HTTP Range，接收方网络中断可续传
- 删除三重保障：下载完成 ACK 即删（主路径）→ TTL 1 小时兜底 → 房间销毁全删（§2）

### 4.4 限制（三重校验：前端预检 + file-offer 元数据 + 服务端强制）

| 限制项 | 值 | 服务端强制点 |
| --- | --- | --- |
| 单文件大小 | ≤ 100MB | 中转逐片累计 + P2P file-offer 校验 |
| 单次批量文件数 | ≤ 10 | 发送端拆分校验 + 服务端 file-offer 校验 |
| 文本消息长度 | ≤ 8000 字符 | WS 消息 schema |
| 每房间并发中转上传 | 1 | 存储层互斥 |

### 4.5 调参表（初始值，待标定）

| 参数 | 初始值 | 说明 |
| --- | --- | --- |
| ice-timeout | 8s | ICE 建立超时 |
| probe-size | 2MB | 吞吐探测块 |
| p2p-min-throughput | 500KB/s | P2P 可用吞吐下限 |
| p2p-retry-interval | 5min | 判定中转后重试 P2P 的间隔 |
| p2p-chunk | 256KB | DataChannel 分块 |
| buffered-high | 4MB | 背压阈值 |
| relay-chunk | 4MB（服务端上限 5MB） | 中转上传分片 |
| relay-ttl | 60min | 中转文件兜底存活 |
| grace | 5min | 成员断线宽限（期内重连恢复身份） |
| waiting-expire | 2h | 无人加入销毁 |
| join-grace | 60s | REST 建房/加入后未 hello 的占位宽限 |
| room-max-age | 24h | 房间绝对寿命 |
| hello-timeout | 5s | WS 首帧 hello 超时强制断开 |
| max-invalid-messages | 10 | 单连接容忍的连续非法消息数 |
| heartbeat | 15s × 3 | 判定离线 |

限流初始值（内存滑动窗口）：创建 10 次/小时/IP；加入 30 次/小时/IP；同 (IP, 房间码) join 失败 3 次锁 10 分钟。

## 5. API 与 WS 协议（阶段②实现蓝图）

契约类型与 TypeBox schema 全部收敛在 `packages/contracts`，discriminated union 表达，前端经 `@elysia/eden` treaty 消费 REST，WS 消息复用同一份类型。

### REST

| 方法/路径 | 说明 | 鉴权 |
| --- | --- | --- |
| `POST /rooms` | 创建房间 → `{code, token, expiresAt}` | 速率限制（每 IP 10 间/小时，待标定） |
| `GET /rooms/:code` | 加入前预检 → `{status: waiting\|active\|closed}`，不泄露成员信息 | 无 |
| `POST /rooms/:code/join` `{nickname}` | 加入 → `{token}`；waiting 之外的态返回 `room-full` / `room-closed` | 速率限制 |
| `POST /relay/rooms/:code/files?fileId&offset` body=bytes | 分片上传，最后一片 `done=1` | Bearer member token |
| `GET /relay/files/:fileId` | 下载，支持 Range | Bearer member token |
| `DELETE /relay/files/:fileId` | 发送方取消中转 | Bearer member token |
| `GET /health` | 存活检查 | 无 |

### WS `/ws`（首帧 `hello{token}` 鉴权后进入房间流）

阶段②定稿（相对初稿的修订已并入）：

```ts
type ClientMessage =
  | { type: 'hello'; token: string }
  | { type: 'ping' }
  | { type: 'signal'; payload: Offer | Answer | IceCandidate } // WebRTC 信令透传
  | { type: 'text'; id: string; content: string }               // ≤ 8000 字符
  | { type: 'file-offer'; file: FileMeta; channel: 'p2p' | 'relay' }
  | { type: 'file-cancel'; fileId: string }
  | { type: 'relay-downloaded'; fileId: string }
  | { type: 'leave' };                                          // 主动离开 → 房间销毁

type ServerMessage =
  | { type: 'joined'; room: RoomInfo; peer: PeerInfo | null }
  | { type: 'peer-joined'; peer: PeerInfo }                     // 首次加入与重连均触发
  | { type: 'peer-left'; reason: 'leave' | 'disconnect' }
  | { type: 'room-closed'; reason: 'manual' | 'expired' }
  | { type: 'pong' }
  | { type: 'signal'; payload: Offer | Answer | IceCandidate }
  | { type: 'text'; id: string; from: PeerInfo; content: string }
  | { type: 'file-offer'; file: FileMeta; channel: 'p2p' | 'relay'; from: PeerInfo }
  | { type: 'file-cancel'; fileId: string }
  | { type: 'relay-notify'; file: FileMeta }                    // 可开始下载
  | { type: 'file-complete'; fileId: string }                    // 接收方完成下载的回执（转发给发送方）
  | { type: 'error'; code: string; message: string };
```

实现要点（阶段②定稿）：

- **中转元数据在 `file-offer`（channel=relay）经过服务器时注册**，上传分片仅引用 fileId，无需额外初始化端点
- 上传完成以**最后一片分片携带 `done=1`** 触发 `relay-notify`（初稿的独立 `relay-uploaded` 消息已移除）
- 成员重连（同 token `hello`）时**补发**断线期间未领取的 `relay-notify`
- `text`/`signal`/`file-offer` 在对端离线（宽限中）时向发送方回 `error{code:'PEER_OFFLINE'}`，消息不暂存
- P2P 的 chunk/ack 不进 WS：直接走 DataChannel 二进制帧（16 字节头：fileId 哈希 + 序号 + 长度，阶段③前端实现时定稿帧格式）

## 6. 安全设计

- **房间码防爆破**：熵 10.7 亿 + join 失败速率限制（同 IP 对同一房间码失败 3 次锁定该码 10 分钟，待标定）+ 房间短生命周期
- **member token**：128 bit 随机，仅存内存，离开/销毁即吊销；WS、上传、下载共用；日志脱敏不输出
- **传输边界**：Origin / WS 来源校验、CORS 白名单、请求体大小上限（防 resource exhaustion）
- **下载安全**：中转下载一律 `application/octet-stream` + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`，**服务器永不内联渲染任何文件**；房间内的图片/视频预览全部由前端基于本地 Blob 完成
- **最小知情**：服务器只经手中转文件的字节与必要元数据（fileId、大小），文件名仅在内存中短暂用于转发，不写日志、不落库；文本消息只转发不存储
- **部署要求**：公网必须 TLS（HTTPS/WSS），配置样例与清单在阶段②随 `deploy/` 交付；生产缺危险配置（如允许明文）时 fail fast

## 7. 可靠性与降级

| 故障 | 行为 |
| --- | --- |
| WS 断线 | 客户端指数退避重连；宽限期内恢复身份，UI 显示「重连中」状态条 |
| ICE 失败 / P2P 慢 | 自动回退中转，用户仅看到通道标识变化 |
| 中转上传分片失败 | 幂等重试同 offset |
| 中转下载中断 | Range 断点续传 |
| P2P 传输中断 | 判定失败，可重试（自动换中转通道） |
| 服务器重启 | 房间内存态全部丢失，客户端收到 closed/expired 引导重建；属产品可接受语义（临时性） |

## 8. 可观测与清理

- 结构化日志（pino，阶段②引入）：仅记录元数据（事件类型、房间码哈希、字节数、时长、结果码），带 request/trace id；不记录内容与文件名
- 清理任务：每 60s sweep 过期房间与超 TTL 中转文件；进程优雅关停时清空 tmp 目录内本服务写入的内容（删除前重新确认归属，只删自己创建的目录）
- `GET /health` 只暴露存活与版本，不泄露内部细节

## 9. 明确的 v1 边界（不做，留档防蔓延）

- 多实例水平扩展（需引入 Redis 共享房间状态，当前单进程内存态）
- P2P 断点续传、TURN 部署
- 消息与文件的任何持久化、导出、审计留档
- 端到端加密（v1 依赖 TLS + P2P 直传；中转通道的服务端可见性已在 PRODUCT.md 隐私边界内。E2EE 列为可能的 v2 方向，不影响当前契约设计）

## 9.1 实现备注（阶段②，2026-09-23）

- 版本：Bun 1.4.0 · Elysia 1.4.30 · @elysiajs/cors 1.4.2 · pino 10.3 · @sinclair/typebox 0.34.52 · Biome 2.5 · TypeScript 7.0 · Turborepo 2.11
- **schema 双轨**：REST 路由 schema 用 Elysia 内联 `t`（Eden 类型推断的唯一来源，Elysia 1.4 已内联自带 typebox，跨包 schema 对象有 nominal 类型冲突风险）；WS 消息契约在 `packages/contracts`（TypeBox 运行时校验 + 前端共享类型）
- **Elysia ws 每个事件传入新的包装对象**：连接身份一律以 `ws.id` 判等（替换连接、close 归属判断）
- **Range 下载**用 `node:fs createReadStream({start,end})` + `Readable.toWeb`：直接返回 `BunFile.slice` 会被运行时自动覆写 `Content-Range`，不可控
- 请求体上限经 `serve.maxRequestBodySize`（= 服务端分片上限 + 1MB）
- 下载响应头完全自管（`application/octet-stream` + `Content-Disposition: attachment` + `nosniff` + `Cache-Control: no-store`）

## 9.2 实现备注（阶段③，2026-09-23）

- 版本：React 19.3 · react-router 8.4 · zustand 5 · HeroUI 3.2.6 · Tailwind v4（@tailwindcss/vite）· lucide-react · Vitest 3 + RTL
- **HeroUI v3 关键认知**：`Toast.Provider` 是 ToastRegion（Toast 队列渲染区，**不透传应用 children**，须与 App 平级挂载）；`TextField`/`TextArea`/`Input` 是 react-aria 原语（Label/Input 组合子、TextArea 为事件式 onChange）；命令式 `toast.success/danger/info/warning`；Modal/AlertDialog 为 trigger 模式（首个子元素即触发器，内部按钮自动关闭）
- **StrictMode 陷阱**：初始化 effect 的"已初始化"守卫在双执行（mount→cleanup→mount）下会把连接永久关闭——依赖数组本身就是单例边界，不要加手动守卫
- 通道决策缓存放 TransferManager 实例（页面刷新即重置）；P2P 链路管理：发送方一律作为发起方建链，双方同时发起时 creator 让位；answerer 收到新 offer 且旧链已应答完成（signalingState ≠ have-remote-offer）时跟随重建
- **调试参数**：`?relay=1` 强制中转通道；`?hostonly=1` 禁用 STUN 仅用 host 候选
- **已知环境限制（待复验）**：本机 IAB(WKWebView) + Clash TUN 组合下，跨标签页 WebRTC 的信令/ICE/SCTP 建链全部成功、`dc.send` 不抛，但对端应用层收不到任何 DataChannel 消息（同环境新建裸 RTCPeerConnection 手工链路可通）；探测超时后按设计自动回退中转，功能不受影响。P2P 数据面需在无 TUN 代理的普通网络环境复验
- E2E 已验证（真实双标签页 + 真实后端）：首页全流程、建房/加入/链接直达预填、文本双向、中转文件全链路（上传→下载→缩略图→保存→即删回执）、图片预览、刷新恢复会话（宽限重连）、离开确认→双方终态

## 10. 阶段规划与验证口径

| 阶段 | 范围 | 验证 |
| --- | --- | --- |
| ①（已完成） | 本设计文档 + [前端设计](frontend-design.md) + PRODUCT.md | 用户确认（2026-09-23） |
| ②（已完成） | `packages/contracts` + `apps/api`（房间状态机、WS、中转、清理、限流、结构化日志） | `bun run verify`（typecheck + 测试 + lint）；含双客户端 WS 端到端；真实进程 smoke（接口 + SIGTERM 优雅关停清空临时目录） |
| ③（已完成） | `apps/web`（HeroUI v3 全部页面与交互、Eden 接通、WS 心跳重连、P2P/中转自适应传输） | `bun run verify` 全绿（60 测试，web 为 Vitest + RTL）；真实双标签页浏览器 E2E（建房/加入/文本/中转文件全链路/图片预览/刷新恢复/离开销毁）；**P2P 数据面在本机特殊网络环境未通（自动回退中转），待普通网络复验**（见 §9.2） |

依赖顺序：contracts → api → web。阶段②开始前如本设计有修订，先同步更新本文与 PRODUCT.md。
