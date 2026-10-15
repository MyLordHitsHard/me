import { h, fmtDate, today, round, fmtNum, lastWeeks, sum, cap } from '../util.js';
import { store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, progressBar, dataTable, linkChip, tile } from '../ui.js';
import { examPrep, weekly, byDay } from '../analytics.js';

export default {
  render() {
    const exams = store.list('exams');
    const upcoming = exams.filter((e) => e.status !== 'done' && (!e.exam_date || e.exam_date >= today())).sort((a, b) => (a.exam_date || '9').localeCompare(b.exam_date || '9'));
    const past = exams.filter((e) => !upcoming.includes(e)).sort((a, b) => (b.exam_date || '').localeCompare(a.exam_date || ''));
    const sessions = store.list('study_sessions');
    const weeks = lastWeeks(12);

    const examCard = (e) => {
      const p = examPrep(store, e);
      const level = p.daysLeft !== null && p.daysLeft <= 14 && (p.pct ?? 0) < 60 ? 'critical' : (p.pct ?? 0) >= 80 ? 'good' : 'warning';
      return h('div', { class: 'mini', onclick: () => openRecord('exams', e) },
        h('div', { class: 'row' }, h('div', { class: 'title', style: { flex: 1 } }, e.name), h('span', { class: 'chip' }, cap(e.status))),
        h('div', { class: 'row' },
          h('div', { class: 'countdown num' }, p.daysLeft === null ? '—' : p.daysLeft),
          h('div', { class: 'small muted' }, p.daysLeft === null ? 'no date set' : `days left · ${fmtDate(e.exam_date)}`)),
        h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, progressBar(p.pct ?? 0)), h('span', { class: 'small num' }, `${fmtNum(p.hours, 1)} / ${fmtNum(p.goal)} h`)),
        h('span', { class: `status ${level}` }, p.pace !== null ? (p.pace > 0 ? `Need ${fmtNum(p.pace, 1)} h/day to reach prep goal` : 'Prep goal reached ✓') : 'Set an exam date for pacing'),
        h('div', { class: 'row' }, store.linksOf('exams', e.id).slice(0, 3).map(({ type, item }) => linkChip(type, item))),
        h('button', { class: 'sm', onclick: (ev) => { ev.stopPropagation(); openRecord('study_sessions', null, { defaults: { exam_id: e.id } }); } }, '+ Log study session'));
    };

    const scored = past.filter((e) => e.score !== null && e.score !== undefined && e.max_score).reverse();
    const topics = new Map();
    for (const s of sessions) { const t = s.topic || 'General'; topics.set(t, (topics.get(t) || 0) + (s.minutes || 0)); }
    const topTopics = [...topics].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const total = sum(sessions, (s) => s.minutes) / 60;
    const avgScore = scored.length ? scored.reduce((a, e) => a + (e.score / e.max_score) * 100, 0) / scored.length : null;

    return h('div', { style: { display: 'contents' } },
      pageHead('Exam tracker', 'Countdowns, preparation pacing, study sessions and results.',
        h('button', { disabled: !exams.length, onclick: () => openRecord('study_sessions', null) }, '+ Study session'),
        h('button', { class: 'primary', onclick: () => openRecord('exams', null) }, '+ New exam')),
      exams.length ? h('div', { class: 'tiles' },
        tile('Upcoming exams', upcoming.length),
        tile('Total study time', fmtNum(total, 1), 'h'),
        tile('Average result', avgScore === null ? '—' : Math.round(avgScore), avgScore === null ? '' : '%'),
        tile('Sessions logged', sessions.length)) : null,
      h('div', null, h('div', { class: 'section-title' }, 'Upcoming'),
        upcoming.length ? h('div', { class: 'cards' }, upcoming.map(examCard)) : card(null, null, empty('No upcoming exams. Add one to get a countdown and a study plan pace.', 'Add exam', () => openRecord('exams', null)))),
      h('div', { class: 'grid' },
        h('div', { class: 'span-6' }, card('Study hours per week', 'all exams', chart('bar', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Study', data: weekly(byDay(sessions, 'date', (s) => s.minutes), weeks).map((m) => round(m / 60, 1)), color: 'var(--s4)' }], unit: 'h' }))),
        h('div', { class: 'span-6' }, card('Results vs target', 'score as % of max', scored.length ? chart('line', {
          labels: scored.map((e) => e.name), yMax: 100,
          datasets: [
            { label: 'Score %', data: scored.map((e) => round((e.score / e.max_score) * 100, 1)), color: 'var(--s1)', points: true },
            { label: 'Target %', data: scored.map((e) => (e.target_score ? round((e.target_score / e.max_score) * 100, 1) : null)), color: 'var(--muted)', points: true, borderDash: [4, 4] },
          ], unit: '%',
        }) : empty('Results appear once you record scores.'))),
        h('div', { class: 'span-6' }, card('Time by topic', 'top 10', topTopics.length ? chart('bar', { labels: topTopics.map((t) => t[0]), datasets: [{ label: 'Hours', data: topTopics.map((t) => round(t[1] / 60, 1)), color: 'var(--s4)' }], horizontal: true, unit: 'h' }) : empty('Log study sessions with a topic.'))),
        h('div', { class: 'span-6' }, card('Past exams', `${past.length}`, past.length ? dataTable(past, [
          { label: 'Exam', get: (e) => e.name },
          { label: 'Date', get: (e) => fmtDate(e.exam_date) },
          { label: 'Score', num: true, get: (e) => (e.score !== null && e.score !== undefined ? `${e.score}/${e.max_score ?? '—'}` : '—') },
          { label: '%', num: true, get: (e) => (e.score !== null && e.max_score ? `${Math.round((e.score / e.max_score) * 100)}%` : '—') },
          { label: 'Prep', num: true, get: (e) => `${fmtNum(examPrep(store, e).hours, 1)} h` },
        ], { onClick: (e) => openRecord('exams', e) }) : empty('Completed exams are listed here.')))));
  },
};

