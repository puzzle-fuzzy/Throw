import { afterAll, describe, expect, test } from 'bun:test';
import type { ClientMessage, ServerMessage } from '@throw/contracts';
import { makeContext } from './helpers';

const ctx = await makeContext();
const app = ctx.app;
app.listen({ port: 0, hostname: '127.0.0.1' });
const port = app.server?.port;
if (!port) throw new Error('测试服务器启动失败');

const base = `http://127.0.0.1:${port}`;

afterAll(() => {
  app.stop();
  void ctx.storage.wipeAll();
});

class WsClient {
  readonly ws: WebSocket;
  private readonly messages: ServerMessage[] = [];
  private readonly waiters: Array<{
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => this.receive(String(ev.data));
  }

  static async connect(): Promise<WsClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = new WsClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('ws 连接失败'));
    });
    return client;
  }

  private receive(raw: string): void {
    const msg = JSON.parse(raw) as ServerMessage;
    const index = this.waiters.findIndex((w) => w.predicate(msg));
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter!.timer);
      waiter!.resolve(msg);
    } else {
      this.messages.push(msg);
    }
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  expectType<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<ServerMessage & { type: T }> {
    const index = this.messages.findIndex((m) => m.type === type);
    if (index >= 0) {
      return Promise.resolve(this.messages.splice(index, 1)[0] as ServerMessage & { type: T });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `等待消息 ${type} 超时（已有：${this.messages.map((m) => m.type).join(',')}）`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push({
        predicate: (m) => m.type === type,
        resolve: (m) => resolve(m as ServerMessage & { type: T }),
        timer,
      });
    });
  }
}

async function restCreate(): Promise<{ code: string; token: string }> {
  const res = await fetch(`${base}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`create 失败: ${res.status}`);
  return (await res.json()) as { code: string; token: string };
}

async function restJoin(code: string): Promise<{ token: string }> {
  const res = await fetch(`${base}/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`join 失败: ${res.status}`);
  return (await res.json()) as { token: string };
}

