'use strict';
// LifeOS — a multi-user personal & career dashboard.
// Runs as a plain Node server (`npm start`) or as a Vercel serverless function (api/index.js).
// Storage: Postgres via DATABASE_URL (e.g. Neon), or embedded PGlite when unset.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, NOW, q } = require('./lib/db');
const { ENTITIES, LINKABLE, IMPORT_ORDER } = require('./lib/schema');
const lb = require('./lib/leaderboards');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const COOKIE = 'lifeos_sid';
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';
const TRUST_PROXY = !!process.env.VERCEL || process.env.TRUST_PROXY === 'true';
// Vercel rejects request bodies above ~4.5 MB before they reach us; stay under it everywhere.
const BODY_LIMIT = 4 * 1024 * 1024;

let ready = null;
const getDb = () => (ready ||= open().catch((e) => { ready = null; throw e; }));

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
  const timing = res.startedAt ? { 'Server-Timing': `app;dur=${Date.now() - res.startedAt}` } : {};
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...timing, ...headers });
  res.end(data);
}

function readBody(req, limit) {
  // Vercel's Node runtime exposes a lazily parsed `req.body`; plain node:http doesn't.
  if ('body' in req) {
    let b;
    try {
      b = req.body;
    } catch {
      return Promise.reject(bad('Invalid JSON'));
    }
    if (b === undefined || b === null || b === '') return Promise.resolve({});
    if (Buffer.isBuffer(b) || typeof b === 'string') {
      try {
        return Promise.resolve(JSON.parse(b.toString('utf8')));
      } catch {
        return Promise.reject(bad('Invalid JSON'));
      }
    }
    if (typeof b === 'object') return Promise.resolve(b);
  }
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

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + SESSION_DAYS * 86400000);
  return token;
}

// Per-instance cache of token → user id, so most requests skip the session lookup round trip.
// Logout / password change clear it locally; other warm instances notice within SESSION_CACHE_MS.
const SESSION_CACHE_MS = 30000;
const sessionCache = new Map();
function forgetSessions(match) {
  for (const [k, v] of sessionCache) if (match(k, v)) sessionCache.delete(k);
}

async function currentUserId(db, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const hit = sessionCache.get(hash);
  if (hit && hit.until > Date.now()) return hit.uid;
  const row = await db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?', hash, Date.now());
  if (!row) { sessionCache.delete(hash); return null; }
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(hash, { uid: row.user_id, until: Math.min(Date.now() + SESSION_CACHE_MS, Number(row.expires_at)) });
  return row.user_id;
}

function publicUser(u) {
  let settings = {};
  try {
    settings = JSON.parse(u.settings || '{}');
  } catch {}
  return { id: u.id, username: u.username, display_name: u.display_name, headline: u.headline || '', bio: u.bio || '', settings, created_at: u.created_at };
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

// Small in-memory limiter for auth endpoints (per server instance).
const attempts = new Map();
function rateLimit(req, key, max = 10, windowMs = 10 * 60 * 1000) {
  const k = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const list = (attempts.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Too many attempts, try again in a few minutes');
  list.push(now);
  attempts.set(k, list);
  if (attempts.size > 10000) attempts.clear();
}

// ---------- validation ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

async function coerce(db, name, f, v, userId, trustRefs) {
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
      if (f.type === 'int' && Math.abs(n) > 2147483647) throw bad(`${name} is out of range`);
      return n;
    }
    case 'ref': {
      const id = Number(v);
      if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw bad(`${name} is invalid`);
      if (!trustRefs && !(await db.get(`SELECT 1 FROM ${f.ref} WHERE id = ? AND user_id = ?`, id, userId))) {
        throw bad(`${name} refers to an unknown ${ENTITIES[f.ref].label.toLowerCase()}`);
      }
      return id;
    }
  }
  throw bad(`Unsupported field ${name}`);
}

