import { h, download } from '../util.js';
import { api, store, DEFAULT_SETTINGS } from '../store.js';
import { card, pageHead, guard, confirmBox, toast } from '../ui.js';
import { WIDGETS } from './dashboard.js';
import { loadSample } from '../sample.js';

const MODULE_LABELS = {
  career: 'Career', goals: 'Goals', skills: 'Skills', exams: 'Exams', workouts: 'Workouts', notes: 'Notes', sketch: 'Sketch pad', people: 'People',
  graph: 'Connections graph', wellbeing: 'Wellbeing', finance: 'Finance', trackers: 'Custom trackers', swot: 'SWOT', analysis: 'Analysis', leaderboards: 'Leaderboards',
};
const TARGETS = {
  study_hours_30d: ['Study hours per 30 days', 'h'], workout_min_30d: ['Workout minutes per 30 days', 'min'], sleep: ['Sleep per night', 'h'],
  savings_rate: ['Savings rate', '%'], contacts_30d: ['Social interactions per 30 days', ''],
};
const TABS = [['profile', 'Profile'], ['appearance', 'Appearance'], ['dashboard', 'Dashboard'], ['modules', 'Modules'], ['targets', 'Targets'], ['data', 'Data'], ['account', 'Account']];

function profile() {
  const u = store.user;
  const name = h('input', { value: u.display_name, maxLength: 80 });
  const headline = h('input', { value: u.headline, maxLength: 200, placeholder: 'e.g. CS graduate · Full-stack developer · Competitive programmer' });
  const bio = h('textarea', { rows: 5, maxLength: 5000, placeholder: 'A short summary about you' }, u.bio);
  return card('Profile', `@${u.username}`, h('div', { class: 'form-grid' },
    h('label', { class: 'field' }, h('span', null, 'Display name (shown on leaderboards)'), name),
    h('label', { class: 'field' }, h('span', null, 'Headline'), headline),
    h('label', { class: 'field wide' }, h('span', null, 'About'), bio)),
  h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: () => guard(() => store.saveProfile({ display_name: name.value, headline: headline.value, bio: bio.value }), 'Profile saved') }, 'Save profile')));
}

function appearance(s) {
  const seg = h('div', { class: 'seg' }, ['system', 'light', 'dark'].map((t) => h('button', { class: s.theme === t ? 'active' : '', onclick: () => guard(() => store.saveSettings({ theme: t })) }, t[0].toUpperCase() + t.slice(1))));
  const accents = ['#2a78d6', '#6250d6', '#1baf7a', '#008300', '#eb6834', '#e34948', '#d55181', '#0b0b0b'];
  const currency = h('input', { value: s.currency, maxLength: 4, style: { width: '80px' } });
  return card('Appearance', null,
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, 'Theme'), seg),
      h('label', { class: 'field' }, h('span', null, 'Accent colour'), h('div', { class: 'row', style: { gap: '4px' } },
        accents.map((c) => h('button', { class: `swatch ${s.accent === c ? 'active' : ''}`, style: { background: c }, 'aria-label': `Accent ${c}`, onclick: () => guard(() => store.saveSettings({ accent: c })) })),
        h('input', { type: 'color', value: s.accent, 'aria-label': 'Custom accent', onchange: (e) => guard(() => store.saveSettings({ accent: e.target.value })) }))),
      h('label', { class: 'field' }, h('span', null, 'Currency symbol'), h('div', { class: 'row' }, currency, h('button', { onclick: () => guard(() => store.saveSettings({ currency: currency.value }), 'Saved') }, 'Save')))));
}

function dashboard(s) {
  const order = [...s.widgets.filter((w) => WIDGETS[w]), ...Object.keys(WIDGETS).filter((w) => !s.widgets.includes(w))];
  const move = (i, d) => { const o = [...order]; const [x] = o.splice(i, 1); o.splice(i + d, 0, x); guard(() => store.saveSettings({ widgets: o })); };
  return card('Dashboard widgets', 'show, hide and reorder', h('div', null, order.map((w, i) => h('div', { class: 'widget-row' },
    h('input', { type: 'checkbox', checked: !s.hiddenWidgets.includes(w), 'aria-label': `Show ${WIDGETS[w].label}`, onchange: (e) => guard(() => store.saveSettings({ widgets: order, hiddenWidgets: e.target.checked ? s.hiddenWidgets.filter((x) => x !== w) : [...s.hiddenWidgets, w] })) }),
    h('span', { class: 'grow' }, WIDGETS[w].label),
    h('button', { class: 'sm', disabled: i === 0, 'aria-label': 'Move up', onclick: () => move(i, -1) }, '↑'),
    h('button', { class: 'sm', disabled: i === order.length - 1, 'aria-label': 'Move down', onclick: () => move(i, 1) }, '↓')))),
  h('button', { class: 'sm', style: { marginTop: '10px' }, onclick: () => guard(() => store.saveSettings({ widgets: DEFAULT_SETTINGS.widgets, hiddenWidgets: [] }), 'Reset') }, 'Reset to default'));
}

function modules(s) {
  return card('Modules', 'turn off the parts of LifeOS you don’t use', h('div', { class: 'form-grid' }, Object.entries(MODULE_LABELS).map(([k, l]) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: s.modules[k] !== false, onchange: (e) => guard(() => store.saveSettings({ modules: { ...s.modules, [k]: e.target.checked } })) }), l))));
}

