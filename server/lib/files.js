import { shellQuote } from './runners.js';

/**
 * App .env and nginx config editing.
 * Everything is validated and backed up before writing; nginx edits are
 * tested with `nginx -t` and rolled back automatically on failure.
 */

const ALLOWED_ENV_FILES = new Set(['.env', '.env.local', '.env.production']);
const NGINX_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertEnvFile(file) {
  if (!ALLOWED_ENV_FILES.has(file)) {
    throw new Error('Only .env, .env.local and .env.production can be edited');
  }
}

function assertCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('..') || cwd.length > 200) {
    throw new Error('Invalid app directory');
  }
}

function assertNginxName(name) {
  if (!NGINX_NAME_RE.test(name) || name.includes('..')) {
    throw new Error('Invalid config filename');
  }
}

// ---------- app .env ----------

export async function readAppEnv(runner, cwd, file = '.env') {
  assertCwd(cwd);
  assertEnvFile(file);
  const target = `${cwd}/${file}`;
  const { stdout, code } = await runner.exec(
    `if [ -f ${shellQuote(target)} ]; then echo "__EXISTS__"; cat ${shellQuote(target)}; else echo "__MISSING__"; fi`,
    10000
  );
  if (code !== 0) throw new Error('Could not read the env file');
  if (stdout.startsWith('__MISSING__') || stdout.trim() === '__MISSING__') return { exists: false, path: target, content: '' };
  if (stdout.startsWith('__EXISTS__')) return { exists: true, path: target, content: stdout.slice('__EXISTS__'.length).replace(/^\n/, '') };
  return { exists: false, path: target, content: '' };
}

export async function writeAppEnv(runner, cwd, file = '.env', content = '') {
  assertCwd(cwd);
  assertEnvFile(file);
  if (typeof content !== 'string' || content.length > 100_000) throw new Error('Env content too large');
  const target = `${cwd}/${file}`;
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const script = `
cd ${shellQuote(cwd)} || exit 1
TS=$(date +%Y%m%d%H%M%S)
if [ -f ${shellQuote(file)} ]; then cp ${shellQuote(file)} ${shellQuote(file)}.bak-$TS; fi
echo ${shellQuote(b64)} | base64 -d > ${shellQuote(`${file}.fleet-tmp`)} || exit 1
mv ${shellQuote(`${file}.fleet-tmp`)} ${shellQuote(file)}
echo "saved (backup: ${file}.bak-$TS)"
`.trim();
  const { stdout, stderr, code } = await runner.exec(script, 15000);
  if (code !== 0) throw new Error(stderr.trim() || 'Could not write the env file — check permissions');
  return { ok: true, path: target, message: stdout.trim() };
}

// ---------- nginx ----------

// Root can be overridden (e.g. NGINX_ROOT=/tmp/fake-nginx) for testing or
// non-standard layouts. Defaults to the conventional /etc/nginx.
const NGINX_ROOT = (process.env.NGINX_ROOT || '/etc/nginx').replace(/\/+$/, '');

export async function listNginxConfigs(runner) {
  const script = `
AVAIL=${NGINX_ROOT}/sites-available
ENAB=${NGINX_ROOT}/sites-enabled
[ -d "$AVAIL" ] || { echo "__NO_NGINX__"; exit 0; }
for f in "$AVAIL"/*; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  case "$base" in *.bak-*|*.fleet-tmp) continue;; esac
  if [ -L "$ENAB/$base" ]; then en="yes"; else en="no"; fi
  domains=$(grep -hoE 'server_name[^;]*;' "$f" | head -1 | sed 's/server_name//;s/;//' | xargs)
  echo "$base|$en|$domains"
done`.trim();
  const { stdout } = await runner.exec(script, 10000);
  if (stdout.includes('__NO_NGINX__')) return { nginx: false, files: [] };
  const files = stdout.split('\n').filter(Boolean).map((line) => {
    const [name, en, domains] = line.split('|');
    return { name, enabled: en === 'yes', domains: (domains || '').trim() };
  });
  return { nginx: true, files, root: `${NGINX_ROOT}/sites-available` };
}

