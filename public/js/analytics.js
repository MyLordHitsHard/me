// Derived analytics: life-area scores, insights, automatic SWOT, correlations.
import { today, daysAgo, addDays, daysBetween, weekStart, lastWeeks, monthKey, parseDate, iso, sum, avg, clamp, round, pearson, fmtNum, fmtDate } from './util.js';

export const AREAS = ['career', 'learning', 'health', 'mind', 'relationships', 'finance'];
export const AREA_LABEL = { career: 'Career', learning: 'Learning', health: 'Health', mind: 'Mind', relationships: 'Relationships', finance: 'Finance' };

const inRange = (d, from, to = today()) => d && d >= from && d <= to;

export function byDay(rows, dateField, value) {
  const m = new Map();
  for (const r of rows) {
    const d = r[dateField];
    if (!d) continue;
    m.set(d, (m.get(d) || 0) + (Number(value(r)) || 0));
  }
  return m;
}
export const sumRange = (map, from, to = today()) => { let s = 0; for (const [d, v] of map) if (inRange(d, from, to)) s += v; return s; };
export function weekly(map, weeks) {
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const out = weeks.map(() => 0);
  for (const [d, v] of map) { const i = idx.get(weekStart(d)); if (i !== undefined) out[i] += v; }
  return out;
}

export function studyByDay(s) {
  const m = byDay(s.list('study_sessions'), 'date', (r) => r.minutes);
  for (const [d, v] of byDay(s.list('skill_logs'), 'date', (r) => r.minutes)) m.set(d, (m.get(d) || 0) + v);
  return m;
}
export const workoutByDay = (s) => byDay(s.list('workouts'), 'date', (r) => r.duration);

