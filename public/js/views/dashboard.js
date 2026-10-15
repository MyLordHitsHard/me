import { h, today, daysAgo, lastWeeks, fmtDate, fmtNum, relDays, addDays, round } from '../util.js';
import { store, TYPE_COLOR } from '../store.js';
import { card, tile, chart, empty, progressBar, openRecord, linkChip } from '../ui.js';
import { areaScores, AREAS, AREA_LABEL, upcoming, insights, studyByDay, workoutByDay, sumRange, weekly, streak, contactDue } from '../analytics.js';
import { loadSample } from '../sample.js';

export const WIDGETS = {
  kpis: { label: 'Key numbers', span: 12 },
  balance: { label: 'Life balance wheel', span: 5 },
  upcoming: { label: 'Coming up', span: 3 },
  insights: { label: 'Insights', span: 4 },
  workoutWeekly: { label: 'Weekly workout minutes', span: 6 },
  studyWeekly: { label: 'Weekly study hours', span: 6 },
  skills: { label: 'Skills vs targets', span: 6 },
  mood: { label: 'Mood & energy (30 days)', span: 6 },
  goals: { label: 'Active goals', span: 6 },
  notes: { label: 'Pinned & recent notes', span: 6 },
};

export function insightList(items) {
  const icon = { good: '✓', warning: '!', critical: '!', info: 'i' };
  return h('div', { class: 'insights' }, items.map((i) => h('div', { class: `insight ${i.kind}` }, h('span', { class: 'ic', 'aria-label': i.kind }, icon[i.kind]), h('span', null, i.text))));
}

export function balanceBlock(res) {
  const labels = AREAS.map((a) => AREA_LABEL[a]);
  return h('div', null,
    chart('radar', { labels, datasets: [{ label: 'Score', data: AREAS.map((a) => res.scores[a] ?? 0), color: 'var(--accent)' }], height: '', unit: '/ 100' }),
    h('div', { class: 'list', style: { marginTop: '8px' } }, AREAS.map((a) => h('div', { class: 'row', style: { padding: '4px 0' } },
      h('span', { style: { width: '110px' }, class: 'small' }, AREA_LABEL[a]),
      h('div', { style: { flex: 1 } }, progressBar(res.scores[a] ?? 0)),
      h('span', { class: 'small num', style: { width: '44px', textAlign: 'right' } }, res.scores[a] === null ? 'no data' : res.scores[a])))));
}

function welcome() {
  return card('Welcome to LifeOS 👋', null,
    h('p', { class: 'ink2' }, 'This is your private dashboard. Everything you log — skills, exams, workouts, check-ins, people, notes — feeds the charts, insights, SWOT analysis and the connections graph.'),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => loadSample() }, 'Explore with sample data'),
      h('a', { class: 'btn', href: '#/settings' }, 'Import a profile / data file'),
      h('button', { onclick: () => openRecord('skills', null) }, 'Add your first skill'),
      h('a', { class: 'btn', href: '#/wellbeing' }, 'Do today’s check-in')));
}

