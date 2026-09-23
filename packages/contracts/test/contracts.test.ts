import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import {
  ClientMessageSchema,
  FileMetaSchema,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ServerMessageSchema,
} from '../src';

describe('room code', () => {
  test('生成 6 位且全部落在字母表内', () => {
    for (let i = 0; i < 200; i++) {
      const random = new Uint8Array(6).map(() => Math.floor(Math.random() * 256));
      const code = generateRoomCode(random);
      expect(code.length).toBe(6);
      expect(isValidRoomCode(code)).toBeTrue();
    }
  });

  test('随机字节不足时抛错', () => {
    expect(() => generateRoomCode(new Uint8Array(3))).toThrow();
  });

  test('归一化：小写/连字符/混淆字符', () => {
    expect(normalizeRoomCode('abc-123')).toBe('ABC123');
    expect(normalizeRoomCode(' abil0u ')).toBe('AB110V');
    expect(normalizeRoomCode('o0i1l')).toBe('00111');
  });

  test('合法与非法码校验', () => {
    expect(isValidRoomCode('ABC123')).toBeTrue();
    expect(isValidRoomCode('AB1')).toBeFalse();
    expect(isValidRoomCode('ABC1234')).toBeFalse();
    expect(isValidRoomCode('ABCI23')).toBeFalse(); // I 不在字母表
    expect(isValidRoomCode(...['ABC123'.split('').reverse().join('')])).toBeTrue();
    expect(ROOM_CODE_ALPHABET).not.toContain('I');
    expect(ROOM_CODE_ALPHABET).not.toContain('L');
    expect(ROOM_CODE_ALPHABET).not.toContain('O');
    expect(ROOM_CODE_ALPHABET).not.toContain('U');
  });
});

describe('message schema', () => {
  const meta = { fileId: 'f_01', name: 'a.png', size: 10, mime: 'image/png' };

  test('合法消息通过', () => {
    expect(Value.Check(ClientMessageSchema, { type: 'ping' })).toBeTrue();
    expect(Value.Check(ClientMessageSchema, { type: 'hello', token: 't' })).toBeTrue();
    expect(
      Value.Check(ClientMessageSchema, { type: 'file-offer', file: meta, channel: 'relay' }),
    ).toBeTrue();
    expect(Value.Check(ServerMessageSchema, { type: 'relay-notify', file: meta })).toBeTrue();
    expect(
      Value.Check(ServerMessageSchema, { type: 'peer-left', reason: 'disconnect' }),
    ).toBeTrue();
  });

  test('超限文件被拒', () => {
    const big = { ...meta, size: 100 * 1024 * 1024 + 1 };
    expect(Value.Check(FileMetaSchema, big)).toBeFalse();
  });

  test('未知 type / 超长文本被拒', () => {
    expect(Value.Check(ClientMessageSchema, { type: 'nope' })).toBeFalse();
    expect(
      Value.Check(ClientMessageSchema, { type: 'text', id: '1', content: 'x'.repeat(8001) }),
    ).toBeFalse();
    expect(
      Value.Check(ClientMessageSchema, { type: 'text', id: '1', content: 'x'.repeat(8000) }),
    ).toBeTrue();
  });
});
