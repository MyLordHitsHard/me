// Shared UI: modals, toasts, tooltips, forms, record editor, charts.
import { h, clear, today, humanize, fmtDate, fmtNum } from './util.js';
import { store, TYPES, TYPE_COLOR } from './store.js';

// ---------- toasts ----------
let toastBox;
export function toast(msg, kind = '') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 5000 : 2600);
}
export async function guard(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message || 'Something went wrong', 'error');
    return undefined;
  }
}

// ---------- tooltip ----------
let tipEl;
export function tip(el, content) {
  el.addEventListener('mouseenter', () => {
    if (!tipEl) { tipEl = h('div', { class: 'tooltip' }); document.body.append(tipEl); }
    clear(tipEl).append(typeof content === 'function' ? content() : content);
    tipEl.style.display = 'block';
  });
  el.addEventListener('mousemove', (e) => {
    if (!tipEl) return;
    const x = Math.min(e.clientX + 12, window.innerWidth - tipEl.offsetWidth - 8);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${e.clientY + 14}px`;
  });
  el.addEventListener('mouseleave', () => { if (tipEl) tipEl.style.display = 'none'; });
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ---------- modal ----------
export function modal({ title, body, actions = [], wide, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => (a instanceof Node ? a : h('button', {
    class: a.class || '',
    onclick: async () => { if ((await a.onClick?.()) !== false) close(); },
  }, a.label)))) : null;
  const m = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'ghost icon', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body),
    foot);
  back.append(m);
  document.body.append(back);
  setTimeout(() => m.querySelector('input:not([type=hidden]), textarea, select')?.focus(), 30);
  return { close, el: m };
}

export function confirmBox(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title: 'Are you sure?',
      body: h('p', null, message),
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, class: 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

// ---------- forms ----------
const LONG = new Set(['body', 'notes', 'details', 'syllabus', 'gratitude', 'how_met']);
const SCALE = { mood: ['Awful', 'Low', 'Okay', 'Good', 'Great'], energy: ['Drained', 'Low', 'Okay', 'Good', 'High'], focus: ['Scattered', 'Low', 'Okay', 'Sharp', 'Deep'], stress: ['Calm', 'Low', 'Some', 'High', 'Very high'], closeness: ['Distant', 'Loose', 'Friendly', 'Close', 'Inner circle'], intensity: ['Very light', 'Light', 'Moderate', 'Hard', 'Max'] };
const LABELS = {
  contact_every: 'Contact every (days)', prep_goal_hours: 'Prep goal (hours)', duration: 'Duration (min)', sleep: 'Sleep (hours)',
  daily_goal: 'Daily goal', minutes: 'Minutes', weight: 'Weight (kg)', level: 'Level (0–100)', target: 'Target level', progress: 'Progress %',
  max_score: 'Max score', target_score: 'Target score', exam_date: 'Exam date', start_date: 'Start', end_date: 'End', due_date: 'Due', url: 'Link',
  org: 'Organisation', score: 'Score / grade / rank', last_contact: 'Last contact', how_met: 'How you met',
};
export const fieldLabel = (n) => LABELS[n] || humanize(n);

export function input(name, f, value, { refOptions } = {}) {
  const v = value === null || value === undefined ? '' : value;
  if (f.type === 'enum') {
    return h('select', { name }, (f.required ? [] : [h('option', { value: '' }, '—')]).concat(f.enum.map((o) => h('option', { value: o, selected: o === v }, humanize(o)))));
  }
  if (SCALE[name]) {
    return h('select', { name }, h('option', { value: '' }, '—'), SCALE[name].map((l, i) => h('option', { value: i + 1, selected: Number(v) === i + 1 }, `${i + 1} · ${l}`)));
  }
  if (f.type === 'ref') {
    return h('select', { name }, (refOptions || store.list(f.ref)).map((r) => h('option', { value: r.id, selected: r.id === Number(v) }, store.title(f.ref, r))));
  }
  if (f.type === 'bool') return h('input', { type: 'checkbox', name, checked: !!v });
  if (f.type === 'date') return h('input', { type: 'date', name, value: v });
  if (f.type === 'int' || f.type === 'real') return h('input', { type: 'number', name, value: v, step: f.type === 'int' ? 1 : 'any', min: f.min, max: f.max });
  if (LONG.has(name) || (f.maxLen || 0) > 5000) return h('textarea', { name, rows: name === 'body' ? 12 : 4 }, v);
  return h('input', { type: name === 'email' ? 'email' : name === 'url' ? 'url' : 'text', name, value: v, maxLength: f.maxLen });
}

export function readInput(el, f) {
  if (f.type === 'bool') return el.checked;
  const v = el.value;
  if (v === '') return null;
  if (f.type === 'int' || f.type === 'real' || f.type === 'ref') return Number(v);
  return v;
}

export function buildForm(type, item = {}, { omit = [], defaults = {} } = {}) {
  const def = store.schema.entities[type];
  const inputs = {};
  const fields = [];
  for (const [name, f] of Object.entries(def.fields)) {
    if (f.heavy || name === 'thumb' || omit.includes(name)) continue;
    const value = item[name] ?? defaults[name] ?? (f.type === 'date' && f.required ? today() : f.default);
    const el = input(name, f, value);
    inputs[name] = { el, f };
    const wide = el.tagName === 'TEXTAREA';
    fields.push(f.type === 'bool'
      ? h('label', { class: 'check wide' }, el, fieldLabel(name))
      : h('label', { class: `field${wide ? ' wide' : ''}` }, h('span', null, fieldLabel(name) + (f.required ? ' *' : '')), el));
  }
  const el = h('form', { class: 'form-grid', onsubmit: (e) => e.preventDefault() }, fields);
  return {
    el,
    values() {
      const out = { ...defaults };
      for (const [n, { el: i, f }] of Object.entries(inputs)) out[n] = readInput(i, f);
      return out;
    },
  };
}

// ---------- record editor (form + children + relations) ----------
export const CHILDREN = {
  skills: { type: 'skill_logs', fk: 'skill_id', cols: ['date', 'minutes', 'level', 'note'], label: 'Practice log' },
  exams: { type: 'study_sessions', fk: 'exam_id', cols: ['date', 'minutes', 'topic', 'focus'], label: 'Study sessions' },
  workouts: { type: 'workout_sets', fk: 'workout_id', cols: ['exercise', 'sets', 'reps', 'weight'], label: 'Exercises' },
  people: { type: 'interactions', fk: 'person_id', cols: ['date', 'kind', 'note'], label: 'Interactions' },
  trackers: { type: 'tracker_logs', fk: 'tracker_id', cols: ['date', 'value', 'note'], label: 'Entries' },
};

// Keep parent records in sync when a child is logged.
export async function afterChildAdded(type, row) {
  if (type === 'skill_logs' && row.level !== null && row.level !== undefined) {
    await store.update('skills', row.skill_id, { level: row.level }, { silent: true });
  }
  if (type === 'interactions') {
    const p = store.get('people', row.person_id);
    if (p && (!p.last_contact || p.last_contact < row.date)) await store.update('people', p.id, { last_contact: row.date }, { silent: true });
  }
}

function childSection(parentType, parent) {
  const cfg = CHILDREN[parentType];
  const def = store.schema.entities[cfg.type];
  const wrap = h('div');
  const render = () => {
    clear(wrap);
    const rows = store.list(cfg.type).filter((r) => r[cfg.fk] === parent.id).sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)));
    const inputs = {};
    const addRow = h('tr', null, cfg.cols.map((c) => {
      const f = def.fields[c];
      const el = input(c, f, f.type === 'date' ? today() : '');
      el.style.width = '100%';
      inputs[c] = { el, f };
      return h('td', null, el);
    }), h('td', null, h('button', {
      class: 'sm primary',
      onclick: async () => {
        const values = { [cfg.fk]: parent.id };
        for (const [n, { el, f }] of Object.entries(inputs)) values[n] = readInput(el, f);
        const row = await guard(() => store.create(cfg.type, values, { silent: true }));
        if (row) { await afterChildAdded(cfg.type, row); store.emit(); render(); }
      },
    }, 'Add')));
    wrap.append(
      h('div', { class: 'section-title' }, cfg.label, h('span', null, `${rows.length}`)),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, cfg.cols.map((c) => h('th', null, fieldLabel(c))), h('th'))),
        h('tbody', null, addRow, rows.map((r) => h('tr', null,
          cfg.cols.map((c) => h('td', { class: 'num' }, def.fields[c].type === 'date' ? fmtDate(r[c]) : (r[c] ?? '—'))),
          h('td', null, h('button', {
            class: 'sm ghost danger', 'aria-label': 'Delete entry',
            onclick: async () => { await guard(() => store.remove(cfg.type, r.id)); render(); },
          }, '✕')))))),
      ),
    );
  };
  render();
  return wrap;
}

export function linkChip(type, item, onRemove) {
  return h('span', { class: 'chip link', title: TYPES[type].single, onclick: () => openRecord(type, item) },
    h('span', { class: 'dot', style: { background: TYPE_COLOR[type] } }),
    store.title(type, item),
    onRemove ? h('span', { class: 'x', role: 'button', 'aria-label': 'Unlink', onclick: (e) => { e.stopPropagation(); onRemove(); } }, '✕') : null);
}

export function linksSection(type, item) {
  const wrap = h('div');
  const render = () => {
    clear(wrap);
    const linked = store.linksOf(type, item.id);
    const typeSel = h('select', null, store.schema.linkable.map((t) => h('option', { value: t }, TYPES[t].single)));
    const itemSel = h('select', { style: { flex: '1', minWidth: '140px' } });
    const fillItems = () => {
      clear(itemSel);
      const t = typeSel.value;
      const taken = new Set(linked.filter((x) => x.type === t).map((x) => x.item.id));
      const opts = store.list(t).filter((r) => !(t === type && r.id === item.id) && !taken.has(r.id));
      itemSel.append(...(opts.length ? opts.map((r) => h('option', { value: r.id }, store.title(t, r))) : [h('option', { value: '' }, 'Nothing to link')]));
    };
    typeSel.addEventListener('change', fillItems);
    typeSel.value = type === 'people' ? 'skills' : 'people';
    fillItems();
    const labelIn = h('input', { placeholder: 'relation (optional) e.g. "mentor for"', style: { flex: '1', minWidth: '140px' } });
    wrap.append(
      h('div', { class: 'section-title' }, 'Connections', h('span', null, `${linked.length}`)),
      h('div', { class: 'row', style: { marginBottom: '8px' } }, linked.length
        ? linked.map(({ link, type: t, item: it }) => h('span', { class: 'row', style: { gap: '4px' } },
          linkChip(t, it, async () => { await guard(() => store.unlink(link.id)); render(); }),
          link.label ? h('span', { class: 'small muted' }, link.label) : null))
        : h('span', { class: 'muted small' }, 'Not connected to anything yet. Connect people, skills, goals, exams and notes to build your life graph.')),
      h('div', { class: 'row' }, typeSel, itemSel, labelIn, h('button', {
        class: 'sm',
        onclick: async () => {
          if (!itemSel.value) return;
          await guard(() => store.link(type, item.id, typeSel.value, Number(itemSel.value), labelIn.value.trim() || null));
          render();
        },
      }, 'Link')),
    );
  };
  render();
  return wrap;
}

export function openRecord(type, item, { defaults = {}, onSaved, omit } = {}) {
  if (type === 'sketches' && item) { location.hash = `#/sketch?id=${item.id}`; return; }
  if (type === 'notes' && item) { location.hash = `#/notes?id=${item.id}`; return; }
  const isNew = !item || !item.id;
  const form = buildForm(type, item || {}, { defaults, omit });
  const body = [form.el];
  if (!isNew && CHILDREN[type]) body.push(childSection(type, item));
  if (!isNew && store.schema.linkable.includes(type)) body.push(linksSection(type, item));
  const actions = [];
  if (!isNew) {
    actions.push({
      label: 'Delete', class: 'danger',
      onClick: async () => {
        if (!(await confirmBox(`Delete “${store.title(type, item)}”? Linked entries are removed too.`))) return false;
        await guard(() => store.remove(type, item.id), 'Deleted');
        return true;
      },
    });
    actions.push(h('span', { class: 'spacer' }));
  }
  actions.push({ label: isNew ? 'Cancel' : 'Close' });
  actions.push({
    label: isNew ? 'Create' : 'Save', class: 'primary',
    onClick: async () => {
      const values = form.values();
      const row = await guard(() => (isNew ? store.create(type, values) : store.update(type, item.id, values)), isNew ? 'Created' : 'Saved');
      if (!row) return false;
      if (isNew) await afterChildAdded(type, row);
      if (onSaved) onSaved(row);
      if (isNew && (CHILDREN[type] || store.schema.linkable.includes(type)) && type !== 'notes') {
        setTimeout(() => openRecord(type, row), 50); // continue with logs & connections
      }
      return true;
    },
  });
  modal({ title: isNew ? `New ${TYPES[type]?.single || type}` : store.title(type, item), body, actions, wide: !isNew && !!CHILDREN[type] });
}

// ---------- building blocks ----------
export function card(title, sub, ...children) {
  return h('section', { class: 'card' }, (title || sub) ? h('div', { class: 'card-head' }, h('h2', null, title), sub instanceof Node ? sub : (sub ? h('span', { class: 'sub' }, sub) : null)) : null, ...children);
}
export function tile(label, value, unit, delta) {
  return h('div', { class: 'tile' }, h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value, unit ? h('small', null, unit) : null),
    delta ? h('div', { class: `delta ${delta.dir || ''}` }, delta.text) : null);
}
export function empty(text, actionLabel, onAction) {
  return h('div', { class: 'empty' }, h('div', null, text), actionLabel ? h('button', { class: 'primary', onclick: onAction }, actionLabel) : null);
}
export function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'row' }, actions));
}
export function progressBar(pct, markerPct) {
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('i', { style: { width: `${Math.max(0, Math.min(100, pct))}%` } }),
    markerPct !== undefined && markerPct !== null ? h('b', { style: { left: `${Math.max(0, Math.min(100, markerPct))}%` } }) : null);
}
export function dataTable(rows, cols, { onClick } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, cols.map((c) => h('th', { style: c.num ? { textAlign: 'right' } : null }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', { class: onClick ? 'click' : '', onclick: onClick ? () => onClick(r) : null },
      cols.map((c) => h('td', { class: c.num ? 'num' : '', style: c.num ? { textAlign: 'right' } : null }, c.render ? c.render(r) : (c.get(r) ?? '—'))))))));
}

