import { existsSync } from 'node:fs';
import { type FileHandle, mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidRoomCode } from '@throw/contracts';
import { errors } from '../domain/errors';

/** 归属标记：目录里存在此文件才视为本服务创建，启动时可安全清理崩溃残留 */
const MARKER = '.throw-relay';
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface RelayStorage {
  init(): Promise<void>;
  putChunk(code: string, fileId: string, offset: number, data: Uint8Array): Promise<void>;
  sizeOf(code: string, fileId: string): Promise<number | null>;
  pathOf(code: string, fileId: string): string;
  deleteFile(code: string, fileId: string): Promise<void>;
  deleteRoom(code: string): Promise<void>;
  wipeAll(): Promise<void>;
}

function assertPathParts(code: string, fileId: string): void {
  if (!isValidRoomCode(code) || !FILE_ID_RE.test(fileId)) {
    // path traversal 防线：路由层已校验过，这里再挡一道（hostile input 处理）
    throw errors.invalidRequest('路径参数非法');
  }
}

export class DiskRelayStorage implements RelayStorage {
  constructor(private readonly root: string) {}

  private roomDir(code: string): string {
    return join(this.root, code);
  }

  pathOf(code: string, fileId: string): string {
    assertPathParts(code, fileId);
    return join(this.root, code, fileId);
  }

  async init(): Promise<void> {
    if (existsSync(join(this.root, MARKER))) {
      await rm(this.root, { recursive: true, force: true });
    }
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, MARKER), String(process.pid ?? 'unknown'));
  }

  async putChunk(code: string, fileId: string, offset: number, data: Uint8Array): Promise<void> {
    assertPathParts(code, fileId);
    await mkdir(this.roomDir(code), { recursive: true });
    const path = this.pathOf(code, fileId);
    let fh: FileHandle | null = null;
    try {
      fh = await open(path, 'r+').catch(() => open(path, 'w+'));
      // (buffer, bufferOffset, length, filePosition)：位置写，支持分片续传重试
      await fh.write(data, 0, data.byteLength, offset);
    } finally {
      await fh?.close();
    }
  }

  async sizeOf(code: string, fileId: string): Promise<number | null> {
    assertPathParts(code, fileId);
    try {
      return (await stat(this.pathOf(code, fileId))).size;
    } catch {
      return null;
    }
  }

  async deleteFile(code: string, fileId: string): Promise<void> {
    assertPathParts(code, fileId);
    await rm(this.pathOf(code, fileId), { force: true });
    // 目录空了才顺手移除；非空（房间还有其他文件）时 ENOTEMPTY，忽略
    await rm(this.roomDir(code), { force: true }).catch(() => {});
  }

  async deleteRoom(code: string): Promise<void> {
    if (!isValidRoomCode(code)) return;
    await rm(this.roomDir(code), { recursive: true, force: true }).catch(() => {});
  }

  async wipeAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true }).catch(() => {});
  }
}
