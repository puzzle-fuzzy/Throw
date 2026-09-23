import type { RateLimiter } from './domain/rateLimiter';
import type { RoomService } from './domain/roomService';
import type { Logger } from './log';
import type { RelayService } from './services/relayService';

export interface SweepDeps {
  rooms: RoomService;
  relay: RelayService;
  limiter: RateLimiter;
  logger: Logger;
}

/** 周期清扫：过期房间/成员、超 TTL 中转文件、限流残留。返回停止函数。 */
export function startSweeping(deps: SweepDeps, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    const destroyed = deps.rooms.sweep();
    if (destroyed.length > 0) {
      deps.logger.info({ destroyed: destroyed.length }, 'sweep: 过期房间销毁');
    }
    void deps.relay.sweep();
    deps.limiter.sweep();
  }, intervalMs);
  return () => clearInterval(timer);
}
