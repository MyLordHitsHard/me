import { h, clear, debounce } from './util.js';
import { api, store, TYPES, TYPE_COLOR } from './store.js';
import { destroyCharts, hideTip, toast, openRecord } from './ui.js';

const VIEWS = [
  { group: 'Overview' },
  { id: 'dashboard', label: 'Dashboard', icon: '⌂', always: true },
  { id: 'analysis', label: 'Analysis', icon: '◔' },
  { id: 'swot', label: 'SWOT', icon: '⊞' },
  { group: 'Career & learning' },
  { id: 'career', label: 'Career', icon: '◆' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'skills', label: 'Skills', icon: '★' },
  { id: 'exams', label: 'Exams', icon: '✎' },
  { id: 'leaderboards', label: 'Leaderboards', icon: '♛' },
  { group: 'Life' },
  { id: 'workouts', label: 'Workouts', icon: '♥' },
  { id: 'wellbeing', label: 'Wellbeing', icon: '☀' },
  { id: 'finance', label: 'Finance', icon: '¤' },
  { id: 'trackers', label: 'Trackers', icon: '▦' },
  { id: 'people', label: 'People', icon: '☺' },
  { group: 'Create & connect' },
  { id: 'notes', label: 'Notes', icon: '≡' },
  { id: 'sketch', label: 'Sketch pad', icon: '✐' },
  { id: 'graph', label: 'Connections', icon: '⋈' },
  { group: '' },
  { id: 'settings', label: 'Settings', icon: '⚙', always: true },
];
const LOADERS = {
  dashboard: () => import('./views/dashboard.js'), analysis: () => import('./views/analysis.js'), swot: () => import('./views/swot.js'),
  career: () => import('./views/career.js'), goals: () => import('./views/goals.js'), skills: () => import('./views/skills.js'),
  exams: () => import('./views/exams.js'), leaderboards: () => import('./views/leaderboards.js'), workouts: () => import('./views/workouts.js'),
  wellbeing: () => import('./views/wellbeing.js'), finance: () => import('./views/finance.js'), trackers: () => import('./views/trackers.js'),
  people: () => import('./views/people.js'), notes: () => import('./views/notes.js'), sketch: () => import('./views/sketch.js'),
  graph: () => import('./views/graph.js'), settings: () => import('./views/settings.js'),
};

const root = document.getElementById('root');
let shell = null;
let current = null; // { id, view }

function applyTheme() {
  const s = store.settings();
  const el = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') el.setAttribute('data-theme', s.theme);
  else el.removeAttribute('data-theme');
  el.style.setProperty('--accent', s.accent || '#2a78d6');
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, q] = raw.split('?');
  return { id: id || 'dashboard', params: new URLSearchParams(q || '') };
}

// ---------- auth ----------
async function renderAuth() {
  destroyCharts();
  document.documentElement.removeAttribute('data-theme');
  let cfg = { allowSignup: true };
  try { cfg = await api('GET', '/api/auth/config'); } catch {}
  let mode = 'login';
  const err = h('div', { class: 'err', role: 'alert' });
  const form = h('form');
  const tabs = h('div', { class: 'seg' });
  const draw = () => {
    clear(form);
    clear(tabs);
    tabs.append(
      h('button', { type: 'button', class: mode === 'login' ? 'active' : '', onclick: () => { mode = 'login'; draw(); } }, 'Log in'),
      cfg.allowSignup ? h('button', { type: 'button', class: mode === 'register' ? 'active' : '', onclick: () => { mode = 'register'; draw(); } }, 'Create account') : null,
    );
    form.append(
      mode === 'register' ? h('label', { class: 'field' }, h('span', null, 'Your name'), h('input', { name: 'display_name', autocomplete: 'name', required: true })) : null,
      h('label', { class: 'field' }, h('span', null, 'Username'), h('input', { name: 'username', autocomplete: 'username', required: true, pattern: '[A-Za-z0-9_.\\-]{3,32}' })),
      h('label', { class: 'field' }, h('span', null, 'Password'), h('input', { name: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minLength: mode === 'register' ? 8 : 1 })),
      err,
      h('button', { class: 'primary', type: 'submit' }, mode === 'login' ? 'Log in' : 'Create my dashboard'),
    );
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form));
    try {
      await api('POST', `/api/auth/${mode}`, body);
      await start();
    } catch (ex) { err.textContent = ex.message; }
  });
  draw();
  clear(root).append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'L'), 'LifeOS'),
    h('p', { class: 'ink2', style: { margin: 0 } }, 'Your career, learning, health, people and ideas — connected in one private dashboard.'),
    h('div', { class: 'features' }, ['Career timeline & goals', 'Skills & exam tracker', 'Workout & wellbeing logs', 'Notes & sketch pad', 'People you know', 'Relations graph', 'Charts, analysis & SWOT', 'Opt-in leaderboards'].map((f) => h('span', null, `✓ ${f}`))),
    tabs, form,
  )));
}

