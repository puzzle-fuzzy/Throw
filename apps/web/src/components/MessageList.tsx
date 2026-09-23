import { Button, ScrollShadow, toast } from '@heroui/react';
import { ArrowDown, Copy } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
}

export function MessageList({ onCancel, onRetry, onDownload, peerSeed }: MessageListProps) {
  const items = useChat((state) => state.items);
  const transfers = useChat((state) => state.transfers);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickToBottom.current = distance < 120;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 以消息数变化作为滚动到底部的触发器
  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [items.length]);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollShadow className="h-full" orientation="vertical">
        <div ref={scrollerRef} className="mx-auto flex h-full flex-col gap-3 px-3 py-4">
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
                        className="size-6 min-w-6 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
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
          <div ref={bottomRef} />
        </div>
      </ScrollShadow>
      {!stickToBottom.current && items.length > 0 && (
        <button
          type="button"
          aria-label="回到底部"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-default p-2 shadow-md"
          onClick={() => {
            stickToBottom.current = true;
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
