import { useCallback, useEffect, useState } from 'react';
import { checkAuth, isDemo, logout, onDemoChange } from '@/lib/api';
import { useHashRoute } from '@/hooks/use-route';
import { Login } from '@/sections/Login';
import { Overview } from '@/sections/Overview';
import { Servers } from '@/sections/Servers';
import { ServerDetail } from '@/sections/ServerDetail';
import { Deploy } from '@/sections/Deploy';

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [demo, setDemo] = useState(isDemo());
  const [route, navigate] = useHashRoute();

  useEffect(() => onDemoChange(setDemo), []);

  useEffect(() => {
    // skip the probe when no session cookie exists — avoids a pointless 401
    if (!document.cookie.includes('panel_session=')) {
      setAuth('out');
      return;
    }
    checkAuth().then((ok) => setAuth(ok ? 'in' : 'out'));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setAuth('out');
  }, []);

  if (auth === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="font-mono text-sm text-muted-foreground">
          <span className="text-primary">&gt;</span> establishing uplink<span className="blink-cursor text-primary">▌</span>
        </span>
      </div>
    );
  }

  if (auth === 'out') {
    return <Login onSuccess={() => setAuth('in')} />;
  }

  const navItems = [
    { key: 'overview', label: 'overview', hash: '#/' },
    { key: 'servers', label: 'servers', hash: '#/servers' },
    { key: 'deploy', label: 'deploy', hash: '#/deploy' },
  ] as const;

  const activeNav =
    route.view === 'overview' ? 'overview' :
    route.view === 'servers' || route.view === 'server' ? 'servers' : 'deploy';

  return (
    <div className="flex min-h-dvh">
      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-sidebar-background md:flex">
        <div className="border-b px-5 py-5">
          <a href="#/" className="flex items-center gap-2.5">
            <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
            <span className="text-[15px] font-bold tracking-tight text-foreground">Fleet Panel</span>
          </a>
          <div className="mt-1.5 flex items-center gap-1.5 pl-[38px]">
            <span className="status-dot status-dot--live" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">all systems live</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4">
          {navItems.map((item) => (
            <a
              key={item.key}
              href={item.hash}
              className={`mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium capitalize transition-colors ${
                activeNav === item.key
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${activeNav === item.key ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
              {item.label}
            </a>
          ))}
        </nav>
        <div className="border-t px-3 py-3">
          <button
            onClick={handleLogout}
            className="w-full rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col md:ml-56">
        {/* top bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
          <a href="#/" className="flex items-center gap-2 md:hidden">
            <img src="/icons/icon-192.png" alt="" className="h-6 w-6 rounded-md" />
            <span className="text-sm font-bold text-foreground">Fleet Panel</span>
          </a>
          <nav className="flex gap-1 md:hidden">
            {navItems.map((item) => (
              <a
                key={item.key}
                href={item.hash}
                className={`rounded px-2 py-1 font-mono text-[12px] ${activeNav === item.key ? 'text-primary' : 'text-muted-foreground'}`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {demo && (
              <span className="rounded border border-[--warning] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[#f5a524]">
                demo preview — no live backend
              </span>
            )}
            <span className="hidden items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:flex">
              <span className="status-dot status-dot--live" />
              {new Date().toISOString().slice(0, 10)}
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
          {route.view === 'overview' && <Overview onOpenServer={(id) => navigate({ view: 'server', id })} />}
          {route.view === 'servers' && <Servers onOpenServer={(id) => navigate({ view: 'server', id })} />}
          {route.view === 'server' && <ServerDetail serverId={route.id} onDeploy={() => navigate({ view: 'deploy' })} />}
          {route.view === 'deploy' && <Deploy />}
        </main>
      </div>
    </div>
  );
}