function targets(s) {
  const inputs = {};
  return card('Targets', 'used for life-balance scores, insights and SWOT', h('div', { class: 'form-grid' }, Object.entries(TARGETS).map(([k, [l, u]]) => {
    inputs[k] = h('input', { type: 'number', step: 'any', min: 0, value: s.targets[k] });
    return h('label', { class: 'field' }, h('span', null, `${l}${u ? ` (${u})` : ''}`), inputs[k]);
  })), h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', {
    class: 'primary',
    onclick: () => {
      const t = {};
      for (const [k, el] of Object.entries(inputs)) t[k] = Math.max(0.1, Number(el.value) || DEFAULT_SETTINGS.targets[k]);
      guard(() => store.saveSettings({ targets: t }), 'Targets saved');
    },
  }, 'Save targets')));
}

function data() {
  const file = h('input', { type: 'file', accept: 'application/json,.json' });
  const mode = h('select', null, h('option', { value: 'merge' }, 'Merge into my data'), h('option', { value: 'replace' }, 'Replace all my data'));
  const applyProfile = h('input', { type: 'checkbox', checked: true });
  return card('Your data', 'everything is private to your account', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
    h('div', null, h('h3', null, 'Export'), h('p', { class: 'small ink2' }, 'Download a complete JSON backup — every record, sketch and connection.'),
      h('button', { onclick: async () => { const d = await guard(() => api('GET', '/api/export')); if (d) download(`lifeos-${store.user.username}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2)); } }, 'Download backup')),
    h('div', null, h('h3', null, 'Import'), h('p', { class: 'small ink2' }, 'Restore a backup or load a profile file (for example seed/himanshu.json in the repo).'),
      h('div', { class: 'row' }, file, mode, h('label', { class: 'check' }, applyProfile, 'Also apply name / headline / bio'),
        h('button', {
          class: 'primary',
          onclick: async () => {
            const f = file.files[0];
            if (!f) return toast('Choose a JSON file first', 'error');
            let payload;
            try { payload = JSON.parse(await f.text()); } catch { return toast('That file is not valid JSON', 'error'); }
            if (mode.value === 'replace' && !(await confirmBox('Replace ALL your current data with this file?', 'Replace'))) return;
            const r = await guard(() => importInParts(payload, mode.value, applyProfile.checked));
            if (r) { await store.load(); toast(`Imported ${Object.values(r.counts).reduce((a, b) => a + b, 0)} records`); }
          },
        }, 'Import'))),
    h('div', null, h('h3', null, 'Sample data'), h('p', { class: 'small ink2' }, 'Explore every chart with 90 days of realistic demo data.'), h('button', { onclick: () => loadSample() }, 'Add sample data')),
    h('div', null, h('h3', null, 'Erase'), h('p', { class: 'small ink2' }, 'Delete every record in your account but keep the account itself.'),
      h('button', { class: 'danger', onclick: async () => { if (!(await confirmBox('Erase ALL your data? Download a backup first if unsure. This cannot be undone.', 'Erase everything'))) return; await guard(async () => { await api('POST', '/api/import', { payload: { data: {} }, mode: 'replace' }); await store.load(); }, 'All data erased'); } }, 'Erase all my data'))));
}

function account() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minLength: 8 });
  const del = h('input', { type: 'password', autocomplete: 'current-password' });
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
    card('Change password', null, h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, 'Current password'), cur),
      h('label', { class: 'field' }, h('span', null, 'New password (8+ characters)'), next)),
    h('button', { class: 'primary', style: { marginTop: '12px' }, onclick: async () => { const ok = await guard(() => api('PUT', '/api/me/password', { current: cur.value, next: next.value }), 'Password changed — other sessions were signed out'); if (ok) { cur.value = ''; next.value = ''; } } }, 'Change password')),
    card('Delete account', null, h('p', { class: 'small ink2' }, 'Permanently deletes your account, all data and leaderboard memberships.'),
      h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', null, 'Confirm with your password'), del),
        h('button', { class: 'danger', style: { alignSelf: 'flex-end' }, onclick: async () => {
          if (!(await confirmBox('Delete your account forever?', 'Delete account'))) return;
          const ok = await guard(() => api('DELETE', '/api/me', { password: del.value }));
          if (ok) location.reload();
        } }, 'Delete my account'))));
}

// Hosts like Vercel cap request bodies (~4.5 MB), so sketch images travel one per request.
async function importInParts(payload, mode, applyProfile) {
  const sketches = (payload.data && Array.isArray(payload.data.sketches)) ? payload.data.sketches : [];
  const images = new Map(sketches.map((sk) => [sk.id, { data: sk.data, thumb: sk.thumb }]));
  const light = { ...payload, data: { ...(payload.data || {}), sketches: sketches.map(({ data: _d, thumb: _t, ...rest }) => rest) } };
  const r = await api('POST', '/api/import', { payload: light, mode, applyProfile });
  for (const [oldId, img] of images) {
    const newId = r.ids && r.ids.sketches && r.ids.sketches[oldId];
    if (newId && (img.data || img.thumb)) await api('PUT', `/api/sketches/${newId}`, { data: img.data ?? null, thumb: img.thumb ?? null });
  }
  return r;
}

let tab = 'profile';

export default {
  render({ params }) {
    tab = params.get('tab') || tab;
    const s = store.settings();
    const body = { profile, appearance, dashboard, modules, targets, data, account }[tab] || profile;
    return h('div', { style: { display: 'contents' } },
      pageHead('Settings', 'Make LifeOS yours.'),
      h('div', { class: 'seg', style: { flexWrap: 'wrap', alignSelf: 'flex-start' } }, TABS.map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; location.hash = `#/settings?tab=${k}`; } }, l))),
      body(s));
  },
};
