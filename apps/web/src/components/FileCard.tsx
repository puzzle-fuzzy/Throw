import { Alert, Button, Card, Chip, ProgressBar, ProgressCircle, Spinner } from '@heroui/react';
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

type StatusColor = 'accent' | 'danger' | 'default' | 'success' | 'warning';

function getStatusLabel(transfer: TransferItem, isAwaitingPeerReceipt: boolean): string {
  switch (transfer.status) {
    case 'queued':
      return transfer.direction === 'send' ? '准备发送' : '等待传输开始';
    case 'offering':
      return '正在建立传输';
    case 'transferring':
      if (isAwaitingPeerReceipt) return '等待对方接收确认';
      return transfer.direction === 'send' ? '正在发送' : '正在接收';
    case 'completed':
      return transfer.direction === 'send' ? '对方已确认接收' : '已接收';
    case 'failed':
      return '传输失败';
    case 'cancelled':
      return '已取消';
  }
}

function getStatusColor(transfer: TransferItem, isAwaitingPeerReceipt: boolean): StatusColor {
  if (isAwaitingPeerReceipt) return 'warning';
  switch (transfer.status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'offering':
    case 'transferring':
      return 'accent';
    case 'queued':
    case 'cancelled':
      return 'default';
  }
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
  const isPreparing = transfer.status === 'queued' || transfer.status === 'offering';
  const isActivelyTransferring = transfer.status === 'transferring' && !uploadDoneWaitingPeer;
  const isCancellable = isPreparing || transfer.status === 'transferring';
  const canRetry =
    transfer.status === 'failed' && transfer.direction === 'send' && !!transfer.source;
  const statusLabel = getStatusLabel(transfer, uploadDoneWaitingPeer);
  const statusColor = getStatusColor(transfer, uploadDoneWaitingPeer);
  const preparationDescription =
    transfer.status === 'queued'
      ? transfer.direction === 'send'
        ? '正在准备文件传输'
        : '已收到文件邀请，等待对方开始传输'
      : '正在通知对方并建立传输通道';
  const peerReceiptDescription =
    transfer.channel === 'p2p'
      ? '本端传输已完成，等待对方接收确认'
      : '文件已上传，等待对方接收确认';

  return (
    <Card
      className="w-full gap-0 p-0"
      variant="secondary"
      role="group"
      aria-label={`文件：${transfer.name}`}
    >
      <Card.Header className="flex-row items-start gap-2.5 px-3 pt-3">
        <div className="mt-0.5 shrink-0 rounded-lg bg-default p-2 text-foreground">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={transfer.name}>
            {transfer.name}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{formatBytes(transfer.size)}</span>
            <Chip size="sm" variant="tertiary" color="default">
              <Chip.Label>{transfer.channel === 'p2p' ? 'P2P' : '中转'}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="soft" color={statusColor}>
              <Chip.Label>{statusLabel}</Chip.Label>
            </Chip>
          </div>
        </div>
        {isCancellable && (
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
      </Card.Header>

      <Card.Content className="gap-3 px-3 pb-3 pt-3">
        {isPreparing && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" aria-label={statusLabel} />
            <span>{preparationDescription}</span>
          </div>
        )}

        {isActivelyTransferring && (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <ProgressCircle
                aria-label={`${transfer.name} 当前传输百分比`}
                value={percent}
                size="sm"
                color="accent"
              >
                <ProgressCircle.Track>
                  <ProgressCircle.TrackCircle />
                  <ProgressCircle.FillCircle />
                </ProgressCircle.Track>
              </ProgressCircle>
              <span>
                {formatBytes(transfer.sentBytes)} / {formatBytes(transfer.size)}
              </span>
              <span>{formatSpeed(transfer.speedBps)}</span>
              <span>剩余 {formatEta(transfer.etaSec)}</span>
            </div>
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
          </>
        )}

        {uploadDoneWaitingPeer && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <ProgressCircle
              aria-label={`${transfer.name} 本端传输完成`}
              value={100}
              size="sm"
              color="warning"
            >
              <ProgressCircle.Track>
                <ProgressCircle.TrackCircle />
                <ProgressCircle.FillCircle />
              </ProgressCircle.Track>
            </ProgressCircle>
            <span>{peerReceiptDescription}</span>
          </div>
        )}

        {transfer.status === 'completed' && (
          <p className="text-xs text-muted">
            {transfer.direction === 'send' ? '对方已确认接收此文件。' : '文件已接收，可下载保存。'}
          </p>
        )}

        {transfer.status === 'cancelled' && <p className="text-xs text-muted">文件传输已取消。</p>}

        {transfer.status === 'failed' && (
          <Alert status="danger" role="alert" className="gap-2 px-3 py-2">
            <Alert.Indicator>
              <AlertCircle className="size-4" />
            </Alert.Indicator>
            <Alert.Content>
              <Alert.Title>文件传输失败</Alert.Title>
              <Alert.Description className="break-words">
                {transfer.error ?? '请检查连接后重试'}
              </Alert.Description>
            </Alert.Content>
            {canRetry && (
              <Button size="sm" variant="outline" onPress={() => onRetry(transfer.fileId)}>
                <RotateCcw className="size-3.5" />
                换通道重试
              </Button>
            )}
          </Alert>
        )}

        {transfer.status === 'completed' && transfer.blobUrl && isImage && (
          <ImageViewer src={transfer.blobUrl} alt={transfer.name}>
            <Button
              variant="ghost"
              aria-label={`放大预览 ${transfer.name}`}
              className="h-52 w-full overflow-hidden rounded-lg p-0"
            >
              <img
                src={transfer.blobUrl}
                alt={transfer.name}
                className="h-full w-full bg-default object-contain"
                loading="lazy"
              />
            </Button>
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
      </Card.Content>

      {transfer.status === 'completed' && transfer.direction === 'recv' && transfer.blobUrl && (
        <Card.Footer className="px-3 pb-3">
          <Button size="sm" variant="outline" onPress={() => onDownload(transfer)}>
            <Download className="size-3.5" />
            下载保存
          </Button>
        </Card.Footer>
      )}
    </Card>
  );
}
