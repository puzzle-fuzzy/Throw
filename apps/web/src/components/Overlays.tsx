import { Alert, Button, Card, Skeleton, Spinner } from '@heroui/react';
import { DoorClosed, Home, UserRoundX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCountdown } from '../lib/format';

/** 连接中：整页骨架 */
export function ConnectingOverlay() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <Card aria-busy="true" className="w-full max-w-sm p-0">
        <Card.Header className="flex-col items-center gap-3 px-6 pt-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-default text-foreground">
            <Spinner size="lg" />
          </div>
          <div className="space-y-1">
            <Card.Title>正在连接房间</Card.Title>
            <Card.Description>正在验证邀请并建立安全连接。</Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="space-y-4 px-6 py-5" aria-hidden="true">
          <div className="space-y-2">
            <Skeleton className="h-3 w-2/5 rounded" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-3/5 rounded" />
            <Skeleton className="h-3 w-full rounded" />
          </div>
        </Card.Content>
        <Card.Footer className="px-6 pb-6 pt-0">
          <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
            <Spinner color="current" size="sm" />
            连接完成后即可开始传输
          </p>
        </Card.Footer>
      </Card>
    </div>
  );
}

interface EndOverlayProps {
  closeReason?: 'manual' | 'expired' | null;
  onHome: () => void;
}

/** 终态覆盖层：仅用于已关闭或过期的房间。 */
export function EndOverlay({ closeReason, onHome }: EndOverlayProps) {
  const title = closeReason === 'expired' ? '房间已过期' : '房间已关闭';
  const description =
    closeReason === 'expired'
      ? '房间有效期已结束，无法继续发送消息或文件。'
      : '房间已被关闭，无法继续发送消息或文件。';

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-0">
        <Card.Header className="flex-col items-center gap-3 px-6 pt-6 text-center">
          <div className="rounded-full bg-default p-3 text-foreground">
            <DoorClosed aria-hidden="true" className="size-6" />
          </div>
          <div className="space-y-1">
            <Card.Title>{title}</Card.Title>
            <Card.Description>{description}</Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="px-6 py-5 text-center text-sm text-muted">
          要继续传输，请从首页创建新房间，或使用新的邀请链接加入房间。
        </Card.Content>
        <Card.Footer className="px-6 pb-6 pt-0">
          <Button fullWidth variant="primary" onPress={onHome}>
            <Home className="size-4" />
            返回首页
          </Button>
        </Card.Footer>
      </Card>
    </div>
  );
}

interface PeerLeftNoticeProps {
  reconnectAt: number | null;
}

/** 非阻断提醒：历史保留，对方仍可在服务端宽限期内恢复原会话。 */
export function PeerLeftNotice({ reconnectAt }: PeerLeftNoticeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (reconnectAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [reconnectAt]);

  const canReconnect = reconnectAt !== null && reconnectAt > now;
  const description = canReconnect
    ? `对方可在 ${formatCountdown(reconnectAt, now)} 内恢复当前会话；聊天记录会保留在当前页面。`
    : '对方的可重连窗口已结束。聊天记录会保留到当前房间关闭，但无法继续传输。';

  return (
    <div className="px-4 pt-3">
      <Alert status="warning">
        <Alert.Indicator>
          <UserRoundX aria-hidden="true" className="size-4" />
        </Alert.Indicator>
        <Alert.Content>
          <Alert.Title>对方暂时离开</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
        </Alert.Content>
      </Alert>
    </div>
  );
}
