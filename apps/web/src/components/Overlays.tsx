import { Button, Card, Spinner } from '@heroui/react';
import { DoorOpen, Plus, UserX } from 'lucide-react';

/** 连接中：整页骨架 */
export function ConnectingOverlay() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-muted">
      <Spinner size="lg" />
      <p className="text-sm">正在连接房间…</p>
    </div>
  );
}

interface EndOverlayProps {
  kind: 'peer-left' | 'closed';
  closeReason?: 'manual' | 'expired' | null;
  onRecreate: () => void;
  onHome: () => void;
}

/** 终态覆盖层：对方离开（可等待）/ 房间关闭或过期 */
export function EndOverlay({ kind, closeReason, onRecreate, onHome }: EndOverlayProps) {
  const title =
    kind === 'peer-left'
      ? '对方已离开'
      : closeReason === 'manual'
        ? '房间已关闭'
        : closeReason === 'expired'
          ? '房间已过期'
          : '会话已失效';
  const description =
    kind === 'peer-left'
      ? '对方可能掉线或关闭了页面。房间保留期间可以用原链接回来，但本会话记录不会同步给新加入的设备。'
      : '房间已销毁，服务器上的中转文件已删除。';

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-0">
        <Card.Content className="flex flex-col items-center gap-4 p-6">
          <div className="rounded-full bg-default p-3 text-foreground">
            {kind === 'peer-left' ? <UserX className="size-6" /> : <DoorOpen className="size-6" />}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button variant="primary" onPress={onRecreate}>
              <Plus className="size-4" />
              重新创建房间
            </Button>
            <Button variant="tertiary" onPress={onHome}>
              返回首页
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