export async function readNginxConfig(runner, name) {
  assertNginxName(name);
  const target = `${NGINX_ROOT}/sites-available/${name}`;
  const { stdout, code, stderr } = await runner.exec(`cat ${shellQuote(target)}`, 10000);
  if (code !== 0) throw new Error(stderr.trim() || 'Could not read the config');
  return { name, path: target, content: stdout };
}

export async function writeNginxConfig(runner, name, content) {
  assertNginxName(name);
  if (typeof content !== 'string' || content.length > 200_000) throw new Error('Config too large');
  const target = `${NGINX_ROOT}/sites-available/${name}`;
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const script = `
set -o pipefail
TS=$(date +%Y%m%d%H%M%S)
BACKUP=${shellQuote(target)}.bak-$TS
# decode to a temp file in /tmp first (always writable)
echo ${shellQuote(b64)} | base64 -d > /tmp/fleet-nginx-$TS || { echo "ERROR: decode failed"; exit 1; }
# back up the current file
if [ -f ${shellQuote(target)} ]; then
  (cp ${shellQuote(target)} "$BACKUP" 2>/dev/null || sudo -n cp ${shellQuote(target)} "$BACKUP") || { echo "ERROR: no permission to back up $target"; exit 1; }
fi
# apply the new config
if ! (cp /tmp/fleet-nginx-$TS ${shellQuote(target)} 2>/dev/null || sudo -n cp /tmp/fleet-nginx-$TS ${shellQuote(target)}); then
  echo "ERROR: permission denied writing $target."
  echo "Grant the panel user access once, e.g.:"
  echo "  sudo chown -R \\$USER /etc/nginx/sites-available"
  echo "  echo '\\$USER ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t, /usr/sbin/nginx -s reload, /bin/systemctl reload nginx' | sudo tee /etc/sudoers.d/fleet-panel"
  exit 1
fi
# validate the WHOLE nginx config; roll back on failure
TEST=$( (nginx -t 2>&1 || sudo -n nginx -t 2>&1) )
if ! echo "$TEST" | grep -q "syntax is ok"; then
  if [ -f "$BACKUP" ]; then (cp "$BACKUP" ${shellQuote(target)} 2>/dev/null || sudo -n cp "$BACKUP" ${shellQuote(target)}); fi
  echo "ERROR: nginx config test failed — change rolled back."
  echo "$TEST"
  exit 1
fi
echo "saved and nginx -t passed (backup: $BACKUP)"
`.trim();
  const { stdout, stderr, code } = await runner.exec(script, 20000);
  if (code !== 0) throw new Error((stdout + '\n' + stderr).trim() || 'Could not write the config');
  return { ok: true, path: target, message: stdout.trim() };
}

export async function reloadNginx(runner) {
  const { stdout, stderr, code } = await runner.exec(
    '(sudo -n systemctl reload nginx 2>/dev/null || sudo -n nginx -s reload 2>/dev/null || systemctl reload nginx 2>&1 || nginx -s reload 2>&1)',
    15000
  );
  const out = (stdout + stderr).trim();
  if (out && /denied|password|not in the sudoers/i.test(out)) {
    throw new Error('Reload needs sudo — add the sudoers rule shown when saving a config.');
  }
  return { ok: true, message: out || 'nginx reloaded' };
}

/** Which env files exist in an app dir (for the editor's file picker). */
export async function listEnvFiles(runner, cwd) {
  assertCwd(cwd);
  const { stdout } = await runner.exec(
    `cd ${shellQuote(cwd)} 2>/dev/null && ls -1a | grep -E '^\\.env(\\.|$)' | grep -v '\\.bak' || true`,
    10000
  );
  return stdout.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('.env'));
}
