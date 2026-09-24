import { create } from 'zustand';
import type { SocketStatus } from '../lib/ws-client';

export type RoomPhase = 'connecting' | 'waiting' | 'connected' | 'peer-left' | 'closed';
export type ChannelKind = 'p2p' | 'relay' | null;

interface RoomState {
  phase: RoomPhase;
  closeReason: 'manual' | 'expired' | null;
  wsStatus: SocketStatus;
  reconnectAttempt: number;
  channel: ChannelKind;
  peer: { nickname: string | null } | null;
  /** 对方断线通知抵达客户端的时刻，用于展示可恢复宽限倒计时 */
  peerLeftAt: number | null;
  expiresAt: number | null;
  /** 调试/演示：URL ?relay=1 强制中转通道 */
  forceRelay: boolean;

  setPhase: (phase: RoomPhase) => void;
  setWsStatus: (status: SocketStatus, attempt: number) => void;
  setChannel: (channel: ChannelKind) => void;
  setPeer: (peer: { nickname: string | null } | null) => void;
  setExpiresAt: (expiresAt: number | null) => void;
  setForceRelay: (forceRelay: boolean) => void;
  markClosed: (reason: 'manual' | 'expired') => void;
  reset: () => void;
}

export const useRoom = create<RoomState>((set) => ({
  phase: 'connecting',
  closeReason: null,
  wsStatus: 'connecting',
  reconnectAttempt: 0,
  channel: null,
  peer: null,
  peerLeftAt: null,
  expiresAt: null,
  forceRelay: false,

  setPhase: (phase) =>
    set({
      phase,
      peerLeftAt: phase === 'peer-left' ? Date.now() : null,
    }),
  setWsStatus: (wsStatus, reconnectAttempt) => set({ wsStatus, reconnectAttempt }),
  setChannel: (channel) => set({ channel }),
  setPeer: (peer) => set({ peer }),
  setExpiresAt: (expiresAt) => set({ expiresAt }),
  setForceRelay: (forceRelay) => set({ forceRelay }),
  markClosed: (reason) =>
    set({
      phase: 'closed',
      closeReason: reason,
      wsStatus: 'closed',
      channel: null,
      peerLeftAt: null,
    }),
  reset: () =>
    set({
      phase: 'connecting',
      closeReason: null,
      wsStatus: 'connecting',
      reconnectAttempt: 0,
      channel: null,
      peer: null,
      peerLeftAt: null,
      expiresAt: null,
    }),
}));