export function streak(dates) {
  const set = new Set(dates);
  let n = 0;
  let d = today();
  if (!set.has(d)) d = addDays(d, -1);
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function lastContact(s, p) {
  let last = p.last_contact || null;
  for (const i of s.list('interactions')) if (i.person_id === p.id && (!last || i.date > last)) last = i.date;
  return last;
}
export function contactDue(s, p) {
  const last = lastContact(s, p);
  if (!last) return { due: (p.closeness || 3) >= 4, last, overdueBy: null };
  const gap = daysBetween(last, today());
  return { due: gap > (p.contact_every || 30), last, overdueBy: gap - (p.contact_every || 30) };
}
export function nextBirthday(b) {
  if (!b) return null;
  const t = parseDate(today());
  const [, m, d] = b.split('-').map(Number);
  let next = new Date(t.getFullYear(), m - 1, d);
  if (next < t) next = new Date(t.getFullYear() + 1, m - 1, d);
  return iso(next);
}

export function examPrep(s, e) {
  const sessions = s.list('study_sessions').filter((x) => x.exam_id === e.id);
  const hours = sum(sessions, (x) => x.minutes) / 60;
  const goal = e.prep_goal_hours || 0;
  const daysLeft = e.exam_date ? daysBetween(today(), e.exam_date) : null;
  const pct = goal ? clamp((hours / goal) * 100, 0, 100) : null;
  const pace = daysLeft && daysLeft > 0 && goal ? Math.max(0, goal - hours) / daysLeft : null;
  const scorePct = e.score !== null && e.score !== undefined && e.max_score ? (e.score / e.max_score) * 100 : null;
  return { hours, goal, daysLeft, pct, pace, scorePct, sessions };
}

export function finance(s, month = monthKey(today())) {
  const tx = s.list('transactions').filter((t) => monthKey(t.date) === month);
  const income = sum(tx.filter((t) => t.kind === 'income'), (t) => t.amount);
  const expense = sum(tx.filter((t) => t.kind === 'expense'), (t) => t.amount);
  const saving = sum(tx.filter((t) => t.kind === 'saving'), (t) => t.amount);
  const rate = income ? ((income - expense) / income) * 100 : null;
  return { income, expense, saving, rate, count: tx.length };
}

// ---------- life-area scores (0–100, null when there is no data) ----------
export function areaScores(s, targets) {
  const d30 = daysAgo(29);
  const d14 = daysAgo(13);
  const study = studyByDay(s);
  const workout = workoutByDay(s);
  const checks14 = s.list('checkins').filter((c) => inRange(c.date, d14));
  const parts = {};
  const add = (area, label, v) => { if (v !== null && v !== undefined && Number.isFinite(v)) (parts[area] ||= []).push({ label, value: clamp(v, 0, 100) }); };

  const skills = s.list('skills');
  if (skills.length) add('career', 'Skill level vs target', avg(skills, (k) => (k.target ? (k.level / k.target) * 100 : k.level)));
  const cGoals = s.list('goals').filter((g) => g.area === 'career' && g.status !== 'dropped');
  if (cGoals.length) add('career', 'Career goal progress', avg(cGoals, (g) => (g.status === 'done' ? 100 : g.progress)));
  const careerActive = s.list('career').filter((c) => ['active', 'applied', 'interview', 'offer'].includes(c.status) || inRange(c.end_date || c.start_date, daysAgo(365)));
  if (s.list('career').length) add('career', 'Career momentum (last year)', careerActive.length * 20);

  const studyH = sumRange(study, d30) / 60;
  if (s.list('study_sessions').length || s.list('skill_logs').length) add('learning', 'Study hours (30d) vs target', (studyH / targets.study_hours_30d) * 100);
  const examScores = s.list('exams').map((e) => examPrep(s, e).scorePct).filter((x) => x !== null);
  if (examScores.length) add('learning', 'Average exam score', avg(examScores));
  const lGoals = s.list('goals').filter((g) => g.area === 'learning' && g.status !== 'dropped');
  if (lGoals.length) add('learning', 'Learning goal progress', avg(lGoals, (g) => (g.status === 'done' ? 100 : g.progress)));

  if (s.list('workouts').length) add('health', 'Workout minutes (30d) vs target', (sumRange(workout, d30) / targets.workout_min_30d) * 100);
  const sleep = avg(checks14, (c) => c.sleep);
  if (sleep !== null) add('health', 'Sleep vs target', 100 - Math.abs(targets.sleep - sleep) * 25);

  const mood = avg(checks14, (c) => c.mood);
  const energy = avg(checks14, (c) => c.energy);
  const stress = avg(checks14, (c) => c.stress);
  if (mood !== null) add('mind', 'Mood (14d)', ((mood - 1) / 4) * 100);
  if (energy !== null) add('mind', 'Energy (14d)', ((energy - 1) / 4) * 100);
  if (stress !== null) add('mind', 'Low stress (14d)', ((5 - stress) / 4) * 100);

  const people = s.list('people');
  if (people.length) {
    add('relationships', 'People kept in touch with', (people.filter((p) => !contactDue(s, p).due).length / people.length) * 100);
    const inter30 = s.list('interactions').filter((i) => inRange(i.date, d30)).length;
    add('relationships', 'Interactions (30d) vs target', (inter30 / targets.contacts_30d) * 100);
  }

  const f = finance(s);
  if (f.rate !== null) add('finance', 'Savings rate vs target', (f.rate / targets.savings_rate) * 100);
  const fGoals = s.list('goals').filter((g) => g.area === 'finance' && g.status !== 'dropped');
  if (fGoals.length) add('finance', 'Finance goal progress', avg(fGoals, (g) => (g.status === 'done' ? 100 : g.progress)));

  for (const t of s.list('trackers')) {
    if (!t.daily_goal || !AREAS.includes(t.area)) continue;
    const logs = s.list('tracker_logs').filter((l) => l.tracker_id === t.id && inRange(l.date, d30));
    if (logs.length) add(t.area, `${t.name} vs goal`, (sum(logs, (l) => l.value) / (t.daily_goal * 30)) * 100);
  }

  const scores = {};
  for (const a of AREAS) scores[a] = parts[a] ? round(avg(parts[a], (p) => p.value)) : null;
  const known = AREAS.map((a) => scores[a]).filter((x) => x !== null);
  return { scores, parts, overall: known.length ? round(avg(known)) : null };
}

// ---------- upcoming ----------
export function upcoming(s, horizon = 30) {
  const t = today();
  const end = addDays(t, horizon);
  const items = [];
  for (const e of s.list('exams')) if (e.exam_date && e.status !== 'done' && e.exam_date >= t && e.exam_date <= addDays(t, 120)) items.push({ date: e.exam_date, type: 'exams', item: e, text: `Exam: ${e.name}` });
  for (const g of s.list('goals')) if (g.due_date && !['done', 'dropped'].includes(g.status) && g.due_date <= end) items.push({ date: g.due_date, type: 'goals', item: g, text: `${g.due_date < t ? 'Overdue goal' : 'Goal due'}: ${g.title}` });
  for (const p of s.list('people')) {
    const b = nextBirthday(p.birthday);
    if (b && b <= end) items.push({ date: b, type: 'people', item: p, text: `${p.name}'s birthday` });
  }
  for (const c of s.list('career')) if (c.status === 'interview' && c.start_date && c.start_date >= t && c.start_date <= end) items.push({ date: c.start_date, type: 'career', item: c, text: `Interview: ${c.title}` });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- insights ----------
export function insights(s, targets) {
  const out = [];
  const d30 = daysAgo(29);
  const p30 = [daysAgo(59), daysAgo(30)];
  const study = studyByDay(s);
  const workout = workoutByDay(s);
  const compare = (map, label, unit, div = 1) => {
    const cur = sumRange(map, d30) / div;
    const prev = sumRange(map, ...p30) / div;
    if (!cur && !prev) return;
    if (prev && cur >= prev * 1.15) out.push({ kind: 'good', text: `${label} up ${Math.round(((cur - prev) / prev) * 100)}% vs the previous 30 days (${fmtNum(cur, 1)} ${unit}).` });
    else if (prev && cur <= prev * 0.85) out.push({ kind: 'warning', text: `${label} down ${Math.round(((prev - cur) / prev) * 100)}% vs the previous 30 days (${fmtNum(cur, 1)} ${unit}).` });
  };
  compare(study, 'Study time', 'h', 60);
  compare(workout, 'Workout time', 'min');

  for (const e of s.list('exams')) {
    if (e.status === 'done' || !e.exam_date) continue;
    const p = examPrep(s, e);
    if (p.daysLeft === null || p.daysLeft < 0) continue;
    if (p.daysLeft <= 21 && p.pct !== null && p.pct < 60) out.push({ kind: 'critical', text: `${e.name} is ${p.daysLeft === 0 ? 'today' : `in ${p.daysLeft} days`} and prep is at ${Math.round(p.pct)}%. You need ~${fmtNum(p.pace, 1)} h/day to hit your goal.` });
    else if (p.pace !== null && p.pace > 0) out.push({ kind: 'info', text: `${e.name}: ${fmtNum(p.hours, 1)}/${fmtNum(p.goal)} h prepared, ${p.daysLeft} days left — about ${fmtNum(p.pace, 1)} h/day keeps you on track.` });
  }

  const checks = s.list('checkins');
  const recent = checks.filter((c) => inRange(c.date, daysAgo(13)));
  const before = checks.filter((c) => inRange(c.date, daysAgo(27), daysAgo(14)));
  const m1 = avg(recent, (c) => c.mood);
  const m0 = avg(before, (c) => c.mood);
  if (m1 !== null && m0 !== null && m1 - m0 <= -0.5) out.push({ kind: 'warning', text: `Mood has dipped (${fmtNum(m0, 1)} → ${fmtNum(m1, 1)} over two weeks). Check sleep, workload and time with people.` });
  if (m1 !== null && m0 !== null && m1 - m0 >= 0.5) out.push({ kind: 'good', text: `Mood is improving (${fmtNum(m0, 1)} → ${fmtNum(m1, 1)}). Whatever you changed, keep it.` });
  const sl = avg(recent, (c) => c.sleep);
  if (sl !== null && sl < targets.sleep - 1) out.push({ kind: 'warning', text: `Averaging ${fmtNum(sl, 1)} h of sleep — ${fmtNum(targets.sleep - sl, 1)} h under your target.` });

  const due = s.list('people').filter((p) => contactDue(s, p).due);
  if (due.length) out.push({ kind: 'info', text: `${due.length} ${due.length === 1 ? 'person is' : 'people are'} due a catch-up: ${due.slice(0, 3).map((p) => p.name).join(', ')}${due.length > 3 ? ' and others' : ''}.` });

  const overdue = s.list('goals').filter((g) => g.due_date && g.due_date < today() && !['done', 'dropped'].includes(g.status));
  if (overdue.length) out.push({ kind: 'critical', text: `${overdue.length} goal${overdue.length > 1 ? 's are' : ' is'} overdue: ${overdue.slice(0, 3).map((g) => g.title).join(', ')}.` });

  const cs = streak(checks.map((c) => c.date));
  if (cs >= 7) out.push({ kind: 'good', text: `${cs}-day check-in streak. Consistency compounds.` });

  const f = finance(s);
  if (f.rate !== null && f.rate < 0) out.push({ kind: 'critical', text: `Spending exceeds income this month by ${fmtNum(f.expense - f.income)}.` });

  const corr = topCorrelations(s, 2);
  for (const c of corr) out.push({ kind: 'info', text: c.text });

  if (!out.length) out.push({ kind: 'info', text: 'Log a few days of check-ins, workouts and study sessions to unlock personalised insights.' });
  const order = { critical: 0, warning: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

// ---------- automatic SWOT ----------
export function swotAuto(s, targets) {
  const S = []; const W = []; const O = []; const T = [];
  const src = (type, item) => ({ type, item });
  const skills = s.list('skills');
  for (const k of [...skills].sort((a, b) => b.level - a.level).filter((k) => k.level >= 70).slice(0, 5)) S.push({ text: `Strong in ${k.name} (level ${k.level})`, ...src('skills', k) });
  for (const k of skills.filter((k) => k.target && k.level < k.target - 30).slice(0, 4)) W.push({ text: `${k.name} is ${k.target - k.level} points below target`, ...src('skills', k) });

  const ach = s.list('career').filter((c) => ['achievement', 'certificate', 'publication'].includes(c.kind));
  if (ach.length) S.push({ text: `${ach.length} achievements & certifications on record` });
  const edu = s.list('career').filter((c) => c.kind === 'education' && c.score);
  for (const e of edu.slice(0, 2)) S.push({ text: `${e.title}${e.org ? ` at ${e.org}` : ''} — ${e.score}`, ...src('career', e) });

  const exams = s.list('exams');
  const scored = exams.map((e) => ({ e, p: examPrep(s, e) })).filter((x) => x.p.scorePct !== null);
  const ex = avg(scored, (x) => x.p.scorePct);
  if (ex !== null && ex >= 75) S.push({ text: `Strong exam record — averaging ${Math.round(ex)}%` });
  if (ex !== null && ex < 60) W.push({ text: `Exam average is ${Math.round(ex)}% — revisit study methods` });
  for (const { e, p } of scored) if (e.target_score && e.score < e.target_score) W.push({ text: `${e.name}: scored ${e.score} vs target ${e.target_score}`, ...src('exams', e) });

  const wmin = sumRange(workoutByDay(s), daysAgo(29));
  if (s.list('workouts').length) {
    if (wmin >= targets.workout_min_30d) S.push({ text: `Consistent training — ${fmtNum(wmin)} min in 30 days` });
    else W.push({ text: `Training at ${Math.round((wmin / targets.workout_min_30d) * 100)}% of your monthly target` });
  }
  const checks = s.list('checkins').filter((c) => c.date >= daysAgo(13));
  const sl = avg(checks, (c) => c.sleep);
  if (sl !== null && sl < targets.sleep - 0.75) W.push({ text: `Under-sleeping: ${fmtNum(sl, 1)} h average` });
  const st = avg(checks, (c) => c.stress);
  if (st !== null && st >= 3.5) T.push({ text: `High stress (${fmtNum(st, 1)}/5) is a burnout risk` });
  const mood = avg(checks, (c) => c.mood);
  if (mood !== null && mood >= 4) S.push({ text: `Positive mindset — mood ${fmtNum(mood, 1)}/5` });

  const people = s.list('people');
  const mentors = people.filter((p) => p.relation === 'mentor');
  const close = people.filter((p) => (p.closeness || 0) >= 4);
  if (close.length >= 3) S.push({ text: `Solid support network — ${close.length} close relationships` });
  for (const m of mentors.slice(0, 3)) O.push({ text: `Learn from ${m.name}${m.company ? ` (${m.company})` : ''}`, ...src('people', m) });
  const companies = new Map();
  for (const p of people.filter((p) => p.company && ['colleague', 'mentor', 'classmate', 'acquaintance', 'friend'].includes(p.relation))) companies.set(p.company, (companies.get(p.company) || 0) + 1);
  for (const [c, n] of [...companies].sort((a, b) => b[1] - a[1]).slice(0, 3)) O.push({ text: `${n} contact${n > 1 ? 's' : ''} at ${c} — potential referral` });
  const neglected = people.filter((p) => (p.closeness || 0) >= 4 && contactDue(s, p).due);
  if (neglected.length) T.push({ text: `Drifting from ${neglected.length} close relationship${neglected.length > 1 ? 's' : ''}` });
  if (people.length && people.length < 5) W.push({ text: 'Small professional network — add mentors and peers' });

  for (const k of skills.filter((k) => k.target && k.level < k.target && k.target - k.level <= 10)) O.push({ text: `${k.name} is within ${k.target - k.level} points of target`, ...src('skills', k) });
  for (const e of exams.filter((e) => e.status !== 'done' && e.exam_date && e.exam_date >= today())) {
    const p = examPrep(s, e);
    if (p.daysLeft > 21) O.push({ text: `${p.daysLeft} days to prepare for ${e.name}`, ...src('exams', e) });
    else if (p.pct !== null && p.pct < 60) T.push({ text: `${e.name} in ${p.daysLeft} days with ${Math.round(p.pct)}% prep`, ...src('exams', e) });
  }
  for (const c of s.list('career').filter((c) => ['applied', 'interview', 'offer'].includes(c.status))) O.push({ text: `${c.status === 'offer' ? 'Offer' : c.status === 'interview' ? 'Interview' : 'Application'} in progress: ${c.title}${c.org ? ` @ ${c.org}` : ''}`, ...src('career', c) });

  const overdue = s.list('goals').filter((g) => g.due_date && g.due_date < today() && !['done', 'dropped'].includes(g.status));
  for (const g of overdue.slice(0, 3)) T.push({ text: `Overdue: ${g.title}`, ...src('goals', g) });
  const done = s.list('goals').filter((g) => g.status === 'done');
  if (done.length >= 3) S.push({ text: `Follow-through — ${done.length} goals completed` });

  const f = finance(s);
  if (f.rate !== null && f.rate >= targets.savings_rate) S.push({ text: `Healthy savings rate (${Math.round(f.rate)}%)` });
  if (f.rate !== null && f.rate < 0) T.push({ text: 'Spending more than you earn this month' });
  else if (f.rate !== null && f.rate < targets.savings_rate / 2) W.push({ text: `Low savings rate (${Math.round(f.rate)}%)` });

  const study = sumRange(studyByDay(s), daysAgo(29)) / 60;
  const prev = sumRange(studyByDay(s), daysAgo(59), daysAgo(30)) / 60;
  if (prev && study < prev * 0.7) T.push({ text: `Study time fell ${Math.round((1 - study / prev) * 100)}% this month` });

  return { S, W, O, T };
}

// ---------- correlations ----------
export function dailyVariables(s, days = 90) {
  const from = daysAgo(days - 1);
  const checks = new Map(s.list('checkins').map((c) => [c.date, c]));
  const study = studyByDay(s);
  const workout = workoutByDay(s);
  const vars = [
    { key: 'sleep', label: 'Sleep', get: (d) => checks.get(d)?.sleep },
    { key: 'mood', label: 'Mood', get: (d) => checks.get(d)?.mood },
    { key: 'energy', label: 'Energy', get: (d) => checks.get(d)?.energy },
    { key: 'focus', label: 'Focus', get: (d) => checks.get(d)?.focus },
    { key: 'stress', label: 'Stress', get: (d) => checks.get(d)?.stress },
    { key: 'workout', label: 'Workout min', get: (d) => workout.get(d) || 0, activity: true },
    { key: 'study', label: 'Study min', get: (d) => study.get(d) || 0, activity: true },
  ];
  for (const t of s.list('trackers')) {
    const m = byDay(s.list('tracker_logs').filter((l) => l.tracker_id === t.id), 'date', (l) => l.value);
    if (m.size >= 5) vars.push({ key: `t${t.id}`, label: t.name, get: (d) => m.get(d) || 0, activity: true });
  }
  const dates = [];
  for (let d = from; d <= today(); d = addDays(d, 1)) dates.push(d);
  return { vars, dates, checkDays: new Set([...checks.keys()].filter((d) => d >= from)) };
}

export function correlationMatrix(s) {
  const { vars, dates, checkDays } = dailyVariables(s);
  // Activity zeros are only meaningful on days you were tracking at all.
  const tracked = dates.filter((d) => checkDays.has(d) || vars.some((v) => v.activity && v.get(d)));
  const m = vars.map((a) => vars.map((b) => {
    const xs = []; const ys = [];
    for (const d of tracked) {
      const x = a.get(d); const y = b.get(d);
      if (x === undefined || x === null || y === undefined || y === null) continue;
      xs.push(Number(x)); ys.push(Number(y));
    }
    return xs.length >= 7 ? { r: pearson(xs, ys), n: xs.length } : { r: null, n: xs.length };
  }));
  return { vars, m };
}

export function topCorrelations(s, n = 3) {
  const { vars, m } = correlationMatrix(s);
  const out = [];
  for (let i = 0; i < vars.length; i++) for (let j = i + 1; j < vars.length; j++) {
    const c = m[i][j];
    if (c.r === null || Math.abs(c.r) < 0.35) continue;
    if (['mood', 'energy', 'focus', 'stress'].includes(vars[i].key) && ['mood', 'energy', 'focus', 'stress'].includes(vars[j].key)) continue; // obvious
    const dir = c.r > 0 ? 'higher' : 'lower';
    out.push({ r: c.r, text: `On days with more ${vars[i].label.toLowerCase()}, your ${vars[j].label.toLowerCase()} tends to be ${dir} (r = ${c.r.toFixed(2)}, ${c.n} days).` });
  }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, n);
}

// ---------- activity heatmap ----------
export function activityByDay(s) {
  const m = new Map();
  const bump = (d, n = 1) => { if (d) m.set(d, (m.get(d) || 0) + n); };
  for (const t of ['workouts', 'study_sessions', 'skill_logs', 'checkins', 'interactions', 'tracker_logs']) for (const r of s.list(t)) bump(r.date);
  for (const r of s.list('notes')) bump(String(r.created_at).slice(0, 10));
  for (const r of s.list('sketches')) bump(String(r.created_at).slice(0, 10));
  return m;
}

export { lastWeeks, fmtDate };
