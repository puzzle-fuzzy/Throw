import { toast } from '@heroui/react';
import { LIMITS, type ServerMessage } from '@throw/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { TransferManager } from '../lib/transfer';
import { RoomSocket } from '../lib/ws-client';
import { useChat } from '../stores/chat';
import { useRoom } from '../stores/room';
import type { RoomSession } from '../stores/session';

interface UseRoomConnectionResult {
  leave: () => void;
  sendText: (content: string) => boolean;
  sendFiles: (files: File[]) => Promise<void>;
  cancelTransfer: (fileId: string) => void;
  retryTransfer: (fileId: string) => void;
}

/**
 * 房间生命周期接线：RoomSocket（心跳/重连）+ TransferManager（自适应传输）→ zustand stores。
 * 挂载时创建、卸载时销毁；同一房间会话期间保持单例。返回的方法在调用时读取内部 ref。
 */
export function useRoomConnection(session: RoomSession): UseRoomConnectionResult {
  const managerRef = useRef<TransferManager | null>(null);
  const socketRef = useRef<RoomSocket | null>(null);

  const leave = useCallback(() => {
    const socket = socketRef.current;
    const manager = managerRef.current;
    socket?.send({ type: 'leave' });
    socket?.close();
    manager?.stop();
    useChat.getState().clear();
    useRoom.getState().reset();
  }, []);

  const sendText = useCallback((content: string): boolean => {
    const id = crypto.randomUUID();
    const ok = socketRef.current?.send({ type: 'text', id, content }) ?? false;
    if (ok) {
      useChat.getState().addText({ id, mine: true, content });
    }
    return ok;
  }, []);

  const sendFiles = useCallback(async (files: File[]) => {
    await managerRef.current?.sendFiles(files);
  }, []);

  const cancelTransfer = useCallback((fileId: string) => {
    managerRef.current?.cancel(fileId);
  }, []);

  const retryTransfer = useCallback((fileId: string) => {
    void managerRef.current?.retry(fileId);
  }, []);

  useEffect(() => {
    if (!session.token) return; // 直达链接等场景：无会话不连接（页面会重定向回首页）

    const forceRelay = new URLSearchParams(location.search).has('relay');
    useRoom.getState().setForceRelay(forceRelay);

    const manager = new TransferManager({
      socket: {
        send: (msg) => socketRef.current?.send(msg) ?? false,
      },
      role: session.role,
      forceRelay: forceRelay,
      onChannelChange: (channel) => useRoom.getState().setChannel(channel),
      onSystem: (text) => useChat.getState().addSystem(text),
      onTransferActivity: () =>
        useRoom.getState().setExpiresAt(Date.now() + LIMITS.TRANSFER_IDLE_EXPIRE_MS),
    });
    manager.sessionRef = { code: session.code, token: session.token };
    managerRef.current = manager;
    if (import.meta.env.DEV) {
      (window as unknown as { __throwManager?: unknown }).__throwManager = manager;
    }

    const handleMessage = (msg: ServerMessage) => {
      const store = useRoom.getState();
      const chat = useChat.getState();
      switch (msg.type) {
        case 'joined':
          store.setExpiresAt(msg.room.expiresAt);
          store.setPeer(msg.peer);
          store.setPhase(msg.room.status === 'active' ? 'connected' : 'waiting');
          return;
        case 'peer-joined':
          store.setPeer(msg.peer);
          store.setPhase('connected');
          // 房间转入 active：空闲倒计时从 30 分钟起算（等待期的 2 小时语义失效）
          store.setExpiresAt(Date.now() + LIMITS.TRANSFER_IDLE_EXPIRE_MS);
          chat.addSystem(`${msg.peer.nickname ?? '游客'} 已加入房间`);
          return;
        case 'peer-left':
          store.setPhase('peer-left');
          chat.addSystem(msg.reason === 'leave' ? '对方离开了房间' : '对方连接中断');
          return;
        case 'room-closed':
          store.markClosed(msg.reason);
          chat.addSystem(msg.reason === 'manual' ? '房间已关闭' : '房间已过期');
          socketRef.current?.close();
          manager.stop();
          return;
        case 'text':
          chat.addText({ id: msg.id, mine: false, content: msg.content });
          return;
        case 'signal':
          void manager.handleSignal(msg.payload);
          return;
        case 'error':
          if (msg.code === 'PEER_OFFLINE') {
            toast.warning('对方暂不在线，消息未送达');
          } else {
            toast.danger(msg.message);
          }
          return;
        default:
          manager.handleServerMessage(msg);
      }
    };

    const socket = new RoomSocket({
      token: session.token,
      onMessage: handleMessage,
      onStatus: (status, attempt) => useRoom.getState().setWsStatus(status, attempt),
      onDead: (reason) => {
        useRoom.getState().markClosed('expired');
        useChat.getState().addSystem(reason === 'unauthorized' ? '会话已失效' : '房间已关闭');
        manager.stop();
      },
    });
    socketRef.current = socket;
    // manager 的 socket 依赖已就位（send 闭包读 socketRef）
    socket.start();

    return () => {
      socket.close();
      manager.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 单例按 token 初始化
  }, [session.token, session.code, session.role]);

  return { leave, sendText, sendFiles, cancelTransfer, retryTransfer };
}
