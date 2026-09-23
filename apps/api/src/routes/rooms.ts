import { isValidRoomCode, LIMITS, normalizeRoomCode } from '@throw/contracts';
import { Elysia, t } from 'elysia';
import type { AppDeps } from '../deps';
import { AppError, errors } from '../domain/errors';
import { clientIp, codeHash, requireOrigin } from '../http';

export function roomsRoutes(deps: AppDeps) {
  return new Elysia({ name: 'routes.rooms' })
    .post(
      '/rooms',
      ({ body, request, server }) => {
        requireOrigin(deps.config, request);
        const ip = clientIp(request, server);
        if (!deps.limiter.allowCreate(ip)) throw errors.rateLimited('创建房间过于频繁');
        const created = deps.rooms.createRoom();
        deps.logger.info({ event: 'room.create', room: codeHash(created.code) }, '房间创建');
        return { code: created.code, token: created.token, expiresAt: created.expiresAt };
      },
      { body: t.Object({}) },
    )
    .get('/rooms/:code', ({ params }) => {
      const code = normalizeRoomCode(params.code);
      if (!isValidRoomCode(code)) return { status: 'closed' as const };
      return { status: deps.rooms.statusOf(code) };
    })
    .post(
      '/rooms/:code/join',
      ({ params, body, request, server }) => {
        requireOrigin(deps.config, request);
        const ip = clientIp(request, server);
        const code = normalizeRoomCode(params.code);
        if (!isValidRoomCode(code)) throw errors.roomClosed();
        if (deps.limiter.isJoinLocked(ip, code)) {
          throw errors.rateLimited('该房间码尝试次数过多，请稍后再试');
        }
        if (!deps.limiter.allowJoin(ip)) throw errors.rateLimited('加入请求过于频繁');
        try {
          const joined = deps.rooms.joinRoom(code);
          deps.logger.info({ event: 'room.join', room: codeHash(code) }, '成员加入');
          return { token: joined.token, expiresAt: joined.expiresAt };
        } catch (error) {
          if (
            error instanceof AppError &&
            (error.code === 'ROOM_CLOSED' || error.code === 'ROOM_FULL')
          ) {
            deps.limiter.registerJoinFail(ip, code);
          }
          throw error;
        }
      },
      { body: t.Object({}) },
    );
}