describe('WS 端到端（双客户端）', () => {
  test('完整流程：加入、心跳、文本、信令、中转上传下载、即删、离开', async () => {
    const room = await restCreate();
    const a = await WsClient.connect();
    a.send({ type: 'hello', token: room.token });
    const joinedA = await a.expectType('joined');
    expect(joinedA.room).toMatchObject({ code: room.code, status: 'waiting' });
    expect(joinedA.peer).toBeNull();

    const joinB = await restJoin(room.code);
    const b = await WsClient.connect();
    b.send({ type: 'hello', token: joinB.token });
    const joinedB = await b.expectType('joined');
    expect(joinedB.room.status).toBe('active');
    expect(joinedB.peer).toEqual({ nickname: null });
    const peerJoined = await a.expectType('peer-joined');
    expect(peerJoined.peer).toEqual({ nickname: null });

    // 心跳
    a.send({ type: 'ping' });
    await a.expectType('pong');

    // 文本
    a.send({ type: 'text', id: 'm1', content: '你好，世界' });
    const text = await b.expectType('text');
    expect(text).toMatchObject({ id: 'm1', content: '你好，世界', from: { nickname: null } });

    // 信令透传
    a.send({ type: 'signal', payload: { kind: 'offer', sdp: 'v=0 fake' } });
    const signal = await b.expectType('signal');
    expect(signal.payload).toEqual({ kind: 'offer', sdp: 'v=0 fake' });

    // 中转：offer → 分片上传 → relay-notify → Range 下载 → 即删回执
    const meta = { fileId: 'file-e2e', name: '你好.txt', size: 11, mime: 'text/plain' };
    a.send({ type: 'file-offer', file: meta, channel: 'relay' });
    const offer = await b.expectType('file-offer');
    expect(offer).toMatchObject({ file: meta, channel: 'relay', from: { nickname: null } });

    const upload = async (query: string, body: string) => {
      const res = await fetch(`${base}/relay/rooms/${room.code}/files?${query}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${room.token}` },
        body,
      });
      if (!res.ok) throw new Error(`上传失败 ${res.status}: ${await res.text()}`);
      return (await res.json()) as { received: number };
    };
    expect(await upload('fileId=file-e2e&offset=0', 'hello ')).toEqual({ received: 6 });
    expect(await upload('fileId=file-e2e&offset=6&done=1', 'world')).toEqual({ received: 11 });

    const notify = await b.expectType('relay-notify');
    expect(notify.file).toEqual(meta);

    const dl = await fetch(`${base}/relay/files/file-e2e`, {
      headers: { authorization: `Bearer ${joinB.token}`, range: 'bytes=0-4' },
    });
    expect(dl.status).toBe(206);
    expect(await dl.text()).toBe('hello');

    b.send({ type: 'relay-downloaded', fileId: 'file-e2e' });
    await a.expectType('file-complete');
    const gone = await fetch(`${base}/relay/files/file-e2e`, {
      headers: { authorization: `Bearer ${joinB.token}` },
    });
    expect(gone.status).toBe(404);

    // 离开：房间销毁，对方收到 room-closed
    a.send({ type: 'leave' });
    const closed = await b.expectType('room-closed');
    expect(closed.reason).toBe('manual');
    expect(ctx.destroyedRooms).toContain(room.code);
    b.ws.close();
  }, 15_000);

  test('未 hello 先发消息 → UNAUTHORIZED 错误', async () => {
    const c = await WsClient.connect();
    c.send({ type: 'text', id: 'x', content: 'hi' });
    const err = await c.expectType('error');
    expect(err.code).toBe('UNAUTHORIZED');
    c.ws.close();
  });

  test('非法 token hello → UNAUTHORIZED 并断开', async () => {
    const c = await WsClient.connect();
    c.send({ type: 'hello', token: 'not-a-token' });
    const err = await c.expectType('error');
    expect(err.code).toBe('UNAUTHORIZED');
    c.ws.close();
  });

  test('对方未在线：文本收到 PEER_OFFLINE', async () => {
    const room = await restCreate();
    const a = await WsClient.connect();
    a.send({ type: 'hello', token: room.token });
    await a.expectType('joined');
    a.send({ type: 'text', id: 'm1', content: '有人吗' });
    const err = await a.expectType('error');
    expect(err.code).toBe('PEER_OFFLINE');
    a.ws.close();
  });

  test('断线重连：peer-left → 重新 hello → peer-joined；补发错过的 relay-notify', async () => {
    const room = await restCreate();
    const joinB = await restJoin(room.code);
    const a = await WsClient.connect();
    a.send({ type: 'hello', token: room.token });
    await a.expectType('joined');
    const b = await WsClient.connect();
    b.send({ type: 'hello', token: joinB.token });
    await b.expectType('joined');
    await a.expectType('peer-joined');

    // B 掉线
    b.ws.close();
    const left = await a.expectType('peer-left');
    expect(left.reason).toBe('disconnect');

    // B 掉线期间 A 完成一次中转上传
    const meta = {
      fileId: 'file-off',
      name: 'offline.bin',
      size: 4,
      mime: 'application/octet-stream',
    };
    a.send({ type: 'file-offer', file: meta, channel: 'relay' });
    const res = await fetch(
      `${base}/relay/rooms/${room.code}/files?fileId=file-off&offset=0&done=1`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${room.token}` },
        body: 'abcd',
      },
    );
    expect(res.ok).toBeTrue();

    // B 用原 token 重连（宽限期内）
    const b2 = await WsClient.connect();
    b2.send({ type: 'hello', token: joinB.token });
    const rejoined = await b2.expectType('joined');
    expect(rejoined.room.status).toBe('active');
    const pending = await b2.expectType('relay-notify');
    expect(pending.file).toEqual(meta);
    await a.expectType('peer-joined');

    // 离开收敛
    a.send({ type: 'leave' });
    await b2.expectType('room-closed');
    b2.ws.close();
  }, 15_000);

  test('连续非法消息超限后连接被关闭', async () => {
    const room = await restCreate();
    const a = await WsClient.connect();
    a.send({ type: 'hello', token: room.token });
    await a.expectType('joined');
    const closed = new Promise<void>((resolve) => {
      a.ws.onclose = () => resolve();
    });
    for (let i = 0; i < 12; i++) {
      a.ws.send('this is not json');
    }
    await closed;
    a.send({ type: 'ping' }); // 已关闭的 socket，send 应静默失败或抛错均可
    expect(ctx.rooms.statusOf(room.code)).toBe('waiting');
  }, 10_000);
});
