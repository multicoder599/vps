import { useEffect, useState } from 'react';
import { deployApp, getServers } from '@/lib/api';
import type { EnvVar, ServerInfo } from '@/types';
import { Console, type ConsoleLine } from '@/components/Console';

export function Deploy() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverId, setServerId] = useState('');
  const [form, setForm] = useState({ name: '', repo: '', branch: 'main', port: '', startCmd: 'npm start' });
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: '', value: '' }]);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    getServers().then((list) => {
      setServers(list);
      const local = list.find((s) => s.kind === 'local');
      setServerId((prev) => prev || (local ? local.id : list[0]?.id || ''));
    }).catch(() => {});
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setEnv = (i: number, k: 'key' | 'value') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEnvVars((arr) => arr.map((v, idx) => (idx === i ? { ...v, [k]: e.target.value } : v)));

  const addEnvRow = () => setEnvVars((arr) => [...arr, { key: '', value: '' }]);
  const removeEnvRow = (i: number) => setEnvVars((arr) => arr.filter((_, idx) => idx !== i));

  const canSubmit = form.name.trim() && form.repo.trim() && serverId && !running;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError('');
    setLines([]);
    setResult(null);
    setRunning(true);
    try {
      await deployApp(serverId, {
        name: form.name.trim(),
        repo: form.repo.trim(),
        branch: form.branch.trim() || 'main',
        port: form.port.trim() || undefined,
        startCmd: form.startCmd.trim() || 'npm start',
        env: envVars.filter((v) => v.key.trim()),
      }, (ev) => {
        if (ev.type === 'log') setLines((l) => [...l, { text: ev.line, stream: ev.stream }]);
        else {
          setRunning(false);
          setResult(ev.ok ? 'ok' : 'fail');
          if (ev.error) setLines((l) => [...l, { text: `ERROR: ${ev.error}`, stream: 'stderr' }]);
        }
      });
    } catch (err) {
      setRunning(false);
      setResult('fail');
      setFormError(err instanceof Error ? err.message : 'deploy failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label-tech">ship new code</div>
        <h1 className="mt-1 text-xl font-bold tracking-tight">Deploy an app</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Clone a git repo onto any linked VPS, install dependencies, and boot it under pm2 — all in one run.
          Re-running with the same app name updates the existing deployment.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form onSubmit={submit} className="panel h-fit space-y-4 p-5">
          <div>
            <label htmlFor="dp-server" className="label-tech block">target server</label>
            <select id="dp-server" value={serverId} onChange={(e) => setServerId(e.target.value)}
              className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm">
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} {s.kind === 'local' ? '(this vps)' : `— ${s.host}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dp-repo" className="label-tech block">git repository</label>
            <input id="dp-repo" required value={form.repo} onChange={set('repo')}
              placeholder="https://github.com/multicoder599/oddsxpess.git"
              className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dp-branch" className="label-tech block">branch</label>
              <input id="dp-branch" value={form.branch} onChange={set('branch')} placeholder="main"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
            <div>
              <label htmlFor="dp-name" className="label-tech block">app name (pm2)</label>
              <input id="dp-name" required pattern="[A-Za-z0-9._\-]+" title="letters, numbers, dash, dot, underscore"
                value={form.name} onChange={set('name')} placeholder="my-api"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dp-port" className="label-tech block">port (optional)</label>
              <input id="dp-port" inputMode="numeric" value={form.port} onChange={set('port')} placeholder="4061"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
            <div>
              <label htmlFor="dp-cmd" className="label-tech block">start command</label>
              <input id="dp-cmd" value={form.startCmd} onChange={set('startCmd')} placeholder="npm start"
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="label-tech">environment variables</span>
              <button type="button" onClick={addEnvRow}
                className="rounded border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                + add
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {envVars.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <input aria-label={`env key ${i + 1}`} value={v.key} onChange={setEnv(i, 'key')} placeholder="MONGO_URI"
                    className="w-2/5 rounded-md border bg-background px-3 py-1.5 font-mono text-xs" />
                  <input aria-label={`env value ${i + 1}`} value={v.value} onChange={setEnv(i, 'value')} placeholder="value"
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-xs" />
                  <button type="button" onClick={() => removeEnvRow(i)} aria-label="remove variable"
                    className="rounded border px-2 font-mono text-xs text-muted-foreground hover:border-destructive/60 hover:text-destructive">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {formError && <p role="alert" className="font-mono text-xs text-destructive">ERROR: {formError}</p>}

          <button type="submit" disabled={!canSubmit}
            className="w-full rounded-md bg-primary px-4 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
            {running ? 'deploying…' : '> deploy'}
          </button>
        </form>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="label-tech">deploy log</span>
            {result === 'ok' && <span className="font-mono text-[12px] text-primary text-glow">✓ app is live under pm2</span>}
            {result === 'fail' && <span className="font-mono text-[12px] text-destructive">✗ deploy failed</span>}
          </div>
          <Console lines={lines} running={running} maxHeight="60vh"
            emptyHint="fill the form and hit deploy — output streams here" />
        </div>
      </div>
    </div>
  );
}
