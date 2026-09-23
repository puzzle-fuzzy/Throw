import { type Static, Type as t } from '@sinclair/typebox';

/** 稳定错误码：前端按 code 分支，message 为中文人话（仅供直接展示） */
export const ERROR_CODES = [
  'ROOM_FULL',
  'ROOM_CLOSED',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'ORIGIN_FORBIDDEN',
  'FILE_TOO_LARGE',
  'TOO_MANY_FILES',
  'TEXT_TOO_LONG',
  'UNKNOWN_FILE',
  'CHUNK_TOO_LARGE',
  'UPLOAD_BUSY',
  'INVALID_OFFSET',
  'INVALID_MESSAGE',
  'INVALID_REQUEST',
  'PEER_OFFLINE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

export const ErrorBodySchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
  }),
});
export type ErrorBody = Static<typeof ErrorBodySchema>;
