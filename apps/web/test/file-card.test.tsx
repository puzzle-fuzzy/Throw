import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileCard } from '../src/components/FileCard';
import type { TransferItem } from '../src/stores/chat';

function makeTransfer(patch: Partial<TransferItem>): TransferItem {
  return {
    fileId: 'f1',
    name: '照片.png',
    size: 10 * 1024 * 1024,
    mime: 'image/png',
    direction: 'send',
    channel: 'p2p',
    status: 'transferring',
    sentBytes: 0,
    speedBps: undefined,
    etaSec: undefined,
    error: undefined,
    blobUrl: undefined,
    source: undefined,
    ...patch,
  };
}

const noop = () => {};
const download = vi.fn();

describe('FileCard 状态机渲染', () => {
  it('传输中：显示进度、速度与取消按钮', () => {
    render(
      <FileCard
        transfer={makeTransfer({
          sentBytes: 5 * 1024 * 1024,
          speedBps: 2 * 1024 * 1024,
          etaSec: 2.5,
        })}
        onCancel={noop}
        onRetry={noop}
        onDownload={download}
      />,
    );
    const card =
      screen.getByText('照片.png').closest('section, article, div[class]')?.parentElement ??
      document.body;
    void card;
    expect(screen.getByText('照片.png')).toBeTruthy();
    expect(screen.getByText('P2P')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消传输' })).toBeTruthy();
    expect(screen.getByText(/2\.0 MB\/s/)).toBeTruthy();
    // 进度条带 aria
    expect(screen.getByRole('progressbar', { name: '照片.png 传输进度' })).toBeTruthy();
  });

  it('发送方上传完等待对方：显示等待保存文案', () => {
    render(
      <FileCard
        transfer={makeTransfer({ status: 'transferring', sentBytes: 10 * 1024 * 1024 })}
        onCancel={noop}
        onRetry={noop}
        onDownload={download}
      />,
    );
    expect(screen.getByText('已发送 · 等待对方保存')).toBeTruthy();
  });

  it('失败：显示原因与换通道重试', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <FileCard
        transfer={makeTransfer({ status: 'failed', error: 'P2P 连接中断' })}
        onCancel={noop}
        onRetry={retry}
        onDownload={download}
      />,
    );
    expect(screen.getByText('P2P 连接中断')).toBeTruthy();
    const retryButton = await screen.findByRole('button', { name: /换通道重试/ });
    await user.click(retryButton);
    expect(retry).toHaveBeenCalledWith('f1');
  });

  it('接收方完成：显示下载保存按钮', () => {
    render(
      <FileCard
        transfer={makeTransfer({
          direction: 'recv',
          status: 'completed',
          blobUrl: 'blob:mock',
        })}
        onCancel={noop}
        onRetry={noop}
        onDownload={download}
      />,
    );
    const btn = screen.getByRole('button', { name: /下载保存/ });
    btn.click();
    expect(download).toHaveBeenCalled();
  });
});
