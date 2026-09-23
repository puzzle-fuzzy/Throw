import { Value } from '@sinclair/typebox/value';
import {
  type ClientMessage,
  ClientMessageSchema,
  LIMITS,
  type ServerMessage,
} from '@throw/contracts';
import type { Member, RoomService } from '../domain/roomService';
import { codeHash } from '../http';
import type { Logger } from '../log';
import type { RelayService } from '../services/relayService';

/** Elysia WS 边界的最小结构（生产为 ElysiaWS；注意 Elysia 每个事件都会新建包装对象，身份用 id 判等） */
export interface HubSocket {
  readonly id: string;
  data: WsData;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WsData {
  auth?: { code: string; token: string };
  invalidCount: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

function errorJson(code: string, message: string): string {
  return JSON.stringify({ type: 'error', code, message } satisfies ServerMessage);
}

export interface WsHubDeps {
  rooms: RoomService;
  relay: RelayService;
  logger: Logger;
}

/** WS 连接生命周期 + ClientMessage 分发 */
export class WsHub {
  constructor(private deps: WsHubDeps) {}

  onOpen(ws: HubSocket): void {
    ws.data.invalidCount = 0;
    ws.data.helloTimer = setTimeout(() => {
      if (!ws.data.auth) ws.close(4001, 'hello timeout');
    }, LIMITS.HELLO_TIMEOUT_MS);
  }

  onMessage(ws: HubSocket, raw: unknown): void {
    let parsed: unknown;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.invalid(ws, '消息不是合法 JSON');
        return;
      }
    } else if (typeof raw === 'object' && raw !== null) {
      parsed = raw; // Elysia ws 层已把 JSON 文本帧解析为对象
    } else {
      this.invalid(ws, '仅接受 JSON 文本帧');
      return;
    }
    if (!Value.Check(ClientMessageSchema, parsed)) {
      this.invalid(ws, '消息不符合协议');
      return;
    }
    const msg = parsed as ClientMessage;
    if (msg.type === 'hello') {
      this.hello(ws, msg.token);
      return;
    }
    const auth = ws.data.auth;
    if (!auth) {
      ws.send(errorJson('UNAUTHORIZED', '请先发送 hello'));
      return;
    }
    const found = this.deps.rooms.findByToken(auth.token);
    if (!found) {
      ws.data.auth = undefined;
      ws.send(errorJson('ROOM_CLOSED', '房间已关闭'));
      ws.close(1000, 'room closed');
      return;
    }
    const { member } = found;
    this.deps.rooms.touchMember(member);
    try {
      this.dispatch(ws, msg, member.token);
    } catch (error) {
      // AppError → 单条 error 消息；未知异常不 断连接
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : '处理失败';
      ws.send(errorJson(code ?? 'INTERNAL', message));
      if (!code) this.deps.logger.error({ err: message }, 'ws 消息处理异常');
    }
  }

  onClose(ws: HubSocket): void {
    if (ws.data.helloTimer) {
      clearTimeout(ws.data.helloTimer);
      ws.data.helloTimer = null;
    }
    const auth = ws.data.auth;
    if (!auth) return;
    const found = this.deps.rooms.findByToken(auth.token);
    if (!found) return;
    const { room, member } = found;
    if (!member.ws) return; // 已被新连接替换或事件乱序
    if (member.ws.id !== ws.id) {
      this.deps.logger.info(
        { event: 'ws.replaced', room: codeHash(room.code) },
        '旧连接被替换关闭',
      );
      return;
    }
    this.deps.rooms.detach(member);
    this.deps.logger.info(
      { event: 'ws.close', room: codeHash(room.code), role: member.role },
      'WS 成员断线（进入宽限）',
    );
    const peer = this.deps.rooms.peerOf(room, member);
    if (peer) {
      this.deps.rooms.sendTo(peer, { type: 'peer-left', reason: 'disconnect' });
    }
  }

