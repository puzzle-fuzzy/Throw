import { Button, Card, Chip, ProgressBar, Tooltip } from '@heroui/react';
import { AlertCircle, Download, RotateCcw, X } from 'lucide-react';
import { formatBytes, formatEta, formatSpeed } from '../lib/format';
import type { TransferItem } from '../stores/chat';
import { fileIconFor, isImageMime, isVideoMime } from './FileIcon';
import { ImageViewer } from './ImageViewer';

interface FileCardProps {
  transfer: TransferItem;
  onCancel: (fileId: string) => void;
  onRetry: (fileId: string) => void;
  onDownload: (transfer: TransferItem) => void;
}

export function FileCard({ transfer, onCancel, onRetry, onDownload }: FileCardProps) {
  const Icon = fileIconFor(transfer.mime);
  const percent =
    transfer.size > 0 ? Math.min(100, Math.round((transfer.sentBytes / transfer.size) * 100)) : 0;
  const isImage = isImageMime(transfer.mime);
  const isVideo = isVideoMime(transfer.mime);
  const uploadDoneWaitingPeer =
    transfer.direction === 'send' &&
    transfer.status === 'transferring' &&
    transfer.sentBytes >= transfer.size;

  return (
    <Card className="w-full p-0">
      <Card.Content className="flex flex-col gap-2 p-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0 rounded-lg bg-default p-2 text-foreground">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <Tooltip>
              <Tooltip.Trigger>
                <p className="truncate text-sm font-medium">{transfer.name}</p>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <Tooltip.Arrow />
                {transfer.name}
              </Tooltip.Content>
            </Tooltip>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>{formatBytes(transfer.size)}</span>
              <Chip size="sm" variant="secondary">
                {transfer.channel === 'p2p' ? 'P2P' : '中转'}
              </Chip>
              {transfer.status === 'transferring' && !uploadDoneWaitingPeer && (
                <span>
                  {formatBytes(transfer.sentBytes)} · {formatSpeed(transfer.speedBps)} · 剩余{' '}
                  {formatEta(transfer.etaSec)}
                </span>
              )}
              {uploadDoneWaitingPeer && <span>已发送 · 等待对方保存</span>}
            </div>
          </div>
          {transfer.status === 'transferring' && (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="取消传输"
              onPress={() => onCancel(transfer.fileId)}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        {transfer.status === 'transferring' && !uploadDoneWaitingPeer && (
          <ProgressBar
            aria-label={`${transfer.name} 传输进度`}
            value={percent}
            size="sm"
            color="accent"
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        )}

        {transfer.status === 'failed' && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-sm text-danger-soft-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <AlertCircle className="size-4 shrink-0" />
              <span className="truncate">{transfer.error ?? '传输失败'}</span>
            </span>
            <Button size="sm" variant="outline" onPress={() => onRetry(transfer.fileId)}>
              <RotateCcw className="size-3.5" />
              换通道重试
            </Button>
          </div>
        )}

        {transfer.status === 'completed' && transfer.blobUrl && isImage && (
          <ImageViewer src={transfer.blobUrl} alt={transfer.name}>
            <button
              type="button"
              aria-label="放大预览"
              className="block w-full overflow-hidden rounded-lg"
            >
              <img
                src={transfer.blobUrl}
                alt={transfer.name}
                className="max-h-[280px] w-full object-cover"
                loading="lazy"
              />
            </button>
          </ImageViewer>
        )}

        {transfer.status === 'completed' && transfer.blobUrl && isVideo && (
          // biome-ignore lint/a11y/useMediaCaption: 用户互传的临时视频，无字幕轨可言
          <video
            src={transfer.blobUrl}
            controls
            preload="metadata"
            className="max-h-[280px] w-full rounded-lg bg-black"
          />
        )}

        {transfer.status === 'completed' && transfer.direction === 'recv' && (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onPress={() => onDownload(transfer)}
          >
            <Download className="size-3.5" />
            下载保存
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}
