import {
  type ClientMessage,
  type FileMeta,
  LIMITS,
  type ServerMessage,
  type SignalPayload,
} from '@throw/contracts';
import { SpeedMeter, useChat } from '../stores/chat';
import { downloadRelayFile, uploadRelayChunk } from './api';
import { type ControlMessage, type DecodedFrame, fnv1a, PeerLink } from './p2p';

const P2P_CHUNK_BYTES = 256 * 1024;
const RELAY_CHUNK_BYTES = LIMITS.RELAY_CHUNK_BYTES;
const HIGH_WATER_BYTES = 4 * 1024 * 1024;
const ICE_TIMEOUT_MS = 8000;
const PROBE_BYTES = 2 * 1024 * 1024;
const MIN_P2P_THROUGHPUT = 500 * 1024;
const P2P_RETRY_AFTER_MS = 5 * 60 * 1000;

export type ChannelDecision = 'p2p' | 'relay';

export interface TransferManagerDeps {
  socket: { send: (msg: ClientMessage) => boolean };
  role: 'creator' | 'joiner';
  forceRelay: boolean;
  onChannelChange: (channel: 'p2p' | 'relay' | null) => void;
  onSystem: (text: string) => void;
  /** 任何传输活动（发送/接收开始、完成、取消）触发，用于重置房间空闲倒计时 */
  onTransferActivity?: () => void;
}

interface IncomingP2P {
  fileId: string;
  size: number;
  received: number;
  parts: ArrayBuffer[];
  lastAckBytes: number;
}

/**
 * 自适应传输管理器（每房间一个实例）：
 * - 通道决策：P2P 优先（ICE 8s 超时 + 2MB 吞吐探测），失败/慢 → 中转并缓存结论 5 分钟
 * - 发起方固定为 creator（无协商冲突）；joiner 发送时通过 ws file-offer 间接触发 creator 建链
 * - P2P：12 字节头二进制帧 + JSON 控制帧，背压 + ack 驱动进度
 * - 中转：分片上传 done=1 → 对端 relay-notify → Range 下载 → relay-downloaded 即删
 */
export class TransferManager {
  private link: PeerLink | null = null;
  private linkFailedAt = 0;
  private decision: { channel: ChannelDecision | null; retryP2pAt: number; probed: boolean } = {
    channel: null,
    retryP2pAt: 0,
    probed: false,
  };
  private incoming = new Map<number, IncomingP2P>();
  private hashToFileId = new Map<number, string>();
  private aborted = new Set<string>();
  private readonly meters = new Map<string, SpeedMeter>();

  constructor(private readonly deps: TransferManagerDeps) {}

  private meter(fileId: string): SpeedMeter {
    let meter = this.meters.get(fileId);
    if (!meter) {
      meter = new SpeedMeter();
      this.meters.set(fileId, meter);
    }
    return meter;
  }

  private buildLink(initiator: boolean): PeerLink {
    this.link?.close();
    const link = new PeerLink(
      {
        onSignal: (payload) => {
          this.deps.socket.send({ type: 'signal', payload });
        },
        onData: (frame) => this.onDataFrame(frame),
        onControl: (control) => this.onControl(control),
        onStateChange: () => {},
      },
      { initiator, openTimeoutMs: ICE_TIMEOUT_MS },
    );
    this.link = link;
    return link;
  }

  /** 发送方视角：链路可用则复用；死链/无链则自己发起（与角色无关） */
  private ensureInitiatorLink(): PeerLink {
    if (this.link?.isOpen) return this.link;
    if (this.link && !this.link.isDead) return this.link;
    return this.buildLink(true);
  }

