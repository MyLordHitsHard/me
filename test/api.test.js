'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-'));
process.env.DB_PATH = path.join(dir, 'test.db');
const { server } = require('../server');

let base;
test.before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

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

  const person = (await a('POST', '/api/people', { name: 'Mentor Mike', relation: 'mentor' })).body;
  const link = await a('POST', '/api/links', { from_type: 'people', from_id: person.id, to_type: 'skills', to_id: skill.id, label: 'teaches' });
  assert.equal(link.status, 201);
  assert.equal((await a('POST', '/api/links', { from_type: 'skills', from_id: skill.id, to_type: 'people', to_id: person.id })).status, 409);

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
  assert.equal(imp.body.counts.skill_logs, 1);
  const boot = (await b('GET', '/api/bootstrap')).body;
  assert.equal(boot.data.skills.length, 2);
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
