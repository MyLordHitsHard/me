import { h, today, addDays, fmtDate, fmtNum, lastWeeks, round, daysAgo, weekStart, parseDate } from '../util.js';
import { store } from '../store.js';
import { card, chart, pageHead, tip, empty, cssVar } from '../ui.js';
import { areaScores, AREAS, AREA_LABEL, activityByDay, correlationMatrix, dailyVariables, insights, studyByDay, workoutByDay, weekly, byDay } from '../analytics.js';
import { insightList, balanceBlock } from './dashboard.js';

function heatmap() {
  const act = activityByDay(store);
  const start = weekStart(addDays(today(), -7 * 25));
  const cells = [];
  let max = 0;
  for (const v of act.values()) max = Math.max(max, v);
  const step = (v) => (!v ? 0 : Math.min(6, 1 + Math.floor((v / Math.max(max, 1)) * 5.99)));
  for (let d = start; d <= today(); d = addDays(d, 1)) {
    const v = act.get(d) || 0;
    const el = h('i', { style: { background: `var(--seq-${step(v)})` }, 'aria-label': `${d}: ${v}` });
    tip(el, () => h('span', null, h('strong', null, fmtDate(d, true)), ` · ${v} log${v === 1 ? '' : 's'}`));
    cells.push(el);
  }
  const total = [...act].filter(([d]) => d >= start).reduce((a, [, v]) => a + v, 0);
  const activeDays = [...act].filter(([d, v]) => d >= start && v).length;
  return h('div', null,
    h('div', { class: 'heatmap' }, cells),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('span', { class: 'small muted' }, `${total} entries · active on ${activeDays} of ${Math.round((parseDate(today()) - parseDate(start)) / 86400000) + 1} days`),
      h('span', { class: 'spacer' }),
      h('div', { class: 'scale' }, 'Less', [0, 1, 2, 3, 4, 5, 6].map((i) => h('i', { style: { background: `var(--seq-${i})` } })), 'More')));
}

