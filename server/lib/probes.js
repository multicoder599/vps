import { shellQuote } from './runners.js';

/**
 * Server probes — pure bash, no dependencies on the target machine.
 * Works identically through LocalRunner and SshRunner.
 */

const METRICS_SCRIPT = `
read _ u1 n1 s1 i1 _ < /proc/stat; sleep 0.4
read _ u2 n2 s2 i2 _ < /proc/stat
awk -v u1="$u1" -v n1="$n1" -v s1="$s1" -v i1="$i1" -v u2="$u2" -v n2="$n2" -v s2="$s2" -v i2="$i2" 'BEGIN{
  t1=u1+n1+s1+i1; t2=u2+n2+s2+i2; dt=t2-t1; di=i2-i1;
  printf "CPU=%.1f\\n", (dt>0)? (1-di/dt)*100 : 0 }'
awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{printf "MEM_TOTAL=%d\\nMEM_USED=%d\\n", t*1024, (t-a)*1024}' /proc/meminfo
df -B1 / | awk 'NR==2{printf "DISK_TOTAL=%s\\nDISK_USED=%s\\n", $2, $3}'
awk '{printf "UPTIME=%d\\n", $1}' /proc/uptime
cut -d' ' -f1-3 /proc/loadavg | awk '{print "LOAD="$0}'
nproc | awk '{print "CORES="$0}'
( . /etc/os-release 2>/dev/null; echo "OS=$PRETTY_NAME" ) || uname -sr | awk '{print "OS="$0}'
hostname | awk '{print "HOSTNAME="$0}'
`.trim();

export async function getMetrics(runner) {
  const { stdout, code, stderr } = await runner.exec(METRICS_SCRIPT, 15000);
  if (code !== 0) throw new Error(stderr.trim() || 'Metrics probe failed');
  const kv = {};
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    cpuPercent: parseFloat(kv.CPU) || 0,
    memTotal: Number(kv.MEM_TOTAL) || 0,
    memUsed: Number(kv.MEM_USED) || 0,
    diskTotal: Number(kv.DISK_TOTAL) || 0,
    diskUsed: Number(kv.DISK_USED) || 0,
    uptimeSeconds: Number(kv.UPTIME) || 0,
    loadAvg: kv.LOAD || '',
    cores: Number(kv.CORES) || 1,
    os: kv.OS || 'Linux',
    hostname: kv.HOSTNAME || '',
    at: new Date().toISOString(),
  };
}

function parsePm2List(jsonText) {
  let list;
  try {
    list = JSON.parse(jsonText);
  } catch {
    // pm2 jlist sometimes prints warnings before the JSON — take from first '['
    const i = jsonText.indexOf('[');
    if (i < 0) return [];
    try { list = JSON.parse(jsonText.slice(i)); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({
    name: p.name,
    id: p.pm_id,
    status: p.pm2_env?.status || 'unknown',
    cpu: p.monit?.cpu ?? 0,
    memory: p.monit?.memory ?? 0,
    restarts: p.pm2_env?.restart_time ?? 0,
    uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
    cwd: p.pm2_env?.pm_cwd || '',
    version: p.pm2_env?.version || '',
    instances: p.pm2_env?.instances ?? 1,
    execMode: p.pm2_env?.exec_mode || 'fork',
  }));
}

export async function listApps(runner) {
  const { stdout, code } = await runner.exec('command -v pm2 >/dev/null 2>&1 && pm2 jlist || echo "__NO_PM2__"', 15000);
  if (stdout.includes('__NO_PM2__')) return { pm2: false, apps: [] };
  if (code !== 0) throw new Error('Could not read pm2 process list');
  return { pm2: true, apps: parsePm2List(stdout) };
}

const ALLOWED_ACTIONS = new Set(['restart', 'stop', 'start', 'reload', 'delete']);

export async function appAction(runner, name, action) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error('Unsupported action');
  assertSafeName(name);
  const pm2Cmd = action === 'delete' ? `pm2 delete ${shellQuote(name)}` : `pm2 ${action} ${shellQuote(name)}`;
  const { stdout, stderr, code } = await runner.exec(`${pm2Cmd} && pm2 save`, 30000);
  if (code !== 0) throw new Error((stderr || stdout).trim().slice(0, 500) || `pm2 ${action} failed`);
  return { ok: true };
}

export async function getLogs(runner, name, lines = 200) {
  assertSafeName(name);
  const n = Math.min(Math.max(parseInt(lines, 10) || 200, 1), 2000);
  // Read the raw log files directly — faster and cleaner than `pm2 logs`.
  const script = `
for f in "$HOME/.pm2/logs/${name}-out.log" "$HOME/.pm2/logs/${name}-error.log"; do
  [ -f "$f" ] || continue
  echo "--- ${name}$(basename "$f" | sed "s/${name}//") ---"
  tail -n ${n} "$f"
done`.trim();
  const { stdout, code, stderr } = await runner.exec(script, 15000);
  if (code !== 0 && !stdout) throw new Error(stderr.trim() || 'Could not read logs');
  return stdout || '(no log output yet)';
}

