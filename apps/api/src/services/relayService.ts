import { type FileMeta, LIMITS, type ServerMessage } from '@throw/contracts';
import { errors } from '../domain/errors';
import type { RelayStorage } from './relayStorage';

interface RelayFile {
  meta: FileMeta;
  senderToken: string;
  uploadedBytes: number;
  ready: boolean;
  createdAt: number;
}

export interface RelayServiceDeps {
  storage: RelayStorage;
  now: () => number;
  notifyRoom: (code: string, msg: ServerMessage) => void;
  limits?: typeof LIMITS;
}

export type OpenedDownload =
  | {
      code: string;
      path: string;
      meta: FileMeta;
      size: number;
      /** null = 全量 200；有值 = 206 部分内容（闭区间） */
      range: { start: number; end: number } | null;
    }
  | { unsatisfiable: true; size: number };

/** Range 解析：null = 忽略（200 全量）；'unsatisfiable' = 416 */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)(?:,|$)/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isInteger(start) || start >= size) return 'unsatisfiable';
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isInteger(end) || end < start) return 'unsatisfiable';
  return { start, end };
}

/**
 * 中转通道服务：file-offer 注册元数据 → 分片上传（offset 幂等）→ done 通知接收方 →
 * Range 下载 → relay-downloaded 即删；TTL / 房间销毁兜底清理。
 */
export class RelayService {
  private rooms = new Map<string, Map<string, RelayFile>>();
  private fileRoom = new Map<string, string>();
  private activeUpload = new Map<string, string>();

  private get limits(): typeof LIMITS {
    return this.deps.limits ?? LIMITS;
  }

  constructor(private deps: RelayServiceDeps) {}

  private filesOf(code: string): Map<string, RelayFile> {
    let files = this.rooms.get(code);
    if (!files) {
      files = new Map();
      this.rooms.set(code, files);
    }
    return files;
  }

  /** file-offer（channel=relay）时注册；重复 offer 幂等 */
  registerMeta(code: string, meta: FileMeta, senderToken: string): void {
    if (meta.size > this.limits.MAX_FILE_BYTES) {
      throw errors.fileTooLarge('文件超过大小上限');
    }
    const files = this.filesOf(code);
    if (files.has(meta.fileId)) return;
    if (files.size >= this.limits.MAX_PENDING_FILES_PER_ROOM) {
      throw errors.tooManyFiles();
    }
    files.set(meta.fileId, {
      meta,
      senderToken,
      uploadedBytes: 0,
      ready: false,
      createdAt: this.deps.now(),
    });
    this.fileRoom.set(meta.fileId, code);
  }

  async putChunk(
    code: string,
    fileId: string,
    senderToken: string,
    offset: number,
    data: Uint8Array,
  ): Promise<{ received: number }> {
    const file = this.rooms.get(code)?.get(fileId);
    if (!file || file.senderToken !== senderToken) throw errors.unknownFile();
    if (file.ready) throw errors.invalidRequest('文件已标记完成');
    if (data.byteLength === 0) throw errors.invalidRequest('空分片');
    if (data.byteLength > this.limits.RELAY_CHUNK_MAX_BYTES) throw errors.chunkTooLarge();
    if (!Number.isInteger(offset) || offset < 0 || offset > file.uploadedBytes) {
      throw errors.invalidOffset();
    }
    const active = this.activeUpload.get(code);
    if (active !== undefined && active !== fileId) throw errors.uploadBusy();
    const newSize = Math.max(file.uploadedBytes, offset + data.byteLength);
    if (newSize > this.limits.MAX_FILE_BYTES) {
      throw errors.fileTooLarge('累计大小超过单文件上限');
    }
    this.activeUpload.set(code, fileId);
    await this.deps.storage.putChunk(code, fileId, offset, data);
    file.uploadedBytes = newSize;
    return { received: newSize };
  }

  /** 最后一片携带 done=1：校验完整后置 ready 并通知房间内成员 */
  async complete(code: string, fileId: string, senderToken: string): Promise<FileMeta> {
    const file = this.rooms.get(code)?.get(fileId);
    if (!file || file.senderToken !== senderToken) throw errors.unknownFile();
    if (file.ready) return file.meta;
    if (file.uploadedBytes !== file.meta.size) {
      throw errors.invalidRequest('上传不完整：字节数与声明大小不一致');
    }
    file.ready = true;
    if (this.activeUpload.get(code) === fileId) this.activeUpload.delete(code);
    this.deps.notifyRoom(code, { type: 'relay-notify', file: file.meta });
    return file.meta;
  }

  locate(fileId: string): string | null {
    return this.fileRoom.get(fileId) ?? null;
  }

  /** 下载计划；未注册/未就绪返回 null，Range 无法满足返回 unsatisfiable */
  async openDownload(fileId: string, rangeHeader: string | null): Promise<OpenedDownload | null> {
    const code = this.fileRoom.get(fileId);
    if (code === undefined) return null;
    const file = this.rooms.get(code)?.get(fileId);
    if (!file?.ready) return null;
    const size = file.meta.size;
    const range = parseRange(rangeHeader, size);
    if (range === 'unsatisfiable') return { unsatisfiable: true, size };
    return {
      code,
      path: this.deps.storage.pathOf(code, fileId),
      meta: file.meta,
      size,
      range,
    };
  }

  /** 接收方确认下载完成：删除文件，返回发送方 token（供 file-complete 回执） */
  async markDownloaded(fileId: string): Promise<{ senderToken: string | null }> {
    const code = this.fileRoom.get(fileId);
    const file = code !== undefined ? this.rooms.get(code)?.get(fileId) : undefined;
    if (!code || !file) return { senderToken: null };
    await this.forget(code, fileId);
    return { senderToken: file.senderToken };
  }

  /** 任一方取消：删除；返回是否存在 */
  async cancel(code: string, fileId: string): Promise<boolean> {
    const existed = this.rooms.get(code)?.has(fileId) ?? false;
    if (existed) await this.forget(code, fileId);
    return existed;
  }

  /** 成员重连后补发未领取的 relay-notify（只发给接收方：发送者自己的文件跳过） */
  pendingNotifications(code: string, memberToken: string): FileMeta[] {
    const files = this.rooms.get(code);
    if (!files) return [];
    const pending: FileMeta[] = [];
    for (const file of files.values()) {
      if (file.ready && file.senderToken !== memberToken) pending.push(file.meta);
    }
    return pending;
  }

  async deleteRoomFiles(code: string): Promise<void> {
    this.rooms.delete(code);
    for (const [fileId, roomCode] of this.fileRoom) {
      if (roomCode === code) this.fileRoom.delete(fileId);
    }
    if (this.activeUpload.get(code)) this.activeUpload.delete(code);
    await this.deps.storage.deleteRoom(code);
  }

  /** TTL 兜底清理；通知房间成员 file-cancel 让 UI 收敛 */
  async sweep(): Promise<void> {
    const now = this.deps.now();
    for (const [code, files] of this.rooms) {
      for (const [fileId, file] of files) {
        if (now - file.createdAt > this.limits.RELAY_FILE_TTL_MS) {
          await this.forget(code, fileId);
          this.deps.notifyRoom(code, { type: 'file-cancel', fileId });
        }
      }
      if (files.size === 0) this.rooms.delete(code);
    }
  }

  private async forget(code: string, fileId: string): Promise<void> {
    this.rooms.get(code)?.delete(fileId);
    this.fileRoom.delete(fileId);
    if (this.activeUpload.get(code) === fileId) this.activeUpload.delete(code);
    await this.deps.storage.deleteFile(code, fileId);
  }
}
