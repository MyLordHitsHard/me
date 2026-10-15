import { h, fmtDate, relDays, today, cap } from '../util.js';
import { store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, progressBar, guard, linkChip } from '../ui.js';
import { AREAS, AREA_LABEL } from '../analytics.js';

const COLS = ['todo', 'doing', 'done', 'dropped'];

function goalCard(g) {
  const overdue = g.due_date && g.due_date < today() && !['done', 'dropped'].includes(g.status);
  return h('div', { class: 'mini', draggable: 'true', ondragstart: (e) => e.dataTransfer.setData('text/plain', String(g.id)), onclick: () => openRecord('goals', g) },
    h('div', { class: 'title' }, g.title),
    h('div', { class: 'row small muted' }, h('span', { class: 'chip' }, AREA_LABEL[g.area] || cap(g.area || 'personal')),
      g.due_date ? h('span', { class: `status ${overdue ? 'critical' : ''}` }, `${overdue ? 'Overdue · ' : ''}${fmtDate(g.due_date)} (${relDays(g.due_date)})`) : null),
    g.status !== 'dropped' ? h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, progressBar(g.status === 'done' ? 100 : g.progress)), h('span', { class: 'small num' }, `${g.status === 'done' ? 100 : g.progress}%`)) : null,
    h('div', { class: 'row' }, store.linksOf('goals', g.id).slice(0, 3).map(({ type, item }) => linkChip(type, item))));
}

export default {
  render({ params }) {
    const area = params.get('area') || '';
    const goals = store.list('goals').filter((g) => !area || g.area === area);
    const filter = h('div', { class: 'seg' }, [['', 'All'], ...AREAS.map((a) => [a, AREA_LABEL[a]]), ['personal', 'Personal']].map(([k, l]) => h('button', { class: area === k ? 'active' : '', onclick: () => { location.hash = k ? `#/goals?area=${k}` : '#/goals'; } }, l)));
    const board = h('div', { class: 'kanban' }, COLS.map((status) => {
      const list = goals.filter((g) => g.status === status).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
      const col = h('div', { class: 'col' }, h('h3', null, h('span', null, { todo: 'To do', doing: 'In progress', done: 'Done', dropped: 'Dropped' }[status]), h('span', null, String(list.length))), list.map(goalCard));
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = Number(e.dataTransfer.getData('text/plain'));
        if (id) guard(() => store.update('goals', id, status === 'done' ? { status, progress: 100 } : { status }));
      });
      return col;
    }));
    const all = store.list('goals').filter((g) => g.status !== 'dropped');
    const areas = [...AREAS, 'personal'];
    return h('div', { style: { display: 'contents' } },
      pageHead('Goals', 'Set goals for every area of life, link them to skills, exams and people, and drag them across the board.',
        h('button', { class: 'primary', onclick: () => openRecord('goals', null, { defaults: area ? { area } : {} }) }, '+ New goal')),
      h('div', { class: 'row' }, filter),
      goals.length ? board : card(null, null, empty('No goals yet. What do you want to achieve this quarter?', 'Set a goal', () => openRecord('goals', null))),
      all.length ? h('div', { class: 'grid' }, h('div', { class: 'span-12' }, card('Average progress by area', 'excluding dropped goals', chart('bar', {
        labels: areas.map((a) => AREA_LABEL[a] || 'Personal'),
        datasets: [{ label: 'Progress', data: areas.map((a) => { const g = all.filter((x) => x.area === a); return g.length ? Math.round(g.reduce((s, x) => s + (x.status === 'done' ? 100 : x.progress), 0) / g.length) : 0; }), color: 'var(--s3)' }],
        yMax: 100, unit: '%', height: 'short',
      })))) : null);
  },
};
