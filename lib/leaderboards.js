'use strict';
// Opt-in leaderboards. Only members of a board are ranked, and only their
// display name, username and score are ever shown to other users.
// Each request is answered with a single SQL statement (latency matters on serverless).

const { NORM } = require('./db');

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
  if (m[1] === 'metric' && !Object.prototype.hasOwnProperty.call(METRICS, m[2])) return null;
  return { kind: m[1], name: m[1] === 'metric' ? m[2] : norm(m[2]) };
}

function streak(dates) {
  const set = new Set(dates || []);
  let n = 0;
  let d = new Date();
  if (!set.has(isoDate(d))) d = new Date(Date.now() - 86400000); // today not logged yet doesn't break it
  while (set.has(isoDate(d))) {
    n++;
    d = new Date(d.getTime() - 86400000);
  }
  return n;
}

// SQL expression for a user's score plus its params in order. `uid` is either a column
// (e.g. 'u.id', correlated) or omitted, in which case the user id is bound as a parameter.
function scoreSql(k, uidCol, uidValue) {
  const U = uidCol || '?';
  const u = uidCol ? [] : [uidValue];
  const since = daysAgo(29);
  if (k.kind === 'skill') return [`(SELECT COALESCE(MAX(level), 0) FROM skills WHERE user_id = ${U} AND ${NORM('name')} = ?)`, [...u, k.name]];
  if (k.kind === 'tracker') {
    return [`(SELECT COALESCE(SUM(l.value), 0) FROM tracker_logs l JOIN trackers t ON t.id = l.tracker_id
      WHERE t.user_id = ${U} AND ${NORM('t.name')} = ? AND l.date >= ?)`, [...u, k.name, since]];
  }
  switch (k.name) {
    case 'workout_minutes_30d': return [`(SELECT COALESCE(SUM(duration), 0) FROM workouts WHERE user_id = ${U} AND date >= ?)`, [...u, since]];
    case 'workouts_30d': return [`(SELECT COUNT(*) FROM workouts WHERE user_id = ${U} AND date >= ?)`, [...u, since]];
    case 'study_hours_30d': return [`(SELECT ROUND(((SELECT COALESCE(SUM(minutes), 0) FROM study_sessions WHERE user_id = ${U} AND date >= ?)
      + (SELECT COALESCE(SUM(minutes), 0) FROM skill_logs WHERE user_id = ${U} AND date >= ?)) / 6.0) / 10.0)`, [...u, since, ...u, since]];
    case 'skills_total': return [`(SELECT COALESCE(SUM(level), 0) FROM skills WHERE user_id = ${U})`, [...u]];
    case 'checkin_streak': // dates are turned into a streak in JS
      return [`(SELECT COALESCE(json_agg(DISTINCT date), '[]'::json) FROM checkins WHERE user_id = ${U} AND date >= ?)`, [...u, daysAgo(400)]];
  }
  return ['0', []];
}
const finish = (k, v) => (k.kind === 'metric' && k.name === 'checkin_streak' ? streak(v) : Number(v) || 0);

