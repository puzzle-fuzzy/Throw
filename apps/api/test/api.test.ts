import { afterAll, describe, expect, test } from 'bun:test';
import type { CreateRoomOk } from './helpers';
import { makeContext } from './helpers';

const ctx = await makeContext();
afterAll(async () => {
  await ctx.storage.wipeAll();
});

const app = ctx.app;

async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

async function createRoom(nickname?: string): Promise<CreateRoomOk> {
  const res = await call('/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(nickname === undefined ? {} : { nickname }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateRoomOk;
}

describe('REST 基础', () => {
  test('health', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  test('创建 → 状态查询 waiting → 加入 → active → 满员', async () => {
    const created = await createRoom('小明');
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(typeof created.token).toBe('string');
    expect(created.expiresAt).toBeGreaterThan(Date.now());

    const status1 = await call(`/rooms/${created.code}`);
    expect(await status1.json()).toEqual({ status: 'waiting' });

    const join = await call(`/rooms/${created.code}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: '小红' }),
    });
    expect(join.status).toBe(200);
    const joinBody = (await join.json()) as { token: string };
    expect(typeof joinBody.token).toBe('string');

    const status2 = await call(`/rooms/${created.code}`);
    expect(await status2.json()).toEqual({ status: 'active' });

    const third = await call(`/rooms/${created.code}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: { code: string } }).error.code).toBe('ROOM_FULL');
  });

  test('未知房间码/非法房间码 → closed / 404', async () => {
    const unknown = await call('/rooms/ZZZZZZ');
    expect(await unknown.json()).toEqual({ status: 'closed' });
    const invalid = await call('/rooms/xyz');
    expect(await invalid.json()).toEqual({ status: 'closed' });
    const join = await call('/rooms/ZZZZZZ/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(join.status).toBe(404);
  });

  test('参数校验失败 → 400 INVALID_REQUEST', async () => {
    const res = await call('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 123 }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_REQUEST');
  });

  test('CORS 预检放行（开发 origin=true）', async () => {
    const res = await call('/rooms', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
      },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    expect(allowOrigin === '*' || allowOrigin === 'http://localhost:5173').toBeTrue();
  });
});

describe('REST 中转', () => {
  test('上传/下载/删除全链路', async () => {
    const created = await createRoom();
    const join = await call(`/rooms/${created.code}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const { token: receiverToken } = (await join.json()) as { token: string };
    const senderToken = created.token;

    const fileId = 'file-01';
    ctx.relay.registerMeta(
      created.code,
      { fileId, name: 'hello.txt', size: 11, mime: 'text/plain' },
      senderToken,
    );

    const upload = (query: string, body: Uint8Array, token: string) =>
      call(`/relay/rooms/${created.code}/files?${query}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body,
      });

    // 未认证
    const noAuth = await upload(
      'fileId=file-01&offset=0',
      new TextEncoder().encode('hello'),
      'bad',
    );
    expect(noAuth.status).toBe(401);

    // 分片
    const part1 = await upload(
      'fileId=file-01&offset=0',
      new TextEncoder().encode('hello '),
      senderToken,
    );
    expect(part1.status).toBe(200);
    expect(await part1.json()).toEqual({ received: 6 });

    const part2 = await upload(
      'fileId=file-01&offset=6&done=1',
      new TextEncoder().encode('world'),
      senderToken,
    );
    expect(await part2.json()).toEqual({ received: 11 });

    // 接收方 Range 下载
    const dl = await call(`/relay/files/${fileId}`, {
      headers: { authorization: `Bearer ${receiverToken}`, range: 'bytes=0-4' },
    });
    expect(dl.status).toBe(206);
    expect(dl.headers.get('content-range')).toBe('bytes 0-4/11');
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await dl.text()).toBe('hello');

    // 全量
    const full = await call(`/relay/files/${fileId}`, {
      headers: { authorization: `Bearer ${receiverToken}` },
    });
    expect(full.status).toBe(200);
    expect(await full.text()).toBe('hello world');

    // 416
    const unsat = await call(`/relay/files/${fileId}`, {
      headers: { authorization: `Bearer ${receiverToken}`, range: 'bytes=99-' },
    });
    expect(unsat.status).toBe(416);
    expect(unsat.headers.get('content-range')).toBe('bytes */11');

    // 无关成员（另一房间的 token）拒绝
    const stranger = await createRoom('路人');
    const forbidden = await call(`/relay/files/${fileId}`, {
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(forbidden.status).toBe(403);

    // 发送方取消（DELETE）
    const del = await call(`/relay/files/${fileId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${senderToken}` },
    });
    expect(del.status).toBe(200);
    const gone = await call(`/relay/files/${fileId}`, {
      headers: { authorization: `Bearer ${receiverToken}` },
    });
    expect(gone.status).toBe(404);
  });
});
