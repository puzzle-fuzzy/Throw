import { describe, expect, it } from 'vitest';
import { formatBytes, formatCountdown, formatEta, formatSpeed } from '../src/lib/format';

describe('formatBytes', () => {
  it('小字节', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });
  it('KB/MB/GB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
  it('非法输入', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatSpeed', () => {
  it('未知速度显示 —', () => {
    expect(formatSpeed(undefined)).toBe('—');
    expect(formatSpeed(0)).toBe('—');
  });
  it('正常速度', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s');
  });
});

describe('formatEta', () => {
  it('未知与边界', () => {
    expect(formatEta(undefined)).toBe('—');
    expect(formatEta(0)).toBe('—');
    expect(formatEta(1.4)).toBe('2 秒');
  });
  it('分钟与小时', () => {
    expect(formatEta(90)).toBe('1 分 30 秒');
    expect(formatEta(3690)).toBe('1 时 1 分');
  });
});

describe('formatCountdown', () => {
  it('分秒倒计时', () => {
    expect(formatCountdown(10 * 60_000, 0)).toBe('10 分 00 秒');
    expect(formatCountdown(65_000, 0)).toBe('1 分 05 秒');
  });
  it('已过期归零', () => {
    expect(formatCountdown(0, 5000)).toBe('0 分 00 秒');
  });
});
