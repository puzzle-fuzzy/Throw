import { type ClientMessage, LIMITS, type ServerMessage } from '@throw/contracts';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomSocketOptions {
  token: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus, attempt: number) => void;
  /** 房间已死（token 失效/房间关闭）时回调，不再重连 */
  onDead: (reason: 'unauthorized' | 'room-closed') => void;
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * 房间 WebSocket：hello 首帧鉴权、15s 心跳、断线指数退避重连（同 token 恢复身份，
 * 依赖服务端 5 分钟宽限）。room-closed / hello 被拒视为终态。
 */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private status: SocketStatus = 'connecting';
  private attempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dead = false;
  private intentionalClose = false;

  constructor(private readonly options: RoomSocketOptions) {}

  start(): void {
    if (this.ws || this.dead) return;
    this.connect();
  }

  get connected(): boolean {
    return this.status === 'open';
  }

  send(msg: ClientMessage): boolean {
    if (this.status !== 'open' || !this.ws) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** 主动离开/页面卸载：不重连 */
  close(): void {
    this.intentionalClose = true;
    this.dead = true;
    this.stopTimers();
    this.ws?.close(1000, 'client leave');
    this.ws = null;
    this.setStatus('closed');
  }

  private connect(): void {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', token: this.options.token } satisfies ClientMessage));
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'error' && (msg.code === 'UNAUTHORIZED' || msg.code === 'ROOM_CLOSED')) {
        this.dead = true;
        this.stopTimers();
        this.setStatus('closed');
        this.options.onDead(msg.code === 'UNAUTHORIZED' ? 'unauthorized' : 'room-closed');
        ws.close();
        return;
      }
      if (msg.type === 'joined') {
        this.attempt = 0;
        this.setStatus('open');
        this.startHeartbeat();
      }
      this.options.onMessage(msg);
    };
    ws.onclose = () => {
      this.stopHeartbeat();
      if (this.intentionalClose || this.dead) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose 随后触发，重连逻辑集中在 onclose
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = BACKOFF_STEPS_MS[Math.min(this.attempt, BACKOFF_STEPS_MS.length - 1)]!;
    this.attempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'open' && this.ws) {
        this.ws.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
      }
    }, LIMITS.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus(status, this.attempt);
  }
}
