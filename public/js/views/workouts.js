import { h, fmtDate, daysAgo, lastWeeks, sum, avg, fmtNum, cap, weekStart, today, addDays } from '../util.js';
import { store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, dataTable, tile } from '../ui.js';
import { weekly, byDay } from '../analytics.js';

const TYPES = ['strength', 'cardio', 'sport', 'yoga', 'walk', 'hiit', 'other'];

let selectedExercise = null;

export default {
  render() {
    const ws = [...store.list('workouts')].sort((a, b) => b.date.localeCompare(a.date));
    const sets = store.list('workout_sets');
    const weeks = lastWeeks(12);
    const last30 = ws.filter((w) => w.date >= daysAgo(29));
    const target = store.settings().targets.workout_min_30d;

    // consecutive weeks with ≥ 3 sessions (current week counts if already reached)
    const perWeek = new Map();
    for (const w of ws) perWeek.set(weekStart(w.date), (perWeek.get(weekStart(w.date)) || 0) + 1);
    let wk = weekStart(today());
    if ((perWeek.get(wk) || 0) < 3) wk = addDays(wk, -7);
    let weekStreak = 0;
    while ((perWeek.get(wk) || 0) >= 3) { weekStreak++; wk = addDays(wk, -7); }

    const datasets = TYPES.map((t, i) => ({ label: cap(t), data: weekly(byDay(ws.filter((w) => w.type === t), 'date', (w) => w.duration), weeks), color: `var(--s${i + 1})` })).filter((d) => d.data.some((v) => v));

    // personal records
    const byEx = new Map();
    for (const s of sets) {
      const w = store.get('workouts', s.workout_id);
      if (!w) continue;
      const key = s.exercise.trim();
      const e = byEx.get(key) || { exercise: key, best: 0, e1rm: 0, sessions: 0, volume: 0, history: new Map() };
      e.sessions++;
      e.volume += (s.sets || 0) * (s.reps || 0) * (s.weight || 0);
      if ((s.weight || 0) > e.best) e.best = s.weight;
      const oneRm = s.weight ? s.weight * (1 + (s.reps || 1) / 30) : 0;
      if (oneRm > e.e1rm) e.e1rm = oneRm;
      e.history.set(w.date, Math.max(e.history.get(w.date) || 0, s.weight || 0));
      byEx.set(key, e);
    }
    const prs = [...byEx.values()].sort((a, b) => b.sessions - a.sessions);
    if (!selectedExercise || !byEx.has(selectedExercise)) selectedExercise = prs.find((p) => p.best)?.exercise || null;
    const sel = selectedExercise ? byEx.get(selectedExercise) : null;
    const hist = sel ? [...sel.history].filter(([, v]) => v).sort((a, b) => a[0].localeCompare(b[0])) : [];
    const picker = h('select', { 'aria-label': 'Exercise', onchange: (e) => { selectedExercise = e.target.value; store.emit(); } },
      prs.filter((p) => p.best).map((p) => h('option', { value: p.exercise, selected: p.exercise === selectedExercise }, p.exercise)));

    return h('div', { style: { display: 'contents' } },
      pageHead('Workout tracker', 'Log sessions and exercises, watch weekly volume and personal records.',
        h('button', { class: 'primary', onclick: () => openRecord('workouts', null) }, '+ Log workout')),
      ws.length ? h('div', { class: 'tiles' },
        tile('Sessions (30d)', last30.length),
        tile('Minutes (30d)', fmtNum(sum(last30, (w) => w.duration)), 'min', { text: `${Math.round((sum(last30, (w) => w.duration) / target) * 100)}% of ${fmtNum(target)} target` }),
        tile('Avg intensity', fmtNum(avg(last30, (w) => w.intensity), 1), '/ 5'),
        tile('Calories (30d)', fmtNum(sum(last30, (w) => w.calories)), 'kcal'),
        tile('Week streak', weekStreak, 'weeks', { text: '≥ 3 sessions / week' })) : null,
      ws.length ? h('div', { class: 'grid' },
        h('div', { class: 'span-8' }, card('Minutes per week by type', 'last 12 weeks', chart('bar', { labels: weeks.map((w) => fmtDate(w)), datasets, stacked: true, unit: 'min', height: 'tall' }))),
        h('div', { class: 'span-4' }, card('Mix (30 days)', 'sessions by type', chart('bar', {
          labels: TYPES.map(cap), horizontal: true, height: 'tall',
          datasets: [{ label: 'Sessions', data: TYPES.map((t) => last30.filter((w) => w.type === t).length), colors: TYPES.map((t, i) => `var(--s${i + 1})`) }],
        }))),
        h('div', { class: 'span-6' }, card('Strength progress', picker, hist.length >= 1 ? chart('line', { labels: hist.map(([d]) => fmtDate(d)), datasets: [{ label: `${selectedExercise} top set`, data: hist.map(([, v]) => v), color: 'var(--s1)', points: true }], unit: 'kg', yMin: undefined }) : empty('Log exercises with weights to see progress.'))),
        h('div', { class: 'span-6' }, card('Personal records', `${prs.length} exercises`, prs.length ? dataTable(prs.slice(0, 10), [
          { label: 'Exercise', get: (p) => p.exercise },
          { label: 'Best', num: true, get: (p) => (p.best ? `${fmtNum(p.best, 1)} kg` : '—') },
          { label: 'Est. 1RM', num: true, get: (p) => (p.e1rm ? `${fmtNum(p.e1rm)} kg` : '—') },
          { label: 'Sets logged', num: true, get: (p) => p.sessions },
        ]) : empty('Add exercises to a workout to track PRs.'))),
        h('div', { class: 'span-12' }, card('Recent sessions', null, dataTable(ws.slice(0, 15), [
          { label: 'Date', get: (w) => fmtDate(w.date) },
          { label: 'Session', get: (w) => w.title || cap(w.type) },
          { label: 'Type', get: (w) => cap(w.type) },
          { label: 'Minutes', num: true, get: (w) => w.duration },
          { label: 'Intensity', num: true, get: (w) => (w.intensity ? `${w.intensity}/5` : '—') },
          { label: 'Exercises', num: true, get: (w) => sets.filter((s) => s.workout_id === w.id).length },
        ], { onClick: (w) => openRecord('workouts', w) })))) : card(null, null, empty('No workouts yet. Log your first session — gym, run, sport, yoga, anything.', 'Log workout', () => openRecord('workouts', null))));
  },
};