async function validate(db, entity, body, userId, isCreate, trustRefs = false) {
  const def = ENTITIES[entity];
  const out = {};
  for (const [name, f] of Object.entries(def.fields)) {
    let v = body[name];
    if (isCreate && (v === undefined || v === null || v === '') && f.default !== undefined) v = f.default;
    if (isCreate && f.required && (v === undefined || v === null || v === '')) throw bad(`${name} is required`);
    const c = await coerce(db, name, f, v, userId, trustRefs);
    if (c !== undefined) out[name] = c;
  }
  return out;
}

const listColumns = (entity) => ['id', ...Object.entries(ENTITIES[entity].fields).filter(([, f]) => !f.heavy).map(([n]) => q(n)), 'created_at', 'updated_at'].join(', ');

// Ownership check for every reference field, folded into the write itself (no extra round trip).
function refGuard(entity, values, userId) {
  const sql = [];
  const params = [];
  for (const [n, f] of Object.entries(ENTITIES[entity].fields)) {
    if (f.type !== 'ref' || values[n] === undefined || values[n] === null) continue;
    sql.push(`EXISTS (SELECT 1 FROM ${f.ref} WHERE id = ? AND user_id = ?)`);
    params.push(values[n], userId);
  }
  return { sql: sql.join(' AND '), params };
}
async function badRef(db, entity, values, userId) {
  for (const [n, f] of Object.entries(ENTITIES[entity].fields)) {
    if (f.type !== 'ref' || values[n] === undefined || values[n] === null) continue;
    if (!(await db.get(`SELECT 1 FROM ${f.ref} WHERE id = ? AND user_id = ?`, values[n], userId))) return bad(`${n} refers to an unknown ${ENTITIES[f.ref].label.toLowerCase()}`);
  }
  return null;
}

// Parameters in INSERT … SELECT need explicit types.
const CAST = { text: 'text', date: 'text', enum: 'text', int: 'integer', bool: 'integer', real: 'double precision', ref: 'integer' };

// INSERT … RETURNING the list columns: one round trip.
async function createRow(db, entity, userId, values) {
  const cols = Object.keys(values);
  const fields = ENTITIES[entity].fields;
  const guard = refGuard(entity, values, userId);
  const row = await db.get(`INSERT INTO ${entity} (user_id${cols.map((c) => `, ${q(c)}`).join('')})
    SELECT ?::integer${cols.map((c) => `, ?::${CAST[fields[c].type]}`).join('')} ${guard.sql ? `WHERE ${guard.sql}` : ''} RETURNING ${listColumns(entity)}`,
  userId, ...cols.map((c) => values[c]), ...guard.params);
  if (!row) throw (await badRef(db, entity, values, userId)) || bad('Invalid reference');
  return row;
}

// Keep parents in sync when a child is logged (a practice log's level updates the skill, an interaction bumps last contact).
const PARENT_SYNC = {
  skill_logs: (row, uid) => (row.level === null || row.level === undefined ? null
    : ['skills', `UPDATE skills SET level = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ? RETURNING ${listColumns('skills')}`, [row.level, row.skill_id, uid]]),
  interactions: (row, uid) => ['people', `UPDATE people SET last_contact = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ? AND (last_contact IS NULL OR last_contact < ?) RETURNING ${listColumns('people')}`, [row.date, row.person_id, uid, row.date]],
};

const getRow = (db, entity, id, userId, full) => db.get(`SELECT ${full ? '*' : listColumns(entity)} FROM ${entity} WHERE id = ? AND user_id = ?`, id, userId);

// Everything the client needs on load, as ONE query (each round trip to the DB costs latency).
const BOOT_SQL = `SELECT json_build_object(
  'user', (SELECT row_to_json(x) FROM (SELECT id, username, display_name, headline, bio, settings, created_at FROM users WHERE id = $1) x),
  'links', COALESCE((SELECT json_agg(x ORDER BY x.id) FROM (SELECT id, from_type, from_id, to_type, to_id, label FROM links WHERE user_id = $1) x), '[]'::json),
  ${Object.keys(ENTITIES).map((e) => `'${e}', COALESCE((SELECT json_agg(x ORDER BY x.id) FROM (SELECT ${listColumns(e)} FROM ${e} WHERE user_id = $1) x), '[]'::json)`).join(',\n  ')}
) AS boot`;

