/** 内存滑动窗口限流（单实例；数值为初始值，见 docs/architecture.md §4.5 调参表） */
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_MAX = 10;
const JOIN_WINDOW_MS = 60 * 60 * 1000;
const JOIN_MAX = 30;
const JOIN_FAIL_WINDOW_MS = 10 * 60 * 1000;
const JOIN_FAIL_MAX = 3;
const JOIN_FAIL_LOCK_MS = 10 * 60 * 1000;
const ENTRY_RETENTION_MS = 2 * 60 * 60 * 1000;

interface JoinFail {
  count: number;
  windowUntil: number;
  lockedUntil: number;
}

export class RateLimiter {
  private createHits = new Map<string, number[]>();
  private joinHits = new Map<string, number[]>();
  private joinFails = new Map<string, JoinFail>();

  constructor(private now: () => number = () => Date.now()) {}

  private hit(map: Map<string, number[]>, key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const hits = (map.get(key) ?? []).filter((x) => t - x < windowMs);
    if (hits.length >= max) {
      map.set(key, hits);
      return false;
    }
    hits.push(t);
    map.set(key, hits);
    return true;
  }

  allowCreate(ip: string): boolean {
    return this.hit(this.createHits, ip, CREATE_MAX, CREATE_WINDOW_MS);
  }

  allowJoin(ip: string): boolean {
    return this.hit(this.joinHits, ip, JOIN_MAX, JOIN_WINDOW_MS);
  }

  isJoinLocked(ip: string, code: string): boolean {
    const entry = this.joinFails.get(`${ip}:${code}`);
    return entry !== undefined && entry.lockedUntil > this.now();
  }

  /** join 失败计数；窗口内累计到阈值后锁定该 (ip, code) 组合 */
  registerJoinFail(ip: string, code: string): void {
    const key = `${ip}:${code}`;
    const t = this.now();
    const entry = this.joinFails.get(key);
    if (!entry || t > entry.windowUntil) {
      this.joinFails.set(key, { count: 1, windowUntil: t + JOIN_FAIL_WINDOW_MS, lockedUntil: 0 });
      return;
    }
    entry.count += 1;
    if (entry.count >= JOIN_FAIL_MAX) {
      entry.lockedUntil = t + JOIN_FAIL_LOCK_MS;
    }
  }

  sweep(): void {
    const t = this.now();
    for (const [key, hits] of this.createHits) {
      if (hits.every((x) => t - x >= ENTRY_RETENTION_MS)) this.createHits.delete(key);
    }
    for (const [key, hits] of this.joinHits) {
      if (hits.every((x) => t - x >= ENTRY_RETENTION_MS)) this.joinHits.delete(key);
    }
    for (const [key, entry] of this.joinFails) {
      if (t > entry.lockedUntil && t > entry.windowUntil + ENTRY_RETENTION_MS) {
        this.joinFails.delete(key);
      }
    }
  }
}
