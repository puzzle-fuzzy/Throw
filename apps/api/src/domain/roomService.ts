import { LIMITS, type PeerInfo, type RoomInfo, type ServerMessage } from '@throw/contracts';
import { errors } from './errors';

/** 测试可替换的最小 socket 接口（生产为 Elysia 的 ElysiaWS 包装）。
 *  Elysia 每个 ws 事件都会创建新包装对象，连接身份一律用 id 判等。 */
export interface MemberSocket {
  readonly id: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Member {
  token: string;
  nickname: string | null;
  role: 'creator' | 'joiner';
  ws: MemberSocket | null;
  lastSeenAt: number;
  createdAt: number;
  /** null = 从未断线（REST 创建/加入后尚未 hello，或当前在线） */
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  state: 'waiting' | 'active' | 'closed';
  createdAt: number;
  lastActiveAt: number;
  members: Member[];
}

export interface RoomServiceDeps {
  now: () => number;
  generateCode: () => string;
  generateToken: () => string;
  /** 房间销毁回调（清理中转文件等）；ageMs 为房间存活时长 */
  onRoomDestroyed: (
    code: string,
    reason: 'manual' | 'expired',
    ageMs: number,
  ) => void | Promise<void>;
}

/**
 * 房间状态机（内存态）：
 * waiting --join--> active --destroy(manual|expired)--> 移出注册表
 * 成员断线进入宽限（GRACE_MS），期内重连恢复身份；超时移除。
 * waiting 超时未加入（WAITING_EXPIRE_MS）或房间达到绝对寿命即销毁。
 */
export class RoomService {
  private rooms = new Map<string, Room>();
  private byToken = new Map<string, { room: Room; member: Member }>();

  constructor(private deps: RoomServiceDeps) {}

  createRoom(nickname: string | null): { code: string; token: string; expiresAt: number } {
    const now = this.deps.now();
    let code = this.deps.generateCode();
    for (let guard = 0; this.rooms.has(code); guard++) {
      if (guard >= 50) throw new Error('房间码生成冲突过多');
      code = this.deps.generateCode();
    }
    const token = this.deps.generateToken();
    const room: Room = {
      code,
      state: 'waiting',
      createdAt: now,
      lastActiveAt: now,
      members: [
        {
          token,
          nickname,
          role: 'creator',
          ws: null,
          lastSeenAt: now,
          createdAt: now,
          disconnectedAt: null,
        },
      ],
    };
    this.rooms.set(code, room);
    this.byToken.set(token, { room, member: room.members[0]! });
    return { code, token, expiresAt: this.expiresAtOf(room) };
  }

  joinRoom(code: string, nickname: string | null): { token: string; expiresAt: number } {
    const room = this.rooms.get(code);
    if (!room || room.state === 'closed') throw errors.roomClosed();
    if (room.state === 'active' || room.members.length >= 2) throw errors.roomFull();
    const now = this.deps.now();
    const token = this.deps.generateToken();
    const member: Member = {
      token,
      nickname,
      role: 'joiner',
      ws: null,
      lastSeenAt: now,
      createdAt: now,
      disconnectedAt: null,
    };
    room.members.push(member);
    room.state = 'active';
    room.lastActiveAt = now;
    this.byToken.set(token, { room, member });
    return { token, expiresAt: this.expiresAtOf(room) };
  }

  statusOf(code: string): 'waiting' | 'active' | 'closed' {
    const room = this.rooms.get(code);
    if (!room || room.state === 'closed') return 'closed';
    return room.state;
  }

  getRoom(code: string): Room | null {
    return this.rooms.get(code) ?? null;
  }

  findByToken(token: string): { room: Room; member: Member } | null {
    return this.byToken.get(token) ?? null;
  }

  peerOf(room: Room, member: Member): Member | null {
    if (room.members.length < 2) return null;
    return room.members.find((m) => m !== member) ?? null;
  }

  touchMember(member: Member): void {
    member.lastSeenAt = this.deps.now();
  }

