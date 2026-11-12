import crypto from 'node:crypto';

/**
 * Single-admin password auth.
 * Password comes from env PANEL_PASSWORD (required — no default, by design).
 * Sessions are random tokens kept in memory; a restart simply logs everyone out.
 */

const PASSWORD = process.env.PANEL_PASSWORD;
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map(); // token -> expiresAt

// naive per-IP login rate limit: 5 tries / 5 min
const attempts = new Map();

export function passwordConfigured() {
  return Boolean(PASSWORD && PASSWORD.length >= 8);
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
  const ok = typeof password === 'string'
    && password.length === PASSWORD.length
    && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(PASSWORD));
  if (!ok) {
    recordFail(ip);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  res.setHeader('Set-Cookie', `panel_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`);
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
