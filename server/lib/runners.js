import { exec, spawn } from 'node:child_process';
import { Client } from 'ssh2';

/**
 * Two interchangeable command runners:
 *  - LocalRunner: runs on this machine via child_process
 *  - SshRunner: runs on a linked VPS via ssh2 (password or private key)
 * Both expose exec(cmd) and execStream(cmd, onLine) so the rest of the
 * backend doesn't care where a server lives.
 */

const DEFAULT_TIMEOUT = 20000;

/**
 * Non-interactive shells skip most of .bashrc, so tools installed via
 * nvm / npm-global / volta / fnm are often missing from PATH even though
 * they work fine in an SSH session. This bootstrap restores the common
 * locations explicitly before every command.
 */
const ENV_BOOTSTRAP = [
  'export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:$HOME/.local/bin:$HOME/.npm-global/bin"',
  '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true',
  '[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH" || true',
  '[ -d "$HOME/.fnm/aliases/default/bin" ] && export PATH="$HOME/.fnm/aliases/default/bin:$PATH" || true',
].join('; ');

function withEnv(cmd) {
  return `${ENV_BOOTSTRAP}; ${cmd}`;
}

export class LocalRunner {
  exec(cmd, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      // login shell so nvm / user-local installs (pm2, node) are on PATH
      exec(`/bin/bash -lc ${shellQuote(withEnv(cmd))}`, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && err.killed) return reject(new Error('Command timed out'));
        resolve({ code: err ? err.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  }

  execStream(cmd, onLine) {
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', ['-lc', withEnv(cmd)]);
      let bufOut = '';
      let bufErr = '';
      const flush = (buf, stream) => {
        const lines = buf.split('\n');
        const rest = lines.pop();
        for (const line of lines) onLine(line, stream);
        return rest;
      };
      child.stdout.on('data', (d) => { bufOut = flush(bufOut + d.toString(), 'stdout'); });
      child.stderr.on('data', (d) => { bufErr = flush(bufErr + d.toString(), 'stderr'); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (bufOut) onLine(bufOut, 'stdout');
        if (bufErr) onLine(bufErr, 'stderr');
        resolve(code ?? 0);
      });
    });
  }
}

export class SshRunner {
  constructor({ host, port, username, authType, secret }) {
    this.cfg = {
      host,
      port: port || 22,
      username,
      readyTimeout: 12000,
      algorithms: { serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] },
    };
    if (authType === 'key') this.cfg.privateKey = secret;
    else this.cfg.password = secret;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => { conn.end(); reject(new Error('SSH connection timed out')); }, 15000);
      conn.on('ready', () => { clearTimeout(timer); resolve(conn); });
      conn.on('error', (err) => { clearTimeout(timer); reject(new Error(friendlySshError(err))); });
      conn.connect(this.cfg);
    });
  }

  async exec(cmd, timeout = DEFAULT_TIMEOUT) {
    const conn = await this.connect();
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Command timed out')), timeout);
        conn.exec(`bash -lc ${shellQuote(withEnv(cmd))}`, (err, stream) => {
          if (err) { clearTimeout(timer); return reject(err); }
          let stdout = ''; let stderr = '';
          stream.on('data', (d) => { stdout += d.toString(); });
          stream.stderr.on('data', (d) => { stderr += d.toString(); });
          stream.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 0, stdout, stderr }); });
          stream.on('error', (e) => { clearTimeout(timer); reject(e); });
        });
      });
    } finally {
      conn.end();
    }
  }

  async execStream(cmd, onLine) {
    const conn = await this.connect();
    try {
      return await new Promise((resolve, reject) => {
        conn.exec(`bash -lc ${shellQuote(withEnv(cmd))}`, (err, stream) => {
          if (err) return reject(err);
          let bufOut = ''; let bufErr = '';
          const flush = (buf, name) => {
            const lines = buf.split('\n');
            const rest = lines.pop();
            for (const line of lines) onLine(line, name);
            return rest;
          };
          stream.on('data', (d) => { bufOut = flush(bufOut + d.toString(), 'stdout'); });
          stream.stderr.on('data', (d) => { bufErr = flush(bufErr + d.toString(), 'stderr'); });
          stream.on('close', (code) => {
            if (bufOut) onLine(bufOut, 'stdout');
            if (bufErr) onLine(bufErr, 'stderr');
            resolve(code ?? 0);
          });
          stream.on('error', reject);
        });
      });
    } finally {
      conn.end();
    }
  }
}

export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function friendlySshError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/authentication/i.test(msg)) return 'SSH authentication failed — check the username and password/key.';
  if (/ECONNREFUSED/.test(msg)) return 'Connection refused — is SSH running on that port?';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Host not found — check the IP/hostname.';
  if (/ETIMEDOUT|timed out/i.test(msg)) return 'Connection timed out — check the host, port, and firewall.';
  return msg;
}

/** Build the right runner for a stored server record. */
export function runnerFor(server) {
  if (server.kind === 'local') return new LocalRunner();
  return new SshRunner({
    host: server.host,
    port: server.port,
    username: server.username,
    authType: server.authType,
    secret: server.secretPlain,
  });
}
