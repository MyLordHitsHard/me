import { h, fmtDate, cap } from '../util.js';
import { store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, guard, linkChip } from '../ui.js';

const KIND_ORDER = ['job', 'internship', 'education', 'project', 'certificate', 'achievement', 'publication', 'other'];
const PIPELINE = ['applied', 'interview', 'offer', 'rejected'];

function period(c) {
  if (!c.start_date && !c.end_date) return '';
  const s = c.start_date ? fmtDate(c.start_date, true) : '';
  const e = c.end_date ? fmtDate(c.end_date, true) : (c.status === 'active' ? 'present' : '');
  return e && s !== e ? `${s} – ${e}` : s;
}

function timeline(items) {
  const sorted = [...items].sort((a, b) => (b.start_date || b.end_date || '').localeCompare(a.start_date || a.end_date || ''));
  return h('div', { class: 'timeline' }, sorted.map((c) => h('div', { class: 'tl-item', onclick: () => openRecord('career', c) },
    h('div', { class: 'title', style: { fontWeight: 600 } }, c.title, c.org ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${c.org}`) : null),
    h('div', { class: 'small muted' }, [period(c), c.score, c.location].filter(Boolean).join(' · ')),
    c.details ? h('div', { class: 'small ink2', style: { marginTop: '4px' } }, c.details.slice(0, 220)) : null,
    h('div', { class: 'row', style: { marginTop: '4px' } }, store.linksOf('career', c.id).map(({ type, item }) => linkChip(type, item))))));
}

function pipeline(apps) {
  const col = (status) => {
    const list = apps.filter((a) => a.status === status);
    const el = h('div', { class: 'col' },
      h('h3', null, h('span', null, cap(status)), h('span', null, String(list.length))),
      list.map((a) => h('div', { class: 'mini', draggable: 'true', ondragstart: (e) => e.dataTransfer.setData('text/plain', String(a.id)), onclick: () => openRecord('career', a) },
        h('div', { class: 'title' }, a.org || a.title), h('div', { class: 'small muted' }, a.org ? a.title : '', a.start_date ? ` · ${fmtDate(a.start_date)}` : ''))));
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (id) guard(() => store.update('career', id, { status }));
    });
    return el;
  };
  return h('div', { class: 'kanban' }, PIPELINE.map(col));
}

export default {
  render() {
    const items = store.list('career');
    const apps = items.filter((c) => c.kind === 'application');
    const rest = items.filter((c) => c.kind !== 'application');
    const counts = KIND_ORDER.map((k) => rest.filter((c) => c.kind === k).length);
    const u = store.user;
    const rate = apps.length ? Math.round((apps.filter((a) => ['interview', 'offer'].includes(a.status)).length / apps.length) * 100) : null;

    return h('div', { style: { display: 'contents' } },
      pageHead('Career', 'Education, work, projects, achievements and job applications — your professional story.',
        h('button', { onclick: () => openRecord('career', null, { defaults: { kind: 'application', status: 'applied' } }) }, '+ Application'),
        h('button', { class: 'primary', onclick: () => openRecord('career', null) }, '+ Add item')),
      card(u.display_name, h('a', { href: '#/settings', class: 'small' }, 'Edit profile'),
        h('div', { class: 'ink2' }, u.headline || 'Add a headline in Settings, e.g. “CS graduate · Full-stack developer”'),
        u.bio ? h('p', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, u.bio) : null),
      h('div', { class: 'grid' },
        h('div', { class: 'span-7' }, card('Timeline', `${rest.length} items`, rest.length ? timeline(rest) : empty('Add your education, jobs, projects and achievements.', 'Add first item', () => openRecord('career', null)))),
        h('div', { class: 'span-5' },
          card('Profile mix', null, chart('bar', { labels: KIND_ORDER.map(cap), datasets: [{ label: 'Items', data: counts, color: 'var(--s7)' }], horizontal: true, height: 'short' })),
          h('div', { style: { height: '16px' } }),
          card('Highlights', null, (() => {
            const hl = rest.filter((c) => ['achievement', 'certificate', 'publication'].includes(c.kind));
            return hl.length ? h('div', { class: 'list' }, hl.map((c) => h('div', { class: 'list-item', onclick: () => openRecord('career', c) }, h('span', null, '★'), h('div', { class: 'grow' }, h('div', { class: 'title' }, c.title), h('div', { class: 'small muted' }, [c.org, period(c)].filter(Boolean).join(' · '))))))
              : empty('Certificates and achievements show up here.');
          })())),
        h('div', { class: 'span-12' }, card('Application pipeline', rate !== null ? `${apps.length} applications · ${rate}% reached interview+ · drag cards to update` : 'drag cards between columns',
          apps.length ? pipeline(apps) : empty('Track job & internship applications here.', 'Add application', () => openRecord('career', null, { defaults: { kind: 'application', status: 'applied' } }))))));
  },
};
