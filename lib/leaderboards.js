'use strict';
// Opt-in leaderboards. Only members of a board are ranked, and only their
// display name, username and score are ever shown to other users.

const METRICS = {
  workout_minutes_30d: { title: 'Workout minutes (30 days)', unit: 'min' },
  workouts_30d: { title: 'Workouts logged (30 days)', unit: 'sessions' },
  study_hours_30d: { title: 'Study & practice hours (30 days)', unit: 'h' },
  checkin_streak: { title: 'Daily check-in streak', unit: 'days' },
  skills_total: { title: 'Total skill points', unit: 'pts' },
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isoDate = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => isoDate(new Date(Date.now() - n * 86400000));

function parseKey(key) {
  const m = /^(metric|skill|tracker):(.{1,100})$/.exec(String(key || ''));
  if (!m) return null;
  if (m[1] === 'metric' && !METRICS[m[2]]) return null;
  return { kind: m[1], name: m[1] === 'metric' ? m[2] : norm(m[2]) };
}

function titleOf(db, k) {
  if (k.kind === 'metric') return METRICS[k.name];
  const table = k.kind === 'skill' ? 'skills' : 'trackers';
  const row = db.prepare(`SELECT name, ${k.kind === 'tracker' ? 'unit' : "'' AS unit"} FROM ${table} WHERE lower(trim(name)) = ? LIMIT 1`).get(k.name);
  const name = row ? row.name : k.name;
  return k.kind === 'skill'
    ? { title: `Skill: ${name}`, unit: 'level' }
    : { title: `${name} (30 days)`, unit: (row && row.unit) || '' };
}

function streak(db, userId) {
  const dates = new Set(db.prepare('SELECT DISTINCT date FROM checkins WHERE user_id = ?').all(userId).map((r) => r.date));
  let n = 0;
  let d = new Date();
  if (!dates.has(isoDate(d))) d = new Date(Date.now() - 86400000); // today not logged yet doesn't break it
  while (dates.has(isoDate(d))) {
    n++;
    d = new Date(d.getTime() - 86400000);
  }
  return n;
}

function scoreFor(db, k, userId) {
  const since = daysAgo(29);
  const one = (sql, ...p) => {
    const r = db.prepare(sql).get(...p);
    return r ? Number(r.v) || 0 : 0;
  };
  if (k.kind === 'skill') return one('SELECT MAX(level) v FROM skills WHERE user_id = ? AND lower(trim(name)) = ?', userId, k.name);
  if (k.kind === 'tracker') {
    return one(`SELECT COALESCE(SUM(l.value),0) v FROM tracker_logs l JOIN trackers t ON t.id = l.tracker_id
      WHERE t.user_id = ? AND lower(trim(t.name)) = ? AND l.date >= ?`, userId, k.name, since);
  }
  switch (k.name) {
    case 'workout_minutes_30d': return one('SELECT COALESCE(SUM(duration),0) v FROM workouts WHERE user_id = ? AND date >= ?', userId, since);
    case 'workouts_30d': return one('SELECT COUNT(*) v FROM workouts WHERE user_id = ? AND date >= ?', userId, since);
    case 'study_hours_30d': {
      const m = one('SELECT COALESCE(SUM(minutes),0) v FROM study_sessions WHERE user_id = ? AND date >= ?', userId, since)
        + one('SELECT COALESCE(SUM(minutes),0) v FROM skill_logs WHERE user_id = ? AND date >= ?', userId, since);
      return Math.round((m / 60) * 10) / 10;
    }
    case 'checkin_streak': return streak(db, userId);
    case 'skills_total': return one('SELECT COALESCE(SUM(level),0) v FROM skills WHERE user_id = ?', userId);
  }
  return 0;
}

// Can this user take part in the board? (You can't join a skill board for a skill you don't track.)
function eligible(db, k, userId) {
  if (k.kind === 'metric') return true;
  const table = k.kind === 'skill' ? 'skills' : 'trackers';
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ? AND lower(trim(name)) = ?`).get(userId, k.name);
}

function list(db, userId) {
  const keys = new Set(Object.keys(METRICS).map((m) => `metric:${m}`));
  for (const r of db.prepare('SELECT name FROM skills WHERE user_id = ?').all(userId)) keys.add(`skill:${norm(r.name)}`);
  for (const r of db.prepare('SELECT name FROM trackers WHERE user_id = ?').all(userId)) keys.add(`tracker:${norm(r.name)}`);
  for (const r of db.prepare('SELECT DISTINCT board_key FROM leaderboard_members').all()) keys.add(r.board_key);
  const joined = new Set(db.prepare('SELECT board_key FROM leaderboard_members WHERE user_id = ?').all(userId).map((r) => r.board_key));
  const counts = new Map(db.prepare('SELECT board_key, COUNT(*) c FROM leaderboard_members GROUP BY board_key').all().map((r) => [r.board_key, r.c]));
  const out = [];
  for (const key of keys) {
    const k = parseKey(key);
    if (!k) continue;
    out.push({ key, kind: k.kind, ...titleOf(db, k), joined: joined.has(key), members: counts.get(key) || 0, eligible: eligible(db, k, userId) });
  }
  const rank = { metric: 0, skill: 1, tracker: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.members - a.members || a.title.localeCompare(b.title));
}

function board(db, key, userId) {
  const k = parseKey(key);
  if (!k) return null;
  const members = db.prepare(`SELECT u.id, u.username, u.display_name, u.headline FROM leaderboard_members m
    JOIN users u ON u.id = m.user_id WHERE m.board_key = ?`).all(key);
  const rows = members.map((u) => ({
    username: u.username,
    display_name: u.display_name,
    headline: u.headline || '',
    score: scoreFor(db, k, u.id),
    me: u.id === userId,
  })).sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));
  let prev = null;
  let place = 0;
  rows.forEach((r, i) => {
    if (r.score !== prev) place = i + 1;
    r.rank = place;
    prev = r.score;
  });
  return { key, kind: k.kind, ...titleOf(db, k), joined: rows.some((r) => r.me), eligible: eligible(db, k, userId), rows, myScore: scoreFor(db, k, userId) };
}

module.exports = { parseKey, list, board, eligible, norm };
