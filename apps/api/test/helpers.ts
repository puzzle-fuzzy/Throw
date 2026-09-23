import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS } from '@throw/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { AppDeps } from '../src/deps';
import { RateLimiter } from '../src/domain/rateLimiter';
import { RoomService } from '../src/domain/roomService';
import { createLogger } from '../src/log';
import { RelayService } from '../src/services/relayService';
import { DiskRelayStorage } from '../src/services/relayStorage';
import { WsHub } from '../src/ws/hub';

export interface CreateRoomOk {
  code: string;
  token: string;
  expiresAt: number;
}

export interface TestContext {
  deps: AppDeps;
  rooms: RoomService;
  relay: RelayService;
  limiter: RateLimiter;
  storage: DiskRelayStorage;
  tmpDir: string;
  destroyedRooms: string[];
  app: ReturnType<typeof buildApp>;
}

export type LimitsOverride = Partial<Record<keyof typeof LIMITS, number>>;

export async function makeContext(options?: {
  limits?: LimitsOverride;
  publicOrigins?: string[];
  loggerLevel?: string;
}): Promise<TestContext> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'throw-test-'));
  const config = loadConfig({
    APP_ENV: 'test',
    TMP_DIR: tmpDir,
    PUBLIC_ORIGIN: options?.publicOrigins?.join(','),
  });
  const logger = createLogger(options?.loggerLevel ?? 'silent');
  const storage = new DiskRelayStorage(tmpDir);
  await storage.init();

  const destroyedRooms: string[] = [];
  let relay: RelayService | undefined;
  let seq = 0;
  // 固定合法码轮换（字母表排除 I/L/O/U，A–H 安全）
  const TEST_CODES = [
    'AAAAAA',
    'BBBBBB',
    'CCCCCC',
    'DDDDDD',
    'EEEEEE',
    'FFFFFF',
    'GGGGGG',
    'HHHHHH',
  ];
  const rooms = new RoomService({
    now: () => Date.now(),
    generateCode: () => TEST_CODES[seq++ % TEST_CODES.length]!,
    generateToken: () => `token-${seq++}-${Math.random().toString(36).slice(2, 8)}`,
    onRoomDestroyed: async (code) => {
      destroyedRooms.push(code);
      await relay?.deleteRoomFiles(code);
    },
  });
  relay = new RelayService({
    storage,
    now: () => Date.now(),
    notifyRoom: (code, msg) => rooms.broadcastCode(code, msg),
    limits: options?.limits ? ({ ...LIMITS, ...options.limits } as typeof LIMITS) : undefined,
  });
  const limiter = new RateLimiter();
  const hub = new WsHub({ rooms, relay, logger });

  const deps: AppDeps = { config, logger, rooms, relay, limiter, hub };
  return { deps, rooms, relay, limiter, storage, tmpDir, destroyedRooms, app: buildApp(deps) };
}
