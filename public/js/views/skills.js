import { h, lastWeeks, fmtDate, round, daysAgo, sum } from '../util.js';
import { api, store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, progressBar, guard, linkChip, tile } from '../ui.js';
import { weekly, byDay } from '../analytics.js';
import { norm } from './leaderboards.js';

export default {
  async render() {
    const skills = [...store.list('skills')].sort((a, b) => b.level - a.level);
    const logs = store.list('skill_logs');
    let boards = [];
    try { boards = await api('GET', '/api/leaderboards'); } catch {}
    const joined = new Set(boards.filter((b) => b.joined).map((b) => b.key));
    const weeks = lastWeeks(12);
    const top = [...skills].sort((a, b) => sum(logs.filter((l) => l.skill_id === b.id), (l) => l.minutes) - sum(logs.filter((l) => l.skill_id === a.id), (l) => l.minutes)).slice(0, 5);
    const datasets = top.map((k, i) => ({ label: k.name, data: weekly(byDay(logs.filter((l) => l.skill_id === k.id), 'date', (l) => l.minutes), weeks).map((m) => round(m / 60, 1)), color: `var(--s${i + 1})` }));
    const others = logs.filter((l) => !top.some((k) => k.id === l.skill_id));
    if (others.length) datasets.push({ label: 'Other', data: weekly(byDay(others, 'date', (l) => l.minutes), weeks).map((m) => round(m / 60, 1)), color: 'var(--muted)' });
    const cats = [...new Set(skills.map((k) => k.category || 'Uncategorised'))];
    const h30 = sum(logs.filter((l) => l.date >= daysAgo(29)), (l) => l.minutes) / 60;

    const skillCard = (k) => {
      const mine = logs.filter((l) => l.skill_id === k.id);
      const hours = sum(mine, (l) => l.minutes) / 60;
      const key = `skill:${norm(k.name)}`;
      const isIn = joined.has(key);
      return h('div', { class: 'mini', onclick: () => openRecord('skills', k) },
        h('div', { class: 'row' }, h('div', { class: 'title', style: { flex: 1 } }, k.name), h('span', { class: 'chip' }, k.category || 'Skill')),
        h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, progressBar(k.level, k.target)), h('span', { class: 'num small' }, `${k.level}/${k.target ?? '—'}`)),
        h('div', { class: 'small muted' }, `${round(hours, 1)} h practised · ${mine.length} sessions${mine.length ? ` · last ${fmtDate(mine.map((l) => l.date).sort().pop())}` : ''}`),
        h('div', { class: 'row' }, store.linksOf('skills', k.id).slice(0, 3).map(({ type, item }) => linkChip(type, item))),
        h('div', { class: 'row' },
          h('button', { class: 'sm', onclick: (e) => { e.stopPropagation(); openRecord('skill_logs', null, { defaults: { skill_id: k.id } }); } }, '+ Log practice'),
          h('button', {
            class: `sm ${isIn ? 'active' : ''}`, title: 'Opt in to rank against other users on this skill',
            onclick: async (e) => {
              e.stopPropagation();
              await guard(() => api(isIn ? 'DELETE' : 'POST', `/api/leaderboards/${encodeURIComponent(key)}/join`), isIn ? 'Left leaderboard' : 'Joined leaderboard');
              store.emit();
            },
          }, isIn ? '♛ On leaderboard' : '♛ Join leaderboard')));
    };

    return h('div', { style: { display: 'contents' } },
      pageHead('Skills', 'Rate your skills, set targets, log practice and opt in to skill leaderboards.',
        h('button', { onclick: () => openRecord('skill_logs', null) , disabled: !skills.length }, '+ Log practice'),
        h('button', { class: 'primary', onclick: () => openRecord('skills', null) }, '+ New skill')),
      skills.length ? h('div', { class: 'tiles' },
        tile('Skills tracked', skills.length),
        tile('Average level', Math.round(skills.reduce((a, k) => a + k.level, 0) / skills.length), '/ 100'),
        tile('At or above target', skills.filter((k) => k.target && k.level >= k.target).length, `of ${skills.length}`),
        tile('Practice (30 days)', round(h30, 1), 'h')) : null,
      skills.length ? h('div', { class: 'cards' }, skills.map(skillCard)) : card(null, null, empty('List the skills you want to grow — programming languages, frameworks, soft skills…', 'Add a skill', () => openRecord('skills', null))),
      skills.length ? h('div', { class: 'grid' },
        h('div', { class: 'span-7' }, card('Practice hours per week', 'top 5 skills by time + other', chart('bar', { labels: weeks.map((w) => fmtDate(w)), datasets, stacked: true, unit: 'h' }))),
        h('div', { class: 'span-5' }, card('Average level by category', null, chart('bar', {
          labels: cats, horizontal: true, yMax: 100, unit: '/ 100',
          datasets: [{ label: 'Level', data: cats.map((c) => { const g = skills.filter((k) => (k.category || 'Uncategorised') === c); return Math.round(g.reduce((a, k) => a + k.level, 0) / g.length); }), color: 'var(--s2)' }],
        })))) : null);
  },
};
