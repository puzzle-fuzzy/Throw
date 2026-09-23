import { Button, Card, Spinner, toast } from '@heroui/react';
import { Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCountdown } from '../lib/format';

interface WaitingPanelProps {
  code: string;
  expiresAt: number | null;
}

export function WaitingPanel({ code, expiresAt }: WaitingPanelProps) {
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
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm p-0">
        <Card.Content className="flex flex-col items-center gap-4 p-6">
          <p className="text-sm text-muted">房间码</p>
          <button
            type="button"
            onClick={() => void copyCode()}
            aria-label="复制房间码"
            className="rounded-xl px-4 py-2 pl-[1.3em] font-mono text-3xl font-bold tracking-[0.3em] transition-colors hover:bg-default"
          >
            {code}
          </button>
          <div className="flex w-full flex-col gap-2">
            <Button variant="outline" fullWidth onPress={() => void copyLink()}>
              <Link2 className="size-4" />
              复制邀请链接
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            等待对方加入…
          </div>
          {expiresAt !== null && (
            <p className="text-xs text-muted">房间 {formatCountdown(expiresAt, now)} 后自动过期</p>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
