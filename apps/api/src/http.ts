import { createHash } from 'node:crypto';
import type { AppConfig } from './config';
import { errors } from './domain/errors';
import type { Member, Room, RoomService } from './domain/roomService';

/** Elysia universal Server 中取对端地址所需的最小接口 */
export interface IpLookup {
  requestIP(request: Request): { address: string } | null;
}

/**
 * Bearer member token 鉴权；expectedCode 提供时校验属于该房间。
 * token 即成员身份（内存态，房间关闭即失效）。
 */
export function authenticate(
  rooms: RoomService,
  request: Request,
  expectedCode?: string,
): { room: Room; member: Member } {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw errors.unauthorized();
  const found = rooms.findByToken(token);
  if (!found) throw errors.unauthorized('token 无效或房间已关闭');
  if (expectedCode && found.room.code !== expectedCode) throw errors.forbidden();
  return found;
}

/** 生产模式下校验变更类请求的 Origin（浏览器必带）；配置为 true（开发）时放行 */
export function requireOrigin(config: AppConfig, request: Request): void {
  if (config.publicOrigins === true) return;
  const origin = request.headers.get('origin');
  if (!origin || !config.publicOrigins.includes(origin.replace(/\/+$/, ''))) {
    throw errors.originForbidden();
  }
}

/** WS 升级用：无 Origin（非浏览器）放行至 hello 鉴权约束 */
export function isOriginAllowed(config: AppConfig, request: Request): boolean {
  if (config.publicOrigins === true) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return config.publicOrigins.includes(origin.replace(/\/+$/, ''));
}

/**
 * 优先取可信反代的 x-forwarded-for 首段（部署要求见 deploy/README.md），
 * 否则用连接对端地址。
 */
export function clientIp(request: Request, server: IpLookup | null): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return server?.requestIP(request)?.address ?? 'unknown';
}

/** 日志脱敏：房间码只记 8 位哈希前缀 */
export function codeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 8);
}

/** 昵称归一：去空白，空串视为未填写 */
export function normalizeNickname(input: string | undefined | null): string | null {
  const trimmed = input?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
