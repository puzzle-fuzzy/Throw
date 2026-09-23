import cors from '@elysiajs/cors';
import { LIMITS } from '@throw/contracts';
import { Elysia } from 'elysia';
import type { AppDeps } from './deps';
import { AppError } from './domain/errors';
import { healthRoutes } from './routes/health';
import { relayRoutes } from './routes/relay';
import { roomsRoutes } from './routes/rooms';
import { wsRoute } from './routes/ws';

const requestMeta = new WeakMap<Request, { id: string; start: number }>();

/** app factory：测试经 app.handle 直接调用，不启动监听 */
export function buildApp(deps: AppDeps) {
  return new Elysia({
    name: 'throw-api',
    serve: { maxRequestBodySize: LIMITS.RELAY_CHUNK_MAX_BYTES + 1024 * 1024 },
  })
    .use(
      cors({
        origin: deps.config.publicOrigins === true ? true : deps.config.publicOrigins,
        allowedHeaders: ['Authorization', 'Content-Type'],
        maxAge: 600,
      }),
    )
    .onRequest(({ request, set }) => {
      const id = crypto.randomUUID();
      requestMeta.set(request, { id, start: Date.now() });
      set.headers['x-request-id'] = id;
    })
    .onAfterResponse(({ request, set }) => {
      const meta = requestMeta.get(request);
      if (!meta) return;
      const path = new URL(request.url).pathname;
      if (path === '/health') return;
      deps.logger.info(
        {
          reqId: meta.id,
          method: request.method,
          path,
          status: set.status ?? 200,
          ms: Date.now() - meta.start,
        },
        'http',
      );
    })
    .onError(({ error, set, code }) => {
      if (error instanceof AppError) {
        set.status = error.status;
        return { error: { code: error.code, message: error.message } };
      }
      if (code === 'VALIDATION') {
        set.status = 400;
        return { error: { code: 'INVALID_REQUEST', message: '请求参数非法' } };
      }
      deps.logger.error({ err: error instanceof Error ? error.stack : String(error) }, '内部错误');
      set.status = 500;
      return { error: { code: 'INTERNAL', message: '服务器内部错误' } };
    })
    .use(healthRoutes())
    .use(roomsRoutes(deps))
    .use(relayRoutes(deps))
    .use(wsRoute(deps));
}
