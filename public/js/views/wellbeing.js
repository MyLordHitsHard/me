import { h, today, daysAgo, addDays, fmtDate, avg, fmtNum } from '../util.js';
import { store } from '../store.js';
import { card, chart, empty, pageHead, buildForm, guard, tile, dataTable, openRecord } from '../ui.js';
import { streak } from '../analytics.js';

export default {
  render() {
    const checks = [...store.list('checkins')].sort((a, b) => b.date.localeCompare(a.date));
    const todays = checks.find((c) => c.date === today());
    const form = buildForm('checkins', todays || { date: today() });
    const save = h('button', {
      class: 'primary',
      onclick: async () => {
        const v = form.values();
        const existing = checks.find((c) => c.date === v.date);
        await guard(() => (existing ? store.update('checkins', existing.id, v) : store.create('checkins', v)), 'Check-in saved');
      },
    }, todays ? 'Update today’s check-in' : 'Save check-in');

    const days = [];
    for (let d = daysAgo(59); d <= today(); d = addDays(d, 1)) days.push(d);
    const by = new Map(checks.map((c) => [c.date, c]));
    const recent = checks.filter((c) => c.date >= daysAgo(13));
    const sleepTarget = store.settings().targets.sleep;

    return h('div', { style: { display: 'contents' } },
      pageHead('Wellbeing', 'A 30-second daily check-in: mood, energy, sleep, focus and stress. It powers the Mind & Health scores and correlations.'),
      h('div', { class: 'tiles' },
        tile('Check-in streak', streak(checks.map((c) => c.date)), 'days'),
        tile('Mood (14d)', fmtNum(avg(recent, (c) => c.mood), 1), '/ 5'),
        tile('Energy (14d)', fmtNum(avg(recent, (c) => c.energy), 1), '/ 5'),
        tile('Sleep (14d)', fmtNum(avg(recent, (c) => c.sleep), 1), 'h', { text: `target ${sleepTarget} h` }),
        tile('Stress (14d)', fmtNum(avg(recent, (c) => c.stress), 1), '/ 5')),
      h('div', { class: 'grid' },
        h('div', { class: 'span-5' }, card(todays ? 'Today’s check-in ✓' : 'How are you today?', fmtDate(today()), form.el, h('div', { class: 'row', style: { marginTop: '12px' } }, save))),
        h('div', { class: 'span-7' },
          card('Mood, energy & focus', 'last 60 days · 1–5', checks.length ? chart('line', {
            labels: days.map((d) => fmtDate(d)), yMin: 1, yMax: 5,
            datasets: [
              { label: 'Mood', data: days.map((d) => by.get(d)?.mood ?? null), color: 'var(--s1)' },
              { label: 'Energy', data: days.map((d) => by.get(d)?.energy ?? null), color: 'var(--s2)' },
              { label: 'Focus', data: days.map((d) => by.get(d)?.focus ?? null), color: 'var(--s3)' },
            ],
          }) : empty('Your trends appear after a few check-ins.')),
          h('div', { style: { height: '16px' } }),
          card('Sleep', 'hours per night', checks.length ? chart('bar', {
            labels: days.map((d) => fmtDate(d)), unit: 'h', height: 'short',
            datasets: [{ label: 'Sleep', data: days.map((d) => by.get(d)?.sleep ?? null), colors: days.map((d) => ((by.get(d)?.sleep ?? sleepTarget) < sleepTarget - 1 ? 'var(--s2)' : 'var(--s1)')) }],
          }) : empty('—'))),
        h('div', { class: 'span-12' }, card('History', `${checks.length} check-ins`, checks.length ? dataTable(checks.slice(0, 30), [
          { label: 'Date', get: (c) => fmtDate(c.date) },
          { label: 'Mood', num: true, get: (c) => c.mood }, { label: 'Energy', num: true, get: (c) => c.energy },
          { label: 'Sleep', num: true, get: (c) => c.sleep }, { label: 'Focus', num: true, get: (c) => c.focus }, { label: 'Stress', num: true, get: (c) => c.stress },
          { label: 'Gratitude / notes', get: (c) => [c.gratitude, c.notes].filter(Boolean).join(' · ').slice(0, 80) },
        ], { onClick: (c) => openRecord('checkins', c) }) : empty('No check-ins yet.'))),
        h('p', { class: 'small muted span-12' }, 'Short bars in the sleep chart are nights more than an hour under your target (set in Settings).')));
  },
};
