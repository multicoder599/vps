import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * JSON-file store with AES-256-GCM encryption for SSH secrets.
 * Data lives in <root>/data/servers.json — no external database needed.
 */

const DATA_DIR = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'servers.json');
const KEY_FILE = path.join(DATA_DIR, '.secret-key');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function loadKey() {
  ensureDir();
  if (process.env.PANEL_SECRET) {
    return crypto.createHash('sha256').update(process.env.PANEL_SECRET).digest();
  }
  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

const KEY = loadKey();

export function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) return { servers: [] };
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return { servers: [] };
  }
}

function writeStore(data) {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Public view of a server — never includes secrets. */
function publicView(s) {
  const { secret, ...rest } = s;
  return { ...rest, hasSecret: Boolean(secret) };
}

export function listServers() {
  const store = readStore();
  const localsFirst = [...store.servers].sort((a, b) => (a.kind === 'local' ? -1 : 1) - (b.kind === 'local' ? -1 : 1));
  return localsFirst.map(publicView);
}

export function getServer(id, withSecret = false) {
  const s = readStore().servers.find((x) => x.id === id);
  if (!s) return null;
  if (!withSecret) return publicView(s);
  return { ...s, secretPlain: s.secret ? decryptSecret(s.secret) : null };
}

export function addServer(input) {
  const store = readStore();
  const server = {
    id: crypto.randomUUID(),
    kind: 'remote',
    name: input.name,
    host: input.host,
    port: input.port || 22,
    username: input.username,
    authType: input.authType, // 'password' | 'key'
    secret: encryptSecret(input.secret),
    createdAt: new Date().toISOString(),
  };
  store.servers.push(server);
  writeStore(store);
  return publicView(server);
}

export function removeServer(id) {
  const store = readStore();
  const before = store.servers.length;
  store.servers = store.servers.filter((x) => x.id !== id || x.kind === 'local');
  writeStore(store);
  return store.servers.length < before;
}

export function ensureLocalServer() {
  const store = readStore();
  if (!store.servers.some((x) => x.kind === 'local')) {
    store.servers.unshift({
      id: 'local',
      kind: 'local',
      name: process.env.LOCAL_SERVER_NAME || 'This VPS (local)',
      host: '127.0.0.1',
      port: 0,
      username: process.env.USER || 'root',
      authType: 'none',
      secret: null,
      createdAt: new Date().toISOString(),
    });
    writeStore(store);
  }
}
