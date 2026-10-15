'use strict';
// LifeOS — a multi-user personal & career dashboard.
// Zero runtime dependencies: Node >= 22.5 (built-in node:sqlite).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, tx } = require('./lib/db');
const { ENTITIES, LINKABLE, IMPORT_ORDER } = require('./lib/schema');
const lb = require('./lib/leaderboards');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'lifeos.db');
const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const COOKIE = 'lifeos_sid';
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';

const db = open(DB_PATH);

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(bad('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isSecure(req) {
  return process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
}
function sessionCookie(req, token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + SESSION_DAYS * 86400000);
  return token;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare('SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

function publicUser(u) {
  let settings = {};
  try {
    settings = JSON.parse(u.settings || '{}');
  } catch {}
  return { id: u.id, username: u.username, display_name: u.display_name, headline: u.headline || '', bio: u.bio || '', settings, created_at: u.created_at };
}

// Very small in-memory limiter for auth endpoints.
const attempts = new Map();
function rateLimit(req, key, max = 10, windowMs = 10 * 60 * 1000) {
  const ip = req.socket.remoteAddress || '?';
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (attempts.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Too many attempts, try again in a few minutes');
  list.push(now);
  attempts.set(k, list);
}

// ---------- validation ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerce(entity, name, f, v, userId) {
  if (v === undefined) return undefined;
  if (v === null || v === '') {
    if (f.required) throw bad(`${name} is required`);
    return null;
  }
  switch (f.type) {
    case 'text': {
      const s = String(v);
      if (s.length > (f.maxLen || 20000)) throw bad(`${name} is too long`);
      return s;
    }
    case 'enum':
      if (!f.enum.includes(v)) throw bad(`${name} must be one of ${f.enum.join(', ')}`);
      return v;
    case 'date':
      if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be YYYY-MM-DD`);
      return v;
    case 'bool':
      return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    case 'int':
    case 'real': {
      let n = Number(v);
      if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
      if (f.type === 'int') n = Math.round(n);
      if (f.min !== undefined && n < f.min) throw bad(`${name} must be ≥ ${f.min}`);
      if (f.max !== undefined && n > f.max) throw bad(`${name} must be ≤ ${f.max}`);
      return n;
    }
    case 'ref': {
      const id = Number(v);
      if (!Number.isInteger(id) || !db.prepare(`SELECT 1 FROM ${f.ref} WHERE id = ? AND user_id = ?`).get(id, userId)) {
        throw bad(`${name} refers to an unknown ${ENTITIES[f.ref].label.toLowerCase()}`);
      }
      return id;
    }
  }
  throw bad(`Unsupported field ${name}`);
}

function validate(entity, body, userId, isCreate) {
  const def = ENTITIES[entity];
  const out = {};
  for (const [name, f] of Object.entries(def.fields)) {
    let v = body[name];
    if (isCreate && (v === undefined || v === null || v === '') && f.default !== undefined) v = f.default;
    if (isCreate && f.required && (v === undefined || v === null || v === '')) throw bad(`${name} is required`);
    const c = coerce(entity, name, f, v, userId);
    if (c !== undefined) out[name] = c;
  }
  return out;
}

const listColumns = (entity) => ['id', ...Object.entries(ENTITIES[entity].fields).filter(([, f]) => !f.heavy).map(([n]) => n), 'created_at', 'updated_at'].join(', ');

function insertRow(entity, userId, values) {
  const cols = Object.keys(values);
  const sql = `INSERT INTO ${entity} (user_id${cols.map((c) => `, ${c}`).join('')}) VALUES (?${cols.map(() => ', ?').join('')})`;
  const r = db.prepare(sql).run(userId, ...cols.map((c) => values[c]));
  return Number(r.lastInsertRowid);
}

function getRow(entity, id, userId, full) {
  return db.prepare(`SELECT ${full ? '*' : listColumns(entity)} FROM ${entity} WHERE id = ? AND user_id = ?`).get(id, userId);
}

function validLinkEnd(type, id, userId) {
  return LINKABLE.includes(type) && Number.isInteger(id) && !!db.prepare(`SELECT 1 FROM ${type} WHERE id = ? AND user_id = ?`).get(id, userId);
}

function deleteLinksFor(entity, id, userId) {
  db.prepare('DELETE FROM links WHERE user_id = ? AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?))').run(userId, entity, id, entity, id);
}

function allData(userId, full) {
  const data = {};
  for (const e of Object.keys(ENTITIES)) {
    data[e] = db.prepare(`SELECT ${full ? '*' : listColumns(e)} FROM ${e} WHERE user_id = ? ORDER BY id`).all(userId);
    if (full) data[e].forEach((r) => delete r.user_id);
  }
  const links = db.prepare('SELECT id, from_type, from_id, to_type, to_id, label FROM links WHERE user_id = ? ORDER BY id').all(userId);
  return { data, links };
}

function importData(userId, payload, mode) {
  const src = (payload && payload.data) || {};
  const idMap = {};
  const counts = {};
  tx(db, () => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM links WHERE user_id = ?').run(userId);
      for (const e of [...IMPORT_ORDER].reverse()) db.prepare(`DELETE FROM ${e} WHERE user_id = ?`).run(userId);
    }
    for (const e of IMPORT_ORDER) {
      idMap[e] = {};
      counts[e] = 0;
      const rows = Array.isArray(src[e]) ? src[e] : [];
      const def = ENTITIES[e];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const r = { ...row };
        let skip = false;
        for (const [n, f] of Object.entries(def.fields)) {
          if (f.type === 'ref') {
            const mapped = idMap[f.ref][r[n]];
            if (!mapped) skip = true;
            else r[n] = mapped;
          }
        }
        if (skip) continue;
        const values = validate(e, r, userId, true);
        const newId = insertRow(e, userId, values);
        if (row.id !== undefined) idMap[e][row.id] = newId;
        counts[e]++;
      }
    }
    counts.links = 0;
    for (const l of Array.isArray(payload.links) ? payload.links : []) {
      const from = idMap[l.from_type] && idMap[l.from_type][l.from_id];
      const to = idMap[l.to_type] && idMap[l.to_type][l.to_id];
      if (!from || !to || !LINKABLE.includes(l.from_type) || !LINKABLE.includes(l.to_type)) continue;
      db.prepare('INSERT INTO links (user_id, from_type, from_id, to_type, to_id, label) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, l.from_type, from, l.to_type, to, l.label ? String(l.label).slice(0, 100) : null);
      counts.links++;
    }
  });
  return counts;
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;
  const isMutation = method !== 'GET' && method !== 'HEAD';

  // CSRF defence: mutations must come from our own fetch() wrapper.
  if (isMutation && req.headers['x-lifeos'] !== '1') throw new HttpError(403, 'Missing request header');

  const big = parts[0] === 'import' || parts[0] === 'sketches';
  const body = isMutation ? await readBody(req, big ? 30 * 1024 * 1024 : 2 * 1024 * 1024) : {};

  // ---- auth (no session needed)
  if (parts[0] === 'auth') {
    if (parts[1] === 'config' && method === 'GET') return send(res, 200, { allowSignup: ALLOW_SIGNUP });
    if (parts[1] === 'register' && method === 'POST') {
      if (!ALLOW_SIGNUP) throw new HttpError(403, 'Sign-ups are disabled on this server');
      rateLimit(req, 'register', 5);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const display = String(body.display_name || username).trim().slice(0, 80) || username;
      if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw bad('Username: 3–32 characters, letters, numbers, . _ -');
      if (password.length < 8) throw bad('Password must be at least 8 characters');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
      const r = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)').run(username, display, hashPassword(password));
      const token = createSession(Number(r.lastInsertRowid));
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
      return send(res, 201, publicUser(u), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (parts[1] === 'login' && method === 'POST') {
      rateLimit(req, 'login', 10);
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(body.username || '').trim().toLowerCase());
      if (!u || !verifyPassword(String(body.password || ''), u.password_hash)) throw new HttpError(401, 'Wrong username or password');
      const token = createSession(u.id);
      return send(res, 200, publicUser(u), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (parts[1] === 'logout' && method === 'POST') {
      const token = parseCookies(req)[COOKIE];
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    throw new HttpError(404, 'Not found');
  }

  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Please log in');
  const uid = user.id;

  // ---- profile
  if (parts[0] === 'me') {
    if (parts.length === 1 && method === 'GET') return send(res, 200, publicUser(user));
    if (parts.length === 1 && method === 'PUT') {
      const upd = {};
      if (body.display_name !== undefined) {
        upd.display_name = String(body.display_name).trim().slice(0, 80);
        if (!upd.display_name) throw bad('Display name is required');
      }
      if (body.headline !== undefined) upd.headline = String(body.headline).slice(0, 200);
      if (body.bio !== undefined) upd.bio = String(body.bio).slice(0, 5000);
      if (body.settings !== undefined) {
        const s = JSON.stringify(body.settings || {});
        if (s.length > 50000) throw bad('Settings too large');
        upd.settings = s;
      }
      const cols = Object.keys(upd);
      if (cols.length) db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => upd[c]), uid);
      return send(res, 200, publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(uid)));
    }
    if (parts[1] === 'password' && method === 'PUT') {
      rateLimit(req, 'password', 10);
      if (!verifyPassword(String(body.current || ''), user.password_hash)) throw new HttpError(401, 'Current password is wrong');
      if (String(body.next || '').length < 8) throw bad('New password must be at least 8 characters');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.next)), uid);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
      const token = createSession(uid);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (parts.length === 1 && method === 'DELETE') {
      if (!verifyPassword(String(body.password || ''), user.password_hash)) throw new HttpError(401, 'Password is wrong');
      db.prepare('DELETE FROM users WHERE id = ?').run(uid);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    throw new HttpError(404, 'Not found');
  }

  if (parts[0] === 'schema' && method === 'GET') return send(res, 200, { entities: ENTITIES, linkable: LINKABLE });
  if (parts[0] === 'bootstrap' && method === 'GET') {
    return send(res, 200, { user: publicUser(user), ...allData(uid, false) });
  }
  if (parts[0] === 'export' && method === 'GET') {
    const { data, links } = allData(uid, true);
    return send(res, 200, { app: 'lifeos', version: 1, exported_at: new Date().toISOString(), profile: publicUser(user), data, links }, {
      'Content-Disposition': `attachment; filename="lifeos-${user.username}.json"`,
    });
  }
  if (parts[0] === 'import' && method === 'POST') {
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const counts = importData(uid, body.payload || {}, mode);
    if (body.payload && body.payload.profile && body.applyProfile) {
      const p = body.payload.profile;
      db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), headline = ?, bio = ? WHERE id = ?')
        .run(p.display_name ? String(p.display_name).slice(0, 80) : null, String(p.headline || '').slice(0, 200), String(p.bio || '').slice(0, 5000), uid);
    }
    return send(res, 200, { ok: true, counts });
  }

  // ---- links (relations between any two linkable records)
  if (parts[0] === 'links') {
    if (method === 'POST' && parts.length === 1) {
      const fromId = Number(body.from_id);
      const toId = Number(body.to_id);
      if (!validLinkEnd(body.from_type, fromId, uid) || !validLinkEnd(body.to_type, toId, uid)) throw bad('Invalid link target');
      if (body.from_type === body.to_type && fromId === toId) throw bad('Cannot link a record to itself');
      const dup = db.prepare(`SELECT id FROM links WHERE user_id = ? AND ((from_type=? AND from_id=? AND to_type=? AND to_id=?) OR (from_type=? AND from_id=? AND to_type=? AND to_id=?))`)
        .get(uid, body.from_type, fromId, body.to_type, toId, body.to_type, toId, body.from_type, fromId);
      if (dup) throw new HttpError(409, 'Already linked');
      const label = body.label ? String(body.label).slice(0, 100) : null;
      const r = db.prepare('INSERT INTO links (user_id, from_type, from_id, to_type, to_id, label) VALUES (?, ?, ?, ?, ?, ?)').run(uid, body.from_type, fromId, body.to_type, toId, label);
      return send(res, 201, { id: Number(r.lastInsertRowid), from_type: body.from_type, from_id: fromId, to_type: body.to_type, to_id: toId, label });
    }
    if (method === 'DELETE' && parts.length === 2) {
      db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(Number(parts[1]), uid);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'Not found');
  }

  // ---- leaderboards
  if (parts[0] === 'leaderboards') {
    if (parts.length === 1 && method === 'GET') return send(res, 200, lb.list(db, uid));
    const key = decodeURIComponent(parts[1] || '');
    const k = lb.parseKey(key);
    if (!k) throw new HttpError(404, 'Unknown leaderboard');
    const canonical = `${k.kind}:${k.name}`;
    if (parts.length === 2 && method === 'GET') return send(res, 200, lb.board(db, canonical, uid));
    if (parts[2] === 'join' && method === 'POST') {
      if (!lb.eligible(db, k, uid)) throw bad(`Add this ${k.kind} to your dashboard before joining its leaderboard`);
      db.prepare('INSERT OR IGNORE INTO leaderboard_members (user_id, board_key) VALUES (?, ?)').run(uid, canonical);
      return send(res, 200, lb.board(db, canonical, uid));
    }
    if (parts[2] === 'join' && method === 'DELETE') {
      db.prepare('DELETE FROM leaderboard_members WHERE user_id = ? AND board_key = ?').run(uid, canonical);
      return send(res, 200, lb.board(db, canonical, uid));
    }
    throw new HttpError(404, 'Not found');
  }

  // ---- generic CRUD for every entity
  const entity = parts[0];
  if (!ENTITIES[entity]) throw new HttpError(404, 'Not found');
  const id = parts[1] !== undefined ? Number(parts[1]) : null;
  if (parts.length > 2 || (id !== null && !Number.isInteger(id))) throw new HttpError(404, 'Not found');

  if (method === 'GET' && id === null) {
    return send(res, 200, db.prepare(`SELECT ${listColumns(entity)} FROM ${entity} WHERE user_id = ? ORDER BY id`).all(uid));
  }
  if (method === 'GET') {
    const row = getRow(entity, id, uid, true);
    if (!row) throw new HttpError(404, 'Not found');
    delete row.user_id;
    return send(res, 200, row);
  }
  if (method === 'POST' && id === null) {
    const values = validate(entity, body, uid, true);
    const newId = insertRow(entity, uid, values);
    return send(res, 201, getRow(entity, newId, uid, false));
  }
  if (method === 'PUT' && id !== null) {
    if (!getRow(entity, id, uid, false)) throw new HttpError(404, 'Not found');
    const values = validate(entity, body, uid, false);
    const cols = Object.keys(values);
    if (cols.length) {
      db.prepare(`UPDATE ${entity} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
        .run(...cols.map((c) => values[c]), id, uid);
    }
    return send(res, 200, getRow(entity, id, uid, false));
  }
  if (method === 'DELETE' && id !== null) {
    tx(db, () => {
      deleteLinksFor(entity, id, uid);
      db.prepare(`DELETE FROM ${entity} WHERE id = ? AND user_id = ?`).run(id, uid);
    });
    return send(res, 200, { ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong' });
  }
});

// Purge expired sessions hourly.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`LifeOS running on http://localhost:${PORT}`));
}
module.exports = { server, db };
