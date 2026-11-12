import { useEffect, useState } from 'react';
import { getOverview, getServers } from '@/lib/api';
import type { Overview as OverviewData, ServerInfo } from '@/types';
import { formatBytes, formatUptime, percent } from '@/lib/format';
import { Gauge } from '@/components/Gauge';
import { Sparkline } from '@/components/Sparkline';

interface Props {
  onOpenServer: (id: string) => void;
}

interface ServerCard {
  server: ServerInfo;
  data: OverviewData | null;
  error: string | null;
}

export function Overview({ onOpenServer }: Props) {
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [cpuHistory, setCpuHistory] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const servers = await getServers().catch(() => []);
      if (cancelled) return;
      const results = await Promise.all(
        servers.map(async (server): Promise<ServerCard> => {
          try {
            const data = await getOverview(server.id);
            return { server, data, error: null };
          } catch (err) {
            return { server, data: null, error: err instanceof Error ? err.message : 'unreachable' };
          }
        })
      );
      if (cancelled) return;
      setCards(results);
      setCpuHistory((prev) => {
        const next = { ...prev };
        for (const c of results) {
          if (c.data) {
            const hist = next[c.server.id] || [];
            next[c.server.id] = [...hist, c.data.metrics.cpuPercent].slice(-48);
          }
        }
        return next;
      });
      setLoading(false);
    };

    poll();
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const totalApps = cards.reduce((n, c) => n + (c.data?.apps.length ?? 0), 0);
  const onlineApps = cards.reduce((n, c) => n + (c.data?.apps.filter((a) => a.status === 'online').length ?? 0), 0);
  const erroredApps = cards.reduce((n, c) => n + (c.data?.apps.filter((a) => a.status === 'errored').length ?? 0), 0);
  const onlineServers = cards.filter((c) => c.data).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="label-tech">scanning fleet…</div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="panel h-44 animate-pulse bg-card/60" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* headline stats */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-tech">fleet overview</div>
          <h1 className="mt-1 text-xl font-bold tracking-tight">
            {onlineServers}<span className="text-muted-foreground">/{cards.length}</span>
            <span className="ml-2 text-sm font-normal text-muted-foreground">servers reachable</span>
          </h1>
        </div>
        <div className="flex gap-6 font-mono text-[12px]">
          <span className="flex items-center gap-1.5">
            <span className="status-dot status-dot--live" /> {onlineApps} online
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="status-dot status-dot--idle" /> {totalApps - onlineApps - erroredApps} stopped
          </span>
          {erroredApps > 0 && (
            <span className="flex items-center gap-1.5 text-destructive">
              <span className="status-dot status-dot--down" /> {erroredApps} errored
            </span>
          )}
        </div>
      </div>

      {/* server cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map(({ server, data, error }) => (
          <button
            key={server.id}
            onClick={() => onOpenServer(server.id)}
            className="panel group p-5 text-left transition-colors hover:border-primary/40"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`status-dot ${data ? 'status-dot--live' : 'status-dot--down'}`} />
                  <span className="truncate font-mono text-[15px] font-semibold text-foreground">{server.name}</span>
                  <span className="rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    {server.kind}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {data ? `${data.metrics.os} · ${data.metrics.hostname}` : server.kind === 'local' ? 'local shell' : `${server.username}@${server.host}:${server.port || 22}`}
                </div>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-primary">open ▸</span>
            </div>

            {error ? (
              <p className="mt-4 font-mono text-xs text-destructive">ERROR: {error}</p>
            ) : data ? (
              <div className="mt-5 flex items-center gap-6">
                <div className="flex gap-5">
                  <Gauge value={data.metrics.cpuPercent} label="cpu" size={86} />
                  <Gauge value={percent(data.metrics.memUsed, data.metrics.memTotal)} label="ram" sub={formatBytes(data.metrics.memUsed)} size={86} />
                  <Gauge value={percent(data.metrics.diskUsed, data.metrics.diskTotal)} label="disk" sub={formatBytes(data.metrics.diskUsed)} size={86} />
                </div>
                <div className="hidden min-w-0 flex-1 sm:block">
                  <Sparkline samples={cpuHistory[server.id] || []} height={64} />
                  <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>load {data.metrics.loadAvg}</span>
                    <span>up {formatUptime(data.metrics.uptimeSeconds)}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {data && (
              <div className="mt-4 border-t pt-3 font-mono text-[11px] text-muted-foreground">
                {data.apps.length} pm2 app{data.apps.length === 1 ? '' : 's'}
                {data.apps.filter((a) => a.status === 'errored').length > 0 && (
                  <span className="ml-3 text-destructive">
                    {data.apps.filter((a) => a.status === 'errored').length} errored
                  </span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>

      {cards.length === 0 && (
        <div className="panel border-dashed p-10 text-center">
          <p className="font-mono text-sm text-muted-foreground">no servers found — link your first VPS from the servers page</p>
          <a href="#/servers" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground">
            + link a vps
          </a>
        </div>
      )}
    </div>
  );
}
