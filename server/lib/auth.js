import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Admin auth.
 * - Bootstrap: env PANEL_PASSWORD (min 8 chars) on first start.
 * - After a password change, the scrypt hash persists in data/auth.json and
 *   takes precedence over the env var, so changes survive restarts.
 * - Sessions are random 256-bit tokens kept in memory, HttpOnly cookie.
 */

const DATA_DIR = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

const ENV_PASSWORD = process.env.PANEL_PASSWORD;
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map(); // token -> expiresAt

// naive per-IP login rate limit: 5 tries / 5 min
const attempts = new Map();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readStoredHash() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (j && j.salt && j.hash) return j;
  } catch { /* no file yet */ }
  return null;
}

function scrypt(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function writeHash(password) {
  ensureDir();
  const salt = crypto.randomBytes(16).toString('hex');
  const j = { salt, hash: scrypt(password, salt), updatedAt: new Date().toISOString() };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(j), { mode: 0o600 });
}

export function verifyPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const stored = readStoredHash();
  if (stored) {
    return crypto.timingSafeEqual(
      Buffer.from(scrypt(candidate, stored.salt)),
      Buffer.from(stored.hash)
    );
  }
  if (!ENV_PASSWORD) return false;
  return candidate.length === ENV_PASSWORD.length
    && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(ENV_PASSWORD));
}

export function passwordConfigured() {
  return Boolean(readStoredHash()) || Boolean(ENV_PASSWORD && ENV_PASSWORD.length >= 8);
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, reset: now + 5 * 60 * 1000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 5 * 60 * 1000; }
  attempts.set(ip, rec);
  return rec.count >= 5;
}

function recordFail(ip) {
  const rec = attempts.get(ip) || { count: 0, reset: Date.now() + 5 * 60 * 1000 };
  rec.count += 1;
  attempts.set(ip, rec);
}

export function login(req, res) {
  if (!passwordConfigured()) {
    return res.status(500).json({ error: 'Panel password is not configured. Set PANEL_PASSWORD and restart.' });
  }
  const ip = req.ip || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { password } = req.body || {};
  if (!verifyPassword(password)) {
    recordFail(ip);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  res.setHeader('Set-Cookie', `panel_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`);
  res.json({ ok: true });
}

export function changePassword(req, res) {
  const { current, next } = req.body || {};
  if (!verifyPassword(current)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  if (typeof next !== 'string' || next.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  writeHash(next);
  // keep the caller's session, drop everyone else
  const caller = readToken(req);
  for (const token of sessions.keys()) {
    if (token !== caller) sessions.delete(token);
  }
  res.json({ ok: true });
}

export function logout(req, res) {
  const token = readToken(req);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'panel_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
}

export function readToken(req) {
  const header = req.headers.cookie || '';
  const m = header.match(/(?:^|;\s*)panel_session=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

export function requireAuth(req, res, next) {
  const token = readToken(req);
  const exp = token && sessions.get(token);
  if (exp && exp > Date.now()) {
    sessions.set(token, Date.now() + SESSION_TTL); // rolling expiry
    return next();
  }
  if (token) sessions.delete(token);
  return res.status(401).json({ error: 'Not authenticated' });
}

export function me(req, res) {
  res.json({ ok: true });
}
