import type { SignalPayload } from '@throw/contracts';

/** 二进制帧头 12 字节：u32 fileId 哈希 + u32 序号 + u32 载荷长度（均 LE）；hash 0 保留给探测 */
export const HEADER_BYTES = 12;
const PROBE_HASH = 0;

export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function encodeFrame(hash: number, seq: number, payload: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + payload.byteLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, hash >>> 0, true);
  view.setUint32(4, seq >>> 0, true);
  view.setUint32(8, payload.byteLength, true);
  bytes.set(payload, HEADER_BYTES);
  return buffer;
}

export interface DecodedFrame {
  hash: number;
  seq: number;
  payload: ArrayBuffer;
}

export function decodeFrame(data: ArrayBuffer): DecodedFrame | null {
  if (data.byteLength < HEADER_BYTES) return null;
  const view = new DataView(data);
  const hash = view.getUint32(0, true);
  const seq = view.getUint32(4, true);
  const len = view.getUint32(8, true);
  if (HEADER_BYTES + len !== data.byteLength) return null;
  return { hash, seq, payload: data.slice(HEADER_BYTES, HEADER_BYTES + len) };
}

export interface ControlMessage {
  t: 'begin' | 'ack' | 'done' | 'cancel' | 'probe-ack';
  h?: number;
  /** 已接收字节数 */
  b?: number;
  fileId?: string;
  size?: number;
}

export type PeerLinkState = 'new' | 'connecting' | 'open' | 'failed' | 'closed';

export interface PeerLinkEvents {
  onSignal: (payload: SignalPayload) => void;
  onData: (frame: DecodedFrame) => void;
  onControl: (control: ControlMessage) => void;
  onStateChange: (state: PeerLinkState) => void;
}

export interface PeerLinkOptions {
  /** true = 本端发起 offer（首个 P2P 发送方） */
  initiator: boolean;
  /** ICE 建立超时 */
  openTimeoutMs?: number;
}

/** 公共 STUN（无 TURN：打洞失败按设计回退中转）。??relay 调试参数可禁用 STUN 仅用 host 候选 */
const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** 单条 WebRTC 连接（每房间至多一条，双方向共用）。信令经 WS 透传。 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private state: PeerLinkState = 'new';
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteReady = false;

  constructor(
    private readonly events: PeerLinkEvents,
    private readonly options: PeerLinkOptions,
  ) {
    const hostOnly = new URLSearchParams(location.search).has('hostonly');
    this.pc = new RTCPeerConnection({ iceServers: hostOnly ? [] : STUN_SERVERS });
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.events.onSignal({
          kind: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        });
      }
    };
    this.pc.onconnectionstatechange = () => {
      const cs = this.pc.connectionState;
      if (cs === 'connected') {
        // DataChannel open 才算可用；这里只做日志级状态
      } else if (cs === 'failed') {
        this.setState('failed');
      } else if (cs === 'closed' || cs === 'disconnected') {
        this.setState('closed');
      }
    };
    if (this.options.initiator) {
      this.dc = this.pc.createDataChannel('throw', { ordered: true });
      this.bindChannel(this.dc);
      void this.makeOffer();
    }
  }

  get isOpen(): boolean {
    return this.state === 'open' && this.dc?.readyState === 'open';
  }

  /** failed/closed 后不可复用，需重建 */
  get isDead(): boolean {
    return this.state === 'failed' || this.state === 'closed';
  }

  get isInitiator(): boolean {
    return this.options.initiator;
  }

  /** 当前信令状态：'have-remote-offer' 表示正在应答某条 offer */
  get signaling(): RTCSignalingState {
    return this.pc.signalingState;
  }

  get dataChannel(): RTCDataChannel | null {
    return this.dc;
  }

  private setState(state: PeerLinkState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange(state);
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    channel.onopen = () => {
      if (this.openTimeout) {
        clearTimeout(this.openTimeout);
        this.openTimeout = null;
      }
      this.setState('open');
    };
    channel.onclose = () => this.setState('closed');
    channel.onerror = () => {
      if (this.state !== 'open') this.setState('failed');
    };
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          this.events.onControl(JSON.parse(event.data) as ControlMessage);
        } catch {
          // 忽略无法解析的控制帧
        }
        return;
      }
      const frame = decodeFrame(event.data as ArrayBuffer);
      if (frame) this.events.onData(frame);
    };
  }

  private async makeOffer(): Promise<void> {
    this.setState('connecting');
    this.openTimeout = setTimeout(() => {
      if (this.state !== 'open') this.setState('failed');
    }, this.options.openTimeoutMs ?? 8000);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const offerSdp = this.pc.localDescription?.sdp;
    if (offerSdp) this.events.onSignal({ kind: 'offer', sdp: offerSdp });
  }

  /** 处理对端信令（answerer 在收到 offer 时建立应答端） */
  async handleSignal(payload: SignalPayload, ensureAnswerer: () => PeerLink): Promise<void> {
    switch (payload.kind) {
      case 'offer': {
        const link = !this.dc ? ensureAnswerer() : this;
        await link.acceptOffer(payload.sdp);
        return;
      }
      case 'answer': {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
          this.remoteReady = true;
          await this.flushCandidates();
        }
        return;
      }
      case 'candidate': {
        const candidate: RTCIceCandidateInit = {
          candidate: payload.candidate,
          sdpMid: payload.sdpMid ?? null,
        };
        if (!this.remoteReady) {
          this.pendingCandidates.push(candidate);
          return;
        }
        await this.pc.addIceCandidate(candidate).catch(() => {});
      }
    }
  }

  async acceptOffer(sdp: string): Promise<void> {
    if (!this.dc) {
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.bindChannel(this.dc);
      };
    }
    this.setState('connecting');
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    this.remoteReady = true;
    await this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    const answerSdp = this.pc.localDescription?.sdp;
    if (answerSdp) this.events.onSignal({ kind: 'answer', sdp: answerSdp });
  }

  private async flushCandidates(): Promise<void> {
    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  sendBinary(frame: ArrayBuffer): void {
    if (!this.isOpen || !this.dc) throw new Error('DataChannel 未就绪');
    this.dc.send(frame);
  }

  sendControl(control: ControlMessage): void {
    if (!this.isOpen || !this.dc) throw new Error('DataChannel 未就绪');
    this.dc.send(JSON.stringify(control));
  }

  /** 背压等待：缓冲高于阈值时等 bufferedamountlow */
  async waitDrain(highWaterBytes = 4 * 1024 * 1024): Promise<void> {
    const dc = this.dc;
    if (!dc) return;
    if (dc.bufferedAmount < highWaterBytes) return;
    await new Promise<void>((resolve) => {
      const onLow = () => {
        dc.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      dc.addEventListener('bufferedamountlow', onLow);
    });
  }

  /** 等待通道就绪（超时/失败返回 false） */
  waitOpen(timeoutMs = 8000): Promise<boolean> {
    if (this.isOpen) return Promise.resolve(true);
    if (this.state === 'failed' || this.state === 'closed') return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(interval);
        resolve(value);
      };
      const interval = setInterval(() => {
        if (this.isOpen) finish(true);
        else if (this.state === 'failed' || this.state === 'closed') finish(false);
      }, 50);
      const timer = setTimeout(() => finish(this.isOpen), timeoutMs);
    });
  }

  close(): void {
    if (this.openTimeout) clearTimeout(this.openTimeout);
    try {
      this.dc?.close();
      this.pc.close();
    } catch {
      // 已关闭
    }
    this.setState('closed');
  }
}

export { PROBE_HASH };
