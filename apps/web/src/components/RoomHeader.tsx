import { AlertDialog, Button, Chip, Dropdown, Tooltip, toast } from '@heroui/react';
import { Copy, Link2, LogOut, MoonStar, MoreHorizontal, Send, Timer } from 'lucide-react';
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
  const wsStatus = useRoom((state) => state.wsStatus);
  const expiresAt = useRoom((state) => state.expiresAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('房间码已复制');
    } catch {
      toast.danger('无法复制，请检查浏览器权限后重试');
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
      toast.success('邀请链接已复制');
    } catch {
      toast.danger('无法复制，请检查浏览器权限后重试');
    }
  };

  // `channel` is decided per file transfer. The header instead describes the room and peer state,
  // so it never implies that every message or future transfer is currently using P2P or relay.
  const roomStatus: {
    label: string;
    compactLabel: string;
    color: 'accent' | 'danger' | 'default' | 'warning';
  } =
    phase === 'closed'
      ? { label: '房间已关闭', compactLabel: '已关闭', color: 'danger' }
      : wsStatus === 'reconnecting'
        ? { label: '正在重新连接', compactLabel: '重连中', color: 'warning' }
        : wsStatus === 'connecting' || phase === 'connecting'
          ? { label: '正在连接房间', compactLabel: '连接中', color: 'accent' }
          : wsStatus === 'closed'
            ? { label: '连接已关闭', compactLabel: '已断开', color: 'danger' }
            : phase === 'peer-left'
              ? { label: '对方暂时离开', compactLabel: '对方暂离', color: 'warning' }
              : phase === 'waiting'
                ? { label: '等待对方加入', compactLabel: '等待对方', color: 'default' }
                : { label: '对方已连接', compactLabel: '已连接', color: 'accent' };
  const timeUntilExpiry = expiresAt === null ? null : formatCountdown(expiresAt, now);

  return (
    <header className="flex min-h-14 items-center gap-1.5 border-b border-separator px-3 py-2 sm:gap-2 sm:px-4">
      <Tooltip delay={400}>
        <Button
          variant="ghost"
          onPress={() => void copyCode()}
          aria-label={`复制房间码 ${code}`}
          className="min-w-0 shrink gap-2 rounded-xl px-1.5 py-1"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Send aria-hidden="true" className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="hidden text-[11px] text-muted sm:block">临时房间</span>
            <span className="font-mono text-sm font-bold tracking-[0.16em] sm:text-base sm:tracking-[0.18em]">
              {code}
            </span>
          </span>
          <Copy aria-hidden="true" className="hidden size-3.5 text-muted sm:block" />
        </Button>
        <Tooltip.Content showArrow>
          <Tooltip.Arrow />
          点击复制房间码
        </Tooltip.Content>
      </Tooltip>

      <Chip
        aria-label={roomStatus.label}
        className="shrink-0"
        color={roomStatus.color}
        size="sm"
        variant="soft"
      >
        <Chip.Label>
          <span className="sm:hidden">{roomStatus.compactLabel}</span>
          <span className="hidden sm:inline">{roomStatus.label}</span>
        </Chip.Label>
      </Chip>

      {phase === 'connected' && timeUntilExpiry !== null && (
        <span
          className="hidden shrink-0 items-center gap-1 text-xs text-muted sm:flex"
          title="文件传输空闲后房间会自动关闭；新的传输会重置倒计时"
        >
          <Timer aria-hidden="true" className="size-3.5" />
          <span className="tabular-nums">空闲 {timeUntilExpiry}</span>
        </span>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-0.5">
        <Dropdown>
          <Button variant="ghost" isIconOnly aria-label="更多房间操作">
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </Button>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label="房间操作"
              onAction={(key) => {
                if (key === 'copy-link') void copyLink();
                if (key === 'theme') onToggleTheme();
              }}
            >
              {phase === 'waiting' && (
                <Dropdown.Item id="copy-link" textValue="复制邀请链接">
                  <Link2 className="size-4 shrink-0 text-muted" />
                  复制邀请链接
                </Dropdown.Item>
              )}
              <Dropdown.Item id="theme" textValue="切换主题">
                <MoonStar className="size-4 shrink-0 text-muted" />
                切换亮暗主题
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        <AlertDialog>
          <Button
            aria-label="离开并销毁房间"
            className="min-w-10 shrink-0 px-2 sm:min-w-0 sm:px-3"
            variant="ghost"
          >
            <LogOut aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">离开</span>
          </Button>
          <AlertDialog.Backdrop>
            <AlertDialog.Container size="sm">
              <AlertDialog.Dialog>
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger">
                    <LogOut aria-hidden="true" className="size-5" />
                  </AlertDialog.Icon>
                  <AlertDialog.Heading>离开房间？</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  离开后房间将被销毁，未完成的传输会中止，本会话记录不会保留。
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="tertiary">
                    取消
                  </Button>
                  <Button slot="close" variant="danger" onPress={onLeave}>
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
