import { useState } from 'react';
import { login } from '@/lib/api';

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icons/icon-192.png" alt="Fleet Panel" className="mx-auto h-14 w-14 rounded-xl" />
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">Fleet Panel</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Server hosting, controlled from one secure console.
          </p>
        </div>

        <form onSubmit={submit} className="panel p-6">
          <label htmlFor="password" className="label-tech block">admin password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50"
            placeholder="Enter your panel password"
          />

          {error && (
            <p role="alert" className="mt-3 font-mono text-xs text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          encrypted session · brute-force protected
        </p>
      </div>
    </div>
  );
}
