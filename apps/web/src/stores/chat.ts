import { create } from 'zustand';

export type TransferStatus =
  | 'offering'
  | 'queued'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TransferItem {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  direction: 'send' | 'recv';
  channel: 'p2p' | 'relay';
  status: TransferStatus;
  sentBytes: number;
  speedBps: number | undefined;
  etaSec: number | undefined;
  error: string | undefined;
  blobUrl: string | undefined;
  /** 发送方保留原始 File 以支持换通道重试 */
  source: File | undefined;
}

export interface ChatItem {
  key: string;
  kind: 'text' | 'file' | 'system';
  mine: boolean;
  at: number;
  text: string | undefined;
  fileId: string | undefined;
}

interface ChatState {
  items: ChatItem[];
  transfers: Record<string, TransferItem>;
  addText: (item: { id: string; mine: boolean; content: string; at?: number }) => void;
  addSystem: (text: string) => void;
  addTransfer: (transfer: TransferItem) => void;
  patchTransfer: (fileId: string, patch: Partial<TransferItem>) => void;
  patchProgress: (fileId: string, sentBytes: number, speedBps?: number) => void;
  getTransfer: (fileId: string) => TransferItem | undefined;
  clear: () => void;
}

const SPEED_WINDOW_MS = 1500;

export const useChat = create<ChatState>((set, get) => ({
  items: [],
  transfers: {},

  addText: ({ id, mine, content, at }) =>
    set((state) => ({
      items: [
        ...state.items,
        {
          key: `${mine ? 'out' : 'in'}-${id}`,
          kind: 'text',
          mine,
          at: at ?? Date.now(),
          text: content,
          fileId: undefined,
        },
      ],
    })),

  addSystem: (text) =>
    set((state) => ({
      items: [
        ...state.items,
        {
          key: `sys-${Date.now()}-${state.items.length}`,
          kind: 'system',
          mine: false,
          at: Date.now(),
          text,
          fileId: undefined,
        },
      ],
    })),

  addTransfer: (transfer) =>
    set((state) => {
      if (state.transfers[transfer.fileId]) return state;
      return {
        transfers: { ...state.transfers, [transfer.fileId]: transfer },
        items: [
          ...state.items,
          {
            key: `file-${transfer.fileId}`,
            kind: 'file',
            mine: transfer.direction === 'send',
            at: Date.now(),
            text: undefined,
            fileId: transfer.fileId,
          },
        ],
      };
    }),

  patchTransfer: (fileId, patch) =>
    set((state) => {
      const current = state.transfers[fileId];
      if (!current) return state;
      return { transfers: { ...state.transfers, [fileId]: { ...current, ...patch } } };
    }),

  patchProgress: (fileId, sentBytes, speedBps) =>
    set((state) => {
      const current = state.transfers[fileId];
      if (!current) return state;
      const transfer = { ...current, sentBytes };
      if (speedBps !== undefined && speedBps > 0) {
        transfer.speedBps = speedBps;
        transfer.etaSec = (current.size - sentBytes) / speedBps;
      }
      return { transfers: { ...state.transfers, [fileId]: transfer } };
    }),

  getTransfer: (fileId) => get().transfers[fileId],

  clear: () => {
    for (const transfer of Object.values(useChat.getState().transfers)) {
      if (transfer.blobUrl) URL.revokeObjectURL(transfer.blobUrl);
    }
    set({ items: [], transfers: {} });
  },
}));

/** 速度 EMA 计算器（驱动 patchProgress 的 speedBps 参数） */
export class SpeedMeter {
  private lastBytes = 0;
  private lastAt = 0;
  private ema: number | undefined;

  sample(totalBytes: number): number | undefined {
    const now = Date.now();
    if (this.lastAt === 0) {
      this.lastAt = now;
      this.lastBytes = totalBytes;
      return undefined;
    }
    const dt = now - this.lastAt;
    if (dt < SPEED_WINDOW_MS) return this.ema;
    const instant = ((totalBytes - this.lastBytes) * 1000) / dt;
    this.lastAt = now;
    this.lastBytes = totalBytes;
    this.ema = this.ema === undefined ? instant : this.ema * 0.6 + instant * 0.4;
    return this.ema;
  }
}