/** Redeploy an existing pm2 app: git pull + install + restart, streaming output. */
export async function redeployApp(runner, name, onLine) {
  assertSafeName(name);
  const script = `
set -o pipefail
CWD=$(pm2 describe ${shellQuote(name)} 2>/dev/null | awk -F': ' '/exec cwd|script path|pm cwd/{print $2; exit}')
if [ -z "$CWD" ]; then CWD=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const p=a.find(x=>x.name===process.argv[1]);console.log(p&&p.pm2_env?(p.pm2_env.pm_cwd||""):"")}catch(e){console.log("")}})' ${shellQuote(name)}); fi
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then echo "ERROR: could not find app directory for ${name}"; exit 1; fi
echo "→ app directory: $CWD"
cd "$CWD" || exit 1
if [ -d .git ]; then
  echo "→ git pull"
  git pull --ff-only || { echo "ERROR: git pull failed"; exit 1; }
else
  echo "→ no git repo found, skipping pull"
fi
if [ -f package.json ]; then
  echo "→ installing dependencies"
  if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi || { echo "ERROR: npm install failed"; exit 1; }
fi
echo "→ restarting ${name}"
pm2 restart ${shellQuote(name)} && pm2 save
echo "✓ redeploy finished"
`.trim();
  return runner.execStream(script, onLine);
}

/**
 * Deploy a brand-new app from a git repo. Streams every line back.
 * opts: { name, repo, branch, port, env: [{key,value}], startCmd, subdir }
 */
export async function deployNewApp(runner, opts, onLine) {
  const { name, repo, branch = 'main', port, env = [], startCmd = 'npm start' } = opts;
  assertSafeName(name);
  if (!/^https?:\/\/\S+|^git@\S+$/.test(repo)) throw new Error('Repo must be an https or git@ URL');
  const envPrefix = env
    .filter((e) => e && /^[A-Za-z_][A-Za-z0-9_]*$/.test(e.key))
    .map((e) => `${e.key}=${shellQuote(e.value)}`)
    .join(' ');
  const portPrefix = port && /^\d+$/.test(String(port)) ? `PORT=${Number(port)}` : '';

  const script = `
set -o pipefail
APPS_DIR="$HOME/apps"
mkdir -p "$APPS_DIR"
cd "$APPS_DIR"
if [ -d ${shellQuote(name)} ]; then
  echo "→ directory apps/${name} exists, updating instead"
  cd ${shellQuote(name)}
  git fetch --all && git reset --hard origin/${shellQuote(branch)} || { echo "ERROR: git update failed"; exit 1; }
else
  echo "→ cloning ${repo} (branch ${branch})"
  git clone --depth 1 --branch ${shellQuote(branch)} ${shellQuote(repo)} ${shellQuote(name)} || { echo "ERROR: git clone failed — check the repo URL and branch"; exit 1; }
  cd ${shellQuote(name)}
fi
if [ -f package.json ]; then
  echo "→ installing dependencies"
  if [ -f package-lock.json ]; then npm ci; else npm install; fi || { echo "ERROR: npm install failed"; exit 1; }
  if node -e "process.exit(require('./package.json').scripts&&require('./package.json').scripts.build?0:1)" 2>/dev/null; then
    echo "→ running build"
    npm run build || { echo "ERROR: build failed"; exit 1; }
  fi
else
  echo "→ no package.json found — starting the file you specify"
fi
if ! command -v pm2 >/dev/null 2>&1; then echo "ERROR: pm2 is not installed on this server"; exit 1; fi
pm2 delete ${shellQuote(name)} >/dev/null 2>&1 || true
echo "→ starting ${name} with pm2"
if [ -f package.json ]; then
  env ${portPrefix} ${envPrefix} pm2 start npm --name ${shellQuote(name)} -- ${shellQuote(startCmd.replace(/^npm\s+/, ''))} || { echo "ERROR: pm2 start failed"; exit 1; }
else
  env ${portPrefix} ${envPrefix} pm2 start ${shellQuote(startCmd)} --name ${shellQuote(name)} || { echo "ERROR: pm2 start failed"; exit 1; }
fi
pm2 save
echo "✓ deploy finished — ${name} is live under pm2"
`.trim();
  return runner.execStream(script, onLine);
}

function assertSafeName(name) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
    throw new Error('Invalid app name — use letters, numbers, dash, dot, underscore only');
  }
}