export default {
  render() {
    const s = store.settings();
    const targets = s.targets;
    const res = areaScores(store, targets);
    const total = ['skills', 'exams', 'workouts', 'notes', 'people', 'checkins', 'career', 'goals'].reduce((n, t) => n + store.list(t).length, 0);
    const study = studyByDay(store);
    const work = workoutByDay(store);
    const weeks = lastWeeks(12);
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    const build = {
      kpis() {
        const sH = sumRange(study, daysAgo(29)) / 60;
        const sP = sumRange(study, daysAgo(59), daysAgo(30)) / 60;
        const wM = sumRange(work, daysAgo(29));
        const wP = sumRange(work, daysAgo(59), daysAgo(30));
        const delta = (c, p, unit) => (p ? { dir: c >= p ? 'up' : 'down', text: `${c >= p ? '▲' : '▼'} ${fmtNum(Math.abs(c - p), 1)} ${unit} vs prior 30d` } : { text: 'last 30 days' });
        const nextExam = store.list('exams').filter((e) => e.exam_date && e.exam_date >= today() && e.status !== 'done').sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];
        const due = store.list('people').filter((p) => contactDue(store, p).due).length;
        return h('div', { class: 'tiles' },
          tile('Life score', res.overall ?? '—', res.overall !== null ? '/ 100' : '', { text: 'average of tracked areas' }),
          tile('Study & practice', fmtNum(sH, 1), 'h', delta(sH, sP, 'h')),
          tile('Workout', fmtNum(wM), 'min', delta(wM, wP, 'min')),
          tile('Check-in streak', streak(store.list('checkins').map((c) => c.date)), 'days', { text: store.list('checkins').some((c) => c.date === today()) ? 'today logged ✓' : 'log today to keep it' }),
          tile('Next exam', nextExam ? relDays(nextExam.exam_date).replace('in ', '') : '—', '', { text: nextExam ? nextExam.name : 'none scheduled' }),
          tile('Catch-ups due', due, due === 1 ? 'person' : 'people', { text: 'based on contact frequency' }));
      },
      balance: () => card('Life balance', h('a', { href: '#/analysis', class: 'small' }, 'Analysis →'), balanceBlock(res)),
      upcoming() {
        const items = upcoming(store).slice(0, 8);
        return card('Coming up', 'next 30 days', items.length ? h('div', { class: 'list' }, items.map((u) => h('div', { class: 'list-item', onclick: () => openRecord(u.type, u.item) },
          h('span', { class: 'dot', style: { background: TYPE_COLOR[u.type] } }),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, u.text), h('div', { class: 'small muted' }, `${fmtDate(u.date)} · ${relDays(u.date)}`))))) : empty('Nothing scheduled. Add exam dates, goal deadlines and birthdays.'));
      },
      insights: () => card('Insights', 'auto-generated', insightList(insights(store, targets).slice(0, 6))),
      workoutWeekly: () => card('Workout minutes per week', 'last 12 weeks', chart('bar', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Workout', data: weekly(work, weeks), color: 'var(--s6)' }], unit: 'min' })),
      studyWeekly: () => card('Study & practice hours per week', 'last 12 weeks', chart('bar', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Study', data: weekly(study, weeks).map((m) => round(m / 60, 1)), color: 'var(--s1)' }], unit: 'h' })),
      skills() {
        const sk = [...store.list('skills')].sort((a, b) => b.level - a.level).slice(0, 8);
        return card('Skills vs targets', h('a', { href: '#/skills', class: 'small' }, 'All skills →'), sk.length
          ? h('div', { class: 'list' }, sk.map((k) => h('div', { class: 'list-item', onclick: () => openRecord('skills', k) },
            h('span', { style: { width: '130px' }, class: 'title' }, k.name),
            h('div', { style: { flex: 1 } }, progressBar(k.level, k.target)),
            h('span', { class: 'small num', style: { width: '64px', textAlign: 'right' } }, `${k.level} / ${k.target ?? '—'}`))))
          : empty('No skills yet', 'Add a skill', () => openRecord('skills', null)));
      },
      mood() {
        const days = [];
        for (let d = daysAgo(29); d <= today(); d = addDays(d, 1)) days.push(d);
        const by = new Map(store.list('checkins').map((c) => [c.date, c]));
        if (!store.list('checkins').length) return card('Mood & energy', null, empty('No check-ins yet', 'Check in now', () => { location.hash = '#/wellbeing'; }));
        return card('Mood & energy', 'last 30 days · 1–5', chart('line', {
          labels: days.map((d) => fmtDate(d)), yMin: 1, yMax: 5,
          datasets: [{ label: 'Mood', data: days.map((d) => by.get(d)?.mood ?? null), color: 'var(--s1)' }, { label: 'Energy', data: days.map((d) => by.get(d)?.energy ?? null), color: 'var(--s2)' }],
        }));
      },
      goals() {
        const g = store.list('goals').filter((x) => ['todo', 'doing'].includes(x.status)).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')).slice(0, 7);
        return card('Active goals', h('a', { href: '#/goals', class: 'small' }, 'All goals →'), g.length ? h('div', { class: 'list' }, g.map((x) => h('div', { class: 'list-item', onclick: () => openRecord('goals', x) },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, x.title), h('div', { class: 'small muted' }, `${x.area}${x.due_date ? ` · due ${fmtDate(x.due_date)}` : ''}`)),
          h('div', { style: { width: '120px' } }, progressBar(x.progress)), h('span', { class: 'small num', style: { width: '36px', textAlign: 'right' } }, `${x.progress}%`))))
          : empty('No active goals', 'Set a goal', () => openRecord('goals', null)));
      },
      notes() {
        const n = [...store.list('notes')].sort((a, b) => (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
        return card('Notes', h('a', { href: '#/notes', class: 'small' }, 'Open notes →'), n.length ? h('div', { class: 'list' }, n.map((x) => h('div', { class: 'list-item', onclick: () => { location.hash = `#/notes?id=${x.id}`; } },
          h('span', { 'aria-hidden': 'true' }, x.pinned ? '📌' : '≡'),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, x.title), h('div', { class: 'small muted' }, (x.body || '').slice(0, 90))),
          h('div', { class: 'row' }, store.linksOf('notes', x.id).slice(0, 2).map(({ type, item }) => linkChip(type, item))))))
          : empty('No notes yet', 'Write a note', () => { location.hash = '#/notes?new=1'; }));
      },
    };

    const visible = s.widgets.filter((w) => WIDGETS[w] && !s.hiddenWidgets.includes(w));
    return h('div', { style: { display: 'contents' } },
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, `${hello}, ${store.user.display_name.split(' ')[0]}`), h('p', null, store.user.headline || 'Here is how your life is tracking.')),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/settings?tab=dashboard' }, 'Customize'), h('a', { class: 'btn', href: '#/wellbeing' }, 'Daily check-in'))),
      total === 0 ? welcome() : null,
      h('div', { class: 'grid' }, visible.map((w) => h('div', { class: `span-${WIDGETS[w].span}` }, build[w]()))));
  },
};

