import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type AppEnv = 'development' | 'production' | 'test';

export interface AppConfig {
  env: AppEnv;
  host: string;
  port: number;
  /** 允许的前端 origin（尾斜杠归一）；true = 不限制（仅限开发/测试） */
  publicOrigins: string[] | true;
  tmpDir: string;
  logLevel: string;
}

const ENV_VALUES = ['development', 'production', 'test'] as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const raw = env.APP_ENV ?? 'development';
  if (!(ENV_VALUES as readonly string[]).includes(raw)) {
    throw new Error(`APP_ENV 非法: ${raw}（可选 ${ENV_VALUES.join('/')}）`);
  }
  const appEnv = raw as AppEnv;

  const publicOriginRaw = env.PUBLIC_ORIGIN?.trim();
  if (appEnv === 'production' && !publicOriginRaw) {
    throw new Error('production 必须配置 PUBLIC_ORIGIN（CORS 与 WebSocket Origin 校验依赖它）');
  }
  const publicOrigins: string[] | true = publicOriginRaw
    ? publicOriginRaw
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : true;

  return {
    env: appEnv,
    host: env.HOST ?? (appEnv === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port: Number(env.PORT ?? 3000),
    publicOrigins,
    tmpDir: env.TMP_DIR ?? join(tmpdir(), 'throw-relay'),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
