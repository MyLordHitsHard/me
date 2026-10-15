'use strict';
const test = require('node:test');
const assert = require('node:assert');

// Runs against embedded PGlite by default, or a real Postgres when TEST_DATABASE_URL is set
// (the database is wiped first — never point this at real data).
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else { delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL; process.env.PGLITE_DIR = 'memory://'; }
const { server, getDb } = require('../server');

let base;
test.before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();
  }
  await getDb();
  await new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }));
});
test.after(async () => { server.close(); await (await getDb()).close(); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-lifeos': '1', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

test('auth, CRUD, ownership, links, leaderboards, import/export', async () => {
  const a = client();
  const b = client();

  assert.equal((await a('GET', '/api/bootstrap')).status, 401);
  assert.equal((await a('POST', '/api/auth/register', { username: 'al', password: 'short' })).status, 400);
  assert.equal((await a('POST', '/api/auth/register', { username: 'alice', password: 'password123', display_name: 'Alice' })).status, 201);
  assert.equal((await b('POST', '/api/auth/register', { username: 'alice', password: 'password123' })).status, 409);
  assert.equal((await b('POST', '/api/auth/register', { username: 'bob', password: 'password123', display_name: 'Bob' })).status, 201);

  // CSRF header required
  const noHeader = await fetch(base + '/api/skills', { method: 'POST', body: '{}' });
  assert.equal(noHeader.status, 403);

  const skill = (await a('POST', '/api/skills', { name: 'Python', level: 70 })).body;
  assert.equal(skill.level, 70);
  assert.equal((await a('POST', '/api/skills', { name: 'X', level: 101 })).status, 400);
  assert.equal((await a('POST', '/api/skill_logs', { skill_id: skill.id, date: '2026-10-01', minutes: 60 })).status, 201);
  // Bob cannot touch Alice's data
  assert.equal((await b('PUT', `/api/skills/${skill.id}`, { level: 1 })).status, 404);
  assert.equal((await b('POST', '/api/skill_logs', { skill_id: skill.id, date: '2026-10-01' })).status, 400);
  assert.equal((await b('GET', '/api/skills')).body.length, 0);

  // parent sync: a practice log with a level updates the skill in the same request
  const logged = (await a('POST', '/api/skill_logs', { skill_id: skill.id, date: '2026-10-02', minutes: 30, level: 72 })).body;
  assert.equal(logged._parent.type, 'skills');
  assert.equal(logged._parent.row.level, 72);
  assert.equal((await a('PUT', `/api/skills/${skill.id}`, { level: 70 })).body.level, 70);
  assert.equal((await a('PUT', '/api/skills/999999', { level: 1 })).status, 404);
  assert.equal((await a('PUT', `/api/skill_logs/${logged.id}`, { skill_id: 999999 })).status, 400);
  assert.equal((await a('PUT', `/api/skills/${skill.id}`, {})).body.level, 70);

  const person = (await a('POST', '/api/people', { name: 'Mentor Mike', relation: 'mentor' })).body;
  const link = await a('POST', '/api/links', { from_type: 'people', from_id: person.id, to_type: 'skills', to_id: skill.id, label: 'teaches' });
  assert.equal(link.status, 201);
  assert.equal((await a('POST', '/api/links', { from_type: 'skills', from_id: skill.id, to_type: 'people', to_id: person.id })).status, 409);
  const bobSkill = (await b('POST', '/api/skills', { name: 'Bob only' })).body;
  assert.equal((await a('POST', '/api/links', { from_type: 'skills', from_id: skill.id, to_type: 'skills', to_id: bobSkill.id })).status, 400);
  assert.equal((await a('POST', '/api/links', { from_type: 'users', from_id: 1, to_type: 'skills', to_id: skill.id })).status, 400);
  const met = (await a('POST', '/api/interactions', { person_id: person.id, date: '2026-10-03', kind: 'call' })).body;
  assert.equal(met._parent.row.last_contact, '2026-10-03');
  const older = (await a('POST', '/api/interactions', { person_id: person.id, date: '2026-01-01' })).body;
  assert.equal(older._parent, undefined); // older interaction doesn't move last_contact back
  const boot0 = (await a('GET', '/api/bootstrap')).body;
  assert.ok(boot0.schema.entities.skills && boot0.user.username === 'alice');
  assert.equal(boot0.data.interactions.length, 2);

  const sketch = (await a('POST', '/api/sketches', { title: 's', data: 'data:image/png;base64,AAAA', thumb: 't' })).body;
  assert.equal(sketch.data, undefined); // heavy field not in list responses
  assert.equal((await a('GET', `/api/sketches/${sketch.id}`)).body.data, 'data:image/png;base64,AAAA');

  // leaderboards: Bob can't join a skill board he doesn't have
  assert.equal((await b('POST', '/api/leaderboards/skill:python/join')).status, 400);
  await b('POST', '/api/skills', { name: ' python ', level: 50 });
  assert.equal((await a('POST', '/api/leaderboards/skill:Python/join')).status, 200);
  const board = (await b('POST', '/api/leaderboards/skill:python/join')).body;
  assert.deepEqual(board.rows.map((r) => [r.display_name, r.score, r.rank]), [['Alice', 70, 1], ['Bob', 50, 2]]);
  assert.ok(!('id' in board.rows[0]));
  const lists = (await b('GET', '/api/leaderboards')).body;
  assert.ok(lists.find((l) => l.key === 'skill:python' && l.members === 2 && l.joined));

  // export → import into Bob (merge) remaps ids & links
  const exp = (await a('GET', '/api/export')).body;
  const imp = await b('POST', '/api/import', { payload: exp, mode: 'merge' });
  assert.equal(imp.body.counts.links, 1);
  assert.equal(imp.body.counts.skill_logs, 2);
  const newSketch = imp.body.ids.sketches[sketch.id];
  assert.ok(newSketch);
  assert.equal((await b('GET', `/api/sketches/${newSketch}`)).body.data, 'data:image/png;base64,AAAA');
  const bobNotes = (await b('GET', '/api/bootstrap')).body.data.skills.find((k) => k.name === 'Python');
  assert.equal(bobNotes.created_at, exp.data.skills[0].created_at); // timestamps survive import
  const boot = (await b('GET', '/api/bootstrap')).body;
  assert.equal(boot.data.skills.length, 3);
  assert.equal(boot.links.length, 1);

  // deleting a record removes its links and children
  await a('DELETE', `/api/skills/${skill.id}`);
  const after = (await a('GET', '/api/bootstrap')).body;
  assert.equal(after.links.length, 0);
  assert.equal(after.data.skill_logs.length, 0);

  // password change + account delete
  assert.equal((await a('PUT', '/api/me/password', { current: 'password123', next: 'newpassword1' })).status, 200);
  assert.equal((await a('DELETE', '/api/me', { password: 'newpassword1' })).status, 200);
  assert.equal((await a('GET', '/api/me')).status, 401);
});

test('bulk import is fast and keeps parent/child ids straight', async () => {
  const c = client();
  await c('POST', '/api/auth/register', { username: 'bulk', password: 'password123' });
  const data = { workouts: [], workout_sets: [], checkins: [] };
  for (let i = 1; i <= 400; i++) {
    data.workouts.push({ id: 1000 + i, date: '2026-01-01', type: 'strength', duration: i });
    data.workout_sets.push({ id: i, workout_id: 1000 + i, exercise: `ex${i}`, sets: 3 });
    data.workout_sets.push({ id: 5000 + i, workout_id: 1000 + i, exercise: `ex${i}`, sets: 4 });
    data.checkins.push({ id: i, date: '2026-01-01', mood: (i % 5) + 1 });
  }
  data.workout_sets.push({ id: 99999, workout_id: 424242, exercise: 'orphan' }); // dangling ref is skipped
  const t0 = Date.now();
  const r = await c('POST', '/api/import', { payload: { data }, mode: 'replace' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.counts.workouts, r.body.counts.workout_sets, r.body.counts.checkins], [400, 800, 400]);
  assert.ok(Date.now() - t0 < 10000, 'import took too long');
  const boot = (await c('GET', '/api/bootstrap')).body.data;
  const byId = new Map(boot.workouts.map((w) => [w.id, w]));
  for (const s of boot.workout_sets) assert.equal(`ex${byId.get(s.workout_id).duration}`, s.exercise);

  // leaderboard metrics aggregate correctly (COUNT/SUM come back as numbers)
  await c('POST', '/api/workouts', { date: new Date().toISOString().slice(0, 10), duration: 45 });
  const lb = (await c('POST', '/api/leaderboards/metric:workouts_30d/join')).body;
  assert.strictEqual(lb.rows[0].score, 1);
  const list = (await c('GET', '/api/leaderboards')).body;
  assert.strictEqual(list.find((x) => x.key === 'metric:workouts_30d').members, 1);

  // erase everything
  await c('POST', '/api/import', { payload: { data: {} }, mode: 'replace' });
  assert.equal((await c('GET', '/api/bootstrap')).body.data.workouts.length, 0);
});
