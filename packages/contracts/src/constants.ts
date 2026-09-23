/** 全局限制与时间参数。前后端唯一来源；调参依据见 docs/architecture.md §4.5。 */
export const LIMITS = {
  /** 单文件大小上限（100MB，产品决策） */
  MAX_FILE_BYTES: 100 * 1024 * 1024,
  /** 单次批量文件数上限 */
  MAX_BATCH_FILES: 10,
  /** 文本消息长度上限（字符） */
  MAX_TEXT_CHARS: 8000,
  /** 昵称长度上限 */
  MAX_NICKNAME_CHARS: 32,
  /** 文件名长度上限 */
  MAX_FILE_NAME_CHARS: 255,
  /** MIME 类型串长度上限 */
  MAX_MIME_CHARS: 128,
  /** 房间内未完成中转文件数上限（服务端 file-offer 校验） */
  MAX_PENDING_FILES_PER_ROOM: 20,
  /** 客户端中转分片目标大小 */
  RELAY_CHUNK_BYTES: 4 * 1024 * 1024,
  /** 服务端单分片大小硬上限 */
  RELAY_CHUNK_MAX_BYTES: 5 * 1024 * 1024,
  /** 中转文件兜底存活时间 */
  RELAY_FILE_TTL_MS: 60 * 60 * 1000,
  /** 成员断线宽限（期内可用原 token 重连） */
  GRACE_MS: 5 * 60 * 1000,
  /** waiting 房间无人加入的过期时间 */
  WAITING_EXPIRE_MS: 2 * 60 * 60 * 1000,
  /** 房间绝对寿命上限 */
  ROOM_ABSOLUTE_MAX_AGE_MS: 24 * 60 * 60 * 1000,
  /** 客户端心跳间隔 */
  HEARTBEAT_INTERVAL_MS: 15 * 1000,
  /** 服务端心跳判定离线阈值（3 个周期） */
  HEARTBEAT_TIMEOUT_MS: 45 * 1000,
  /** REST join 后未建立 WS 的占位宽限 */
  JOIN_GRACE_MS: 60 * 1000,
  /** hello 首帧超时（未鉴权连接强制关闭） */
  HELLO_TIMEOUT_MS: 5 * 1000,
  /** 单个连接允许的连续非法消息数 */
  MAX_INVALID_MESSAGES: 10,
} as const;
