'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ENTITIES } = require('./schema');

const SQL_TYPE = { text: 'TEXT', date: 'TEXT', enum: 'TEXT', int: 'INTEGER', bool: 'INTEGER', real: 'REAL', ref: 'INTEGER' };

function columnSql(name, f) {
  let sql = `${name} ${SQL_TYPE[f.type]}`;
  if (f.type === 'ref') sql += ` REFERENCES ${f.ref}(id) ON DELETE CASCADE`;
  return sql;
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      headline TEXT,
      bio TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_type TEXT NOT NULL,
      from_id INTEGER NOT NULL,
      to_type TEXT NOT NULL,
      to_id INTEGER NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS links_user ON links(user_id);
    CREATE TABLE IF NOT EXISTS leaderboard_members (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_key TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, board_key)
    );
    CREATE INDEX IF NOT EXISTS lb_board ON leaderboard_members(board_key);
  `);

  for (const [table, def] of Object.entries(ENTITIES)) {
    const cols = Object.entries(def.fields).map(([n, f]) => columnSql(n, f));
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ${cols.join(',\n      ')},
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ${table}_user ON ${table}(user_id);`);
    // Lightweight migration: add columns introduced after the table was created.
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [n, f] of Object.entries(def.fields)) {
      if (!existing.has(n)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${n} ${SQL_TYPE[f.type]}`);
    }
  }
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { open, tx };
