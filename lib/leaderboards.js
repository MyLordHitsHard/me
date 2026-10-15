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

async function titleOf(db, k) {
  if (k.kind === 'metric') return METRICS[k.name];
  const table = k.kind === 'skill' ? 'skills' : 'trackers';
  const row = await db.get(`SELECT name, ${k.kind === 'tracker' ? 'unit' : "'' AS unit"} FROM ${table} WHERE lower(trim(name)) = ? LIMIT 1`, k.name);
  const name = row ? row.name : k.name;
  return k.kind === 'skill'
    ? { title: `Skill: ${name}`, unit: 'level' }
    : { title: `${name} (30 days)`, unit: (row && row.unit) || '' };
}

async function streak(db, userId) {
  const dates = new Set((await db.all('SELECT DISTINCT date FROM checkins WHERE user_id = ?', userId)).map((r) => r.date));
  let n = 0;
  let d = new Date();
  if (!dates.has(isoDate(d))) d = new Date(Date.now() - 86400000); // today not logged yet doesn't break it
  while (dates.has(isoDate(d))) {
    n++;
    d = new Date(d.getTime() - 86400000);
  }
  return n;
}

async function scoreFor(db, k, userId) {
  const since = daysAgo(29);
  const one = async (sql, ...p) => {
    const r = await db.get(sql, ...p);
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
      const m = (await one('SELECT COALESCE(SUM(minutes),0) v FROM study_sessions WHERE user_id = ? AND date >= ?', userId, since))
        + await one('SELECT COALESCE(SUM(minutes),0) v FROM skill_logs WHERE user_id = ? AND date >= ?', userId, since);
      return Math.round((m / 60) * 10) / 10;
    }
    case 'checkin_streak': return streak(db, userId);
    case 'skills_total': return one('SELECT COALESCE(SUM(level),0) v FROM skills WHERE user_id = ?', userId);
  }
  return 0;
}

// Can this user take part in the board? (You can't join a skill board for a skill you don't track.)
async function eligible(db, k, userId) {
  if (k.kind === 'metric') return true;
  const table = k.kind === 'skill' ? 'skills' : 'trackers';
  return !!(await db.get(`SELECT 1 FROM ${table} WHERE user_id = ? AND lower(trim(name)) = ?`, userId, k.name));
}

async function list(db, userId) {
  const keys = new Set(Object.keys(METRICS).map((m) => `metric:${m}`));
  const [skills, trackers, boards, mine, counted] = await Promise.all([
    db.all('SELECT name FROM skills WHERE user_id = ?', userId),
    db.all('SELECT name FROM trackers WHERE user_id = ?', userId),
    db.all('SELECT DISTINCT board_key FROM leaderboard_members'),
    db.all('SELECT board_key FROM leaderboard_members WHERE user_id = ?', userId),
    db.all('SELECT board_key, COUNT(*) AS c FROM leaderboard_members GROUP BY board_key'),
  ]);
  for (const r of skills) keys.add(`skill:${norm(r.name)}`);
  for (const r of trackers) keys.add(`tracker:${norm(r.name)}`);
  for (const r of boards) keys.add(r.board_key);
  const joined = new Set(mine.map((r) => r.board_key));
  const counts = new Map(counted.map((r) => [r.board_key, Number(r.c)]));
  const out = await Promise.all([...keys].map(parseKey).filter(Boolean).map(async (k) => {
    const key = `${k.kind}:${k.name}`;
    return { key, kind: k.kind, ...(await titleOf(db, k)), joined: joined.has(key), members: counts.get(key) || 0, eligible: await eligible(db, k, userId) };
  }));
  const rank = { metric: 0, skill: 1, tracker: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.members - a.members || a.title.localeCompare(b.title));
}

async function board(db, key, userId) {
  const k = parseKey(key);
  if (!k) return null;
  const members = await db.all(`SELECT u.id, u.username, u.display_name, u.headline FROM leaderboard_members m
    JOIN users u ON u.id = m.user_id WHERE m.board_key = ?`, key);
  const scores = await Promise.all(members.map((u) => scoreFor(db, k, u.id)));
  const rows = members.map((u, i) => ({
    username: u.username,
    display_name: u.display_name,
    headline: u.headline || '',
    score: scores[i],
    me: u.id === userId,
  })).sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));
  let prev = null;
  let place = 0;
  rows.forEach((r, i) => {
    if (r.score !== prev) place = i + 1;
    r.rank = place;
    prev = r.score;
  });
  return { key, kind: k.kind, ...(await titleOf(db, k)), joined: rows.some((r) => r.me), eligible: await eligible(db, k, userId), rows, myScore: await scoreFor(db, k, userId) };
}

module.exports = { parseKey, list, board, eligible, norm };
