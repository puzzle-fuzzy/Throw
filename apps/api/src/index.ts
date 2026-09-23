import { getRandomValues, randomUUID } from 'node:crypto';
import { generateRoomCode } from '@throw/contracts';
import { buildApp } from './app';
import { loadConfig } from './config';
import { RateLimiter } from './domain/rateLimiter';
import { RoomService } from './domain/roomService';
import { codeHash } from './http';
import { createLogger } from './log';
import { RelayService } from './services/relayService';
import { DiskRelayStorage } from './services/relayStorage';
import { startSweeping } from './sweep';
import { WsHub } from './ws/hub';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const storage = new DiskRelayStorage(config.tmpDir);
  await storage.init();

  let relay: RelayService | undefined;
  const rooms = new RoomService({
    now: () => Date.now(),
    generateCode: () => generateRoomCode(getRandomValues(new Uint8Array(6))),
    generateToken: () => randomUUID().replaceAll('-', ''),
    onRoomDestroyed: async (code, reason, ageMs) => {
      logger.info({ event: 'room.close', room: codeHash(code), reason, ageMs }, '房间销毁');
      await relay?.deleteRoomFiles(code);
    },
  });
  relay = new RelayService({
    storage,
    now: () => Date.now(),
    notifyRoom: (code, msg) => rooms.broadcastCode(code, msg),
    logger,
  });
  const limiter = new RateLimiter();
  const hub = new WsHub({ rooms, relay, logger });

  const app = buildApp({ config, logger, rooms, relay, limiter, hub });
  app.listen({ port: config.port, hostname: config.host });
  const stopSweeping = startSweeping({ rooms, relay, limiter, logger });
  logger.info({ env: config.env, host: config.host, port: config.port }, 'Throw API 已启动');

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, '正在关停');
    stopSweeping();
    app.stop();
    void storage.wipeAll().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (import.meta.main) {
  void main();
}

/** Eden treaty 类型源：apps/web 以 `import type { App } from '@throw/api'` 消费（纯类型，无运行时引入） */
export type App = ReturnType<typeof buildApp>;
