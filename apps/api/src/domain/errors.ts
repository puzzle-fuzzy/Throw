import type { ErrorCode } from '@throw/contracts';

/** 稳定错误码 + HTTP 状态；onError 统一映射为 { error: { code, message } } */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: (msg = '未认证') => new AppError('UNAUTHORIZED', 401, msg),
  forbidden: (msg = '无权访问') => new AppError('FORBIDDEN', 403, msg),
  originForbidden: (msg = '来源不允许') => new AppError('ORIGIN_FORBIDDEN', 403, msg),
  rateLimited: (msg = '请求过于频繁，请稍后再试') => new AppError('RATE_LIMITED', 429, msg),
  roomFull: () => new AppError('ROOM_FULL', 409, '房间已满'),
  roomClosed: () => new AppError('ROOM_CLOSED', 404, '房间不存在或已关闭'),
  fileTooLarge: (msg: string) => new AppError('FILE_TOO_LARGE', 413, msg),
  tooManyFiles: () => new AppError('TOO_MANY_FILES', 413, '房间内待传输文件过多'),
  chunkTooLarge: () => new AppError('CHUNK_TOO_LARGE', 413, '分片过大'),
  uploadBusy: () => new AppError('UPLOAD_BUSY', 409, '房间内已有其他上传进行中'),
  invalidOffset: (msg = '分片 offset 非法') => new AppError('INVALID_OFFSET', 400, msg),
  unknownFile: (msg = '文件不存在或已删除') => new AppError('UNKNOWN_FILE', 404, msg),
  invalidRequest: (msg = '请求参数非法') => new AppError('INVALID_REQUEST', 400, msg),
};
