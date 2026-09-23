# Throw 前端设计

> 状态：**阶段③已实现（2026-09-23）**，组件以 HeroUI v3.2.6 实际清单为准；实现期的 API 修正与已知环境限制见 [architecture.md §9.2](architecture.md)。
> 产品边界见 [PRODUCT.md](../PRODUCT.md)，传输通道与协议见 [architecture.md](architecture.md)。

## 1. 技术选型

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | React 19 + Vite | 单页应用，路由 `/` 与 `/r/:code` |
| UI 库 | HeroUI v3（`@heroui/react` + `@heroui/styles` + `tailwind-variants`） | compound 组件、CSS 动效、无 Provider |
| 样式 | Tailwind CSS v4（CSS-first，不用 `tailwind.config.ts`） | `@import "tailwindcss"` 必须在 `@import "@heroui/styles"` 之前 |
| 路由 | react-router | 两条路由 + 链接直达房间 |
| 状态 | zustand | 会话/连接/消息/传输四个 store slice（§6） |
| 图标 | lucide-react | 唯一图标来源 |
| API | `@elysia/eden` treaty（REST）+ 自封装 WS/传输 client | 类型全部来自 `packages/contracts` |

HeroUI v3 硬性约定（实现时逐条遵守）：

- 无 `HeroUIProvider`，不引入 framer-motion
- 一律 compound 结构（`<Card><Card.Header><Card.Title>`），不拍平成 props
- 交互用 `onPress`，不用 `onClick`
- 语义变体：`primary`（每上下文仅一个主操作）/ `secondary` / `tertiary` / `danger` / `ghost` / `outline`

## 2. 布局骨架

```
┌──────────────────────────────────────────────────────┐
│                                                    ◈ │ ← 主题切换（fixed 角落）
│            （视口，任意宽度）                           │
│   ┌──────────────────────────────────────────┐       │
│   │   内容列 ≤ 720px 居中（房间页全宽使用）      │       │
│   │   首页/等待卡内部再收窄 max-w-sm 居中        │       │
│   │   min-h-dvh，flex 列布局                   │       │
│   └──────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────┘
```

- 根容器 `mx-auto w-full max-w-[720px]`：移动全宽，桌面是聊天应用级的舒适列宽（不再窄到像手机）
- 首页 `max-w-sm` 入口卡片居中（按钮与房间码对齐）；房间页消息流 `flex-1` 撑满剩余高度内部滚动
- 消息气泡与文件卡片：移动 `max-w-[85%]`，≥640px 视口收窄到 `sm:max-w-[72%]`，避免宽屏气泡过长
- 桌面端两侧留白即可，不做装饰性背景元素

## 3. 首页 `/`

### 线框

```
┌────────────────────────────────────┐
│            ◈ Throw                 │  ← Lucide 图标 + 产品名
│      临时一对一传输房间·用完即走      │
│                                    │
│  昵称（可选）                        │
│  ┌──────────────────────────────┐  │
│  │ TextField  placeholder 游客   │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │      ＋  创建房间  primary    │  │
│  └──────────────────────────────┘  │
│                                    │
│  ─────────── 或 ───────────        │  ← Separator + 文案
│                                    │
│  房间码                             │
│  ┌──┬──┬──┬──┬──┬──┐               │
│  │  │  │  │  │  │  │               │  ← InputOTP（6 位，自动大写）
│  └──┴──┴──┴──┴──┴──┘               │
│  ┌──────────────────────────────┐  │
│  │       加入房间  outline       │  │  ← 6 位填满才可用
│  └──────────────────────────────┘  │
│                                    │
│  ⓘ 一对一 · 临时会话 · 文件不落云    │  ← 说明行（Lucide 小图标）
└────────────────────────────────────┘
```

### 组件映射

| 元素 | HeroUI v3 | 备注 |
| --- | --- | --- |
| 昵称输入 | `TextField` | 存 localStorage，回填 |
| 创建房间 | `Button` variant=`primary` | pending 态 Spinner + 禁用 |
| 房间码 | `InputOTP`（6 段） | 输入自动大写、粘贴整码自动填充 |
| 加入房间 | `Button` variant=`outline` | 填满 6 位后启用 |
| 分隔 | `Separator` | — |
| 错误反馈 | `ErrorMessage`（输入区）+ `Toast` | 房间不存在 / 已满 / 网络失败分别提示 |

### 行为

- `/r/:code` 直达时：若未入房，先回首页并预填房间码、聚焦昵称（或直接弹昵称输入，见 §4 加入流程）
- 创建/加入成功即携带 token 跳转 `/r/:code`
- 重复提交保护：请求期间按钮 pending + 禁用

## 4. 房间 `/r/:code`

### 4.1 页面状态机

```
connecting ──► waiting ──peer-joined──► connected ──peer-left──► peer-left
   │             │                        │    ▲                    │
   │             │等待超时                 │    │宽限期内重连成功        │房间关闭
   ▼             ▼                        ▼    │                    ▼
closed/expired closed/expired        （重连中）                closed/expired
```

