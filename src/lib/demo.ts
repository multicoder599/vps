import type { Metrics, Overview, Pm2App, ServerInfo } from '@/types';

/**
 * Demo data — used ONLY when the panel backend is unreachable (e.g. the
 * static preview). On a real VPS the frontend talks to the live API.
 * The UI shows a DEMO badge whenever this module is in play.
 */

const now = Date.now();

export const demoServers: ServerInfo[] = [
  {
    id: 'local',
    kind: 'local',
    name: 'This VPS (local)',
    host: '127.0.0.1',
    port: 0,
    username: 'root',
    authType: 'none',
    createdAt: new Date(now - 86400000 * 30).toISOString(),
  },
  {
    id: 'demo-nairobi-1',
    kind: 'remote',
    name: 'nairobi-api-01',
    host: '102.213.44.18',
    port: 22,
    username: 'ubuntu',
    authType: 'password',
    createdAt: new Date(now - 86400000 * 4).toISOString(),
    hasSecret: true,
  },
];

export const demoApps: Pm2App[] = [
  { name: 'oddsxpess', id: 0, status: 'online', cpu: 3.2, memory: 184_500_000, restarts: 2, uptimeMs: now - 1000 * 60 * 60 * 26, cwd: '/root/oddsxpess', version: '5.3.0', instances: 1, execMode: 'fork' },
  { name: 'oddsxpess-admin', id: 1, status: 'online', cpu: 0.4, memory: 96_300_000, restarts: 0, uptimeMs: now - 1000 * 60 * 60 * 26, cwd: '/root/oddsxpess', version: '5.3.0', instances: 1, execMode: 'fork' },
  { name: 'settlement-worker', id: 2, status: 'online', cpu: 1.1, memory: 142_800_000, restarts: 7, uptimeMs: now - 1000 * 60 * 60 * 9, cwd: '/root/oddsxpess/workers', version: '1.4.2', instances: 1, execMode: 'fork' },
  { name: 'old-nalabets', id: 3, status: 'stopped', cpu: 0, memory: 0, restarts: 41, uptimeMs: 0, cwd: '/root/nalabets', version: '4.9.1', instances: 1, execMode: 'fork' },
];

export const demoAppsRemote: Pm2App[] = [
  { name: 'scores-feed', id: 0, status: 'online', cpu: 6.8, memory: 210_400_000, restarts: 1, uptimeMs: now - 1000 * 60 * 60 * 71, cwd: '/home/ubuntu/scores-feed', version: '2.0.7', instances: 1, execMode: 'fork' },
  { name: 'megapay-webhook', id: 1, status: 'online', cpu: 0.2, memory: 74_100_000, restarts: 0, uptimeMs: now - 1000 * 60 * 60 * 71, cwd: '/home/ubuntu/megapay-webhook', version: '1.1.0', instances: 1, execMode: 'fork' },
  { name: 'backup-cron', id: 2, status: 'errored', cpu: 0, memory: 0, restarts: 156, uptimeMs: 0, cwd: '/home/ubuntu/backup-cron', version: '0.3.0', instances: 1, execMode: 'fork' },
];

let tick = 0;

export function demoMetrics(serverId: string): Metrics {
  tick += 1;
  const remote = serverId !== 'local';
  const wave = (base: number, amp: number, speed: number) =>
    Math.max(1, Math.min(97, base + Math.sin(tick / speed) * amp + Math.random() * amp * 0.35));
  return {
    cpuPercent: wave(remote ? 18 : 34, remote ? 9 : 16, 6),
    memTotal: remote ? 2_147_483_648 : 4_294_967_296,
    memUsed: wave(remote ? 41 : 58, 3, 11) / 100 * (remote ? 2_147_483_648 : 4_294_967_296),
    diskTotal: remote ? 42_000_000_000 : 84_000_000_000,
    diskUsed: remote ? 17_500_000_000 : 39_200_000_000,
    uptimeSeconds: 2_419_200 - tick,
    loadAvg: remote ? '0.21 0.18 0.14' : '0.72 0.64 0.58',
    cores: remote ? 2 : 4,
    os: 'Ubuntu 24.04 LTS',
    hostname: remote ? 'nairobi-api-01' : 'vps-main',
    at: new Date().toISOString(),
  };
}

export function demoOverview(serverId: string): Overview {
  return {
    metrics: demoMetrics(serverId),
    pm2: true,
    apps: (serverId === 'local' ? demoApps : demoAppsRemote).map((a) =>
      a.status === 'online'
        ? { ...a, cpu: Math.max(0.1, a.cpu + (Math.random() - 0.5) * 1.4), uptimeMs: a.uptimeMs - 1000 }
        : a
    ),
  };
}

export const demoLogs = `[2026-11-11T18:42:07.112Z] GET /api/games 200 41ms
[2026-11-11T18:42:09.804Z] settlement sweep: 0 pending slips
[2026-11-11T18:42:31.556Z] GET /api/games 200 38ms
[2026-11-11T18:43:02.201Z] POST /api/admin/fixtures 201 122ms — 24 games injected, 0 duplicates skipped
[2026-11-11T18:43:02.377Z] parseKickoffFromTimeString: anchored "Today, 18:30" → Africa/Nairobi
[2026-11-11T18:43:11.940Z] GET /api/games 200 35ms
[2026-11-11T18:43:44.018Z] MegaPay STK push acknowledged, checkout MCK-88413
[2026-11-11T18:44:05.662Z] settlement: slip 7f3a…c91 marked WON (KES 1,240)
[2026-11-11T18:44:19.207Z] GET /api/games 200 33ms
[2026-11-11T18:45:00.003Z] lifecycle: "Arsenal vs Chelsea" → live (kickoff reached)
[2026-11-11T18:45:00.104Z] generateGoalTimes: admin-fixed result 2-1 applied
[2026-11-11T18:45:31.780Z] GET /api/games 200 31ms`;

export function demoDeployLines(appName: string, repo: string): string[] {
  return [
    `→ cloning ${repo} (branch main)`,
    `Cloning into '${appName}'...`,
    'remote: Enumerating objects: 214, done.',
    'remote: Counting objects: 100% (214/214), done.',
    '→ installing dependencies',
    'added 187 packages, and audited 188 packages in 6s',
    '23 packages are looking for funding',
    'found 0 vulnerabilities',
    '→ running build',
    '> build',
    '> vite build',
    'vite v5.4.11 building for production...',
    '✓ 412 modules transformed.',
    'dist/index.html                   0.62 kB',
    'dist/assets/index-Bx2kL9p1.js   212.44 kB │ gzip: 68.10 kB',
    '✓ built in 2.84s',
    `→ starting ${appName} with pm2`,
    `[PM2] Starting /usr/bin/npm in fork_mode (1 instance)`,
    `[PM2] Done.`,
    `┌────┬──────────────┬──────────┬──────┬───────────┐`,
    `│ id │ name         │ status   │ cpu  │ memory    │`,
    `├────┼──────────────┼──────────┼──────┼───────────┤`,
    `│ 4  │ ${appName.padEnd(12)} │ online   │ 0%   │ 42.1mb    │`,
    `└────┴──────────────┴──────────┴──────┴───────────┘`,
    `[PM2] Saving current process list...`,
    `[PM2] Successfully saved in /root/.pm2/dump.pm2`,
    `✓ deploy finished — ${appName} is live under pm2`,
  ];
}
