import { afterAll, describe, expect, test } from 'bun:test';
import { type FileMeta, LIMITS, type ServerMessage } from '@throw/contracts';
import { AppError } from '../src/domain/errors';
import { RelayService } from '../src/services/relayService';
import type { DiskRelayStorage } from '../src/services/relayStorage';
import type { TestContext } from './helpers';
import { makeContext } from './helpers';

const SMALL = {
  MAX_FILE_BYTES: 10,
  MAX_PENDING_FILES_PER_ROOM: 2,
  RELAY_CHUNK_MAX_BYTES: 4,
  RELAY_FILE_TTL_MS: 100,
};

let ctx: TestContext | null = null;
const contexts: TestContext[] = [];
afterAll(async () => {
  for (const c of contexts) {
    await c.storage.wipeAll();
  }
});

async function setup(): Promise<{
  relay: RelayService;
  notified: ServerMessage[];
  storage: DiskRelayStorage;
}> {
  ctx = await makeContext({ limits: SMALL });
  contexts.push(ctx);
  const notified: ServerMessage[] = [];
  // 单独构造以捕获通知
  const relay = new RelayService({
    storage: ctx.storage,
    now: () => Date.now(),
    notifyRoom: (code, msg) => {
      notified.push(msg);
      void code;
    },
    limits: { ...LIMITS, ...SMALL } as typeof LIMITS,
  });
  return { relay, notified, storage: ctx.storage };
}

function meta(fileId: string, size: number, name = 'f.bin'): FileMeta {
  return { fileId, name, size, mime: 'application/octet-stream' };
}

function bytes(n: number): Uint8Array {
  return new Uint8Array(Array.from({ length: n }, (_, i) => i));
}

