import { treaty } from '@elysiajs/eden';
import type { App } from '@throw/api';
import { type FileMeta, LIMITS } from '@throw/contracts';

/** 同源相对路径（开发经 Vite 代理，生产经反代同域转发） */
export const api = typeof window === 'undefined' ? null : treaty<App>(window.location.origin);

export interface RoomCredentials {
  code: string;
  token: string;
  expiresAt: number;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function unwrap<T>(result: { data: T | null; error: object | null }, fallback: string): T {
  if (result.error) {
    const err = result.error as {
      value?: { error?: { code?: string; message?: string } };
      status?: number;
    };
    const body = err.value?.error;
    throw new ApiError(body?.code ?? 'INTERNAL', body?.message ?? fallback, err.status ?? 500);
  }
  if (result.data === null || result.data === undefined) {
    throw new ApiError('INTERNAL', fallback, 500);
  }
  return result.data;
}

export async function createRoom(nickname: string | null): Promise<RoomCredentials> {
  if (!api) throw new ApiError('INTERNAL', '浏览器环境不可用', 500);
  return unwrap(await api.rooms.post({ nickname: nickname ?? undefined }), '创建房间失败');
}

export type RoomStatusValue = 'waiting' | 'active' | 'closed';

export async function getRoomStatus(code: string): Promise<RoomStatusValue> {
  if (!api) throw new ApiError('INTERNAL', '浏览器环境不可用', 500);
  return unwrap(await api.rooms({ code }).get(), '查询房间失败').status;
}

export async function joinRoom(code: string, nickname: string | null): Promise<RoomCredentials> {
  if (!api) throw new ApiError('INTERNAL', '浏览器环境不可用', 500);
  const data = unwrap(
    await api.rooms({ code }).join.post({ nickname: nickname ?? undefined }),
    '加入房间失败',
  );
  return { code, token: data.token, expiresAt: data.expiresAt };
}

/** 中转分片上传；最后一片 done=true */
export async function uploadRelayChunk(
  code: string,
  token: string,
  fileId: string,
  offset: number,
  data: Uint8Array,
  done: boolean,
): Promise<{ received: number }> {
  const query = new URLSearchParams({ fileId, offset: String(offset) });
  if (done) query.set('done', '1');
  const res = await fetch(`/relay/rooms/${code}/files?${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: data as unknown as BodyInit,
  });
  const body = (await res.json().catch(() => null)) as
    | { received?: number }
    | { error?: { code?: string; message?: string } }
    | null;
  if (!res.ok) {
    const codeValue = body && 'error' in body ? body.error?.code : undefined;
    const message = body && 'error' in body ? body.error?.message : '上传失败';
    throw new ApiError(codeValue ?? 'INTERNAL', message ?? '上传失败', res.status);
  }
  return { received: (body as { received: number }).received };
}

/** 中转下载：流式读取以驱动进度 */
export async function downloadRelayFile(
  fileId: string,
  token: string,
  meta: FileMeta,
  onProgress: (receivedBytes: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`/relay/files/${fileId}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      body?.error?.code ?? 'INTERNAL',
      body?.error?.message ?? '下载失败',
      res.status,
    );
  }
  const parts: BlobPart[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress(Math.min(received, meta.size));
  }
  if (received !== meta.size) {
    throw new ApiError('INTERNAL', `下载不完整（${received}/${meta.size}）`, 0);
  }
  return new Blob(parts, { type: meta.mime || 'application/octet-stream' });
}

export const PRECHECK = {
  MAX_FILE_BYTES: LIMITS.MAX_FILE_BYTES,
  MAX_BATCH_FILES: LIMITS.MAX_BATCH_FILES,
  MAX_TEXT_CHARS: LIMITS.MAX_TEXT_CHARS,
};
