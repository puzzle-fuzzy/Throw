import { describe, expect, test } from 'bun:test';
import { LIMITS } from '@throw/contracts';
import { AppError } from '../src/domain/errors';
import type { MemberSocket } from '../src/domain/roomService';
import { RoomService } from '../src/domain/roomService';

type FakeWs = MemberSocket & { sent: string[]; closedWith: number | null };
let fakeWsSeq = 0;

function fakeWs(): FakeWs {
  return {
    id: `fake-ws-${++fakeWsSeq}`,
    sent: [],
    closedWith: null,
    send(data) {
      this.sent.push(data);
    },
    close(code) {
      this.closedWith = code ?? 0;
    },
  };
}

function makeService() {
  let t = 1_000_000_000_000;
  let seq = 0;
  const destroyed: string[] = [];
  const CODES = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'];
  const service = new RoomService({
    now: () => t,
    generateCode: () => CODES[seq++ % CODES.length]!,
    generateToken: () => `tok-${seq}`,
    onRoomDestroyed: (code) => {
      destroyed.push(code);
    },
  });
  return {
    service,
    destroyed,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
}

describe('RoomService 状态机', () => {
  test('创建 → waiting，创建者持有 token', () => {
    const { service } = makeService();
    const created = service.createRoom('小明');
    expect(created.code).toBe('AAAAAA');
    expect(service.statusOf(created.code)).toBe('waiting');
    const found = service.findByToken(created.token);
    expect(found?.member.role).toBe('creator');
    expect(found?.member.nickname).toBe('小明');
  });

  test('join → active；第三人被拒', () => {
    const { service } = makeService();
    const created = service.createRoom(null);
    service.joinRoom(created.code, '小红');
    expect(service.statusOf(created.code)).toBe('active');
    expect(() => service.joinRoom(created.code, '第三者')).toThrowError(AppError);
    try {
      service.joinRoom(created.code, '第三者');
    } catch (error) {
      expect((error as AppError).code).toBe('ROOM_FULL');
    }
  });

  test('join 不存在的房间 → ROOM_CLOSED', () => {
    const { service } = makeService();
    try {
      service.joinRoom('ZZZZZZ', 'x');
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('ROOM_CLOSED');
    }
  });

  test('attach/detach/重连：宽限期内恢复身份', () => {
    const { service, advance } = makeService();
    const created = service.createRoom(null);
    const joined = service.joinRoom(created.code, null);
    const wsA = fakeWs();
    const wsB = fakeWs();
    expect(service.attach(created.token, wsA)).not.toBeNull();
    expect(service.attach(joined.token, wsB)).not.toBeNull();

    service.detach(service.findByToken(joined.token)!.member);
    advance(LIMITS.GRACE_MS - 1);
    const re = service.attach(joined.token, fakeWs());
    expect(re).not.toBeNull();
    expect(re?.member.disconnectedAt).toBeNull();
  });

  test('同 token 重复 attach 替换旧连接', () => {
    const { service } = makeService();
    const created = service.createRoom(null);
    const wsOld = fakeWs();
    service.attach(created.token, wsOld);
    const wsNew = fakeWs();
    service.attach(created.token, wsNew);
    expect(wsOld.closedWith).toBe(4000);
    const member = service.findByToken(created.token)!.member;
    expect(member.ws).toBe(wsNew);
  });

  test('leave：房间销毁，token 失效，触发清理回调', () => {
    const { service, destroyed } = makeService();
    const created = service.createRoom(null);
    service.joinRoom(created.code, null);
    service.leave(created.token);
    expect(service.statusOf(created.code)).toBe('closed');
    expect(service.findByToken(created.token)).toBeNull();
    expect(destroyed).toEqual([created.code]);
  });

  test('sweep：未 hello 的占位成员超 JOIN_GRACE 后房间销毁', () => {
    const { service, advance, destroyed } = makeService();
    const created = service.createRoom(null);
    advance(LIMITS.JOIN_GRACE_MS + 1);
    service.sweep();
    expect(destroyed).toContain(created.code);
    expect(service.statusOf(created.code)).toBe('closed');
  });

  test('sweep：断线超宽限 → 成员移除；双方移除 → 房间销毁', () => {
    const { service, advance, destroyed } = makeService();
    const created = service.createRoom(null);
    const joined = service.joinRoom(created.code, null);
    service.attach(created.token, fakeWs());
    const wsB = fakeWs();
    service.attach(joined.token, wsB);
    service.detach(service.findByToken(created.token)!.member);
    service.detach(service.findByToken(joined.token)!.member);
    advance(LIMITS.GRACE_MS + 1);
    service.sweep();
    expect(destroyed).toContain(created.code);
  });

  test('sweep：心跳超时连接被关闭', () => {
    const { service, advance } = makeService();
    const created = service.createRoom(null);
    const ws = fakeWs();
    service.attach(created.token, ws);
    advance(LIMITS.HEARTBEAT_TIMEOUT_MS + 1);
    service.sweep();
    expect(ws.closedWith).toBe(4001);
  });

  test('sweep：waiting 超时销毁；绝对寿命封顶', () => {
    const { service, advance, destroyed } = makeService();
    const waiting = service.createRoom(null);
    service.attach(waiting.token, fakeWs());
    advance(LIMITS.WAITING_EXPIRE_MS + 1);
    service.sweep();
    expect(destroyed).toContain(waiting.code);

    const other = service.createRoom(null);
    const joined = service.joinRoom(other.code, null);
    service.attach(other.token, fakeWs());
    service.attach(joined.token, fakeWs());
    advance(LIMITS.ROOM_ABSOLUTE_MAX_AGE_MS + 1);
    service.sweep();
    expect(destroyed).toContain(other.code);
  });

  test('传输空闲 30 分钟销毁，传输活动续期', () => {
    const { service, advance, destroyed } = makeService();
    const created = service.createRoom(null);
    const joined = service.joinRoom(created.code, null);
    service.attach(created.token, fakeWs());
    service.attach(joined.token, fakeWs());

    // 无任何传输活动：30 分钟后销毁
    advance(LIMITS.TRANSFER_IDLE_EXPIRE_MS + 1);
    service.sweep();
    expect(destroyed).toContain(created.code);

    // 有传输活动：空闲计时从最后一次活动重新起算
    const room2 = service.createRoom(null);
    const join2 = service.joinRoom(room2.code, null);
    service.attach(room2.token, fakeWs());
    service.attach(join2.token, fakeWs());
    advance(20 * 60_000);
    const roomObj = service.getRoom(room2.code)!;
    service.touchTransfer(roomObj);
    advance(29 * 60_000);
    service.sweep();
    expect(destroyed).not.toContain(room2.code);
    advance(2 * 60_000);
    service.sweep();
    expect(destroyed).toContain(room2.code);
  });

  test('expiresAt：waiting 用 2h；active 锚定最后一次传输活动并受绝对寿命约束', () => {
    const { service, advance } = makeService();
    const created = service.createRoom(null);
    const base = service.expiresAtOf(service.getRoom(created.code)!);
    expect(base - (base - LIMITS.WAITING_EXPIRE_MS)).toBe(LIMITS.WAITING_EXPIRE_MS);

    const joined = service.joinRoom(created.code, null);
    advance(10 * 60_000);
    const roomObj = service.getRoom(created.code)!;
    const idleAnchor = service.expiresAtOf(roomObj);
    expect(idleAnchor).toBe(roomObj.lastTransferAt + LIMITS.TRANSFER_IDLE_EXPIRE_MS);

    // 接近绝对寿命时取小
    advance(LIMITS.ROOM_ABSOLUTE_MAX_AGE_MS);
    service.touchTransfer(service.getRoom(created.code)!);
    const capped = service.expiresAtOf(service.getRoom(created.code)!);
    expect(capped).toBe(roomObj.createdAt + LIMITS.ROOM_ABSOLUTE_MAX_AGE_MS);
    expect(joined.token).toBeTruthy();
  });
});