  /** hello：绑定 socket。token 无效或房间已关返回 null。 */
  attach(token: string, ws: MemberSocket): { room: Room; member: Member } | null {
    const found = this.byToken.get(token);
    if (!found || found.room.state === 'closed') return null;
    const { room, member } = found;
    const now = this.deps.now();
    if (member.ws && member.ws.id !== ws.id) {
      member.ws.close(4000, 'replaced');
    }
    member.ws = ws;
    member.lastSeenAt = now;
    member.disconnectedAt = null;
    room.lastActiveAt = now;
    return found;
  }

  /** socket 断开：进入宽限期（由 WS close 事件调用） */
  detach(member: Member): void {
    member.ws = null;
    member.disconnectedAt = this.deps.now();
  }

  /** 任一成员主动离开：销毁房间（PRODUCT：任一方离开即销毁） */
  leave(token: string): void {
    const found = this.byToken.get(token);
    if (!found) return;
    this.destroy(found.room.code, 'manual');
  }

  destroy(code: string, reason: 'manual' | 'expired'): void {
    const room = this.rooms.get(code);
    if (!room || room.state === 'closed') return;
    room.state = 'closed';
    const msg: ServerMessage = { type: 'room-closed', reason };
    for (const member of room.members) {
      if (member.ws) {
        member.ws.send(JSON.stringify(msg));
        member.ws.close(1000, 'room closed');
        member.ws = null;
      }
      member.disconnectedAt = this.deps.now();
      this.byToken.delete(member.token);
    }
    this.rooms.delete(code);
    void this.deps.onRoomDestroyed(code, reason, this.deps.now() - room.createdAt);
  }

  sendTo(member: Member, msg: ServerMessage): boolean {
    if (!member.ws) return false;
    member.ws.send(JSON.stringify(msg));
    return true;
  }

  broadcastCode(code: string, msg: ServerMessage): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const member of room.members) {
      this.sendTo(member, msg);
    }
  }

  peerInfo(member: Member): PeerInfo {
    return { nickname: member.nickname };
  }

  roomInfo(room: Room): RoomInfo {
    if (room.state === 'closed') throw new Error('roomInfo 不适用于已关闭房间');
    return { code: room.code, status: room.state, expiresAt: this.expiresAtOf(room) };
  }

  expiresAtOf(room: Room): number {
    return room.state === 'waiting'
      ? room.createdAt + LIMITS.WAITING_EXPIRE_MS
      : room.createdAt + LIMITS.ROOM_ABSOLUTE_MAX_AGE_MS;
  }

  /**
   * 周期清扫（返回被销毁的房间码，供日志）。
   * 心跳超时的连接只负责 close，断线/宽限状态由 close 事件与下一轮 sweep 收敛。
   */
  sweep(): string[] {
    const now = this.deps.now();
    const destroyed: string[] = [];
    for (const room of [...this.rooms.values()]) {
      for (const member of room.members) {
        if (member.ws && now - member.lastSeenAt > LIMITS.HEARTBEAT_TIMEOUT_MS) {
          member.ws.close(4001, 'heartbeat timeout');
        }
      }
      // JOIN_GRACE：REST 创建/加入后始终没有 hello 的占位成员
      for (const member of [...room.members]) {
        if (
          !member.ws &&
          member.disconnectedAt === null &&
          now - member.createdAt > LIMITS.JOIN_GRACE_MS
        ) {
          this.removeMember(room, member);
        }
      }
      // GRACE：断线超过宽限仍未重连
      for (const member of [...room.members]) {
        if (
          !member.ws &&
          member.disconnectedAt !== null &&
          now - member.disconnectedAt > LIMITS.GRACE_MS
        ) {
          this.removeMember(room, member);
        }
      }
      const empty = room.members.length === 0;
      const waitingExpired =
        room.state === 'waiting' && now - room.createdAt > LIMITS.WAITING_EXPIRE_MS;
      const tooOld = now - room.createdAt > LIMITS.ROOM_ABSOLUTE_MAX_AGE_MS;
      if (empty || waitingExpired || tooOld) {
        this.destroy(room.code, 'expired');
        destroyed.push(room.code);
      }
    }
    return destroyed;
  }

  private removeMember(room: Room, member: Member): void {
    room.members = room.members.filter((m) => m !== member);
    this.byToken.delete(member.token);
    if (member.ws) {
      member.ws.close(1000, 'removed');
      member.ws = null;
    }
  }
}
