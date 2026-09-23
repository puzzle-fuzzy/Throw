import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Elysia, t } from 'elysia';
import type { AppDeps } from '../deps';
import { errors } from '../domain/errors';
import { authenticate, requireOrigin } from '../http';

const FILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function contentDisposition(name: string): string {
  return `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function relayRoutes(deps: AppDeps) {
  return new Elysia({ name: 'routes.relay' })
    .post(
      '/relay/rooms/:code/files',
      async ({ params, query, request }) => {
        requireOrigin(deps.config, request);
        const { member } = authenticate(deps.rooms, request, params.code);
        const fileId = String(query.fileId ?? '');
        const offset = Number(query.offset);
        const done = query.done === '1';
        if (!FILE_ID_RE.test(fileId)) throw errors.invalidRequest('fileId 非法');
        if (!Number.isInteger(offset) || offset < 0) throw errors.invalidOffset('分片 offset 非法');
        const data = new Uint8Array(await request.arrayBuffer());
        const { received } = await deps.relay.putChunk(
          params.code,
          fileId,
          member.token,
          offset,
          data,
        );
        if (done) await deps.relay.complete(params.code, fileId, member.token);
        return { received };
      },
      {
        query: t.Object({
          fileId: t.String(),
          offset: t.String({ pattern: '^\\d+$' }),
          done: t.Optional(t.String()),
        }),
      },
    )
    .get('/relay/files/:fileId', async ({ params, request, set }) => {
      const opened = await deps.relay.openDownload(params.fileId, request.headers.get('range'));
      if (opened === null) throw errors.unknownFile();
      authenticate(deps.rooms, request, 'unsatisfiable' in opened ? undefined : opened.code);
      if ('unsatisfiable' in opened) {
        set.status = 416;
        set.headers['content-range'] = `bytes */${opened.size}`;
        return '';
      }
      // 用 stream 包 Response：直接返回 BunFile 会被运行时覆写 Content-Range
      const start = opened.range?.start ?? 0;
      const end = opened.range?.end ?? opened.size - 1;
      const headers = new Headers({
        'content-type': 'application/octet-stream',
        'content-disposition': contentDisposition(opened.meta.name),
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
      });
      if (opened.range) {
        headers.set(
          'content-range',
          `bytes ${opened.range.start}-${opened.range.end}/${opened.size}`,
        );
      }
      // createReadStream 明确支持 start/end：BunFile.slice 在真实网络路径下不可靠
      const stream = Readable.toWeb(createReadStream(opened.path, { start, end }));
      return new Response(stream as unknown as ReadableStream<Uint8Array>, {
        status: opened.range ? 206 : 200,
        headers,
      });
    })
    .delete('/relay/files/:fileId', async ({ params, request }) => {
      requireOrigin(deps.config, request);
      const code = deps.relay.locate(params.fileId);
      if (!code) throw errors.unknownFile();
      authenticate(deps.rooms, request, code);
      await deps.relay.cancel(code, params.fileId);
      return { ok: true };
    });
}