async function bootstrap(db, userId) {
  const { boot } = (await db.query(BOOT_SQL, [userId])).rows[0]; // no '?' inside, so $1 passes through untouched
  const { user, links, ...data } = boot;
  return { user, links, data };
}

async function allData(db, userId, full) {
  const entities = Object.keys(ENTITIES);
  const [rows, links] = await Promise.all([
    Promise.all(entities.map((e) => db.all(`SELECT ${full ? '*' : listColumns(e)} FROM ${e} WHERE user_id = ? ORDER BY id`, userId))),
    db.all('SELECT id, from_type, from_id, to_type, to_id, label FROM links WHERE user_id = ? ORDER BY id', userId),
  ]);
  const data = {};
  entities.forEach((e, i) => {
    data[e] = rows[i];
    if (full) data[e].forEach((r) => delete r.user_id);
  });
  return { data, links };
}

// Bulk import with id remapping. Ids are reserved up front so every table is
// written with a handful of multi-row INSERTs instead of one round trip per row.
async function importData(db, userId, payload, mode) {
  const src = (payload && payload.data) || {};
  const idMap = {};
  const counts = {};
  await db.tx(async (t) => {
    if (mode === 'replace') {
      await t.run('DELETE FROM links WHERE user_id = ?', userId);
      for (const e of [...IMPORT_ORDER].reverse()) await t.run(`DELETE FROM ${e} WHERE user_id = ?`, userId);
    }
    for (const e of IMPORT_ORDER) {
      idMap[e] = {};
      counts[e] = 0;
      const def = ENTITIES[e];
      const fields = Object.keys(def.fields);
      const prepared = [];
      for (const row of Array.isArray(src[e]) ? src[e] : []) {
        if (!row || typeof row !== 'object') continue;
        const r = { ...row };
        let skip = false;
        for (const [n, f] of Object.entries(def.fields)) {
          if (f.type !== 'ref') continue;
          const mapped = idMap[f.ref][r[n]];
          if (!mapped) skip = true;
          else r[n] = mapped;
        }
        if (skip) continue;
        prepared.push({ old: row.id, values: await validate(t, e, r, userId, true, true), created: STAMP_RE.test(row.created_at) ? row.created_at : null, updated: STAMP_RE.test(row.updated_at) ? row.updated_at : null });
      }
      if (!prepared.length) continue;
      const ids = (await t.all(`SELECT nextval(pg_get_serial_sequence('${e}', 'id'))::int AS id FROM generate_series(1, ?::int)`, prepared.length)).map((x) => x.id);
      prepared.forEach((p, i) => {
        p.id = ids[i];
        if (p.old !== undefined && p.old !== null) idMap[e][p.old] = p.id;
      });
      const cols = ['id', 'user_id', ...fields.map(q), 'created_at', 'updated_at'];
      const CHUNK = 200;
      for (let i = 0; i < prepared.length; i += CHUNK) {
        const params = [];
        const tuples = prepared.slice(i, i + CHUNK).map((p) => {
          params.push(p.id, userId, ...fields.map((f) => (p.values[f] === undefined ? null : p.values[f])));
          const stamps = [p.created, p.updated].map((s) => (s ? (params.push(s), '?') : NOW));
          return `(${['?', '?', ...fields.map(() => '?')].join(', ')}, ${stamps.join(', ')})`;
        });
        await t.run(`INSERT INTO ${e} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`, ...params);
      }
      counts[e] = prepared.length;
    }
    const links = [];
    for (const l of Array.isArray(payload.links) ? payload.links : []) {
      if (!l || !LINKABLE.includes(l.from_type) || !LINKABLE.includes(l.to_type)) continue;
      const from = idMap[l.from_type][l.from_id];
      const to = idMap[l.to_type][l.to_id];
      if (from && to) links.push([userId, l.from_type, from, l.to_type, to, l.label ? String(l.label).slice(0, 100) : null]);
    }
    for (let i = 0; i < links.length; i += 500) {
      const chunk = links.slice(i, i + 500);
      await t.run(`INSERT INTO links (user_id, from_type, from_id, to_type, to_id, label) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`, ...chunk.flat());
    }
    counts.links = links.length;
  });
  return { counts, ids: { sketches: idMap.sketches } };
}

