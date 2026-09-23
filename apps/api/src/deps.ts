import type { AppConfig } from './config';
import type { RateLimiter } from './domain/rateLimiter';
import type { RoomService } from './domain/roomService';
import type { Logger } from './log';
import type { RelayService } from './services/relayService';
import type { WsHub } from './ws/hub';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  rooms: RoomService;
  relay: RelayService;
  limiter: RateLimiter;
  hub: WsHub;
}
