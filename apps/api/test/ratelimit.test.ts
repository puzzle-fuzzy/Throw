import { describe, expect, test } from 'bun:test';
import { RateLimiter } from '../src/domain/rateLimiter';

const HOUR = 60 * 60 * 1000;

describe('RateLimiter', () => {
  test('创建限流：10 次/小时', () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    for (let i = 0; i < 10; i++) {
      expect(limiter.allowCreate('1.1.1.1')).toBeTrue();
    }
    expect(limiter.allowCreate('1.1.1.1')).toBeFalse();
    expect(limiter.allowCreate('2.2.2.2')).toBeTrue();

    t = HOUR + 1;
    expect(limiter.allowCreate('1.1.1.1')).toBeTrue();
  });

  test('加入失败锁定：3 次失败锁 10 分钟', () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    expect(limiter.isJoinLocked('1.1.1.1', 'AAAAAA')).toBeFalse();
    limiter.registerJoinFail('1.1.1.1', 'AAAAAA');
    limiter.registerJoinFail('1.1.1.1', 'AAAAAA');
    expect(limiter.isJoinLocked('1.1.1.1', 'AAAAAA')).toBeFalse();
    limiter.registerJoinFail('1.1.1.1', 'AAAAAA');
    expect(limiter.isJoinLocked('1.1.1.1', 'AAAAAA')).toBeTrue();
    expect(limiter.isJoinLocked('1.1.1.1', 'BBBBBB')).toBeFalse();

    t = 10 * 60 * 1000 + 1;
    expect(limiter.isJoinLocked('1.1.1.1', 'AAAAAA')).toBeFalse();
  });

  test('加入频控：30 次/小时', () => {
    const limiter = new RateLimiter(() => 0);
    for (let i = 0; i < 30; i++) {
      expect(limiter.allowJoin('3.3.3.3')).toBeTrue();
    }
    expect(limiter.allowJoin('3.3.3.3')).toBeFalse();
  });

  test('sweep 清理过期条目', () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    limiter.allowCreate('1.1.1.1');
    limiter.registerJoinFail('1.1.1.1', 'AAAAAA');
    t = 2 * HOUR + 1;
    limiter.sweep();
    // 清理后重新计数（旧的 hit 已不在窗口内本来就失效；验证不抛错且恢复可用）
    expect(limiter.allowCreate('1.1.1.1')).toBeTrue();
  });
});
