import { h, today, daysAgo, addDays, fmtDate, fmtNum, sum } from '../util.js';
import { api, store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, progressBar, guard, linkChip } from '../ui.js';
import { AREA_LABEL } from '../analytics.js';
import { norm } from './leaderboards.js';

export default {
  async render() {
    const trackers = store.list('trackers');
    const logs = store.list('tracker_logs');
    let joined = new Set();
    try { joined = new Set((await api('GET', '/api/leaderboards')).filter((b) => b.joined).map((b) => b.key)); } catch {}
    const days = [];
    for (let d = daysAgo(29); d <= today(); d = addDays(d, 1)) days.push(d);

    const block = (t, i) => {
      const mine = logs.filter((l) => l.tracker_id === t.id);
      const by = new Map();
      for (const l of mine) by.set(l.date, (by.get(l.date) || 0) + l.value);
      const todayVal = by.get(today()) || 0;
      const total30 = sum(days, (d) => by.get(d) || 0);
      const hit = t.daily_goal ? days.filter((d) => (by.get(d) || 0) >= t.daily_goal).length : null;
      const qty = h('input', { type: 'number', step: 'any', placeholder: t.unit || 'value', style: { width: '110px' }, 'aria-label': `Add ${t.name}` });
      const key = `tracker:${norm(t.name)}`;
      const isIn = joined.has(key);
      return h('div', { class: 'span-6' }, card(t.name, h('span', { class: 'row' }, h('span', { class: 'chip' }, AREA_LABEL[t.area] || 'Personal'), h('button', { class: 'sm ghost', onclick: () => openRecord('trackers', t) }, 'Edit')),
        h('div', { class: 'row', style: { marginBottom: '8px' } },
          h('div', { class: 'grow', style: { flex: 1 } },
            h('div', { class: 'small muted' }, `Today: ${fmtNum(todayVal, 1)}${t.daily_goal ? ` / ${fmtNum(t.daily_goal, 1)}` : ''} ${t.unit || ''}`),
            t.daily_goal ? progressBar((todayVal / t.daily_goal) * 100) : null),
          qty,
          h('button', {
            class: 'primary sm',
            onclick: async () => {
              if (qty.value === '') return;
              await guard(() => store.create('tracker_logs', { tracker_id: t.id, date: today(), value: Number(qty.value) }), 'Logged');
            },
          }, '+ Add')),
        chart('bar', { labels: days.map((d) => fmtDate(d)), datasets: [{ label: t.name, data: days.map((d) => by.get(d) || 0), color: `var(--s${(i % 8) + 1})` }], unit: t.unit || '', height: 'short' }),
        h('div', { class: 'row small muted', style: { marginTop: '8px' } },
          `30-day total ${fmtNum(total30, 1)} ${t.unit || ''}`, hit !== null ? ` · goal hit ${hit}/30 days` : '',
          h('span', { class: 'spacer' }),
          store.linksOf('trackers', t.id).map(({ type, item }) => linkChip(type, item)),
          h('button', { class: `sm ${isIn ? 'active' : ''}`, onclick: async () => { await guard(() => api(isIn ? 'DELETE' : 'POST', `/api/leaderboards/${encodeURIComponent(key)}/join`)); store.emit(); } }, isIn ? '♛ On leaderboard' : '♛ Join leaderboard'))));
    };

    return h('div', { style: { display: 'contents' } },
      pageHead('Custom trackers', 'Track anything — pages read, water, meditation, LeetCode problems, cold showers. Set a daily goal and an area to include it in your life balance.',
        h('button', { class: 'primary', onclick: () => openRecord('trackers', null) }, '+ New tracker')),
      trackers.length ? h('div', { class: 'grid' }, trackers.map(block)) : card(null, null, empty('Create your first custom tracker.', 'New tracker', () => openRecord('trackers', null))));
  },
};
