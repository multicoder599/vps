import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ensureLocalServer, listServers, getServer, addServer, removeServer } from './lib/store.js';
import { runnerFor } from './lib/runners.js';
import { getMetrics, listApps, appAction, getLogs, redeployApp, deployNewApp } from './lib/probes.js';
import { readAppEnv, writeAppEnv, listEnvFiles, listNginxConfigs, readNginxConfig, writeNginxConfig, reloadNginx } from './lib/files.js';
import { login, logout, me, requireAuth, changePassword } from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 5101);

app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));

// security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

ensureLocalServer();

// ---------- auth ----------
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.post('/api/auth/change-password', requireAuth, changePassword);
app.get('/api/auth/me', requireAuth, me);

// ---------- helpers ----------
function withServer(req, res, fn) {
  const server = getServer(req.params.id, true);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  return Promise.resolve(fn(server, runnerFor(server))).catch((err) => {
    if (!res.headersSent) res.status(500).json({ error: String(err.message || err) });
  });
}

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // let nginx stream
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return send;
}

const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  res.status(500).json({ error: String(err.message || err) });
});

// ---------- servers ----------
app.get('/api/servers', requireAuth, asyncRoute(async (req, res) => {
  res.json({ servers: listServers() });
}));

app.post('/api/servers', requireAuth, asyncRoute(async (req, res) => {
  const { name, host, port, username, authType, secret } = req.body || {};
  if (!name || !host || !username) return res.status(400).json({ error: 'name, host and username are required' });
  if (!['password', 'key'].includes(authType)) return res.status(400).json({ error: 'authType must be password or key' });
  if (!secret) return res.status(400).json({ error: authType === 'key' ? 'Paste the private key' : 'Password is required' });
  if (!/^[A-Za-z0-9.\-]{1,253}$/.test(host)) return res.status(400).json({ error: 'Invalid host' });

  // test the connection before saving
  const testRunner = runnerFor({ kind: 'remote', host, port: Number(port) || 22, username, authType, secretPlain: secret });
  try {
    const metrics = await getMetrics(testRunner);
    const server = addServer({ name, host, port: Number(port) || 22, username, authType, secret });
    res.json({ server, verified: true, hostname: metrics.hostname, os: metrics.os });
  } catch (err) {
    res.status(400).json({ error: `Could not connect: ${err.message}` });
  }
}));

app.delete('/api/servers/:id', requireAuth, asyncRoute(async (req, res) => {
  if (req.params.id === 'local') return res.status(400).json({ error: 'The local server cannot be removed' });
  const ok = removeServer(req.params.id);
  res.json({ ok });
}));

app.get('/api/servers/:id/metrics', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    const metrics = await getMetrics(runner);
    res.json({ metrics });
  });
}));

app.get('/api/servers/:id/overview', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    const [metrics, appsResult] = await Promise.all([getMetrics(runner), listApps(runner)]);
    res.json({ metrics, ...appsResult });
  });
}));

// ---------- pm2 apps ----------
app.get('/api/servers/:id/apps', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    res.json(await listApps(runner));
  });
}));

app.post('/api/servers/:id/apps/:name/action', requireAuth, asyncRoute(async (req, res) => {
  const { action } = req.body || {};
  withServer(req, res, async (server, runner) => {
    res.json(await appAction(runner, req.params.name, action));
  });
}));

app.get('/api/servers/:id/apps/:name/logs', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    const logs = await getLogs(runner, req.params.name, req.query.lines);
    res.json({ logs });
  });
}));

// ---------- app .env files ----------
app.get('/api/servers/:id/apps/:name/env', requireAuth, asyncRoute(async (req, res) => {
  const cwd = String(req.query.cwd || '');
  const file = String(req.query.file || '.env');
  withServer(req, res, async (server, runner) => {
    res.json(await readAppEnv(runner, cwd, file));
  });
}));

app.get('/api/servers/:id/apps/:name/env-files', requireAuth, asyncRoute(async (req, res) => {
  const cwd = String(req.query.cwd || '');
  withServer(req, res, async (server, runner) => {
    res.json({ files: await listEnvFiles(runner, cwd) });
  });
}));

app.put('/api/servers/:id/apps/:name/env', requireAuth, asyncRoute(async (req, res) => {
  const { cwd, file = '.env', content = '' } = req.body || {};
  withServer(req, res, async (server, runner) => {
    res.json(await writeAppEnv(runner, String(cwd), String(file), content));
  });
}));

// ---------- nginx configs ----------
app.get('/api/servers/:id/nginx', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    res.json(await listNginxConfigs(runner));
  });
}));

app.get('/api/servers/:id/nginx/:name', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    res.json(await readNginxConfig(runner, req.params.name));
  });
}));

app.put('/api/servers/:id/nginx/:name', requireAuth, asyncRoute(async (req, res) => {
  const { content = '' } = req.body || {};
  withServer(req, res, async (server, runner) => {
    res.json(await writeNginxConfig(runner, req.params.name, content));
  });
}));

app.post('/api/servers/:id/nginx/reload', requireAuth, asyncRoute(async (req, res) => {
  withServer(req, res, async (server, runner) => {
    res.json(await reloadNginx(runner));
  });
}));

// ---------- deploys (SSE streams) ----------
app.post('/api/servers/:id/apps/:name/redeploy', requireAuth, (req, res) => {
  const server = getServer(req.params.id, true);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const send = sse(res);
  redeployApp(runnerFor(server), req.params.name, (line, stream) => send('log', { line, stream }))
    .then((code) => send('done', { code, ok: code === 0 }))
    .catch((err) => send('done', { code: 1, ok: false, error: String(err.message || err) }))
    .finally(() => res.end());
});

app.post('/api/servers/:id/deploy', requireAuth, (req, res) => {
  const server = getServer(req.params.id, true);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const { name, repo, branch, port, env, startCmd } = req.body || {};
  if (!name || !repo) return res.status(400).json({ error: 'name and repo are required' });
  const send = sse(res);
  deployNewApp(runnerFor(server), { name, repo, branch, port, env, startCmd }, (line, stream) => send('log', { line, stream }))
    .then((code) => send('done', { code, ok: code === 0 }))
    .catch((err) => send('done', { code: 1, ok: false, error: String(err.message || err) }))
    .finally(() => res.end());
});

// ---------- health (unauthenticated, for monitoring) ----------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- static frontend ----------
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Fleet Panel listening on http://0.0.0.0:${PORT}`);
});
