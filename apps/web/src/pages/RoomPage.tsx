import { Surface, toast } from '@heroui/react';
import { LIMITS, normalizeRoomCode } from '@throw/contracts';
import { FileUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { InputBar } from '../components/InputBar';
import { MessageList } from '../components/MessageList';
import { ConnectingOverlay, EndOverlay, PeerLeftNotice } from '../components/Overlays';
import { RoomHeader } from '../components/RoomHeader';
import { WaitingPanel } from '../components/WaitingPanel';
import { useRoomConnection } from '../hooks/useRoom';
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
  const peerLeftAt = useRoom((state) => state.peerLeftAt);
  const expiresAt = useRoom((state) => state.expiresAt);
  const [dragging, setDragging] = useState(false);
  const [redirected, setRedirected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const canTransfer = phase === 'connected' && wsStatus === 'open';
  const reconnectAt = peerLeftAt === null ? null : peerLeftAt + LIMITS.GRACE_MS;

  // beforeunload 守卫：会话进行中离开页面提示（刷新/关闭都会丢会话）
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'connected' && phase !== 'peer-left') return;
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
      if (!canTransfer || files.length === 0) return;
      void connection.sendFiles(files).catch((error: unknown) => {
        toast.danger(error instanceof Error ? error.message : '文件发送失败');
      });
    },
    [canTransfer, connection],
  );

  const handleOpenFilePicker = useCallback(() => {
    if (canTransfer) fileInputRef.current?.click();
  }, [canTransfer]);

  // 全页拖拽 + 粘贴截图
  const dragDepth = useRef(0);
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (!canTransfer) return;
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
      if (!canTransfer) return;
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
  }, [canTransfer, handlePickFiles]);

  useEffect(() => {
    if (canTransfer) return;
    dragDepth.current = 0;
    setDragging(false);
  }, [canTransfer]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        if (!canTransfer) return;
        handlePickFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canTransfer, handlePickFiles]);

  const exitRoom = useCallback(() => {
    connection.leave();
    setSessionRoom(null);
    navigate('/', { replace: true });
  }, [connection, setSessionRoom, navigate]);

  const handleDownload = useCallback((transfer: { blobUrl?: string; name: string }) => {
    if (!transfer.blobUrl) return;
    const anchor = document.createElement('a');
    anchor.href = transfer.blobUrl;
    anchor.download = transfer.name;
    anchor.click();
  }, []);

  if (!session) {
    return <ConnectingOverlay />;
  }

  const inputDisabled = wsStatus !== 'open';

  return (
    <Surface
      role="main"
      variant="default"
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-background md:my-4 md:h-[calc(100dvh-2rem)] md:rounded-2xl md:border md:border-separator md:shadow-sm"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          handlePickFiles(files);
        }}
      />
      <RoomHeader code={code} onLeave={exitRoom} onToggleTheme={toggle} />

      {phase === 'connecting' && <ConnectingOverlay />}
      {phase === 'waiting' && <WaitingPanel code={code} expiresAt={expiresAt} />}
      {(phase === 'connected' || phase === 'peer-left') && (
        <>
          {phase === 'peer-left' && <PeerLeftNotice reconnectAt={reconnectAt} />}
          <MessageList
            onCancel={connection.cancelTransfer}
            onRetry={connection.retryTransfer}
            onDownload={handleDownload}
            peerSeed={peerSeed}
            onPickFiles={canTransfer ? handleOpenFilePicker : undefined}
          />
        </>
      )}

      {phase === 'connected' && (
        <InputBar
          disabled={inputDisabled}
          onSendText={handleSendText}
          onOpenFilePicker={handleOpenFilePicker}
        />
      )}

      {phase === 'closed' && <EndOverlay closeReason={closeReason} onHome={exitRoom} />}

      {dragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-accent/10 backdrop-blur-[2px]">
          <Surface className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent px-10 py-8 text-accent">
            <FileUp aria-hidden="true" className="size-10" />
            <p className="text-sm font-medium">松开即发送</p>
          </Surface>
        </div>
      )}
    </Surface>
  );
}
