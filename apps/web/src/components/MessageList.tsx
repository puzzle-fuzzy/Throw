import { Avatar, ScrollShadow } from '@heroui/react';
import { ArrowDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatClock } from '../lib/format';
import { useChat } from '../stores/chat';
import { FileCard } from './FileCard';

interface MessageListProps {
  onCancel: (fileId: string) => void;
  onRetry: (fileId: string) => void;
  onDownload: (transfer: { blobUrl?: string; name: string }) => void;
}

export function MessageList({ onCancel, onRetry, onDownload }: MessageListProps) {
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
                  className={`flex items-end gap-2 ${item.mine ? 'flex-row-reverse self-end' : 'self-start'}`}
                >
                  {!item.mine && (
                    <Avatar size="sm" color="default" className="shrink-0">
                      <Avatar.Fallback>{'友'}</Avatar.Fallback>
                    </Avatar>
                  )}
                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap ${
                      item.mine ? 'bg-accent text-accent-foreground' : 'bg-default text-foreground'
                    }`}
                  >
                    {item.text}
                    <span className="mx-1.5 align-bottom text-[10px] opacity-60">
                      {formatClock(item.at)}
                    </span>
                  </div>
                </div>
              );
            }
            const transfer = item.fileId ? transfers[item.fileId] : undefined;
            if (!transfer) return null;
            return (
              <div key={item.key} className={item.mine ? 'self-end' : 'self-start'}>
                <FileCard
                  transfer={transfer}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onDownload={(t) => onDownload(t)}
                />
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
