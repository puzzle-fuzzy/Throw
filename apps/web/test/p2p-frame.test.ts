import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, fnv1a } from '../src/lib/p2p';

describe('fnv1a', () => {
  it('稳定且区分大小写', () => {
    expect(fnv1a('file-01')).toBe(fnv1a('file-01'));
    expect(fnv1a('file-01')).not.toBe(fnv1a('file-02'));
    expect(fnv1a('abc')).not.toBe(fnv1a('ABC'));
  });
  it('返回 u32', () => {
    const value = fnv1a('hello');
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('帧编解码往返', () => {
  it('编码后解码还原', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 250, 251]);
    const hash = fnv1a('f1');
    const buffer = encodeFrame(hash, 42, payload);
    expect(buffer.byteLength).toBe(12 + 7);
    const decoded = decodeFrame(buffer);
    expect(decoded).not.toBeNull();
    expect(decoded?.hash).toBe(hash);
    expect(decoded?.seq).toBe(42);
    expect(Array.from(decoded ? new Uint8Array(decoded.payload) : [])).toEqual([
      1, 2, 3, 4, 5, 250, 251,
    ]);
  });
  it('空载荷', () => {
    const buffer = encodeFrame(0, 0, new Uint8Array(0));
    const decoded = decodeFrame(buffer);
    expect(decoded?.payload.byteLength).toBe(0);
    expect(decoded?.hash).toBe(0);
  });
  it('非法帧返回 null', () => {
    expect(decodeFrame(new ArrayBuffer(4))).toBeNull();
    const bad = new ArrayBuffer(12 + 2);
    const view = new DataView(bad);
    view.setUint32(8, 99, true); // 声明 99 字节但实际 2 字节
    expect(decodeFrame(bad)).toBeNull();
  });
  it('大序号（u32 边界）', () => {
    const buffer = encodeFrame(0xffffffff, 0xffffffff, new Uint8Array([9]));
    const decoded = decodeFrame(buffer);
    expect(decoded?.seq).toBe(0xffffffff);
    expect(decoded?.hash).toBe(0xffffffff);
  });
});
