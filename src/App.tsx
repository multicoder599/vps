import { useCallback, useEffect, useState } from 'react';
import { checkAuth, isDemo, logout, onDemoChange } from '@/lib/api';
import { useHashRoute } from '@/hooks/use-route';
import { Login } from '@/sections/Login';
import { Overview } from '@/sections/Overview';
import { Servers } from '@/sections/Servers';
import { ServerDetail } from '@/sections/ServerDetail';
import { Deploy } from '@/sections/Deploy';
import { Settings } from '@/sections/Settings';

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [demo, setDemo] = useState(isDemo());
  const [route, navigate] = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => onDemoChange(setDemo), []);

  useEffect(() => {
    // skip the probe when no session cookie exists — avoids a pointless 401
    if (!document.cookie.includes('panel_session=')) {
      setAuth('out');
      return;
    }
    checkAuth().then((ok) => setAuth(ok ? 'in' : 'out'));
  }, []);

  // close the mobile drawer on navigation
  useEffect(() => { setMenuOpen(false); }, [route]);

  const handleLogout = useCallback(async () => {
    await logout();
    setAuth('out');
  }, []);

  if (auth === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="font-mono text-sm text-muted-foreground">
          connecting<span className="blink-cursor text-primary">▌</span>
        </span>
      </div>
    );
  }

  if (auth === 'out') {
    return <Login onSuccess={() => setAuth('in')} />;
  }

  const navItems = [
    { key: 'overview', label: 'Overview', hash: '#/' },
    { key: 'servers', label: 'Servers', hash: '#/servers' },
    { key: 'deploy', label: 'Deploy', hash: '#/deploy' },
    { key: 'settings', label: 'Settings', hash: '#/settings' },
  ] as const;

  const activeNav =
    route.view === 'overview' ? 'overview' :
    route.view === 'servers' || route.view === 'server' ? 'servers' :
    route.view === 'settings' ? 'settings' : 'deploy';

  const navLinks = (onNavigate?: () => void) => (
    <nav className="flex-1 px-3 py-4">
      {navItems.map((item) => (
        <a
          key={item.key}
          href={item.hash}
          onClick={onNavigate}
          className={`mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
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
  );

  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
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
        {navLinks()}
        <div className="border-t px-3 py-3">
          <button
            onClick={handleLogout}
            className="w-full rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="close menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex h-full w-64 flex-col border-r bg-card">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <span className="flex items-center gap-2.5">
                <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
                <span className="text-[15px] font-bold text-foreground">Fleet Panel</span>
              </span>
              <button onClick={() => setMenuOpen(false)} aria-label="close menu"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {navLinks(() => setMenuOpen(false))}
            <div className="border-t px-3 py-3">
              <button onClick={handleLogout}
                className="w-full rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-muted-foreground hover:bg-secondary/60">
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col md:ml-56">
        {/* top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur-md md:px-6">
          <button
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <span className="text-sm font-semibold text-foreground md:hidden">Fleet Panel</span>
          <div className="ml-auto flex items-center gap-3">
            {demo && (
              <span className="rounded border border-[--warning] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[#d97706]">
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
          {route.view === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
