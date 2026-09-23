/** 人类可读的字节数 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 速度（字节/秒 → 可读；未知时显示 —） */
export function formatSpeed(bytesPerSec: number | undefined): string {
  if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

/** 剩余时间 */
export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${Math.ceil(seconds % 60)} 秒`;
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
}

/** 消息时间 HH:MM */
export function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 剩余有效期的分秒（等待页倒计时） */
export function formatCountdown(expiresAt: number, now: number): string {
  const remain = Math.max(0, expiresAt - now);
  const minutes = Math.floor(remain / 60_000);
  const seconds = Math.floor((remain % 60_000) / 1000);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
  }
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}