function colorFor(r) {
  if (r === null) return 'transparent';
  const neg = cssVar('--div-neg'); const mid = cssVar('--div-mid'); const pos = cssVar('--div-pos');
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [a, b] = r < 0 ? [hex(mid), hex(neg)] : [hex(mid), hex(pos)];
  const t = Math.min(1, Math.abs(r));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

function matrix() {
  const { vars, m } = correlationMatrix(store);
  if (!m.some((row, i) => row.some((c, j) => i !== j && c.r !== null))) return empty('Log at least a week of check-ins plus workouts / study to see how your habits relate.');
  const n = vars.length;
  const grid = h('div', { class: 'matrix', style: { gridTemplateColumns: `max-content repeat(${n}, minmax(34px, 1fr))` } });
  grid.append(h('div'), ...vars.map((v) => h('div', { class: 'lab col' }, v.label)));
  vars.forEach((a, i) => {
    grid.append(h('div', { class: 'lab' }, a.label));
    vars.forEach((b, j) => {
      const c = m[i][j];
      const strong = c.r !== null && Math.abs(c.r) > 0.55;
      const cell = h('div', { class: 'cell', style: { background: i === j ? 'transparent' : colorFor(c.r), color: strong ? '#fff' : 'var(--ink-2)' } }, i === j ? '' : c.r === null ? '·' : c.r.toFixed(1));
      if (i !== j) tip(cell, () => h('span', null, h('strong', null, `${a.label} × ${b.label}`), h('br'), c.r === null ? `not enough overlapping days (${c.n})` : `r = ${c.r.toFixed(2)} over ${c.n} days`));
      grid.append(cell);
    });
  });
  return h('div', null, grid, h('div', { class: 'scale', style: { marginTop: '10px' } }, 'Negative', [-1, -0.5, 0, 0.5, 1].map((r) => h('i', { style: { background: colorFor(r) } })), 'Positive',
    h('span', { style: { marginLeft: '12px' } }, 'Pearson r over the last 90 days. Correlation ≠ causation.')));
}

function scatter() {
  const { vars, dates } = dailyVariables(store);
  const sleep = vars.find((v) => v.key === 'sleep');
  const mood = vars.find((v) => v.key === 'mood');
  const pts = dates.map((d) => ({ x: sleep.get(d), y: mood.get(d) })).filter((p) => p.x != null && p.y != null);
  if (pts.length < 5) return empty('Needs a few check-ins with sleep and mood.');
  const jitter = pts.map((p) => ({ x: p.x, y: p.y + (Math.random() - 0.5) * 0.25 }));
  return chart('scatter', { datasets: [{ label: 'Day', data: jitter, color: 'var(--s1)' }], options: { xTitle: 'Sleep (hours)', yTitle: 'Mood (1–5)' }, yMin: 0.5, yMax: 5.5 });
}

export default {
  render() {
    const targets = store.settings().targets;
    const res = areaScores(store, targets);
    const weeks = lastWeeks(16);
    const study = weekly(studyByDay(store), weeks).map((m) => round(m / 60, 1));
    const work = weekly(workoutByDay(store), weeks);
    const tasks = weekly(byDay(store.list('interactions'), 'date', () => 1), weeks);
    const checks = store.list('checkins');
    const moodW = weeks.map((w) => { const c = checks.filter((x) => weekStart(x.date) === w && x.mood); return c.length ? round(c.reduce((a, x) => a + x.mood, 0) / c.length, 2) : null; });

    const breakdown = h('div', { class: 'list' }, AREAS.map((a) => h('div', { style: { padding: '8px 0', borderBottom: '1px solid var(--grid)' } },
      h('div', { class: 'row' }, h('strong', { style: { flex: 1 } }, AREA_LABEL[a]), h('span', { class: 'num' }, res.scores[a] === null ? 'no data' : `${res.scores[a]} / 100`)),
      (res.parts[a] || []).map((p) => h('div', { class: 'row small ink2' }, h('span', { style: { flex: 1 } }, p.label), h('span', { class: 'num' }, Math.round(p.value)))))));

    return h('div', { style: { display: 'contents' } },
      pageHead('Analysis', 'How every part of your life is trending — and how the parts affect each other.'),
      h('div', { class: 'grid' },
        h('div', { class: 'span-5' }, card('Life balance', res.overall !== null ? `overall ${res.overall} / 100` : null, balanceBlock(res))),
        h('div', { class: 'span-7' }, card('How the scores are calculated', 'targets are editable in Settings', breakdown)),
        h('div', { class: 'span-12' }, card('Activity heatmap', 'everything you logged · last 26 weeks', heatmap())),
        h('div', { class: 'span-6' }, card('Study hours per week', '16 weeks', chart('line', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Study', data: study, color: 'var(--s1)', points: true }], unit: 'h', height: 'short' }))),
        h('div', { class: 'span-6' }, card('Workout minutes per week', '16 weeks', chart('line', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Workout', data: work, color: 'var(--s6)', points: true }], unit: 'min', height: 'short' }))),
        h('div', { class: 'span-6' }, card('Average mood per week', '1–5', chart('line', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Mood', data: moodW, color: 'var(--s5)', points: true }], yMin: 1, yMax: 5, height: 'short' }))),
        h('div', { class: 'span-6' }, card('Social interactions per week', '16 weeks', chart('line', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Interactions', data: tasks, color: 'var(--s7)', points: true }], height: 'short' }))),
        h('div', { class: 'span-7' }, card('Habit correlations', 'which daily measures move together', matrix())),
        h('div', { class: 'span-5' }, card('Sleep vs mood', 'each dot is a day', scatter())),
        h('div', { class: 'span-12' }, card('All insights', `${fmtNum(checks.filter((c) => c.date >= daysAgo(29)).length)} check-ins in the last 30 days`, insightList(insights(store, targets))))));
  },
};
