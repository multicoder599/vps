import { useState } from 'react';
import { changePassword } from '@/lib/api';

export function Settings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setDone(false);
    if (next.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setError('New passwords do not match'); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <div className="label-tech">panel settings</div>
        <h1 className="mt-1 text-xl font-bold tracking-tight">Settings</h1>
      </div>

      <form onSubmit={submit} className="panel space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold">Change admin password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored as a one-way hash on the server — survives restarts, and signs out every other session.
          </p>
        </div>

        <div>
          <label htmlFor="pw-current" className="label-tech block">current password</label>
          <input id="pw-current" type="password" required autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)}
            className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm" />
        </div>
        <div>
          <label htmlFor="pw-next" className="label-tech block">new password</label>
          <input id="pw-next" type="password" required minLength={8} autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)}
            className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm" />
        </div>
        <div>
          <label htmlFor="pw-confirm" className="label-tech block">confirm new password</label>
          <input id="pw-confirm" type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm" />
        </div>

        {error && <p role="alert" className="font-mono text-xs text-destructive">{error}</p>}
        {done && <p role="status" className="font-mono text-xs text-[#16a34a]">✓ password updated</p>}

        <button type="submit" disabled={busy}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
