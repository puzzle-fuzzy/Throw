import { AlertDialog, Button, Chip, Dropdown, Tooltip, toast } from '@heroui/react';
import { Copy, Link2, LogOut, MoonStar, MoreHorizontal, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCountdown } from '../lib/format';
import { useRoom } from '../stores/room';

interface RoomHeaderProps {
  code: string;
  onLeave: () => void;
  onToggleTheme: () => void;
}

export function RoomHeader({ code, onLeave, onToggleTheme }: RoomHeaderProps) {
  const phase = useRoom((state) => state.phase);
  const channel = useRoom((state) => state.channel);
  const wsStatus = useRoom((state) => state.wsStatus);
  const expiresAt = useRoom((state) => state.expiresAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    toast.success('房间码已复制');
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
    toast.success('邀请链接已复制');
  };

  return (
    <header className="relative flex items-center gap-2 border-b border-separator px-4 py-2.5">
      <Tooltip>
        <Tooltip.Trigger>
          <Button variant="ghost" size="sm" onPress={() => void copyCode()} aria-label="复制房间码">
            <Copy className="size-3.5 text-muted" />
            <span className="font-mono text-sm font-semibold tracking-widest">{code}</span>
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          <Tooltip.Arrow />
          点击复制房间码
        </Tooltip.Content>
      </Tooltip>

      {phase === 'connected' &&
        (channel === 'p2p' ? (
          <Chip size="sm" color="accent" variant="soft">
            P2P 已连接
          </Chip>
        ) : channel === 'relay' ? (
          <Chip size="sm" variant="secondary">
            中转模式
          </Chip>
        ) : null)}

      {phase === 'connected' && expiresAt !== null && (
        <Tooltip>
          <Tooltip.Trigger>
            <span className="flex items-center gap-1 text-xs text-muted">
              <Timer className="size-3.5" />
              {formatCountdown(expiresAt, now)}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <Tooltip.Arrow />
            文件传输空闲 30 分钟后房间自动关闭；新的传输会重置倒计时
          </Tooltip.Content>
        </Tooltip>
      )}

      {wsStatus === 'reconnecting' && (
        <span className="text-xs text-warning-soft-foreground">重连中…</span>
      )}

      <div className="ms-auto flex items-center gap-0.5">
        <Dropdown>
          <Dropdown.Trigger>
            <Button variant="ghost" isIconOnly aria-label="房间操作">
              <MoreHorizontal className="size-5" />
            </Button>
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu
              onAction={(key) => {
                if (key === 'copy-link') void copyLink();
                if (key === 'theme') onToggleTheme();
              }}
            >
              <Dropdown.Item id="copy-link" textValue="复制邀请链接">
                <Link2 className="size-4 shrink-0 text-muted" />
                复制邀请链接
              </Dropdown.Item>
              <Dropdown.Item id="theme" textValue="切换主题">
                <MoonStar className="size-4 shrink-0 text-muted" />
                切换亮暗主题
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        <AlertDialog>
          <Button variant="ghost" size="sm" aria-label="离开房间">
            <LogOut className="size-4" />
            离开
          </Button>
          <AlertDialog.Backdrop>
            <AlertDialog.Container>
              <AlertDialog.Dialog>
                <AlertDialog.Header>
                  <AlertDialog.Heading>离开房间？</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  离开后房间将被销毁，未完成的传输会中止，本会话记录不会保留。
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button variant="tertiary">取消</Button>
                  <Button variant="danger" onPress={onLeave}>
                    离开并销毁
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      </div>
    </header>
  );
}
