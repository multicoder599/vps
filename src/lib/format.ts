export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatAppUptime(ms: number): string {
  if (!ms || ms <= 0) return '—';
  return formatUptime(Math.floor(ms / 1000));
}

export function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** Color for a 0-100 utilization value — green → amber → red. */
export function loadColor(p: number): string {
  if (p >= 85) return '#e5484d';
  if (p >= 60) return '#f5a524';
  return '#00d9a3';
}

export function statusKind(status: string): 'live' | 'warn' | 'down' | 'idle' {
  if (status === 'online') return 'live';
  if (status === 'launching' || status === 'waiting restart') return 'warn';
  if (status === 'errored') return 'down';
  return 'idle';
}
