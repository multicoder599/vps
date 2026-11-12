import { useEffect, useState } from 'react';

export type Route =
  | { view: 'overview' }
  | { view: 'servers' }
  | { view: 'server'; id: string }
  | { view: 'deploy' };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [head, arg] = h.split('/');
  if (head === 'servers') return { view: 'servers' };
  if (head === 'server' && arg) return { view: 'server', id: decodeURIComponent(arg) };
  if (head === 'deploy') return { view: 'deploy' };
  return { view: 'overview' };
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (r: Route) => {
    const hash =
      r.view === 'overview' ? '#/' :
      r.view === 'servers' ? '#/servers' :
      r.view === 'deploy' ? '#/deploy' :
      `#/server/${encodeURIComponent(r.id)}`;
    if (window.location.hash === hash) setRoute(r);
    else window.location.hash = hash;
  };

  return [route, navigate];
}

export function routeToHash(r: Route): string {
  return r.view === 'overview' ? '#/' :
    r.view === 'servers' ? '#/servers' :
    r.view === 'deploy' ? '#/deploy' :
    `#/server/${encodeURIComponent(r.id)}`;
}
