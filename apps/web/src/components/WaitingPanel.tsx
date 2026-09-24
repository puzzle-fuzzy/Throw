import { Button, Card, Spinner, toast } from '@heroui/react';
import { Clock3, Copy, Link2, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCountdown } from '../lib/format';

interface WaitingPanelProps {
  code: string;
  expiresAt: number | null;
}

export function WaitingPanel({ code, expiresAt }: WaitingPanelProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const copyToClipboard = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.danger('无法复制，请检查浏览器权限后重试');
    }
  };

  const copyCode = () => copyToClipboard(code, '房间码已复制');
  const copyLink = () => copyToClipboard(`${location.origin}/r/${code}`, '邀请链接已复制');

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md p-0">
        <Card.Header className="flex-col items-center gap-2 px-6 pt-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Link2 aria-hidden="true" className="size-5" />
          </div>
          <div className="space-y-1">
            <Card.Title>邀请一位伙伴加入</Card.Title>
            <Card.Description>分享邀请链接或房间码，连接后即可开始传输。</Card.Description>
          </div>
        </Card.Header>

        <Card.Content className="flex flex-col gap-5 px-6 py-5">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-default/60 px-4 py-4 text-center">
            <span className="text-xs font-medium text-muted">房间码</span>
            <Button
              aria-label="复制房间码"
              className="h-auto px-3 py-1 font-mono text-3xl font-bold tracking-[0.24em]"
              size="lg"
              variant="secondary"
              onPress={() => void copyCode()}
            >
              {code}
            </Button>
            <span className="text-xs text-muted">点击房间码复制</span>
          </div>

          <div
            aria-live="polite"
            className="flex items-center justify-center gap-2 text-sm text-muted"
          >
            <Spinner color="current" size="sm" />
            等待对方加入…
          </div>

          <div className="space-y-2 text-sm text-muted">
            <p className="flex items-start gap-2">
              <UsersRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              仅限你和一位对方加入，其他设备无法再进入此房间。
            </p>
            <p className="flex items-start gap-2">
              <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {expiresAt === null
                ? '对方加入前，房间会在有效期结束后自动关闭。'
                : `对方加入前，房间将在 ${formatCountdown(expiresAt, now)} 后自动关闭。`}
            </p>
          </div>
        </Card.Content>

        <Card.Footer className="flex-col gap-2 px-6 pb-6 pt-0">
          <Button fullWidth size="lg" variant="primary" onPress={() => void copyLink()}>
            <Copy className="size-4" />
            复制邀请链接
          </Button>
          <span className="text-center text-xs text-muted">请将链接发给要加入的那一位伙伴。</span>
        </Card.Footer>
      </Card>
    </div>
  );
}