  /** 接收 offer 一侧：复用活链（含对方发起的），否则重建应答链 */
  private ensureAnswererLink(): PeerLink {
    if (this.link && !this.link.isDead) return this.link;
    return this.buildLink(false);
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    if (payload.kind === 'offer') {
      if (this.link && !this.link.isDead && this.link.isInitiator) {
        // 双方同时发起：creator 让位成为应答方，joiner 的 offer 优先（避免死锁）
        if (this.deps.role === 'creator') {
          this.buildLink(false);
        } else {
          return;
        }
      } else if (this.link && !this.link.isDead && this.link.signaling !== 'have-remote-offer') {
        // 已应答完成的旧链收到新 offer = 对端已弃旧链重建，跟随重建
        //（旧 pc 上 setRemoteDescription 会抛 InvalidStateError，必须换新 pc）
        this.buildLink(false);
      }
      const link = this.ensureAnswererLink();
      await link.acceptOffer(payload.sdp);
      return;
    }
    const link = this.link ?? this.ensureAnswererLink();
    await link.handleSignal(payload, () => this.ensureAnswererLink());
  }

  stop(): void {
    this.link?.close();
    this.link = null;
  }

  // ---------- 通道决策 ----------

  private async pickChannel(): Promise<ChannelDecision> {
    if (this.deps.forceRelay) return 'relay';
    const now = Date.now();
    if (this.decision.channel === 'relay' && now < this.decision.retryP2pAt) return 'relay';
    if (this.linkFailedAt !== 0 && now - this.linkFailedAt < P2P_RETRY_AFTER_MS) return 'relay';

    const link = this.ensureInitiatorLink();
    const open = await link.waitOpen(ICE_TIMEOUT_MS);
    if (!open) {
      this.decision = { channel: 'relay', retryP2pAt: now + P2P_RETRY_AFTER_MS, probed: false };
      this.linkFailedAt = now;
      link.close();
      this.link = null;
      this.deps.onSystem('P2P 通道建立失败，本次会话使用服务器中转');
      return 'relay';
    }
    if (!this.decision.probed) {
      const throughput = await this.probe(link);
      if (throughput === null || throughput < MIN_P2P_THROUGHPUT) {
        this.decision = { channel: 'relay', retryP2pAt: now + P2P_RETRY_AFTER_MS, probed: false };
        this.deps.onSystem(
          throughput === null
            ? 'P2P 探测超时，本次会话使用服务器中转'
            : 'P2P 链路较慢，本次会话使用服务器中转',
        );
        return 'relay';
      }
      this.decision = { channel: 'p2p', retryP2pAt: 0, probed: true };
    }
    this.linkFailedAt = 0;
    return 'p2p';
  }

