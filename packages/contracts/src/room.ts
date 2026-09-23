/** Crockford Base32 字母表（排除 I、L、O、U，避免肉眼混淆） */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 6;

/** 输入容错归一化：去空白与连字符、转大写、I/L→1、O→0、U→V（Crockford 解码映射） */
const DECODE_MAP: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

export function normalizeRoomCode(input: string): string {
  const upper = input.trim().toUpperCase().replaceAll('-', '');
  let out = '';
  for (const ch of upper) {
    out += DECODE_MAP[ch] ?? ch;
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * 由随机字节生成房间码（纯函数；32 整除 256，无拒绝采样损耗，6 字节恰好 6 字符）。
 * 调用方注入随机源（crypto.getRandomValues），便于测试。
 */
export function generateRoomCode(randomBytes: Uint8Array): string {
  if (randomBytes.length < ROOM_CODE_LENGTH) {
    throw new Error(`generateRoomCode needs at least ${ROOM_CODE_LENGTH} random bytes`);
  }
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomBytes[i]! % 32];
  }
  return code;
}

// REST DTO 不在此定义：路由 schema 由 apps/api 用 Elysia 内联 t 声明（Eden 类型推断），
// 前端经 treaty 取类型，避免同一契约两套 schema 漂移。
