// Generates ~90 days of realistic demo data and imports it into the account.
import { api, store } from './store.js';
import { daysAgo, addDays, today } from './util.js';
import { guard, confirmBox } from './ui.js';

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

export function sampleData() {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  let id = 1;
  const D = {};
  const add = (t, row) => { (D[t] ||= []).push({ id: id, ...row }); return id++; };
  const links = [];
  const link = (ft, fi, tt, ti, label) => links.push({ from_type: ft, from_id: fi, to_type: tt, to_id: ti, label });

  const sk = {
    dsa: add('skills', { name: 'Data Structures & Algorithms', category: 'Programming', level: 62, target: 85 }),
    react: add('skills', { name: 'React', category: 'Web', level: 74, target: 85 }),
    sysd: add('skills', { name: 'System Design', category: 'Engineering', level: 38, target: 75 }),
    py: add('skills', { name: 'Python', category: 'Programming', level: 80, target: 85 }),
    speak: add('skills', { name: 'Public speaking', category: 'Soft skills', level: 45, target: 70 }),
  };
  for (let d = 89; d >= 0; d--) {
    if (r() < 0.45) {
      const k = pick(Object.values(sk));
      add('skill_logs', { skill_id: k, date: daysAgo(d), minutes: int(20, 90), note: pick(['Practice problems', 'Course module', 'Side project', 'Read docs']) });
    }
  }
  const e1 = add('exams', { name: 'GATE CSE', subject: 'Computer Science', exam_date: addDays(today(), 38), status: 'preparing', target_score: 70, max_score: 100, prep_goal_hours: 160, syllabus: '- DSA\n- OS\n- DBMS\n- CN\n- TOC' });
  const e2 = add('exams', { name: 'AWS Cloud Practitioner', subject: 'Cloud', exam_date: addDays(today(), 12), status: 'preparing', target_score: 800, max_score: 1000, prep_goal_hours: 30 });
  const e3 = add('exams', { name: 'Mock test #3', subject: 'Aptitude', exam_date: daysAgo(20), status: 'done', target_score: 75, score: 81, max_score: 100, prep_goal_hours: 10 });
  const e4 = add('exams', { name: 'Mock test #2', subject: 'Aptitude', exam_date: daysAgo(45), status: 'done', target_score: 75, score: 68, max_score: 100, prep_goal_hours: 10 });
  const topics = ['Operating systems', 'DBMS', 'Graphs', 'Dynamic programming', 'Networks', 'Theory of computation', 'EC2 & S3', 'IAM'];
  for (let d = 80; d >= 0; d--) {
    if (r() < 0.55) add('study_sessions', { exam_id: d < 30 && r() < 0.4 ? e2 : e1, date: daysAgo(d), minutes: int(30, 150), topic: pick(topics), focus: int(2, 5) });
    if (d > 45 && d < 60 && r() < 0.3) add('study_sessions', { exam_id: e4, date: daysAgo(d), minutes: int(30, 60), topic: 'Quant', focus: 3 });
    if (d > 20 && d < 40 && r() < 0.3) add('study_sessions', { exam_id: e3, date: daysAgo(d), minutes: int(30, 60), topic: 'Reasoning', focus: 4 });
  }
  const exs = { strength: ['Bench press', 'Squat', 'Deadlift', 'Overhead press', 'Pull-ups'], hiit: ['Burpees', 'Kettlebell swings'] };
  const workoutDays = new Set();
  for (let d = 89; d >= 0; d--) {
    if (r() < (d < 30 ? 0.5 : 0.4)) {
      const type = pick(['strength', 'strength', 'cardio', 'sport', 'yoga', 'hiit', 'walk']);
      workoutDays.add(daysAgo(d));
      const w = add('workouts', { date: daysAgo(d), type, title: { strength: 'Gym', cardio: 'Run', sport: 'Badminton', yoga: 'Yoga', hiit: 'HIIT', walk: 'Evening walk' }[type], duration: int(25, 80), calories: int(150, 600), intensity: int(2, 5) });
      if (exs[type]) for (let i = 0; i < 3; i++) add('workout_sets', { workout_id: w, exercise: pick(exs[type]), sets: int(3, 5), reps: int(5, 12), weight: type === 'strength' ? int(30, 90) + Math.round((90 - d) / 8) * 2.5 : null });
    }
  }
  for (let d = 59; d >= 0; d--) {
    if (r() < 0.12) continue;
    const sleep = Math.round((5.5 + r() * 3) * 2) / 2;
    const trained = workoutDays.has(daysAgo(d));
    const mood = Math.max(1, Math.min(5, Math.round(1.2 + (sleep - 5.5) * 0.7 + (trained ? 0.8 : 0) + r() * 1.2)));
    add('checkins', { date: daysAgo(d), sleep, mood, energy: Math.max(1, Math.min(5, mood + int(-1, 1))), focus: int(2, 5), stress: int(1, 4), gratitude: r() < 0.3 ? pick(['Good chat with family', 'Solved a hard problem', 'Nice weather', 'Great workout']) : null });
  }
  const p = {
    mom: add('people', { name: 'Mom', relation: 'family', closeness: 5, contact_every: 3, birthday: addDays(today(), 19).replace(/^\d{4}/, '1972') }),
    rahul: add('people', { name: 'Rahul Sharma', relation: 'friend', company: 'Microsoft', role: 'SDE II', closeness: 4, contact_every: 14, how_met: 'College hostel' }),
    priya: add('people', { name: 'Dr. Priya Mehta', relation: 'mentor', company: 'IIT Delhi', role: 'Professor', closeness: 3, contact_every: 30, how_met: 'Research internship' }),
    ankit: add('people', { name: 'Ankit Verma', relation: 'colleague', company: 'Microsoft', role: 'Engineering Manager', closeness: 2, contact_every: 45 }),
    sara: add('people', { name: 'Sara Khan', relation: 'classmate', company: 'Google', role: 'SWE', closeness: 3, contact_every: 30 }),
    dev: add('people', { name: 'Dev Patel', relation: 'friend', closeness: 4, contact_every: 7, birthday: '2001-03-14' }),
  };
  for (let d = 60; d >= 0; d -= int(1, 6)) add('interactions', { person_id: pick([p.mom, p.mom, p.dev, p.rahul, p.sara]), date: daysAgo(d), kind: pick(['call', 'message', 'meet']), note: '' });
  add('interactions', { person_id: p.priya, date: daysAgo(52), kind: 'email', note: 'Asked about research opportunities' });

  const g1 = add('goals', { title: 'Crack GATE with 700+ score', area: 'career', status: 'doing', progress: 55, due_date: addDays(today(), 38) });
  const g2 = add('goals', { title: 'Run a 10K under 55 minutes', area: 'health', status: 'doing', progress: 40, due_date: addDays(today(), 75) });
  const g3 = add('goals', { title: 'Build & ship portfolio v2', area: 'career', status: 'todo', progress: 10, due_date: addDays(today(), 25) });
  add('goals', { title: 'Save 3 months of expenses', area: 'finance', status: 'doing', progress: 35 });
  const g5 = add('goals', { title: 'Read 12 books this year', area: 'learning', status: 'doing', progress: 58 });
  add('goals', { title: 'AWS certification', area: 'learning', status: 'doing', progress: 70, due_date: addDays(today(), 12) });
  add('goals', { title: 'Finish DSA sheet', area: 'learning', status: 'done', progress: 100 });

  const c1 = add('career', { title: 'B.Tech Computer Science', kind: 'education', org: 'Sample University', start_date: '2020-08-01', end_date: '2024-06-30', status: 'done', score: 'CGPA 8.6' });
  add('career', { title: 'Software Engineering Intern', kind: 'internship', org: 'Startup Labs', start_date: '2023-05-15', end_date: '2023-07-31', status: 'done', details: 'Built internal dashboards in React and Node.' });
  const c3 = add('career', { title: 'SDE-1 application', kind: 'application', org: 'Microsoft', start_date: daysAgo(10), status: 'interview' });
  add('career', { title: 'Frontend Engineer application', kind: 'application', org: 'Razorpay', start_date: daysAgo(25), status: 'applied' });
  add('career', { title: 'Google Hash Code — top 3000', kind: 'achievement', start_date: '2022-02-24', status: 'done' });

  const n1 = add('notes', { title: 'GATE strategy', body: '# Plan\n- Finish OS + DBMS by week 3\n- Daily 2 PYQ sets\n- **Weekly** full mock on Sunday\n\n> Consistency beats intensity.', tags: 'gate, plan', pinned: 1 });
  const n2 = add('notes', { title: 'Interview prep — Microsoft', body: '- [x] Revise LRU cache\n- [ ] System design: URL shortener\n- [ ] Behavioural stories (STAR)', tags: 'interview' });
  add('notes', { title: 'Book notes: Atomic Habits', body: 'Make it obvious, attractive, easy, satisfying.', tags: 'books' });

  const t1 = add('trackers', { name: 'Reading', unit: 'pages', daily_goal: 20, area: 'learning' });
  const t2 = add('trackers', { name: 'Water', unit: 'glasses', daily_goal: 8, area: 'health' });
  for (let d = 45; d >= 0; d--) {
    if (r() < 0.7) add('tracker_logs', { tracker_id: t1, date: daysAgo(d), value: int(5, 40) });
    if (r() < 0.8) add('tracker_logs', { tracker_id: t2, date: daysAgo(d), value: int(4, 10) });
  }
  for (let m = 2; m >= 0; m--) {
    const base = addDays(today(), -30 * m).slice(0, 8);
    add('transactions', { date: `${base}01`, kind: 'income', amount: 60000, category: 'Stipend / salary' });
    add('transactions', { date: `${base}03`, kind: 'expense', amount: 15000, category: 'Rent' });
    add('transactions', { date: `${base}05`, kind: 'saving', amount: 10000, category: 'Mutual fund SIP' });
    for (let i = 0; i < 8; i++) {
      const date = `${base}${String(int(6, 27)).padStart(2, '0')}`;
      if (date > today()) continue;
      add('transactions', { date, kind: 'expense', amount: int(200, 3500), category: pick(['Food', 'Transport', 'Books', 'Gym', 'Entertainment', 'Shopping']) });
    }
  }
  add('swot_items', { quadrant: 'O', text: 'Campus placement season starts next month' });
  add('swot_items', { quadrant: 'T', text: 'Competitive job market for freshers' });

  link('people', p.priya, 'skills', sk.sysd, 'mentor for');
  link('people', p.rahul, 'career', c3, 'referral');
  link('people', p.ankit, 'career', c3, 'hiring manager');
  link('people', p.sara, 'skills', sk.dsa, 'study buddy');
  link('exams', e1, 'skills', sk.dsa, 'tests');
  link('exams', e1, 'goals', g1, 'achieves');
  link('notes', n1, 'exams', e1, 'plan for');
  link('notes', n2, 'career', c3, 'prep for');
  link('goals', g3, 'skills', sk.react, 'uses');
  link('career', c1, 'people', p.priya, 'professor');
  link('trackers', t1, 'goals', g5, 'measures');
  return { data: D, links: links.filter((l) => l.to_id) };
}

export async function loadSample() {
  if (!(await confirmBox('Add ~90 days of sample data to your account? You can delete it later from Settings → Data (“Erase all my data”).', 'Add sample data'))) return;
  await guard(async () => {
    await api('POST', '/api/import', { payload: sampleData(), mode: 'merge' });
    await store.load();
  }, 'Sample data added');
}