- `connected` 附带通道态：`p2p` / `relay` / `switching`（探测或回退过程）
- `peer-left` 与 `closed` 为终态页：给出「重建房间」「返回首页」两个出口

### 4.2 线框（connected 态）

```
┌────────────────────────────────────┐
│ ◈  ABC-123   [P2P 已连接]   ⋮      │ ← 顶栏：房间码(点击复制)+状态Chip+菜单
├────────────────────────────────────┤
│          （ScrollShadow 消息流）      │
│  ┌─ 对方 昵称 ─────────┐            │
│  │ 文本气泡             │            │ ← 对方：左对齐
│  └─────────────────────┘            │
│            ┌─────────── 我 ─┐       │
│            │ 文本气泡        │       │ ← 自己：右对齐、accent 底
│            └────────────────┘       │
│  ┌─ 文件卡片 · 对方发来 ──────────┐   │
│  │ 🖼(缩略图)  IMG_2041.jpg        │   │ ← 图片：气泡内缩略图，点击放大
│  │ 2.4MB · [P2P]        ⬇ 下载    │   │
│  └───────────────────────────────┘   │
│  ┌─ 文件卡片 · 我发送 · 传输中 ───┐   │
│  │ ▤  design.sketch               │   │
│  │ ████████░░░░ 62%  4.2MB/s      │   │ ← ProgressBar + 速度 + 剩余
│  │ 36MB/58MB · [中转]      ✕ 取消  │   │
│  └───────────────────────────────┘   │
├────────────────────────────────────┤
│ ╭──────────────────────────────╮   │
│ │ TextArea  发送文本或文件…      │   │  ← 无边框透明（variant=secondary
│ │                              │   │    + important 覆盖），自动增高
│ │ 📎                      (↑)  │   │  ← 工具栏内嵌卡片底部
│ ╰──────────────────────────────╯   │
└────────────────────────────────────┘
   （胶囊输入卡片 rounded-[26px]：左下圆形附件钮 secondary，
     右下圆形发送钮 primary+ArrowUp；字数接近上限时计数居中提示）
   （拖拽文件到页面任意位置 → 全屏拖放覆盖层；粘贴截图直接发送）
```

### 4.3 子状态呈现

| 状态 | 呈现 |
| --- | --- |
| connecting | 页面骨架 + `Spinner` +「正在连接…」 |
| waiting | 消息流位置显示大号房间码卡片：`ABC123`（点击复制房间码）、「复制邀请链接」`Button`、`Spinner` +「等待对方加入…」、有效期倒计时 |
| connected | 顶栏 `Chip`：`P2P 已连接`（primary）/ `中转模式`（secondary）/ `切换通道中…`（+ `Spinner`） |
| 重连中 | 顶部黄色警示条「连接中断，正在重连…（第 n 次）」，输入区禁用，已收内容保留 |
| peer-left | 覆盖层 `Card`：原因文案 +「等待对方回来（宽限 5 分钟，倒计时）」/「返回首页」 |
| closed/expired | 覆盖层 `Card`：说明 +「重新创建房间」（primary）/「返回首页」（tertiary） |

### 4.4 消息流与文件卡片

- 文本气泡：对方左 / 自己右；`Avatar`（昵称首字）+ 昵称 + 时间；长文本内部滚动上限，链接可点击
- 文件卡片（`Card` + `Card.Content`，信息密度优先）：
  - **元信息**：文件类型 Lucide 图标（图片/视频/音频/压缩包/文档/通用）；文件名单行 truncate + `Tooltip` 全名；人类可读大小；通道 `Chip`（P2P/中转）
  - **图片**：完成后气泡内缩略图（本地 Blob，等比、固定比例容器），点击 `Modal` 放大，提供「下载」
  - **视频**：完成后内联原生 `<video controls>`（本地 Blob，`aspect-ratio` 固定容器）
  - **传输中**：`ProgressBar`（含 aria）+ 实时速度 + 预计剩余 + 已传/总量；`取消`（danger ghost）双方均可触发
  - **失败**：错误原因 + `重试`（primary outline，自动换另一通道）+ `取消`
  - **已取消**：置灰收起为一行
- 系统提示行（居中小字）：「对方已加入」「房间将在 X 后过期」等

### 4.5 输入区与发送

输入区为「胶囊卡片」组合（ChatGPT 风格）：外层 `rounded-[26px] border bg-background shadow-sm` 卡片，内部上方是 HeroUI `TextArea`（`variant="secondary"` + important 样式覆盖成无边框透明，`[field-sizing:content]` 自适应增高，上限 5 行），底部内嵌工具栏——左侧圆形附件 `Button`(secondary, `rounded-full`)、右侧圆形发送 `Button`(primary, `rounded-full`, ArrowUp 图标)；组件全部复用 HeroUI 原语，只做样式类调整与组合。

