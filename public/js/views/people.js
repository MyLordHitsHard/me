import { h, fmtDate, relDays, lastWeeks, cap, daysBetween, today } from '../util.js';
import { store, TYPE_COLOR } from '../store.js';
import { card, chart, empty, openRecord, pageHead, dataTable, linkChip, tile } from '../ui.js';
import { contactDue, nextBirthday, weekly, byDay } from '../analytics.js';

const RELATIONS = ['family', 'friend', 'mentor', 'colleague', 'classmate', 'acquaintance', 'other'];
let filter = '';
let query = '';

export default {
  render() {
    const people = store.list('people');
    const shown = people.filter((p) => (!filter || p.relation === filter) && (!query || [p.name, p.company, p.role, p.tags, p.location].join(' ').toLowerCase().includes(query)))
      .sort((a, b) => (b.closeness || 0) - (a.closeness || 0) || a.name.localeCompare(b.name));
    const due = people.map((p) => ({ p, c: contactDue(store, p) })).filter((x) => x.c.due).sort((a, b) => (b.p.closeness || 0) - (a.p.closeness || 0));
    const bdays = people.map((p) => ({ p, d: nextBirthday(p.birthday) })).filter((x) => x.d && daysBetween(today(), x.d) <= 60).sort((a, b) => a.d.localeCompare(b.d));
    const weeks = lastWeeks(12);
    const companies = new Map();
    for (const p of people) if (p.company) companies.set(p.company, (companies.get(p.company) || 0) + 1);
    const topCo = [...companies].sort((a, b) => b[1] - a[1]).slice(0, 8);

    const search = h('input', { type: 'search', placeholder: 'Filter people…', value: query, oninput: (e) => { query = e.target.value.toLowerCase(); store.emit(); } });
    const rel = h('select', { onchange: (e) => { filter = e.target.value; store.emit(); }, 'aria-label': 'Relation' }, h('option', { value: '' }, 'All relations'), RELATIONS.map((r) => h('option', { value: r, selected: r === filter }, cap(r))));
    setTimeout(() => { if (query && document.activeElement !== search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); } }, 0);

    return h('div', { style: { display: 'contents' } },
      pageHead('People', 'Everyone who matters — family, friends, mentors, colleagues. Log interactions, never miss a birthday, and connect people to skills, goals and opportunities.',
        h('a', { class: 'btn', href: '#/graph' }, 'View network graph'),
        h('button', { class: 'primary', onclick: () => openRecord('people', null) }, '+ Add person')),
      people.length ? h('div', { class: 'tiles' },
        tile('People', people.length),
        tile('Inner circle', people.filter((p) => (p.closeness || 0) >= 4).length, 'close'),
        tile('Mentors', people.filter((p) => p.relation === 'mentor').length),
        tile('Catch-ups due', due.length),
        tile('Interactions (30d)', store.list('interactions').filter((i) => daysBetween(i.date, today()) <= 29 && i.date <= today()).length)) : null,
      h('div', { class: 'grid' },
        h('div', { class: 'span-8' }, card('Directory', h('div', { class: 'row' }, search, rel), shown.length ? dataTable(shown, [
          { label: 'Name', render: (p) => h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'dot', style: { background: TYPE_COLOR.people } }), h('strong', null, p.name)) },
          { label: 'Relation', get: (p) => cap(p.relation) },
          { label: 'Company / role', get: (p) => [p.role, p.company].filter(Boolean).join(' @ ') },
          { label: 'Closeness', get: (p) => '●'.repeat(p.closeness || 0) + '○'.repeat(5 - (p.closeness || 0)) },
          { label: 'Last contact', render: (p) => { const c = contactDue(store, p); return h('span', { class: `status ${c.due ? 'warning' : 'good'}` }, c.last ? relDays(c.last) : 'never'); } },
          { label: 'Connected to', render: (p) => h('span', { class: 'row', style: { gap: '4px' } }, store.linksOf('people', p.id).slice(0, 3).map(({ type, item }) => linkChip(type, item))) },
        ], { onClick: (p) => openRecord('people', p) }) : empty(people.length ? 'No matches.' : 'Add the people in your life.', people.length ? null : 'Add person', () => openRecord('people', null)))),
        h('div', { class: 'span-4' },
          card('Catch up with', 'based on “contact every” days', due.length ? h('div', { class: 'list' }, due.slice(0, 8).map(({ p, c }) => h('div', { class: 'list-item', onclick: () => openRecord('people', p) },
            h('div', { class: 'grow' }, h('div', { class: 'title' }, p.name), h('div', { class: 'small muted' }, c.last ? `last ${relDays(c.last)}` : 'no contact logged')),
            h('button', { class: 'sm', onclick: (e) => { e.stopPropagation(); openRecord('interactions', null, { defaults: { person_id: p.id } }); } }, 'Log')))) : empty('You’re up to date 🎉')),
          h('div', { style: { height: '16px' } }),
          card('Birthdays', 'next 60 days', bdays.length ? h('div', { class: 'list' }, bdays.map(({ p, d }) => h('div', { class: 'list-item', onclick: () => openRecord('people', p) },
            h('span', null, '🎂'), h('div', { class: 'grow' }, h('div', { class: 'title' }, p.name), h('div', { class: 'small muted' }, `${fmtDate(d)} · ${relDays(d)}`))))) : empty('Add birthdays to people to get reminders.'))),
        people.length ? h('div', { class: 'span-6' }, card('Interactions per week', 'last 12 weeks', chart('bar', { labels: weeks.map((w) => fmtDate(w)), datasets: [{ label: 'Interactions', data: weekly(byDay(store.list('interactions'), 'date', () => 1), weeks), color: 'var(--s1)' }] }))) : null,
        people.length ? h('div', { class: 'span-6' }, card('Network by company', 'top 8', topCo.length ? chart('bar', { labels: topCo.map((c) => c[0]), datasets: [{ label: 'People', data: topCo.map((c) => c[1]), color: 'var(--s7)' }], horizontal: true }) : empty('Add companies to see where your network is.'))) : null));
  },
};