  private hello(ws: HubSocket, token: string): void {
    if (ws.data.helloTimer) {
      clearTimeout(ws.data.helloTimer);
      ws.data.helloTimer = null;
    }
    const found = this.deps.rooms.attach(token, ws);
    if (!found) {
      this.deps.logger.warn({ event: 'ws.hello.denied' }, 'WS hello 被拒绝');
      ws.send(errorJson('UNAUTHORIZED', 'token 无效或房间已关闭'));
      ws.close(4001, 'unauthorized');
      return;
    }
    const { room, member } = found;
    this.deps.logger.info(
      { event: 'ws.hello', room: codeHash(room.code), role: member.role },
      'WS 成员上线',
    );
    ws.data.auth = { code: room.code, token: member.token };
    const peer = this.deps.rooms.peerOf(room, member);
    ws.send(
      JSON.stringify({
        type: 'joined',
        room: this.deps.rooms.roomInfo(room),
        peer: peer ? this.deps.rooms.peerInfo(peer) : null,
      } satisfies ServerMessage),
    );
    if (peer?.ws) {
      this.deps.rooms.sendTo(peer, {
        type: 'peer-joined',
        peer: this.deps.rooms.peerInfo(member),
      });
    }
    // 断线期间错过 relay-notify 的成员补发
    for (const file of this.deps.relay.pendingNotifications(room.code, member.token)) {
      ws.send(JSON.stringify({ type: 'relay-notify', file } satisfies ServerMessage));
    }
  }

  private dispatch(ws: HubSocket, msg: ClientMessage, token: string): void {
    const found = this.deps.rooms.findByToken(token);
    if (!found) return;
    const { room, member } = found;
    const peer = this.deps.rooms.peerOf(room, member);
    switch (msg.type) {
      case 'ping':
        ws.send('{"type":"pong"}');
        return;
      case 'signal':
        this.forwardOrOffline(ws, peer, { type: 'signal', payload: msg.payload });
        return;
      case 'text':
        this.forwardOrOffline(ws, peer, {
          type: 'text',
          id: msg.id,
          from: this.deps.rooms.peerInfo(member),
          content: msg.content,
        });
        return;
      case 'file-offer': {
        if (msg.channel === 'relay') {
          this.deps.relay.registerMeta(room.code, msg.file, member.token);
        }
        this.forwardOrOffline(ws, peer, {
          type: 'file-offer',
          file: msg.file,
          channel: msg.channel,
          from: this.deps.rooms.peerInfo(member),
        });
        return;
      }
      case 'file-cancel': {
        if (peer) {
          this.deps.rooms.sendTo(peer, { type: 'file-cancel', fileId: msg.fileId });
        }
        void this.deps.relay.cancel(room.code, msg.fileId);
        return;
      }
      case 'relay-downloaded': {
        const result = this.deps.relay
          .markDownloaded(msg.fileId)
          .then(({ senderToken }) => {
            const sender = senderToken ? this.deps.rooms.findByToken(senderToken) : null;
            if (sender) {
              this.deps.rooms.sendTo(sender.member, {
                type: 'file-complete',
                fileId: msg.fileId,
              });
            }
          })
          .catch((error: unknown) => {
            this.deps.logger.error({ err: String(error) }, 'markDownloaded 失败');
          });
        void result;
        return;
      }
      case 'leave':
        this.deps.rooms.leave(member.token);
        return;
      case 'hello':
        return; // 已在 onMessage 处理
    }
  }

  private forwardOrOffline(ws: HubSocket, peer: Member | null, msg: ServerMessage): void {
    if (peer?.ws) {
      peer.ws.send(JSON.stringify(msg));
    } else {
      ws.send(errorJson('PEER_OFFLINE', '对方不在线，消息未送达'));
    }
  }

  private invalid(ws: HubSocket, message: string): void {
    ws.data.invalidCount += 1;
    this.deps.logger.warn(
      { event: 'ws.invalid', count: ws.data.invalidCount },
      `非法 WS 消息：${message}`,
    );
    if (ws.data.invalidCount > LIMITS.MAX_INVALID_MESSAGES) {
      ws.close(4003, 'too many invalid messages');
      return;
    }
    ws.send(errorJson('INVALID_MESSAGE', message));
  }
}