// ---------- API ----------
async function api(req, res, url) {
  const db = await getDb();
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;
  const isMutation = method !== 'GET' && method !== 'HEAD';

  // CSRF defence: mutations must come from our own fetch() wrapper.
  if (isMutation && req.headers['x-lifeos'] !== '1') throw new HttpError(403, 'Missing request header');

  const body = isMutation ? await readBody(req, BODY_LIMIT) : {};

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
      if (password.length > 1000) throw bad('Password is too long');
      const u = await db.get('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?) ON CONFLICT (username) DO NOTHING RETURNING *', username, display, hashPassword(password));
      if (!u) throw new HttpError(409, 'That username is taken');
      const token = await createSession(db, u.id);
      return send(res, 201, publicUser(u), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (parts[1] === 'login' && method === 'POST') {
      rateLimit(req, 'login', 10);
      const u = await db.get('SELECT * FROM users WHERE username = ?', String(body.username || '').trim().toLowerCase());
      if (!u || !verifyPassword(String(body.password || '').slice(0, 1000), u.password_hash)) throw new HttpError(401, 'Wrong username or password');
      await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now()); // housekeeping
      const token = await createSession(db, u.id);
      return send(res, 200, publicUser(u), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (parts[1] === 'logout' && method === 'POST') {
      const token = parseCookies(req)[COOKIE];
      if (token) {
        await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
        sessionCache.delete(sha256(token));
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    throw new HttpError(404, 'Not found');
  }

  const uid = await currentUserId(db, req);
  if (!uid) throw new HttpError(401, 'Please log in');
  const loadUser = async () => {
    const u = await db.get('SELECT * FROM users WHERE id = ?', uid);
    if (!u) throw new HttpError(401, 'Please log in');
    return u;
  };

  // ---- profile
  if (parts[0] === 'me') {
    if (parts.length === 1 && method === 'GET') return send(res, 200, publicUser(await loadUser()));
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
      if (cols.length) await db.run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => upd[c]), uid);
      return send(res, 200, publicUser(await db.get('SELECT * FROM users WHERE id = ?', uid)));
    }
    if (parts[1] === 'password' && method === 'PUT') {
      rateLimit(req, 'password', 10);
      const user = await loadUser();
      if (!verifyPassword(String(body.current || '').slice(0, 1000), user.password_hash)) throw new HttpError(401, 'Current password is wrong');
      const next = String(body.next || '');
      if (next.length < 8) throw bad('New password must be at least 8 characters');
      if (next.length > 1000) throw bad('Password is too long');
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), uid);
      await db.run('DELETE FROM sessions WHERE user_id = ?', uid);
      forgetSessions((k, v) => v.uid === uid);
      const token = await createSession(db, uid);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (parts.length === 1 && method === 'DELETE') {
      const user = await loadUser();
      if (!verifyPassword(String(body.password || '').slice(0, 1000), user.password_hash)) throw new HttpError(401, 'Password is wrong');
      await db.run('DELETE FROM users WHERE id = ?', uid);
      forgetSessions((k, v) => v.uid === uid);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    throw new HttpError(404, 'Not found');
  }

  if (parts[0] === 'schema' && method === 'GET') return send(res, 200, { entities: ENTITIES, linkable: LINKABLE });
  if (parts[0] === 'bootstrap' && method === 'GET') {
    const boot = await bootstrap(db, uid);
    if (!boot.user) throw new HttpError(401, 'Please log in');
    return send(res, 200, { user: publicUser(boot.user), data: boot.data, links: boot.links, schema: { entities: ENTITIES, linkable: LINKABLE } });
  }
  if (parts[0] === 'export' && method === 'GET') {
    const [user, { data, links }] = await Promise.all([loadUser(), allData(db, uid, true)]);
    return send(res, 200, { app: 'lifeos', version: 1, exported_at: new Date().toISOString(), profile: publicUser(user), data, links }, {
      'Content-Disposition': `attachment; filename="lifeos-${user.username}.json"`,
    });
  }
  if (parts[0] === 'import' && method === 'POST') {
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const result = await importData(db, uid, body.payload || {}, mode);
    if (body.payload && body.payload.profile && body.applyProfile) {
      const p = body.payload.profile;
      await db.run('UPDATE users SET display_name = COALESCE(?, display_name), headline = ?, bio = ? WHERE id = ?',
        p.display_name ? String(p.display_name).slice(0, 80) : null, String(p.headline || '').slice(0, 200), String(p.bio || '').slice(0, 5000), uid);
    }
    return send(res, 200, { ok: true, ...result });
  }

  // ---- links (relations between any two linkable records)
  if (parts[0] === 'links') {
    if (method === 'POST' && parts.length === 1) {
      const fromId = Number(body.from_id);
      const toId = Number(body.to_id);
      const okId = (n) => Number.isInteger(n) && n > 0 && n <= 2147483647;
      if (!LINKABLE.includes(body.from_type) || !LINKABLE.includes(body.to_type) || !okId(fromId) || !okId(toId)) throw bad('Invalid link target');
      if (body.from_type === body.to_type && fromId === toId) throw bad('Cannot link a record to itself');
      const label = body.label ? String(body.label).slice(0, 100) : null;
      const dupSql = `SELECT 1 FROM links WHERE user_id = ? AND ((from_type=? AND from_id=? AND to_type=? AND to_id=?) OR (from_type=? AND from_id=? AND to_type=? AND to_id=?))`;
      const dupParams = [uid, body.from_type, fromId, body.to_type, toId, body.to_type, toId, body.from_type, fromId];
      // Ownership of both ends + duplicate check + insert in one statement.
      const r = await db.get(`INSERT INTO links (user_id, from_type, from_id, to_type, to_id, label)
        SELECT ?::integer, ?::text, ?::integer, ?::text, ?::integer, ?::text WHERE EXISTS (SELECT 1 FROM ${body.from_type} WHERE id = ? AND user_id = ?)
          AND EXISTS (SELECT 1 FROM ${body.to_type} WHERE id = ? AND user_id = ?) AND NOT EXISTS (${dupSql}) RETURNING id`,
      uid, body.from_type, fromId, body.to_type, toId, label, fromId, uid, toId, uid, ...dupParams);
      if (!r) {
        if (await db.get(dupSql, ...dupParams)) throw new HttpError(409, 'Already linked');
        throw bad('Invalid link target');
      }
      return send(res, 201, { id: r.id, from_type: body.from_type, from_id: fromId, to_type: body.to_type, to_id: toId, label });
    }
    if (method === 'DELETE' && parts.length === 2) {
      const id = Number(parts[1]);
      if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new HttpError(404, 'Not found');
      await db.run('DELETE FROM links WHERE id = ? AND user_id = ?', id, uid);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'Not found');
  }

  // ---- leaderboards
  if (parts[0] === 'leaderboards') {
    if (parts.length === 1 && method === 'GET') return send(res, 200, await lb.list(db, uid));
    const k = lb.parseKey(decodeURIComponent(parts[1] || ''));
    if (!k) throw new HttpError(404, 'Unknown leaderboard');
    const canonical = `${k.kind}:${k.name}`;
    if (parts.length === 2 && method === 'GET') return send(res, 200, await lb.board(db, canonical, uid));
    if (parts[2] === 'join' && method === 'POST') {
      if (!(await lb.eligible(db, k, uid))) throw bad(`Add this ${k.kind} to your dashboard before joining its leaderboard`);
      await db.run('INSERT INTO leaderboard_members (user_id, board_key) VALUES (?, ?) ON CONFLICT DO NOTHING', uid, canonical);
      return send(res, 200, await lb.board(db, canonical, uid));
    }
    if (parts[2] === 'join' && method === 'DELETE') {
      await db.run('DELETE FROM leaderboard_members WHERE user_id = ? AND board_key = ?', uid, canonical);
      return send(res, 200, await lb.board(db, canonical, uid));
    }
    throw new HttpError(404, 'Not found');
  }

  // ---- generic CRUD for every entity
  const entity = parts[0];
  if (!Object.prototype.hasOwnProperty.call(ENTITIES, entity)) throw new HttpError(404, 'Not found');
  const id = parts[1] !== undefined ? Number(parts[1]) : null;
  if (parts.length > 2 || (id !== null && (!Number.isInteger(id) || id <= 0 || id > 2147483647))) throw new HttpError(404, 'Not found');

  if (method === 'GET' && id === null) {
    return send(res, 200, await db.all(`SELECT ${listColumns(entity)} FROM ${entity} WHERE user_id = ? ORDER BY id`, uid));
  }
  if (method === 'GET') {
    const row = await getRow(db, entity, id, uid, true);
    if (!row) throw new HttpError(404, 'Not found');
    delete row.user_id;
    return send(res, 200, row);
  }
  if (method === 'POST' && id === null) {
    const values = await validate(db, entity, body, uid, true, true);
    const row = await createRow(db, entity, uid, values);
    const sync = PARENT_SYNC[entity] && PARENT_SYNC[entity](row, uid);
    if (sync) {
      const parent = await db.get(sync[1], ...sync[2]);
      if (parent) row._parent = { type: sync[0], row: parent };
    }
    return send(res, 201, row);
  }
  if (method === 'PUT' && id !== null) {
    const values = await validate(db, entity, body, uid, false, true);
    const cols = Object.keys(values);
    if (!cols.length) {
      const row = await getRow(db, entity, id, uid, false);
      if (!row) throw new HttpError(404, 'Not found');
      return send(res, 200, row);
    }
    const guard = refGuard(entity, values, uid);
    const row = await db.get(`UPDATE ${entity} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')}, updated_at = ${NOW}
      WHERE id = ? AND user_id = ? ${guard.sql ? `AND ${guard.sql}` : ''} RETURNING ${listColumns(entity)}`,
    ...cols.map((c) => values[c]), id, uid, ...guard.params);
    if (!row) {
      if (!(await getRow(db, entity, id, uid, false))) throw new HttpError(404, 'Not found');
      throw (await badRef(db, entity, values, uid)) || bad('Invalid reference');
    }
    return send(res, 200, row);
  }
  if (method === 'DELETE' && id !== null) {
    // One atomic statement: drop the record's links and the record (children cascade).
    await db.run(`WITH l AS (DELETE FROM links WHERE user_id = ? AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)))
      DELETE FROM ${entity} WHERE id = ? AND user_id = ?`, uid, entity, id, entity, id, id, uid);
    return send(res, 200, { ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------- static files (local server only; on Vercel the CDN serves public/) ----------
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
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
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

async function handler(req, res) {
  res.startedAt = Date.now();
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz' || url.pathname === '/api/healthz') {
      // Also a latency check: the function and the database should be in the same region.
      const db = await getDb();
      await db.get('SELECT 1 AS ok');
      const t = Date.now();
      await db.get('SELECT 1 AS ok');
      const host = (() => { try { return new URL(process.env.DATABASE_URL || process.env.POSTGRES_URL).hostname; } catch { return ''; } })();
      const dbRegion = (/\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech$/.exec(host) || /\.([a-z0-9]+)\.azure\.neon\.tech$/.exec(host) || [])[1] || null;
      return send(res, 200, { ok: true, functionRegion: process.env.VERCEL_REGION || null, database: db.kind, databaseRegion: dbRegion, dbRoundTripMs: Date.now() - t });
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong' });
  }
}

const server = http.createServer(handler);

if (require.main === module) {
  getDb()
    .then((db) => server.listen(PORT, () => console.log(`LifeOS running on http://localhost:${PORT} (${db.kind})`)))
    .catch((e) => { console.error('Database connection failed:', e.message); process.exit(1); });
}
module.exports = { handler, server, getDb };