// ---------- shell ----------
function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'L'), 'LifeOS'),
    nav,
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'small', id: 'who' }),
      h('button', { class: 'sm', onclick: async () => { await api('POST', '/api/auth/logout'); store.user = null; shell = null; renderAuth(); } }, 'Log out')));
  const searchIn = h('input', { type: 'search', placeholder: 'Search everything…  ( / )', 'aria-label': 'Search' });
  const results = h('div', { class: 'search-results hidden' });
  const doSearch = debounce(() => {
    const q = searchIn.value.trim().toLowerCase();
    clear(results);
    if (!q) { results.classList.add('hidden'); return; }
    const hits = [];
    for (const t of Object.keys(TYPES)) {
      if (!TYPES[t].route) continue;
      for (const r of store.list(t)) {
        const hay = Object.values(r).filter((v) => typeof v === 'string').join(' ').toLowerCase();
        if (hay.includes(q)) hits.push({ t, r });
        if (hits.length > 30) break;
      }
    }
    results.append(...(hits.length ? hits.map(({ t, r }) => h('button', { onclick: () => { results.classList.add('hidden'); searchIn.value = ''; openRecord(t, r); } },
      h('span', { class: 'dot', style: { background: TYPE_COLOR[t], marginTop: '6px' } }), h('span', { class: 'grow' }, store.title(t, r)), h('span', { class: 'muted small' }, TYPES[t].single)))
      : [h('div', { class: 'empty' }, 'No matches')]));
    results.classList.remove('hidden');
  }, 120);
  searchIn.addEventListener('input', doSearch);
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchIn.value = ''; results.classList.add('hidden'); } });
  document.addEventListener('click', (e) => { if (!results.contains(e.target) && e.target !== searchIn) results.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); searchIn.focus(); }
  });

  const quick = h('select', { 'aria-label': 'Quick add', onchange: (e) => { const t = e.target.value; e.target.value = ''; if (t === 'notes') location.hash = '#/notes?new=1'; else if (t === 'sketches') location.hash = '#/sketch'; else if (t === 'checkins') location.hash = '#/wellbeing'; else if (t) openRecord(t, null); } },
    h('option', { value: '' }, '+ Quick add'),
    ['goals', 'skills', 'exams', 'workouts', 'notes', 'people', 'career', 'checkins', 'transactions', 'sketches'].map((t) => h('option', { value: t }, TYPES[t].single)));

  const main = h('main', { class: 'main' },
    h('div', { class: 'topbar' },
      h('button', { class: 'menu-btn icon', 'aria-label': 'Menu', onclick: () => sidebar.classList.toggle('open') }, '☰'),
      h('div', { class: 'search' }, searchIn, results),
      h('span', { class: 'spacer' }),
      quick),
    h('div', { class: 'content', id: 'content' }));
  clear(root).append(h('div', { class: 'app' }, sidebar, main));
  shell = { nav, sidebar, content: main.querySelector('#content') };
}

function renderNav() {
  const mods = store.settings().modules;
  const { id } = parseHash();
  clear(shell.nav);
  let pendingGroup = null;
  for (const v of VIEWS) {
    if (v.group !== undefined) { pendingGroup = v.group; continue; }
    if (!v.always && mods[v.id] === false) continue;
    if (pendingGroup !== null) { if (pendingGroup) shell.nav.append(h('div', { class: 'nav-group' }, pendingGroup)); pendingGroup = null; }
    shell.nav.append(h('a', { href: `#/${v.id}`, class: v.id === id ? 'active' : '', 'aria-current': v.id === id ? 'page' : null, onclick: () => shell.sidebar.classList.remove('open') },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, v.icon), v.label));
  }
  const who = document.getElementById('who');
  if (who) { clear(who).append(h('div', { style: { fontWeight: 600 } }, store.user.display_name), h('div', { class: 'muted' }, `@${store.user.username}`)); }
}

async function route(force) {
  if (!store.user) return;
  const { id, params } = parseHash();
  const valid = LOADERS[id] ? id : 'dashboard';
  renderNav();
  if (!force && current && current.id === valid && current.hash === location.hash) return;
  let mod;
  try { mod = await LOADERS[valid](); } catch (e) { console.error(e); toast('Could not load that page', 'error'); return; }
  destroyCharts();
  hideTip();
  if (current?.view?.unmount) current.view.unmount();
  const view = mod.default;
  current = { id: valid, view, hash: location.hash };
  const node = await view.render({ params });
  clear(shell.content).append(node);
  window.scrollTo(0, 0);
}

async function rerender() {
  if (!current || !shell) return;
  applyTheme();
  renderNav();
  if (current.view.keepOnChange) { current.view.onStoreChange?.(); return; }
  destroyCharts();
  hideTip();
  const y = window.scrollY;
  const node = await current.view.render({ params: parseHash().params });
  clear(shell.content).append(node);
  window.scrollTo(0, y);
}

let started = false;
async function start() {
  try {
    await store.load();
  } catch (e) {
    if (e.status === 401) return renderAuth();
    clear(root).append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h2', null, 'Could not reach the server'), h('p', null, e.message), h('button', { onclick: start }, 'Retry'))));
    return;
  }
  applyTheme();
  buildShell();
  current = null;
  if (!started) {
    started = true;
    window.addEventListener('hashchange', () => route());
    store.onChange(debounce(rerender, 30));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => rerender());
  }
  await route(true);
}

start();
