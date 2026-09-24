import { Button, Card, ScrollShadow, toast } from '@heroui/react';
import { ArrowDown, Copy, FileUp, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock } from '../lib/format';
import { useChat } from '../stores/chat';
import { FileCard } from './FileCard';
import { Identicon } from './Identicon';

interface MessageListProps {
  onCancel: (fileId: string) => void;
  onRetry: (fileId: string) => void;
  onDownload: (transfer: { blobUrl?: string; name: string }) => void;
  /** 对方临时头像种子（房间码:角色），双方独立计算结果一致 */
  peerSeed: string;
  /** 房间已连接时，打开文件选择器。未传入时不显示快捷操作。 */
  onPickFiles?: () => void;
}

export function MessageList({
  onCancel,
  onRetry,
  onDownload,
  peerSeed,
  onPickFiles,
}: MessageListProps) {
  const items = useChat((state) => state.items);
  const transfers = useChat((state) => state.transfers);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showBackToBottom, setShowBackToBottom] = useState(false);
  const hasConversationItems = items.some((item) => item.kind === 'text' || item.kind === 'file');

  const updateScrollPosition = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const isAtBottom = distance < 120;
    stickToBottom.current = isAtBottom;
    setShowBackToBottom(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    stickToBottom.current = true;
    setShowBackToBottom(false);
    if (behavior === 'smooth' && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 以消息数变化作为滚动到底部的触发器
  useEffect(() => {
    if (!stickToBottom.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [items.length, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollShadow
        ref={scrollerRef}
        className="h-full min-h-0"
        orientation="vertical"
        role="log"
        aria-label="房间消息"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={updateScrollPosition}
      >
        <div className="mx-auto flex min-h-full w-full flex-col gap-3 px-3 py-4">
          {items.map((item) => {
            if (item.kind === 'system') {
              return (
                <div key={item.key} className="my-1 text-center text-xs text-muted">
                  {item.text}
                </div>
              );
            }
            if (item.kind === 'text') {
              return (
                <div
                  key={item.key}
                  className={`group flex items-start gap-2.5 ${item.mine ? 'flex-row-reverse self-end' : 'self-start'}`}
                >
                  {!item.mine && (
                    <Identicon
                      seed={peerSeed}
                      size={32}
                      className="mt-0.5 shrink-0 border border-separator bg-background"
                    />
                  )}
                  <div
                    className={`max-w-[85%] rounded-[20px] px-3.5 py-2 text-sm leading-relaxed break-words sm:max-w-[70%] ${
                      item.mine ? 'bg-accent text-accent-foreground' : 'bg-default text-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{item.text}</p>
                    <div className="mt-1 flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        isIconOnly
                        aria-label="复制消息"
                        className="size-6 min-w-6 rounded-full opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"
                        onPress={() => {
                          void navigator.clipboard
                            .writeText(item.text ?? '')
                            .then(() => toast.success('已复制'))
                            .catch(() => toast.danger('复制失败'));
                        }}
                      >
                        <Copy className="size-3" />
                      </Button>
                      <span className="text-[11px] opacity-55">{formatClock(item.at)}</span>
                    </div>
                  </div>
                </div>
              );
            }
            const transfer = item.fileId ? transfers[item.fileId] : undefined;
            if (!transfer) return null;
            return (
              <div
                key={item.key}
                className={`flex items-start gap-2.5 ${item.mine ? 'flex-row-reverse self-end' : 'self-start'}`}
              >
                {!item.mine && (
                  <Identicon
                    seed={peerSeed}
                    size={32}
                    className="mt-0.5 shrink-0 border border-separator bg-background"
                  />
                )}
                <div className="min-w-0 max-w-full flex-1 sm:max-w-[420px]">
                  <FileCard
                    transfer={transfer}
                    onCancel={onCancel}
                    onRetry={onRetry}
                    onDownload={(t) => onDownload(t)}
                  />
                </div>
              </div>
            );
          })}
          {!hasConversationItems && (
            <div className="flex flex-1 items-center justify-center py-8">
              <Card
                variant="transparent"
                className="w-full max-w-sm items-center gap-4 text-center"
              >
                <div className="rounded-full bg-accent-soft p-3 text-accent-soft-foreground">
                  <MessageCircle className="size-6" />
                </div>
                <Card.Header className="items-center gap-1">
                  <Card.Title>已连接，可以开始传输</Card.Title>
                  <Card.Description>
                    发送消息、拖入文件或粘贴截图，内容只在这次会话中保留。
                  </Card.Description>
                </Card.Header>
                {onPickFiles && (
                  <Card.Footer className="w-full">
                    <Button variant="primary" fullWidth onPress={onPickFiles}>
                      <FileUp className="size-4" />
                      选择文件
                    </Button>
                  </Card.Footer>
                )}
              </Card>
            </div>
          )}
        </div>
      </ScrollShadow>
      {showBackToBottom && items.length > 0 && (
        <Button
          variant="secondary"
          isIconOnly
          aria-label="回到底部"
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
          onPress={() => scrollToBottom('smooth')}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}
