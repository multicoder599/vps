import type { DeployRequest, NginxFileInfo, Overview, ServerInfo } from '@/types';
import {
  demoApps,
  demoAppsRemote,
  demoDeployLines,
  demoLogs,
  demoOverview,
  demoServers,
} from '@/lib/demo';

/**
 * API client with transparent demo fallback: when the panel backend is
 * unreachable (static preview), every call falls back to realistic demo
 * data and the UI shows a DEMO badge. On the real VPS, all data is live.
 */

let demoMode = false;
const listeners = new Set<(demo: boolean) => void>();

export function isDemo(): boolean {
  return demoMode;
}

export function onDemoChange(fn: (demo: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setDemo(v: boolean) {
  if (demoMode !== v) {
    demoMode = v;
    listeners.forEach((fn) => fn(v));
  }
}

class DemoFallback extends Error {}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch {
    setDemo(true);
    throw new DemoFallback('backend unreachable');
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // static host returned index.html — no backend here
    setDemo(true);
    throw new DemoFallback('no backend');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data as T;
}

// ---------- auth ----------

export async function login(password: string): Promise<void> {
  try {
    await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
  } catch (err) {
    if (err instanceof DemoFallback) {
      if (password.trim().length === 0) throw new Error('Enter any password for the demo');
      return;
    }
    throw err;
  }
}

export async function logout(): Promise<void> {
  try {
    await req('/api/auth/logout', { method: 'POST' });
  } catch { /* demo or network — either way we're leaving */ }
}

export async function checkAuth(): Promise<boolean> {
  try {
    await req('/api/auth/me');
    return true;
  } catch (err) {
    if (err instanceof DemoFallback) return false;
    return false;
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  try {
    await req('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current, next }) });
  } catch (err) {
    if (err instanceof DemoFallback) return;
    throw err;
  }
}

// ---------- servers ----------

export async function getServers(): Promise<ServerInfo[]> {
  try {
    const data = await req<{ servers: ServerInfo[] }>('/api/servers');
    return data.servers;
  } catch (err) {
    if (err instanceof DemoFallback) return demoServers;
    throw err;
  }
}

export async function addServer(input: {
  name: string; host: string; port: number; username: string; authType: 'password' | 'key'; secret: string;
}): Promise<ServerInfo> {
  try {
    const data = await req<{ server: ServerInfo }>('/api/servers', { method: 'POST', body: JSON.stringify(input) });
    return data.server;
  } catch (err) {
    if (err instanceof DemoFallback) {
      const s: ServerInfo = {
        id: `demo-${Date.now()}`, kind: 'remote', createdAt: new Date().toISOString(), hasSecret: true, ...input,
      };
      demoServers.push(s);
      return s;
    }
    throw err;
  }
}

export async function removeServer(id: string): Promise<void> {
  try {
    await req(`/api/servers/${id}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof DemoFallback) {
      const i = demoServers.findIndex((s) => s.id === id);
      if (i >= 0) demoServers.splice(i, 1);
      return;
    }
    throw err;
  }
}

export async function getOverview(serverId: string): Promise<Overview> {
  try {
    return await req<Overview>(`/api/servers/${serverId}/overview`);
  } catch (err) {
    if (err instanceof DemoFallback) return demoOverview(serverId);
    throw err;
  }
}

// ---------- apps ----------

export async function appAction(serverId: string, name: string, action: string): Promise<void> {
  try {
    await req(`/api/servers/${serverId}/apps/${encodeURIComponent(name)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  } catch (err) {
    if (err instanceof DemoFallback) {
      const list = serverId === 'local' ? demoApps : demoAppsRemote;
      const app = list.find((a) => a.name === name);
      if (app) {
        if (action === 'stop') app.status = 'stopped';
        else if (action === 'delete') list.splice(list.indexOf(app), 1);
        else { app.status = 'online'; app.restarts += 1; app.uptimeMs = Date.now(); }
      }
      return;
    }
    throw err;
  }
}

export async function getLogs(serverId: string, name: string, lines = 200): Promise<string> {
  try {
    const data = await req<{ logs: string }>(`/api/servers/${serverId}/apps/${encodeURIComponent(name)}/logs?lines=${lines}`);
    return data.logs;
  } catch (err) {
    if (err instanceof DemoFallback) return demoLogs;
    throw err;
  }
}

// ---------- app .env ----------

export interface EnvFile {
  exists: boolean;
  path: string;
  content: string;
}

export async function readEnv(serverId: string, name: string, cwd: string, file = '.env'): Promise<EnvFile> {
  try {
    return await req<EnvFile>(`/api/servers/${serverId}/apps/${encodeURIComponent(name)}/env?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`);
  } catch (err) {
    if (err instanceof DemoFallback) {
      return {
        exists: true,
        path: `${cwd}/${file}`,
        content: 'PORT=4061\nMONGO_URI=mongodb://127.0.0.1:27017/oddsxpess\nNODE_ENV=production\nMEGAPAY_KEY=••••••••••••\nJWT_SECRET=••••••••••••••••\n',
      };
    }
    throw err;
  }
}

export async function listEnvFiles(serverId: string, name: string, cwd: string): Promise<string[]> {
  try {
    const data = await req<{ files: string[] }>(`/api/servers/${serverId}/apps/${encodeURIComponent(name)}/env-files?cwd=${encodeURIComponent(cwd)}`);
    return data.files;
  } catch (err) {
    if (err instanceof DemoFallback) return ['.env', '.env.production'];
    throw err;
  }
}

export async function writeEnv(serverId: string, name: string, cwd: string, file: string, content: string): Promise<{ message: string }> {
  try {
    return await req<{ message: string }>(`/api/servers/${serverId}/apps/${encodeURIComponent(name)}/env`, {
      method: 'PUT',
      body: JSON.stringify({ cwd, file, content }),
    });
  } catch (err) {
    if (err instanceof DemoFallback) return { message: 'saved (demo)' };
    throw err;
  }
}

// ---------- nginx ----------

export async function listNginx(serverId: string): Promise<{ nginx: boolean; files: NginxFileInfo[]; root?: string }> {
  try {
    return await req(`/api/servers/${serverId}/nginx`);
  } catch (err) {
    if (err instanceof DemoFallback) {
      return {
        nginx: true,
        root: '/etc/nginx/sites-available',
        files: [
          { name: 'api.oddsxpess.com', enabled: true, domains: 'api.oddsxpess.com' },
          { name: 'oddsxpess.com', enabled: true, domains: 'oddsxpess.com www.oddsxpess.com' },
          { name: 'vps.taskpesa.site', enabled: true, domains: 'vps.taskpesa.site' },
          { name: 'staging.old-site', enabled: false, domains: 'staging.example.com' },
        ],
      };
    }
    throw err;
  }
}

export async function readNginx(serverId: string, name: string): Promise<{ path: string; content: string }> {
  try {
    return await req(`/api/servers/${serverId}/nginx/${encodeURIComponent(name)}`);
  } catch (err) {
    if (err instanceof DemoFallback) {
      return {
        path: `/etc/nginx/sites-available/${name}`,
        content: `server {\n    listen 80;\n    server_name ${name};\n\n    location / {\n        proxy_pass http://127.0.0.1:4061;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    }\n}\n`,
      };
    }
    throw err;
  }
}

export async function writeNginx(serverId: string, name: string, content: string): Promise<{ message: string }> {
  try {
    return await req<{ message: string }>(`/api/servers/${serverId}/nginx/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    if (err instanceof DemoFallback) return { message: 'saved and nginx -t passed (demo)' };
    throw err;
  }
}

export async function reloadNginx(serverId: string): Promise<{ message: string }> {
  try {
    return await req<{ message: string }>(`/api/servers/${serverId}/nginx/reload`, { method: 'POST', body: '{}' });
  } catch (err) {
    if (err instanceof DemoFallback) return { message: 'nginx reloaded (demo)' };
    throw err;
  }
}

// ---------- deploys (streaming) ----------

export type StreamHandler = (event: { type: 'log'; line: string; stream: string } | { type: 'done'; ok: boolean; error?: string }) => void;

function streamSse(url: string, body: unknown, onEvent: StreamHandler): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
      .then(async (res) => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/event-stream')) {
          const data = await res.json().catch(() => ({}));
          if (!ct.includes('application/json')) { setDemo(true); reject(new DemoFallback('no backend')); return; }
          reject(new Error((data as { error?: string }).error || `Request failed (${res.status})`));
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) { resolve(); return Promise.resolve(); }
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const eventLine = chunk.split('\n').find((l) => l.startsWith('event:'));
              const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
              if (eventLine && dataLine) {
                const event = eventLine.slice(6).trim();
                const data = JSON.parse(dataLine.slice(5).trim());
                if (event === 'log') onEvent({ type: 'log', line: data.line, stream: data.stream });
                else if (event === 'done') onEvent({ type: 'done', ok: data.ok, error: data.error });
              }
            }
            return pump();
          });
        return pump();
      })
      .catch((err) => reject(err instanceof DemoFallback ? err : new Error(String(err.message || err))));
  });
}

export async function redeploy(serverId: string, appName: string, onEvent: StreamHandler): Promise<void> {
  try {
    await streamSse(`/api/servers/${serverId}/apps/${encodeURIComponent(appName)}/redeploy`, {}, onEvent);
  } catch (err) {
    if (err instanceof DemoFallback) return simulateStream(demoDeployLines(appName, 'origin'), onEvent, true);
    throw err;
  }
}

export async function deployApp(serverId: string, reqBody: DeployRequest, onEvent: StreamHandler): Promise<void> {
  try {
    await streamSse(`/api/servers/${serverId}/deploy`, reqBody, onEvent);
  } catch (err) {
    if (err instanceof DemoFallback) return simulateStream(demoDeployLines(reqBody.name, reqBody.repo), onEvent, false);
    throw err;
  }
}

function simulateStream(lines: string[], onEvent: StreamHandler, isRedeploy: boolean): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (i < lines.length) {
        onEvent({ type: 'log', line: lines[i], stream: 'stdout' });
        i += 1;
        setTimeout(step, 120 + Math.random() * 260);
      } else {
        if (isRedeploy) onEvent({ type: 'log', line: '✓ redeploy finished', stream: 'stdout' });
        onEvent({ type: 'done', ok: true });
        resolve();
      }
    };
    step();
  });
}
