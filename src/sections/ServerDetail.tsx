import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appAction, getLogs, getOverview, getServers, redeploy,
  readEnv, writeEnv, listEnvFiles,
  listNginx, readNginx, writeNginx, reloadNginx,
} from '@/lib/api';
import type { NginxFileInfo, Overview as OverviewData, Pm2App, ServerInfo } from '@/types';
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
  | { kind: 'env'; app: Pm2App }
  | { kind: 'nginx'; file: string }
  | null;

export function ServerDetail({ serverId, onDeploy }: Props) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [busyAction, setBusyAction] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [confirm, setConfirm] = useState('');
  const [tab, setTab] = useState<'apps' | 'nginx'>('apps');

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
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
          + Deploy app here
        </button>
      </div>

      {error && <p role="alert" className="panel border-destructive/50 p-4 font-mono text-xs text-destructive">{error}</p>}

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

      {/* tabs */}
      <div className="flex gap-1 border-b">
        {([['apps', 'pm2 processes'], ['nginx', 'nginx configs']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`label-tech border-b-2 px-4 py-2.5 transition-colors ${
              tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {key === 'apps' ? `${label}${data ? ` (${data.apps.length})` : ''}` : label}
          </button>
        ))}
      </div>

      {tab === 'apps' ? (
        <AppsTab
          data={data}
          busyAction={busyAction}
          confirm={confirm}
          onAction={runAction}
          onDrawer={setDrawer}
          onDeploy={onDeploy}
        />
      ) : (
        <NginxTab serverId={serverId} onEdit={(file) => setDrawer({ kind: 'nginx', file })} />
      )}

      {/* drawers */}
      {drawer && (
        <DrawerShell
          title={
            drawer.kind === 'logs' ? `logs — ${drawer.app}` :
            drawer.kind === 'redeploy' ? `redeploy — ${drawer.app}` :
            drawer.kind === 'env' ? `environment — ${drawer.app.name}` :
            `nginx — ${drawer.file}`
          }
          onClose={() => setDrawer(null)}
        >
          {drawer.kind === 'logs' && <LogsPane serverId={serverId} app={drawer.app} />}
          {drawer.kind === 'redeploy' && <RedeployPane serverId={serverId} app={drawer.app} onDone={poll} />}
          {drawer.kind === 'env' && (
            <EnvPane serverId={serverId} app={drawer.app} onRestart={async () => { await runAction(drawer.app, 'restart'); }} />
          )}
          {drawer.kind === 'nginx' && <NginxPane serverId={serverId} file={drawer.file} />}
        </DrawerShell>
      )}
    </div>
  );
}

// ---------- apps tab ----------

function AppsTab({ data, busyAction, confirm, onAction, onDrawer, onDeploy }: {
  data: OverviewData | null;
  busyAction: string;
  confirm: string;
  onAction: (app: Pm2App, action: string) => void;
  onDrawer: (d: Drawer) => void;
  onDeploy: () => void;
}) {
  return (
    <div className="panel overflow-hidden">
      {!data ? (
        <div className="p-6 font-mono text-sm text-muted-foreground">loading…</div>
      ) : !data.pm2 ? (
        <div className="p-6 font-mono text-sm text-[#d97706]">pm2 is not installed on this server</div>
      ) : data.apps.length === 0 ? (
        <div className="p-6">
          <p className="font-mono text-sm text-muted-foreground">no pm2 apps on this server yet</p>
          <button onClick={onDeploy} className="mt-3 rounded-lg border border-primary/50 px-3 py-1.5 text-[12px] font-medium text-primary">
            + deploy your first app
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
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
                        <span className={kind === 'down' ? 'text-destructive' : kind === 'live' ? 'text-[#16a34a]' : 'text-muted-foreground'}>
                          {app.status}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] tabular-nums text-foreground/90">{app.cpu.toFixed(1)}%</td>
                    <td className="px-4 py-3 font-mono text-[12px] tabular-nums text-foreground/90">{app.memory ? formatBytes(app.memory) : '—'}</td>
                    <td className={`px-4 py-3 font-mono text-[12px] tabular-nums ${app.restarts > 20 ? 'text-[#d97706]' : 'text-foreground/90'}`}>{app.restarts}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-foreground/90">{app.status === 'online' ? formatAppUptime(app.uptimeMs) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <ActionBtn label="logs" onClick={() => onDrawer({ kind: 'logs', app: app.name })} />
                        <ActionBtn label=".env" onClick={() => onDrawer({ kind: 'env', app })} />
                        <ActionBtn label={busy('restart') ? '…' : 'restart'} disabled={busy('restart')}
                          onClick={() => onAction(app, 'restart')} />
                        {app.status === 'online' ? (
                          <ActionBtn label={busy('stop') ? '…' : 'stop'} disabled={busy('stop')}
                            onClick={() => onAction(app, 'stop')} />
                        ) : (
                          <ActionBtn label={busy('start') ? '…' : 'start'} disabled={busy('start')}
                            onClick={() => onAction(app, 'start')} />
                        )}
                        <ActionBtn label="redeploy" accent onClick={() => onDrawer({ kind: 'redeploy', app: app.name })} />
                        <ActionBtn
                          label={confirm === app.name ? 'sure?' : busy('delete') ? '…' : 'delete'}
                          danger disabled={busy('delete')}
                          onClick={() => onAction(app, 'delete')} />
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
  );
}

function ActionBtn({ label, onClick, disabled, accent, danger }: {
  label: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-40 ${
        danger
          ? 'text-muted-foreground hover:border-destructive/60 hover:text-destructive'
          : accent
            ? 'border-primary/40 text-primary hover:bg-primary/5'
            : 'text-foreground/80 hover:border-foreground/40 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

// ---------- nginx tab ----------

function NginxTab({ serverId, onEdit }: { serverId: string; onEdit: (file: string) => void }) {
  const [files, setFiles] = useState<NginxFileInfo[] | null>(null);
  const [root, setRoot] = useState('/etc/nginx/sites-available');
  const [hasNginx, setHasNginx] = useState(true);
  const [error, setError] = useState('');
  const [reloading, setReloading] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    listNginx(serverId)
      .then((r) => { setFiles(r.files); setHasNginx(r.nginx); if (r.root) setRoot(r.root); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [serverId]);

  useEffect(load, [load]);

  const doReload = async () => {
    setReloading(true);
    setNotice('');
    try {
      const r = await reloadNginx(serverId);
      setNotice(`✓ ${r.message}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'reload failed');
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="label-tech">{root}</span>
        <button onClick={doReload} disabled={reloading}
          className="rounded-md border px-2.5 py-1 font-mono text-[11px] text-foreground/80 transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40">
          {reloading ? 'reloading…' : '↻ reload nginx'}
        </button>
      </div>
      {notice && (
        <p className={`border-b px-4 py-2 font-mono text-[11px] ${notice.startsWith('✓') ? 'text-[#16a34a]' : 'text-destructive'}`}>{notice}</p>
      )}
      {error && <p className="p-4 font-mono text-xs text-destructive">{error}</p>}
      {!error && files === null && <div className="p-6 font-mono text-sm text-muted-foreground">loading…</div>}
      {!error && files !== null && !hasNginx && (
        <div className="p-6 font-mono text-sm text-[#d97706]">nginx is not installed on this server</div>
      )}
      {!error && files !== null && hasNginx && files.length === 0 && (
        <div className="p-6 font-mono text-sm text-muted-foreground">no configs in sites-available</div>
      )}
      {!error && files?.map((f) => (
        <button
          key={f.name}
          onClick={() => onEdit(f.name)}
          className="flex w-full flex-wrap items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-secondary/50"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-foreground">{f.name}</span>
          {f.domains && <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">{f.domains}</span>}
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            f.enabled ? 'border-[#16a34a]/40 text-[#16a34a]' : 'text-muted-foreground'
          }`}>
            {f.enabled ? 'enabled' : 'disabled'}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">edit ›</span>
        </button>
      ))}
    </div>
  );
}

// ---------- drawers ----------

function DrawerShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="close panel" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-mono text-[13px] font-semibold text-foreground">{title}</span>
          <button onClick={onClose}
            className="rounded-md border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
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
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${linesCount === n ? 'border-primary/50 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {n}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="status-dot status-dot--live" /> refreshing 4s
        </span>
      </div>
      {err && <p className="font-mono text-xs text-destructive">{err}</p>}
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
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground">
          Run redeploy
        </button>
      ) : (
        <div className="flex items-center gap-3">
          {result === 'ok' && <span className="font-mono text-[12px] text-[#16a34a]">✓ redeploy succeeded</span>}
          {result === 'fail' && <span className="font-mono text-[12px] text-destructive">✗ redeploy failed — check output</span>}
          {!running && (
            <button onClick={start} className="rounded-md border px-3 py-1.5 font-mono text-[12px] text-foreground hover:border-primary/50 hover:text-primary">
              run again
            </button>
          )}
        </div>
      )}
      <Console lines={lines} running={running} maxHeight="64vh" emptyHint="press run redeploy to start" />
    </div>
  );
}

function EnvPane({ serverId, app, onRestart }: { serverId: string; app: Pm2App; onRestart: () => Promise<void> }) {
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState('.env');
  const [content, setContent] = useState('');
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback((f: string) => {
    setLoading(true);
    setNotice('');
    readEnv(serverId, app.name, app.cwd, f)
      .then((r) => { setContent(r.content); setExists(r.exists); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'read failed'))
      .finally(() => setLoading(false));
  }, [serverId, app.name, app.cwd]);

  useEffect(() => {
    listEnvFiles(serverId, app.name, app.cwd).then(setFiles).catch(() => {});
    load('.env');
  }, [load, serverId, app.name, app.cwd]);

  const save = async (restartAfter: boolean) => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const r = await writeEnv(serverId, app.name, app.cwd, file, content);
      setNotice(`✓ ${r.message}${restartAfter ? ' — restarting…' : ''}`);
      setExists(true);
      if (restartAfter) {
        await onRestart();
        setNotice(`✓ ${r.message} — app restarted`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-tech">file</span>
        {[...new Set([...files, file])].map((f) => (
          <button key={f} onClick={() => { setFile(f); load(f); }}
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${file === f ? 'border-primary/50 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {f}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{app.cwd}/{file}</span>
      </div>

      {!exists && !loading && (
        <p className="rounded-lg border border-dashed p-3 font-mono text-[11px] text-muted-foreground">
          {file} doesn't exist yet — saving will create it. A timestamped backup is kept before every change.
        </p>
      )}

      {loading ? (
        <div className="panel-inset rounded-lg border p-4 font-mono text-xs text-[#8b8a9c]">loading…</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          aria-label={`${file} contents`}
          placeholder={'KEY=value\nANOTHER=value'}
          className="panel-inset h-[46vh] w-full resize-none rounded-lg border p-3 font-mono text-[12px] leading-relaxed text-[#e6e6f0] placeholder:text-[#8b8a9c]/60"
        />
      )}

      {error && <p role="alert" className="whitespace-pre-wrap font-mono text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="font-mono text-xs text-[#16a34a]">{notice}</p>}

      <div className="flex gap-2">
        <button onClick={() => save(false)} disabled={saving || loading}
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => save(true)} disabled={saving}
          className="rounded-lg border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40">
          Save & restart app
        </button>
      </div>
    </div>
  );
}

function NginxPane({ serverId, file }: { serverId: string; file: string }) {
  const [content, setContent] = useState('');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    readNginx(serverId, file)
      .then((r) => { setContent(r.content); setPath(r.path); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'read failed'))
      .finally(() => setLoading(false));
  }, [serverId, file]);

  const save = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const r = await writeNginx(serverId, file, content);
      setNotice(`✓ ${r.message}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Editing <span className="font-mono text-foreground">{path || file}</span>.
        Saving runs <span className="font-mono">nginx -t</span> first — if the test fails, the change is
        rolled back automatically and the old config stays live. Remember to <em>reload nginx</em> after saving.
      </p>

      {loading ? (
        <div className="panel-inset rounded-lg border p-4 font-mono text-xs text-[#8b8a9c]">loading…</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          aria-label={`${file} nginx config`}
          className="panel-inset h-[52vh] w-full resize-none rounded-lg border p-3 font-mono text-[12px] leading-relaxed text-[#e6e6f0]"
        />
      )}

      {error && <p role="alert" className="whitespace-pre-wrap font-mono text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="font-mono text-xs text-[#16a34a]">{notice}</p>}

      <button onClick={save} disabled={saving || loading}
        className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
        {saving ? 'Testing & saving…' : 'Test & save'}
      </button>
    </div>
  );
}
