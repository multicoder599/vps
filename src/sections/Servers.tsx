import { useEffect, useState } from 'react';
import { addServer, getServers, removeServer } from '@/lib/api';
import type { ServerInfo } from '@/types';

interface Props {
  onOpenServer: (id: string) => void;
}

export function Servers({ onOpenServer }: Props) {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', host: '', port: '22', username: 'root', authType: 'password' as 'password' | 'key', secret: '',
  });

  const refresh = async () => {
    setServers(await getServers().catch(() => []));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await addServer({
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        authType: form.authType,
        secret: form.secret,
      });
      setShowForm(false);
      setForm({ name: '', host: '', port: '22', username: 'root', authType: 'password', secret: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add server');
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (id: string) => {
    await removeServer(id).catch(() => {});
    setConfirmRemove(null);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-tech">linked machines</div>
          <h1 className="mt-1 text-xl font-bold tracking-tight">Servers</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-primary px-4 py-2 font-mono text-[13px] font-semibold uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90"
        >
          {showForm ? '× cancel' : '+ link a vps'}
        </button>
      </div>

      {/* link form */}
      {showForm && (
        <form onSubmit={submit} className="panel space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            The panel connects over SSH and verifies the machine before saving. Credentials are stored
            encrypted on this server — nothing is installed on the linked VPS.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sv-name" className="label-tech block">display name</label>
              <input id="sv-name" required value={form.name} onChange={set('name')} placeholder="nairobi-api-01"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
            <div>
              <label htmlFor="sv-host" className="label-tech block">host / ip</label>
              <input id="sv-host" required value={form.host} onChange={set('host')} placeholder="102.213.44.18"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
            <div>
              <label htmlFor="sv-port" className="label-tech block">ssh port</label>
              <input id="sv-port" required inputMode="numeric" value={form.port} onChange={set('port')} placeholder="22"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
            <div>
              <label htmlFor="sv-user" className="label-tech block">ssh user</label>
              <input id="sv-user" required value={form.username} onChange={set('username')} placeholder="root"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
          </div>
          <div>
            <label htmlFor="sv-auth" className="label-tech block">auth method</label>
            <select id="sv-auth" value={form.authType} onChange={set('authType')}
              className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm sm:w-64">
              <option value="password">password</option>
              <option value="key">private key</option>
            </select>
          </div>
          <div>
            <label htmlFor="sv-secret" className="label-tech block">
              {form.authType === 'key' ? 'private key (pem)' : 'ssh password'}
            </label>
            {form.authType === 'key' ? (
              <textarea id="sv-secret" required rows={5} value={form.secret} onChange={set('secret')}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
            ) : (
              <input id="sv-secret" required type="password" value={form.secret} onChange={set('secret')}
                placeholder="••••••••••••"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm sm:w-96" />
            )}
          </div>
          {error && <p role="alert" className="font-mono text-xs text-destructive">ERROR: {error}</p>}
          <button type="submit" disabled={busy}
            className="rounded-md bg-primary px-5 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-40">
            {busy ? 'testing connection…' : '> verify & link'}
          </button>
        </form>
      )}

      {/* server table */}
      <div className="panel overflow-hidden">
        <div className="hidden grid-cols-[1fr_1.2fr_120px_140px_90px] gap-3 border-b px-4 py-2.5 md:grid">
          {['name', 'ssh target', 'auth', 'linked', ''].map((h) => (
            <span key={h} className="label-tech">{h}</span>
          ))}
        </div>
        {loading ? (
          <div className="p-6 font-mono text-sm text-muted-foreground">loading…</div>
        ) : servers.length === 0 ? (
          <div className="p-6 font-mono text-sm text-muted-foreground">no servers linked yet</div>
        ) : (
          servers.map((s) => (
            <div key={s.id}
              className="grid grid-cols-2 gap-3 border-b px-4 py-3.5 last:border-0 md:grid-cols-[1fr_1.2fr_120px_140px_90px] md:items-center">
              <button onClick={() => onOpenServer(s.id)} className="flex min-w-0 items-center gap-2 text-left">
                <span className={`status-dot ${s.kind === 'local' ? 'status-dot--live' : 'status-dot--idle'}`} />
                <span className="truncate font-mono text-[13px] font-medium text-foreground hover:text-primary">{s.name}</span>
                <span className="hidden rounded border px-1 py-px font-mono text-[9px] uppercase tracking-widest text-muted-foreground sm:inline">{s.kind}</span>
              </button>
              <span className="truncate font-mono text-[12px] text-muted-foreground">
                {s.kind === 'local' ? 'local shell' : `${s.username}@${s.host}:${s.port || 22}`}
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">{s.authType === 'none' ? '—' : s.authType}</span>
              <span className="hidden font-mono text-[12px] text-muted-foreground md:block">
                {new Date(s.createdAt).toISOString().slice(0, 10)}
              </span>
              <span className="flex justify-end gap-2">
                <button onClick={() => onOpenServer(s.id)}
                  className="rounded border px-2.5 py-1 font-mono text-[11px] text-foreground transition-colors hover:border-primary/50 hover:text-primary">
                  open
                </button>
                {s.kind !== 'local' && (
                  confirmRemove === s.id ? (
                    <button onClick={() => doRemove(s.id)}
                      className="rounded border border-destructive px-2.5 py-1 font-mono text-[11px] text-destructive">
                      sure?
                    </button>
                  ) : (
                    <button onClick={() => setConfirmRemove(s.id)}
                      className="rounded border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive">
                      unlink
                    </button>
                  )
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