| 交互 | 行为 |
| --- | --- |
| 文本发送 | Enter 或圆形「发送」钮（Shift+Enter 换行，输入法合成态不误发）；发送后清空；8000 字上限接近时计数居中提示 |
| 附件选择 | 📎 圆形 `Button`(secondary) → 文件多选；>100MB 单文件或 >10 个直接 `Toast` 拒绝并列出超限项 |
| 拖拽 | dragenter 全屏半透明覆盖层「松开即发送」；drop 后同样预检 |
| 粘贴 | paste 事件读 `clipboardData.files`（截图直发）；纯文本走输入框 |
| 预检规则 | 三重校验的第一环（见 architecture §4.4）；预检不过不产生任何网络请求 |
| 并发 | 文本不受文件传输影响；文件按通道能力并行（P2P 串行、中转串行，队列展示排队态） |
| 离开保护 | 房间内 `beforeunload` 提示「离开将丢失本会话」；顶栏菜单「离开房间」经 `AlertDialog` 确认 |

### 4.6 组件映射汇总

| 场景 | 组件 |
| --- | --- |
| 顶栏房间码复制 | `Button`(ghost) + `Tooltip` + `Toast`「已复制」 |
| 连接状态 | `Chip`（semantic variant） |
| 离开/关闭确认 | `AlertDialog`、菜单 `Dropdown` |
| 消息流 | `ScrollShadow`（自动滚底；用户上滚时暂停跟随并显示「回到底部」浮标） |
| 等待页骨架 | `Skeleton` |
| 传输进度 | `ProgressBar`；等待对方接受中/排队用 `ProgressCircle`/`Spinner` |
| 图片预览 | `Modal` |
| 全局提示 | `Toast`（复制、错误、通道切换） |

## 5. 主题

- HeroUI v3 oklch CSS 变量体系；亮/暗两套，`<html class="dark" data-theme="dark">` 切换
- 默认跟随系统（`prefers-color-scheme`），手动切换持久化 localStorage；两套主题下传输中的 accent 色均满足对比度
- 动效全部为 CSS 实现（v3 无 framer-motion），遵守 `prefers-reduced-motion`

## 6. 前端状态模型（zustand，草案，阶段③随 contracts 定稿）

```ts
interface SessionStore {
  nickname?: string;
  room?: { code: string; token: string; role: 'creator' | 'joiner' };
}

interface ConnectionStore {
  wsStatus: 'connecting' | 'open' | 'reconnecting' | 'closed';
  roomPhase: 'waiting' | 'connected' | 'peer-left' | 'closed';
  closeReason?: 'manual' | 'idle' | 'expired';
  channel: 'p2p' | 'relay' | 'switching';
  p2pUsable: boolean;         // 会话级缓存（architecture §4.1）
  lastThroughput?: number;    // 探测结果
}

interface MessageItem {        // 仅内存，刷新即失（产品决策）
  id: string;
  kind: 'text' | 'file' | 'system';
  mine: boolean;
  // text: content；file: 引用 TransferItem；system: 文案
}

interface TransferItem {
  fileId: string;
  name: string; size: number; mime: string;
  channel: 'p2p' | 'relay';
  status: 'queued' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  progress: { sentBytes: number; speedBps?: number; etaSec?: number };
  error?: string;
  blobUrl?: string;           // 完成后本地预览；组件卸载/取消时 revokeObjectURL
}
```

规则：Blob URL 的创建与 revoke 与 `TransferItem` 生命周期绑定；重试 = 新 TransferItem 复用同一文件引用；所有 store 不持久化。

## 7. 无障碍与响应式检查单（阶段③逐项验证）

- 焦点：Modal/AlertDialog 焦点圈与返回焦点；离开确认后焦点回到触发按钮
- 进度条 `ProgressBar` aria 值；发送/附件/复制按钮均有 aria-label；消息流 `role="log"` + `aria-live="polite"`
- 键盘：房间码 `InputOTP` 键盘可达；⌘/Ctrl+Enter 发送；Esc 关闭预览
- 触摸目标 ≥ 44px；文件名 truncate + Tooltip；375/720/1280 三档宽度检查文字溢出与布局
- `prefers-reduced-motion` 关闭装饰动效（进度与状态变化保留）

## 8. 验证计划（阶段③）

| 层 | 方式 |
| --- | --- |
| 组件测试（Vitest + RTL） | 文件卡片状态机（queued→transferring→completed/failed/cancelled）、输入区上限与快捷键、房间码输入/粘贴、离开确认 |
| 契约联调 | Eden treaty 直连本地 api；WS client 对 contracts 类型的 exhaustiveness 检查 |
| 浏览器双端验证 | 两窗口真实 P2P 传输；模拟 ICE 失败走中转回退；断网重连；拖拽/粘贴发送；图片/视频预览；亮暗主题与 375/720/1280 三档宽度 |
| 明确不做 | 页面级 E2E 套件与视觉回归（形态稳定后再议，遵循仓库测试约定） |
