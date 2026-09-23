import { toast } from '@heroui/react';
import { normalizeRoomCode } from '@throw/contracts';
import { FileUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { InputBar } from '../components/InputBar';
import { MessageList } from '../components/MessageList';
import { ConnectingOverlay, EndOverlay } from '../components/Overlays';
import { RoomHeader } from '../components/RoomHeader';
import { WaitingPanel } from '../components/WaitingPanel';
import { useRoomConnection } from '../hooks/useRoom';
import { useChat } from '../stores/chat';
import { useRoom } from '../stores/room';
import { useSession } from '../stores/session';
import { useTheme } from '../theme';

export function RoomPage() {
  const { code: rawCode } = useParams();
  const code = normalizeRoomCode(rawCode ?? '');
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const session = useSession((state) => state.room);
  const setSessionRoom = useSession((state) => state.setRoom);
  const phase = useRoom((state) => state.phase);
  const closeReason = useRoom((state) => state.closeReason);
  const wsStatus = useRoom((state) => state.wsStatus);
  const expiresAt = useRoom((state) => state.expiresAt);
  const clearChat = useChat((state) => state.clear);
  const [dragging, setDragging] = useState(false);
  const [redirected, setRedirected] = useState(false);

  // 直达链接但没有本会话：回首页预填房间码
  useEffect(() => {
    if (!session && !redirected && code) {
      setRedirected(true);
      navigate(`/?code=${code}`, { replace: true });
    }
  }, [session, code, navigate, redirected]);

  const connection = useRoomConnection(session ?? { code, token: '', role: 'creator' as const });
  // 对方临时头像种子：双方由（房间码, 对方角色）独立算出一致结果
  const peerSeed = `${code}:${session?.role === 'joiner' ? 'creator' : 'joiner'}`;

  // beforeunload 守卫：会话进行中离开页面提示（刷新/关闭都会丢会话）
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'connected') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  const handleSendText = useCallback(
    (content: string) => {
      if (!connection.sendText(content)) {
        toast.warning('连接未就绪，消息未发送');
      }
    },
    [connection],
  );

  const handlePickFiles = useCallback(
    (files: File[]) => {
      void connection.sendFiles(files).catch((error: unknown) => {
        toast.danger(error instanceof Error ? error.message : '文件发送失败');
      });
    },
    [connection],
  );

  // 全页拖拽 + 粘贴截图
  const dragDepth = useRef(0);
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handlePickFiles(Array.from(event.dataTransfer.files));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handlePickFiles]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        handlePickFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handlePickFiles]);

  const handleLeave = useCallback(() => {
    connection.leave();
    clearChat();
    setSessionRoom(null);
    navigate('/', { replace: true });
  }, [connection, clearChat, setSessionRoom, navigate]);

  const handleDownload = useCallback((transfer: { blobUrl?: string; name: string }) => {
    if (!transfer.blobUrl) return;
    const anchor = document.createElement('a');
    anchor.href = transfer.blobUrl;
    anchor.download = transfer.name;
    anchor.click();
  }, []);

  const handleRecreate = useCallback(() => {
    connection.leave();
    clearChat();
    setSessionRoom(null);
    navigate('/', { replace: true });
  }, [connection, clearChat, setSessionRoom, navigate]);

  if (!session) {
    return <ConnectingOverlay />;
  }

  const inputDisabled = phase !== 'connected' || wsStatus !== 'open';

  return (
    <main className="relative flex h-dvh max-h-dvh flex-col">
      <RoomHeader code={code} onLeave={handleLeave} onToggleTheme={toggle} />

      {phase === 'connecting' && <ConnectingOverlay />}
      {phase === 'waiting' && <WaitingPanel code={code} expiresAt={expiresAt} />}
      {(phase === 'connected' || phase === 'peer-left') && (
        <MessageList
          onCancel={connection.cancelTransfer}
          onRetry={connection.retryTransfer}
          onDownload={handleDownload}
          peerSeed={peerSeed}
        />
      )}

      {phase !== 'closed' && (
        <InputBar
          disabled={inputDisabled}
          onSendText={handleSendText}
          onPickFiles={handlePickFiles}
        />
      )}

      {(phase === 'peer-left' || phase === 'closed') && (
        <EndOverlay
          kind={phase}
          closeReason={closeReason}
          onRecreate={handleRecreate}
          onHome={handleRecreate}
        />
      )}

      {dragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-accent/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent px-10 py-8 text-accent">
            <FileUp className="size-10" />
            <p className="text-sm font-medium">松开即发送</p>
          </div>
        </div>
      )}
    </main>
  );
}