describe('RelayService 中转', () => {
  test('元数据校验：超限与数量上限', async () => {
    const { relay } = await setup();
    expect(() =>
      relay.registerMeta('AAAAAA', meta('f1', SMALL.MAX_FILE_BYTES + 1), 's1'),
    ).toThrowError(AppError);
    relay.registerMeta('AAAAAA', meta('f1', 10), 's1');
    relay.registerMeta('AAAAAA', meta('f2', 10), 's1');
    expect(() => relay.registerMeta('AAAAAA', meta('f3', 10), 's1')).toThrowError(AppError);
    // 重复 offer 幂等
    relay.registerMeta('AAAAAA', meta('f1', 10), 's1');
  });

  test('分片上传 happy path 与幂等重试', async () => {
    const { relay, notified, storage } = await setup();
    relay.registerMeta('AAAAAA', meta('f1', 6), 's1');
    const first = await relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4));
    expect(first.received).toBe(4);
    // 同 offset 重试幂等
    const retry = await relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4));
    expect(retry.received).toBe(4);
    const second = await relay.putChunk('AAAAAA', 'f1', 's1', 4, bytes(2));
    expect(second.received).toBe(6);
    await relay.complete('AAAAAA', 'f1', 's1');
    expect(notified.at(-1)).toEqual({ type: 'relay-notify', file: meta('f1', 6) });
    expect(await storage.sizeOf('AAAAAA', 'f1')).toBe(6);
  });

  test('offset 非法 / 分片过大 / 累计超限 / 并发互斥', async () => {
    const { relay } = await setup();
    relay.registerMeta('AAAAAA', meta('f1', 10), 's1');
    await expect(relay.putChunk('AAAAAA', 'f1', 's1', 1, bytes(4))).rejects.toThrowError(AppError);
    await expect(relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(5))).rejects.toThrowError(AppError);
    await expect(relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4))).resolves.toEqual({
      received: 4,
    });
    await expect(relay.putChunk('AAAAAA', 'f1', 's1', 4, bytes(4))).resolves.toEqual({
      received: 8,
    });
    await expect(relay.putChunk('AAAAAA', 'f1', 's1', 8, bytes(4))).rejects.toThrowError(AppError);

    relay.registerMeta('AAAAAA', meta('f2', 10), 's2');
    await expect(relay.putChunk('AAAAAA', 'f2', 's2', 0, bytes(1))).rejects.toThrowError(AppError);
  });

  test('complete 前字节不足 → 拒绝', async () => {
    const { relay } = await setup();
    relay.registerMeta('AAAAAA', meta('f1', 6), 's1');
    await relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4));
    await expect(relay.complete('AAAAAA', 'f1', 's1')).rejects.toThrowError(AppError);
  });

  test('下载：未就绪 null、Range 206、416、全量 200', async () => {
    const { relay } = await setup();
    relay.registerMeta('AAAAAA', meta('f1', 6, '你好.txt'), 's1');
    expect(await relay.openDownload('f1', null)).toBeNull();
    await relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4));
    await relay.putChunk('AAAAAA', 'f1', 's1', 4, bytes(2));
    await relay.complete('AAAAAA', 'f1', 's1');

    const partial = await relay.openDownload('f1', 'bytes=1-3');
    expect(partial).toMatchObject({ range: { start: 1, end: 3 }, size: 6 });
    const suffix = await relay.openDownload('f1', 'bytes=-2');
    expect(suffix).toMatchObject({ range: { start: 4, end: 5 } });
    const open = await relay.openDownload('f1', 'bytes=4-');
    expect(open).toMatchObject({ range: { start: 4, end: 5 } });
    const unsat = await relay.openDownload('f1', 'bytes=9-12');
    expect(unsat).toEqual({ unsatisfiable: true, size: 6 });
    const full = await relay.openDownload('f1', null);
    expect(full).toMatchObject({ range: null, size: 6, meta: { name: '你好.txt' } });
  });

  test('relay-downloaded 即删 + 取消 + 房间清理 + TTL 清扫', async () => {
    // 即删
    const a = await setup();
    a.relay.registerMeta('AAAAAA', meta('f1', 6), 's1');
    await a.relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4));
    await a.relay.putChunk('AAAAAA', 'f1', 's1', 4, bytes(2));
    await a.relay.complete('AAAAAA', 'f1', 's1');
    const { senderToken } = await a.relay.markDownloaded('f1');
    expect(senderToken).toBe('s1');
    expect(await a.relay.openDownload('f1', null)).toBeNull();
    expect(await a.storage.sizeOf('AAAAAA', 'f1')).toBeNull();

    // 取消
    const b = await setup();
    b.relay.registerMeta('BBBBBB', meta('f1', 6), 's1');
    await b.relay.putChunk('BBBBBB', 'f1', 's1', 0, bytes(4));
    expect(await b.relay.cancel('BBBBBB', 'f1')).toBeTrue();
    expect(await b.relay.locate('f1')).toBeNull();

    // TTL
    const c = await setup();
    const notifiedC = c.notified;
    c.relay.registerMeta('CCCCCC', meta('f1', 6), 's1');
    await c.relay.putChunk('CCCCCC', 'f1', 's1', 0, bytes(4));
    await new Promise((r) => setTimeout(r, SMALL.RELAY_FILE_TTL_MS + 20));
    await c.relay.sweep();
    expect(notifiedC.at(-1)).toEqual({ type: 'file-cancel', fileId: 'f1' });
    expect(await c.relay.locate('f1')).toBeNull();

    // 房间销毁清理
    const d = await setup();
    d.relay.registerMeta('DDDDDD', meta('f1', 6), 's1');
    await d.relay.putChunk('DDDDDD', 'f1', 's1', 0, bytes(4));
    await d.relay.deleteRoomFiles('DDDDDD');
    expect(await d.relay.locate('f1')).toBeNull();
    expect(await d.storage.sizeOf('DDDDDD', 'f1')).toBeNull();
  });

  test('断线重连后补发 pending relay-notify', async () => {
    const { relay } = await setup();
    relay.registerMeta('AAAAAA', meta('f1', 6), 's1');
    relay.registerMeta('AAAAAA', meta('f2', 6), 's1');
    await relay.putChunk('AAAAAA', 'f1', 's1', 0, bytes(4));
    await relay.putChunk('AAAAAA', 'f1', 's1', 4, bytes(2));
    await relay.complete('AAAAAA', 'f1', 's1');
    const pending = relay.pendingNotifications('AAAAAA', 'receiver-token');
    expect(pending.map((f) => f.fileId)).toEqual(['f1']);
  });
});

describe('DiskRelayStorage', () => {
  test('路径参数防线与 marker 初始化', async () => {
    const context = await makeContext();
    contexts.push(context);
    const storage = context.storage;
    await expect(storage.putChunk('AAAAAA', '../escape', 0, bytes(1))).rejects.toThrowError(
      AppError,
    );
    await expect(storage.putChunk('bad/code', 'f1', 0, bytes(1))).rejects.toThrowError(AppError);
    await storage.putChunk('AAAAAA', 'f1', 0, bytes(2));
    await storage.putChunk('AAAAAA', 'f1', 2, bytes(2));
    expect(await storage.sizeOf('AAAAAA', 'f1')).toBe(4);
    // init 幂等（marker 存在时会清空重建）
    await storage.init();
    expect(await storage.sizeOf('AAAAAA', 'f1')).toBeNull();
  });
});