  /** 2MB 探测：发 hash=0 帧，等对端累计 probe-ack；返回 bytes/s */
  private async probe(link: PeerLink): Promise<number | null> {
    return new Promise((resolve) => {
      const started = Date.now();
      let acked = 0;
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        this.probeListener = null;
        clearTimeout(timer);
        resolve(value);
      };
      this.probeListener = (bytes: number) => {
        acked = bytes;
        if (acked >= PROBE_BYTES) {
          const seconds = (Date.now() - started) / 1000;
          finish(seconds > 0 ? PROBE_BYTES / seconds : null);
        }
      };
      const timer = setTimeout(() => {
        if (acked > 0) {
          const seconds = (Date.now() - started) / 1000;
          finish(seconds > 0 ? acked / seconds : null);
        } else {
          finish(null);
        }
      }, 10_000);
      void (async () => {
        try {
          const payload = new Uint8Array(P2P_CHUNK_BYTES);
          const total = Math.ceil(PROBE_BYTES / P2P_CHUNK_BYTES);
          for (let seq = 0; seq < total; seq++) {
            if (!link.isOpen) return finish(null);
            await link.waitDrain(HIGH_WATER_BYTES);
            link.sendBinary(fnv1aFrame0(seq, payload));
          }
        } catch {
          finish(null);
        }
      })();
    });
  }

  private probeListener: ((bytes: number) => void) | null = null;

  // ---------- 发送 ----------

  async sendFiles(files: File[]): Promise<void> {
    const oversized = files.filter((f) => f.size > LIMITS.MAX_FILE_BYTES);
    if (oversized.length > 0) {
      throw new Error(`超出单文件 100MB 上限：${oversized.map((f) => f.name).join('、')}`);
    }
    if (files.length > LIMITS.MAX_BATCH_FILES) {
      throw new Error(`单次最多 ${LIMITS.MAX_BATCH_FILES} 个文件`);
    }
    for (const file of files) {
      await this.sendFile(file, undefined);
    }
  }

  private async sendFile(file: File, preferChannel: ChannelDecision | undefined): Promise<void> {
    const fileId = `f${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const meta: FileMeta = {
      fileId,
      name: file.name || '未命名文件',
      size: file.size,
      mime: file.type || 'application/octet-stream',
    };
    const store = useChat.getState();
    store.addTransfer({
      fileId,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      direction: 'send',
      channel: 'relay',
      status: 'queued',
      sentBytes: 0,
      speedBps: undefined,
      etaSec: undefined,
      error: undefined,
      blobUrl: undefined,
      source: file,
    });
    const channel = preferChannel ?? (await this.pickChannel());
    useChat.getState().patchTransfer(fileId, { channel, status: 'offering' });
    this.deps.onChannelChange(channel);
    this.deps.onTransferActivity?.();
    const offered = this.deps.socket.send({ type: 'file-offer', file: meta, channel });
    if (!offered) {
      useChat.getState().patchTransfer(fileId, { status: 'failed', error: '连接不可用' });
      return;
    }
    if (channel === 'p2p') {
      await this.sendViaP2P(fileId, file, meta);
    } else {
      await this.sendViaRelay(fileId, file, meta);
    }
  }

  private async sendViaP2P(fileId: string, file: File, meta: FileMeta): Promise<void> {
    const link = this.link;
    if (!link?.isOpen) {
      this.fail(fileId, 'P2P 通道不可用');
      return;
    }
    const hash = fnv1a(fileId);
    this.hashToFileId.set(hash, fileId);
    this.aborted.delete(fileId);
    link.sendControl({ t: 'begin', h: hash, fileId, size: meta.size });
    useChat.getState().patchTransfer(fileId, { status: 'transferring' });
    const meter = this.meter(fileId);
    let offset = 0;
    let seq = 0;
    try {
      while (offset < meta.size) {
        if (this.aborted.has(fileId)) return;
        const slice = file.slice(offset, Math.min(offset + P2P_CHUNK_BYTES, meta.size));
        const bytes = new Uint8Array(await slice.arrayBuffer());
        await link.waitDrain(HIGH_WATER_BYTES);
        if (!link.isOpen) throw new Error('P2P 连接中断');
        const frame = new Uint8Array(12 + bytes.byteLength);
        const view = new DataView(frame.buffer);
        view.setUint32(0, hash, true);
        view.setUint32(4, seq++, true);
        view.setUint32(8, bytes.byteLength, true);
        frame.set(bytes, 12);
        link.sendBinary(frame.buffer);
        offset += bytes.byteLength;
        useChat.getState().patchProgress(fileId, offset, meter.sample(offset));
      }
      link.sendControl({ t: 'done', h: hash });
      // 完成由接收方最终 ack（ack b=size）触发 completedP2P
    } catch (error) {
      this.fail(fileId, error instanceof Error ? error.message : 'P2P 传输失败');
    }
  }

  private async sendViaRelay(fileId: string, file: File, meta: FileMeta): Promise<void> {
    const { code, token } = this.session();
    const meter = this.meter(fileId);
    let offset = 0;
    try {
      while (offset < meta.size) {
        if (this.aborted.has(fileId)) return;
        const slice = file.slice(offset, Math.min(offset + RELAY_CHUNK_BYTES, meta.size));
        const bytes = new Uint8Array(await slice.arrayBuffer());
        const done = offset + bytes.byteLength >= meta.size;
        const { received } = await uploadRelayChunk(code, token, fileId, offset, bytes, done);
        offset = received;
        useChat.getState().patchProgress(fileId, offset, meter.sample(offset));
      }
      // 上传完成：等接收方 file-complete 再标记 completed；期间保持 transferring（100%）
    } catch (error) {
      this.fail(fileId, error instanceof Error ? error.message : '中转上传失败');
    }
  }

  // ---------- 服务端消息入口（useRoom 转发） ----------

  handleServerMessage(msg: ServerMessage): void {
    if (
      msg.type === 'file-offer' ||
      msg.type === 'relay-notify' ||
      msg.type === 'file-cancel' ||
      msg.type === 'file-complete'
    ) {
      this.deps.onTransferActivity?.();
    }
    switch (msg.type) {
      case 'file-offer': {
        useChat.getState().addTransfer({
          fileId: msg.file.fileId,
          name: msg.file.name,
          size: msg.file.size,
          mime: msg.file.mime,
          direction: 'recv',
          channel: msg.channel,
          status: 'queued',
          sentBytes: 0,
          speedBps: undefined,
          etaSec: undefined,
          error: undefined,
          blobUrl: undefined,
          source: undefined,
        });
        return;
      }
      case 'relay-notify':
        void this.receiveViaRelay(msg.file);
        return;
      case 'file-cancel': {
        const existing = useChat.getState().transfers[msg.fileId];
        if (existing?.blobUrl) URL.revokeObjectURL(existing.blobUrl);
        useChat.getState().patchTransfer(msg.fileId, { status: 'cancelled', blobUrl: undefined });
        return;
      }
      case 'file-complete':
        useChat.getState().patchTransfer(msg.fileId, { status: 'completed' });
        return;
      default:
        return;
    }
  }

  private async receiveViaRelay(meta: FileMeta): Promise<void> {
    const fileId = meta.fileId;
    if (this.aborted.has(fileId)) return;
    if (!useChat.getState().transfers[fileId]) {
      this.handleServerMessage({
        type: 'file-offer',
        file: meta,
        channel: 'relay',
        from: { nickname: null },
      });
    }
    useChat.getState().patchTransfer(fileId, { status: 'transferring', channel: 'relay' });
    const meter = this.meter(fileId);
    try {
      const blob = await downloadRelayFile(fileId, this.session().token, meta, (bytes) => {
        useChat.getState().patchProgress(fileId, bytes, meter.sample(bytes));
      });
      if (this.aborted.has(fileId)) return;
      useChat.getState().patchTransfer(fileId, {
        status: 'completed',
        blobUrl: URL.createObjectURL(blob),
      });
      this.deps.socket.send({ type: 'relay-downloaded', fileId });
    } catch (error) {
      this.fail(fileId, error instanceof Error ? error.message : '中转下载失败');
    }
  }

  // ---------- P2P 接收 ----------

  private probeReceived = 0;
  private probeAcked = 0;

  private onDataFrame(frame: DecodedFrame): void {
    if (frame.hash === 0) {
      // 探测帧：累计字节并按阈值回 ack（h=0），发送方据此测吞吐
      this.probeReceived += frame.payload.byteLength;
      if (this.probeReceived >= PROBE_BYTES || this.probeReceived - this.probeAcked >= 512 * 1024) {
        this.probeAcked = this.probeReceived;
        this.link?.sendControl({ t: 'ack', h: 0, b: this.probeReceived });
      }
      return;
    }
    const incoming = this.incoming.get(frame.hash);
    if (!incoming) return;
    incoming.parts.push(frame.payload);
    incoming.received += frame.payload.byteLength;
    if (incoming.received - incoming.lastAckBytes >= 512 * 1024) {
      incoming.lastAckBytes = incoming.received;
      this.link?.sendControl({ t: 'ack', h: frame.hash, b: incoming.received });
    }
    const store = useChat.getState();
    store.patchProgress(
      incoming.fileId,
      incoming.received,
      this.meter(incoming.fileId).sample(incoming.received),
    );
  }

  private onControl(control: ControlMessage): void {
    switch (control.t) {
      case 'begin': {
        if (control.h === undefined || !control.fileId) return;
        this.incoming.set(control.h, {
          fileId: control.fileId,
          size: control.size ?? 0,
          received: 0,
          parts: [],
          lastAckBytes: 0,
        });
        useChat
          .getState()
          .patchTransfer(control.fileId, { status: 'transferring', channel: 'p2p' });
        this.deps.onTransferActivity?.();
        return;
      }
      case 'ack': {
        if (control.h === undefined || control.b === undefined) return;
        if (control.h === 0) {
          this.probeListener?.(control.b);
          return;
        }
        const fileId = this.hashToFileId.get(control.h);
        if (fileId && control.b >= (useChat.getState().transfers[fileId]?.size ?? 0)) {
          useChat.getState().patchTransfer(fileId, { status: 'completed' });
        }
        return;
      }
      case 'done': {
        if (control.h === undefined) return;
        const incoming = this.incoming.get(control.h);
        if (!incoming) return;
        this.incoming.delete(control.h);
        const blob = new Blob(incoming.parts, {
          type: useChat.getState().transfers[incoming.fileId]?.mime || 'application/octet-stream',
        });
        useChat.getState().patchTransfer(incoming.fileId, {
          status: 'completed',
          blobUrl: URL.createObjectURL(blob),
        });
        this.link?.sendControl({ t: 'ack', h: control.h, b: incoming.size });
        return;
      }
      case 'cancel': {
        if (control.h === undefined) return;
        const fileId = this.hashToFileId.get(control.h);
        if (fileId) {
          this.incoming.delete(control.h);
          useChat.getState().patchTransfer(fileId, { status: 'cancelled' });
        }
        return;
      }
      case 'probe-ack':
        return;
    }
  }

  // ---------- 取消 / 重试 ----------

  cancel(fileId: string): void {
    this.aborted.add(fileId);
    const transfer = useChat.getState().transfers[fileId];
    if (transfer?.blobUrl) URL.revokeObjectURL(transfer.blobUrl);
    useChat.getState().patchTransfer(fileId, { status: 'cancelled', blobUrl: undefined });
    if (transfer) {
      const hash = fnv1a(fileId);
      if (this.link?.isOpen) {
        this.link.sendControl({ t: 'cancel', h: hash });
      }
    }
    this.deps.socket.send({ type: 'file-cancel', fileId, reason: 'cancel' });
  }

  /** 失败重试：换另一条通道 */
  async retry(fileId: string): Promise<void> {
    const transfer = useChat.getState().transfers[fileId];
    if (!transfer?.source) return;
    const other: ChannelDecision = transfer.channel === 'p2p' ? 'relay' : 'p2p';
    this.aborted.delete(fileId);
    useChat.getState().patchTransfer(fileId, {
      status: 'queued',
      sentBytes: 0,
      error: undefined,
      speedBps: undefined,
      etaSec: undefined,
    });
    const meta: FileMeta = {
      fileId,
      name: transfer.name,
      size: transfer.source.size,
      mime: transfer.mime,
    };
    const channel =
      other === 'p2p' ? ((await this.pickChannel()) === 'p2p' ? 'p2p' : 'relay') : 'relay';
    useChat.getState().patchTransfer(fileId, { channel, status: 'offering' });
    this.deps.socket.send({ type: 'file-offer', file: meta, channel });
    if (channel === 'p2p') {
      await this.sendViaP2P(fileId, transfer.source, meta);
    } else {
      await this.sendViaRelay(fileId, transfer.source, meta);
    }
  }

  private fail(fileId: string, message: string): void {
    useChat.getState().patchTransfer(fileId, { status: 'failed', error: message });
  }

  private session(): { code: string; token: string } {
    // 由 useRoom 在创建时把 session 写入 manager（避免循环依赖 store）
    const session = this.sessionRef;
    if (!session) throw new Error('会话未初始化');
    return session;
  }

  sessionRef: { code: string; token: string } | null = null;
}

/** 探测帧（hash=0）编码 */
function fnv1aFrame0(seq: number, payload: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(12 + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, 0, true);
  view.setUint32(4, seq, true);
  view.setUint32(8, payload.byteLength, true);
  frame.set(payload, 12);
  return frame.buffer;
}
