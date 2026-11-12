import { useCallback, useEffect, useRef, useState } from 'react';
import { appAction, getLogs, getOverview, getServers, redeploy } from '@/lib/api';
import type { Overview as OverviewData, Pm2App, ServerInfo } from '@/types';
import { formatAppUptime, formatBytes, formatUptime, percent, statusKind } from '@/lib/format';
import { Gauge } from '@/components/Gauge';
import { Sparkline } from '@/components/Sparkline';
import { Console, type ConsoleLine } from '@/components/Console';

interface Props {
  serverId: string;
  onDeploy: () => void;
}

type Drawer =
  | { kind: 'logs'; app: string }
  | { kind: 'redeploy'; app: string }
  | null;

export function ServerDetail({ serverId, onDeploy }: Props) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [busyAction, setBusyAction] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [confirm, setConfirm] = useState('');

  const poll = useCallback(async () => {
    try {
      const ov = await getOverview(serverId);
      setData(ov);
      setError('');
      setCpuHistory((h) => [...h, ov.metrics.cpuPercent].slice(-48));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unreachable');
    }
  }, [serverId]);

  useEffect(() => {
    getServers().then((list) => setServer(list.find((s) => s.id === serverId) || null)).catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [poll, serverId]);

  const runAction = async (app: Pm2App, action: string) => {
    if (action === 'delete' && confirm !== app.name) {
      setConfirm(app.name);
      return;
    }
    setConfirm('');
    setBusyAction(`${app.name}:${action}`);
    try {
      await appAction(serverId, app.name, action);
      await poll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'action failed');
    } finally {
      setBusyAction('');
    }
  };

  const metrics = data?.metrics;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <a href="#/servers" className="font-mono text-[11px] text-muted-foreground hover:text-primary">‹ servers</a>
          <div className="mt-1 flex items-center gap-2">
            <span className={`status-dot ${data ? 'status-dot--live' : 'status-dot--down'}`} />
            <h1 className="text-xl font-bold tracking-tight">{server?.name || serverId}</h1>
            {server && (
              <span className="rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{server.kind}</span>
            )}
          </div>
          {metrics && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {metrics.os} · {metrics.cores} cores · load {metrics.loadAvg} · up {formatUptime(metrics.uptimeSeconds)}
            </p>
          )}
        </div>
        <button onClick={onDeploy}
          className="rounded-md bg-primary px-4 py-2 font-mono text-[13px] font-semibold uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90">
          + deploy app here
        </button>
      </div>

      {error && <p role="alert" className="panel border-destructive/50 p-4 font-mono text-xs text-destructive">ERROR: {error}</p>}

      {/* metrics strip */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-center gap-8">
          <Gauge value={metrics?.cpuPercent ?? 0} label="cpu" sub={metrics ? `${metrics.cores} cores` : ''} />
          <Gauge value={metrics ? percent(metrics.memUsed, metrics.memTotal) : 0} label="ram"
            sub={metrics ? `${formatBytes(metrics.memUsed)} / ${formatBytes(metrics.memTotal)}` : ''} />
          <Gauge value={metrics ? percent(metrics.diskUsed, metrics.diskTotal) : 0} label="disk"
            sub={metrics ? `${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}` : ''} />
          <div className="min-w-[220px] flex-1">
            <div className="label-tech mb-2">cpu history — live</div>
            <Sparkline samples={cpuHistory} height={84} />
          </div>
        </div>
      </div>

      {/* apps table */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="label-tech">pm2 processes</span>
          {data && !data.pm2 && <span className="font-mono text-[11px] text-[#f5a524]">pm2 not installed on this server</span>}
        </div>
        {!data ? (
          <div className="p-6 font-mono text-sm text-muted-foreground">loading…</div>
        ) : data.apps.length === 0 ? (
          <div className="p-6">
            <p className="font-mono text-sm text-muted-foreground">no pm2 apps on this server yet</p>
            <button onClick={onDeploy} className="mt-3 rounded-md border border-primary/50 px-3 py-1.5 font-mono text-[12px] text-primary">
              + deploy your first app
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b">
                  {['app', 'status', 'cpu', 'memory', 'restarts', 'uptime', 'actions'].map((h) => (
                    <th key={h} className="label-tech px-4 py-2.5 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.apps.map((app) => {
                  const kind = statusKind(app.status);
                  const busy = (a: string) => busyAction === `${app.name}:${a}`;
                  return (
                    <tr key={app.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-mono text-[13px] font-medium text-foreground">{app.name}</div>
                        <div className="max-w-[240px] truncate font-mono text-[10px] text-muted-foreground">{app.cwd}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-mono text-[12px]">
                          <span className={`status-dot status-dot--${kind}`} />
                          <span className={kind === 'down' ? 'text-destructive' : kind === 'live' ? 'text-primary' : 'text-muted-foreground'}>
                            {app.status}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] tabular-nums text-foreground/90">{app.cpu.toFixed(1)}%</td>
                      <td className="px-4 py-3 font-mono text-[12px] tabular-nums text-foreground/90">{app.memory ? formatBytes(app.memory) : '—'}</td>
                      <td className={`px-4 py-3 font-mono text-[12px] tabular-nums ${app.restarts > 20 ? 'text-[#f5a524]' : 'text-foreground/90'}`}>{app.restarts}</td>
                      <td className="px-4 py-3 font-mono text-[12px] text-foreground/90">{app.status === 'online' ? formatAppUptime(app.uptimeMs) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <ActionBtn label="logs" onClick={() => setDrawer({ kind: 'logs', app: app.name })} />
                          <ActionBtn label={busy('restart') ? '…' : 'restart'} disabled={busy('restart')}
                            onClick={() => runAction(app, 'restart')} />
                          {app.status === 'online' ? (
                            <ActionBtn label={busy('stop') ? '…' : 'stop'} disabled={busy('stop')}
                              onClick={() => runAction(app, 'stop')} />
                          ) : (
                            <ActionBtn label={busy('start') ? '…' : 'start'} disabled={busy('start')}
                              onClick={() => runAction(app, 'start')} />
                          )}
                          <ActionBtn label="redeploy" accent onClick={() => setDrawer({ kind: 'redeploy', app: app.name })} />
                          <ActionBtn
                            label={confirm === app.name ? 'sure?' : busy('delete') ? '…' : 'delete'}
                            danger disabled={busy('delete')}
                            onClick={() => runAction(app, 'delete')} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* drawer: logs / redeploy */}
      {drawer && (
        <DrawerShell
          title={drawer.kind === 'logs' ? `logs — ${drawer.app}` : `redeploy — ${drawer.app}`}
          onClose={() => setDrawer(null)}
        >
          {drawer.kind === 'logs'
            ? <LogsPane serverId={serverId} app={drawer.app} />
            : <RedeployPane serverId={serverId} app={drawer.app} onDone={poll} />}
        </DrawerShell>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, disabled, accent, danger }: {
  label: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-40 ${
        danger
          ? 'text-muted-foreground hover:border-destructive/60 hover:text-destructive'
          : accent
            ? 'border-primary/40 text-primary hover:bg-primary/10'
            : 'text-foreground/80 hover:border-foreground/40 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function DrawerShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="close panel" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-mono text-[13px] font-semibold text-foreground">{title}</span>
          <button onClick={onClose}
            className="rounded border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
            esc ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function LogsPane({ serverId, app }: { serverId: string; app: string }) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [err, setErr] = useState('');
  const [linesCount, setLinesCount] = useState(200);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getLogs(serverId, app, linesCount)
        .then((text) => { if (!cancelled) { setLines(text.split('\n').map((t) => ({ text: t }))); setErr(''); } })
        .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'log read failed'); });
    };
    load();
    const t = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [serverId, app, linesCount]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="label-tech">tail</span>
        {[100, 200, 500, 1000].map((n) => (
          <button key={n} onClick={() => setLinesCount(n)}
            className={`rounded border px-2 py-0.5 font-mono text-[11px] ${linesCount === n ? 'border-primary/50 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {n}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="status-dot status-dot--live" /> refreshing 4s
        </span>
      </div>
      {err && <p className="font-mono text-xs text-destructive">ERROR: {err}</p>}
      <Console lines={lines} maxHeight="70vh" emptyHint="waiting for log output…" />
    </div>
  );
}

function RedeployPane({ serverId, app, onDone }: { serverId: string; app: string; onDone: () => void }) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const started = useRef(false);

  const start = useCallback(() => {
    setLines([]);
    setResult(null);
    setRunning(true);
    redeploy(serverId, app, (ev) => {
      if (ev.type === 'log') setLines((l) => [...l, { text: ev.line, stream: ev.stream }]);
      else {
        setRunning(false);
        setResult(ev.ok ? 'ok' : 'fail');
        if (ev.error) setLines((l) => [...l, { text: `ERROR: ${ev.error}`, stream: 'stderr' }]);
        if (ev.ok) onDone();
      }
    }).catch((err) => {
      setRunning(false);
      setResult('fail');
      setLines((l) => [...l, { text: `ERROR: ${err.message}`, stream: 'stderr' }]);
    });
  }, [serverId, app, onDone]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pulls the latest code in the app's directory, reinstalls dependencies, and restarts
        <span className="font-mono text-foreground"> {app} </span> under pm2.
      </p>
      {!started.current && !running && result === null ? (
        <button
          onClick={() => { started.current = true; start(); }}
          className="rounded-md bg-primary px-4 py-2 font-mono text-[13px] font-semibold uppercase tracking-widest text-primary-foreground">
          &gt; run redeploy
        </button>
      ) : (
        <div className="flex items-center gap-3">
          {result === 'ok' && <span className="font-mono text-[12px] text-primary text-glow">✓ redeploy succeeded</span>}
          {result === 'fail' && <span className="font-mono text-[12px] text-destructive">✗ redeploy failed — check output</span>}
          {!running && (
            <button onClick={start} className="rounded border px-3 py-1.5 font-mono text-[12px] text-foreground hover:border-primary/50 hover:text-primary">
              run again
            </button>
          )}
        </div>
      )}
      <Console lines={lines} running={running} maxHeight="64vh" emptyHint="press run redeploy to start" />
    </div>
  );
}
