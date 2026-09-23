import { type Static, Type as t } from '@sinclair/typebox';
import { LIMITS } from './constants';

/** WebRTC 信令载荷（服务器只透传信封，不解释 SDP 细节） */
export const SignalPayloadSchema = t.Union([
  t.Object({ kind: t.Literal('offer'), sdp: t.String({ maxLength: 64 * 1024 }) }),
  t.Object({ kind: t.Literal('answer'), sdp: t.String({ maxLength: 64 * 1024 }) }),
  t.Object({
    kind: t.Literal('candidate'),
    candidate: t.String({ maxLength: 1024 }),
    sdpMid: t.Union([t.String({ maxLength: 64 }), t.Null()]),
    sdpMLineIndex: t.Optional(t.Number()),
  }),
]);
export type SignalPayload = Static<typeof SignalPayloadSchema>;

/** 文件元数据（file-offer 携带；P2P 与中转共用） */
export const FileMetaSchema = t.Object({
  fileId: t.String({ maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' }),
  name: t.String({ minLength: 1, maxLength: LIMITS.MAX_FILE_NAME_CHARS }),
  size: t.Integer({ minimum: 0, maximum: LIMITS.MAX_FILE_BYTES }),
  mime: t.String({ maxLength: LIMITS.MAX_MIME_CHARS }),
});
export type FileMeta = Static<typeof FileMetaSchema>;

export const FILE_CHANNEL_VALUES = ['p2p', 'relay'] as const;
export type FileChannel = (typeof FILE_CHANNEL_VALUES)[number];

/** 客户端 → 服务端（WS 首帧 hello 鉴权，之后按 type 分发） */
export const ClientMessageSchema = t.Union([
  t.Object({ type: t.Literal('hello'), token: t.String({ maxLength: 128 }) }),
  t.Object({ type: t.Literal('ping') }),
  t.Object({ type: t.Literal('leave') }),
  t.Object({ type: t.Literal('signal'), payload: SignalPayloadSchema }),
  t.Object({
    type: t.Literal('text'),
    id: t.String({ maxLength: 64 }),
    content: t.String({ minLength: 1, maxLength: LIMITS.MAX_TEXT_CHARS }),
  }),
  t.Object({
    type: t.Literal('file-offer'),
    file: FileMetaSchema,
    channel: t.Union([t.Literal('p2p'), t.Literal('relay')]),
  }),
  t.Object({
    type: t.Literal('file-cancel'),
    fileId: t.String({ maxLength: 64 }),
    reason: t.Optional(t.String({ maxLength: 128 })),
  }),
  t.Object({ type: t.Literal('relay-downloaded'), fileId: t.String({ maxLength: 64 }) }),
]);
export type ClientMessage = Static<typeof ClientMessageSchema>;

export const PeerInfoSchema = t.Object({
  nickname: t.Union([t.String(), t.Null()]),
});
export type PeerInfo = Static<typeof PeerInfoSchema>;

export const RoomInfoSchema = t.Object({
  code: t.String(),
  status: t.Union([t.Literal('waiting'), t.Literal('active')]),
  expiresAt: t.Number(),
});
export type RoomInfo = Static<typeof RoomInfoSchema>;

/** 服务端 → 客户端 */
export const ServerMessageSchema = t.Union([
  t.Object({
    type: t.Literal('joined'),
    room: RoomInfoSchema,
    peer: t.Union([PeerInfoSchema, t.Null()]),
  }),
  t.Object({ type: t.Literal('peer-joined'), peer: PeerInfoSchema }),
  t.Object({
    type: t.Literal('peer-left'),
    reason: t.Union([t.Literal('leave'), t.Literal('disconnect')]),
  }),
  t.Object({
    type: t.Literal('room-closed'),
    reason: t.Union([t.Literal('manual'), t.Literal('expired')]),
  }),
  t.Object({ type: t.Literal('pong') }),
  t.Object({ type: t.Literal('signal'), payload: SignalPayloadSchema }),
  t.Object({
    type: t.Literal('text'),
    id: t.String(),
    from: PeerInfoSchema,
    content: t.String(),
  }),
  t.Object({
    type: t.Literal('file-offer'),
    file: FileMetaSchema,
    channel: t.Union([t.Literal('p2p'), t.Literal('relay')]),
    from: PeerInfoSchema,
  }),
  t.Object({ type: t.Literal('file-cancel'), fileId: t.String() }),
  /** 中转文件上传完成，接收方可以开始下载 */
  t.Object({ type: t.Literal('relay-notify'), file: FileMetaSchema }),
  /** 接收方完成下载（relay-downloaded 的回执，转发给发送方） */
  t.Object({ type: t.Literal('file-complete'), fileId: t.String() }),
  t.Object({ type: t.Literal('error'), code: t.String(), message: t.String() }),
]);
export type ServerMessage = Static<typeof ServerMessageSchema>;