// ---------- charts ----------
const charts = new Set();
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const series = (i) => cssVar(`--s${(i % 8) + 1}`);
export function resolveColor(c) { return c && c.startsWith('var(') ? cssVar(c.slice(4, -1)) : c; }

export function destroyCharts() { for (const c of charts) c.destroy(); charts.clear(); }

export function chart(type, { labels, datasets, options = {}, height = '', horizontal, stacked, yMax, yMin, unit = '' }) {
  const canvas = h('canvas', { role: 'img', 'aria-label': datasets.map((d) => d.label).join(', ') });
  const box = h('div', { class: `chart-box ${height}` }, canvas);
  if (!window.Chart) { box.append(h('div', { class: 'empty' }, 'Charts unavailable')); return box; }
  const ink2 = cssVar('--ink-2');
  const muted = cssVar('--muted');
  const grid = cssVar('--grid');
  const surface = cssVar('--surface');
  const multi = datasets.length > 1;
  const ds = datasets.map((d, i) => {
    const color = resolveColor(d.color) || series(i);
    const base = { ...d, borderColor: color, backgroundColor: d.fill ? `${color}22` : color };
    if (type === 'line') Object.assign(base, { borderWidth: 2, pointRadius: d.points ? 3 : 0, pointHoverRadius: 5, pointBackgroundColor: color, pointBorderColor: surface, tension: 0.3, cubicInterpolationMode: 'monotone', spanGaps: true });
    if (type === 'bar') Object.assign(base, { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, borderWidth: 0, ...(d.colors ? { backgroundColor: d.colors.map(resolveColor) } : {}) });
    if (type === 'radar') Object.assign(base, { borderWidth: 2, pointRadius: 3, backgroundColor: `${color}26`, pointBackgroundColor: color });
    if (type === 'scatter') Object.assign(base, { pointRadius: 5, pointHoverRadius: 7, borderColor: surface, borderWidth: 1.5, backgroundColor: color });
    return base;
  });
  const axis = (isValue) => ({
    stacked,
    grid: { color: isValue ? grid : 'transparent', drawTicks: false },
    border: { display: !isValue, color: cssVar('--axis') },
    ticks: { color: muted, padding: 6, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
    ...(isValue ? { beginAtZero: true, max: yMax, min: yMin } : {}),
  });
  const config = {
    type,
    data: { labels, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      indexAxis: horizontal ? 'y' : 'x',
      interaction: type === 'line' ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: type !== 'bar' },
      plugins: {
        legend: { display: multi, position: 'top', align: 'end', labels: { color: ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', font: { size: 12 } } },
        tooltip: {
          backgroundColor: surface, titleColor: cssVar('--ink'), bodyColor: ink2, borderColor: cssVar('--axis'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
          callbacks: unit ? { label: (c) => `${c.dataset.label}: ${fmtNum(c.parsed[horizontal ? 'x' : 'y'] ?? c.parsed.r ?? c.parsed, 1)} ${unit}` } : undefined,
        },
      },
      scales: type === 'radar'
        ? { r: { min: 0, max: 100, angleLines: { color: grid }, grid: { color: grid }, pointLabels: { color: ink2, font: { size: 12 } }, ticks: { display: false, stepSize: 25 } } }
        : type === 'scatter'
          ? { x: { ...axis(true), beginAtZero: false, min: undefined, max: undefined, border: { display: true, color: cssVar('--axis') }, title: { display: !!options.xTitle, text: options.xTitle, color: ink2 } }, y: { ...axis(true), title: { display: !!options.yTitle, text: options.yTitle, color: ink2 } } }
          : { x: axis(horizontal), y: axis(!horizontal) },
      ...options.chart,
    },
  };
  // Chart.js needs the canvas attached for sizing; defer creation one frame.
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    charts.add(new window.Chart(canvas, config));
  });
  return box;
}