// What the user can see on the "Boards" list.
async function list(db, userId) {
  const r = await db.get(`SELECT
    (SELECT COALESCE(json_agg(json_build_object('k', ${NORM('name')}, 'n', name) ORDER BY id), '[]'::json) FROM skills WHERE user_id = ?) AS my_skills,
    (SELECT COALESCE(json_agg(json_build_object('k', ${NORM('name')}, 'n', name, 'u', unit) ORDER BY id), '[]'::json) FROM trackers WHERE user_id = ?) AS my_trackers,
    (SELECT COALESCE(json_agg(json_build_object('k', board_key, 'c', c, 'me', me)), '[]'::json)
       FROM (SELECT board_key, COUNT(*)::int AS c, bool_or(user_id = ?) AS me FROM leaderboard_members GROUP BY board_key) b) AS boards,
    (SELECT COALESCE(json_agg(json_build_object('k', k, 'n', n, 'u', u)), '[]'::json) FROM (
       SELECT DISTINCT ON (m.board_key) m.board_key AS k, COALESCE(s.name, t.name) AS n, t.unit AS u
       FROM leaderboard_members m
       LEFT JOIN skills s ON m.board_key = 'skill:' || ${NORM('s.name')} AND s.user_id = m.user_id
       LEFT JOIN trackers t ON m.board_key = 'tracker:' || ${NORM('t.name')} AND t.user_id = m.user_id
       WHERE m.board_key NOT LIKE 'metric:%' ORDER BY m.board_key, m.joined_at) x) AS names`, userId, userId, userId);
  const info = new Map(); // key -> { name, unit, eligible }
  for (const x of r.names) info.set(x.k, { name: x.n, unit: x.u });
  for (const s of r.my_skills) info.set(`skill:${s.k}`, { name: s.n, eligible: true });
  for (const t of r.my_trackers) info.set(`tracker:${t.k}`, { name: t.n, unit: t.u, eligible: true });
  const boards = new Map(r.boards.map((b) => [b.k, b]));
  const keys = new Set([...Object.keys(METRICS).map((m) => `metric:${m}`), ...info.keys(), ...boards.keys()]);
  const out = [];
  for (const key of keys) {
    const k = parseKey(key);
    if (!k) continue;
    const b = boards.get(key);
    const i = info.get(key) || {};
    out.push({ key, kind: k.kind, ...titleOf(k, i), joined: !!(b && b.me), members: b ? b.c : 0, eligible: k.kind === 'metric' || !!i.eligible });
  }
  const rank = { metric: 0, skill: 1, tracker: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.members - a.members || a.title.localeCompare(b.title));
}

function titleOf(k, i) {
  if (k.kind === 'metric') return METRICS[k.name];
  const name = i.name || k.name;
  return k.kind === 'skill' ? { title: `Skill: ${name}`, unit: 'level' } : { title: `${name} (30 days)`, unit: i.unit || '' };
}

async function eligible(db, k, userId) {
  if (k.kind === 'metric') return true;
  const table = k.kind === 'skill' ? 'skills' : 'trackers';
  return !!(await db.get(`SELECT 1 FROM ${table} WHERE user_id = ? AND ${NORM('name')} = ? LIMIT 1`, userId, k.name));
}

async function board(db, key, userId) {
  const k = parseKey(key);
  if (!k) return null;
  const [memberScore, memberParams] = scoreSql(k, 'u.id');
  const [myScore, myParams] = scoreSql(k, null, userId);
  const table = k.kind === 'skill' ? 'skills' : k.kind === 'tracker' ? 'trackers' : null;
  const infoSql = table
    ? `(SELECT json_build_object('n', name${table === 'trackers' ? ", 'u', unit" : ''}, 'mine', user_id = ?)
         FROM ${table} WHERE ${NORM('name')} = ? ORDER BY (user_id = ?) DESC, id LIMIT 1)`
    : 'NULL';
  const r = await db.get(`SELECT
    (SELECT COALESCE(json_agg(json_build_object('username', u.username, 'display_name', u.display_name, 'headline', COALESCE(u.headline, ''),
        'me', u.id = ?, 'score', ${memberScore})), '[]'::json)
       FROM leaderboard_members m JOIN users u ON u.id = m.user_id WHERE m.board_key = ?) AS rows,
    ${myScore} AS my_score,
    ${infoSql} AS info`,
  userId, ...memberParams, key, ...myParams, ...(table ? [userId, k.name, userId] : []));
  const i = r.info ? { name: r.info.n, unit: r.info.u, eligible: r.info.mine } : {};
  const rows = r.rows.map((x) => ({ ...x, score: finish(k, x.score) }))
    .sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));
  let prev = null;
  let place = 0;
  rows.forEach((x, idx) => {
    if (x.score !== prev) place = idx + 1;
    x.rank = place;
    prev = x.score;
  });
  return { key, kind: k.kind, ...titleOf(k, i), joined: rows.some((x) => x.me), eligible: k.kind === 'metric' || !!i.eligible, rows, myScore: finish(k, r.my_score) };
}

module.exports = { parseKey, list, board, eligible, norm };
