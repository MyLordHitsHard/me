// API client + in-memory store of the signed-in user's data.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'x-lifeos': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data;
}

// Display metadata for every record type.
export const TYPES = {
  career: { label: 'Career', single: 'Career item', icon: '◆', route: 'career', title: (r) => r.title },
  skills: { label: 'Skills', single: 'Skill', icon: '★', route: 'skills', title: (r) => r.name },
  goals: { label: 'Goals', single: 'Goal', icon: '◎', route: 'goals', title: (r) => r.title },
  exams: { label: 'Exams', single: 'Exam', icon: '✎', route: 'exams', title: (r) => r.name },
  workouts: { label: 'Workouts', single: 'Workout', icon: '♥', route: 'workouts', title: (r) => r.title || `${r.type} · ${r.date}` },
  notes: { label: 'Notes', single: 'Note', icon: '≡', route: 'notes', title: (r) => r.title },
  sketches: { label: 'Sketches', single: 'Sketch', icon: '✐', route: 'sketch', title: (r) => r.title },
  people: { label: 'People', single: 'Person', icon: '☺', route: 'people', title: (r) => r.name },
  trackers: { label: 'Trackers', single: 'Tracker', icon: '▦', route: 'trackers', title: (r) => r.name },
  checkins: { single: 'Check-in', title: (r) => `Check-in ${r.date}` },
  transactions: { single: 'Transaction', title: (r) => `${r.kind} ${r.amount}` },
  swot_items: { single: 'SWOT item', title: (r) => r.text },
  skill_logs: { single: 'Practice log', title: (r) => r.date },
  study_sessions: { single: 'Study session', title: (r) => r.date },
  workout_sets: { single: 'Exercise', title: (r) => r.exercise },
  interactions: { single: 'Interaction', title: (r) => r.date },
  tracker_logs: { single: 'Tracker entry', title: (r) => r.date },
};

// Fixed categorical slot per linkable type (colour follows the entity, never rank).
export const TYPE_COLOR = {
  people: 'var(--s1)', skills: 'var(--s2)', goals: 'var(--s3)', exams: 'var(--s4)',
  notes: 'var(--s5)', workouts: 'var(--s6)', career: 'var(--s7)', trackers: 'var(--s8)', sketches: 'var(--muted)',
};

export const DEFAULT_SETTINGS = {
  theme: 'system',
  accent: '#2a78d6',
  currency: '₹',
  modules: {
    career: true, goals: true, skills: true, exams: true, workouts: true, notes: true, sketch: true,
    people: true, graph: true, wellbeing: true, finance: true, trackers: true, swot: true, analysis: true, leaderboards: true,
  },
  widgets: ['kpis', 'balance', 'upcoming', 'insights', 'workoutWeekly', 'studyWeekly', 'skills', 'mood', 'goals', 'notes'],
  hiddenWidgets: [],
  targets: { study_hours_30d: 30, workout_min_30d: 600, sleep: 7.5, savings_rate: 20, contacts_30d: 8 },
};

export const store = {
  user: null,
  schema: null,
  data: {},
  links: [],
  listeners: new Set(),

  settings() {
    const s = (this.user && this.user.settings) || {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      modules: { ...DEFAULT_SETTINGS.modules, ...(s.modules || {}) },
      targets: { ...DEFAULT_SETTINGS.targets, ...(s.targets || {}) },
      widgets: s.widgets || DEFAULT_SETTINGS.widgets,
      hiddenWidgets: s.hiddenWidgets || [],
    };
  },

  async load() {
    const [schema, boot] = await Promise.all([
      this.schema ? Promise.resolve(this.schema) : api('GET', '/api/schema'),
      api('GET', '/api/bootstrap'),
    ]);
    this.schema = schema;
    this.user = boot.user;
    this.data = boot.data;
    this.links = boot.links;
    this.emit();
  },

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) fn(); },

  list(type) { return this.data[type] || []; },
  get(type, id) { return this.list(type).find((r) => r.id === Number(id)) || null; },
  title(type, r) { return r ? (TYPES[type]?.title(r) || `#${r.id}`) : '(deleted)'; },

  async create(type, values, { silent } = {}) {
    const row = await api('POST', `/api/${type}`, values);
    this.data[type] = [...this.list(type), row];
    if (!silent) this.emit();
    return row;
  },
  async update(type, id, values, { silent } = {}) {
    const row = await api('PUT', `/api/${type}/${id}`, values);
    this.data[type] = this.list(type).map((r) => (r.id === id ? row : r));
    if (!silent) this.emit();
    return row;
  },
  async remove(type, id) {
    await api('DELETE', `/api/${type}/${id}`);
    // Server cascades children & links; mirror that locally by reloading.
    await this.load();
  },
  async fetchFull(type, id) { return api('GET', `/api/${type}/${id}`); },

  async link(fromType, fromId, toType, toId, label) {
    const l = await api('POST', '/api/links', { from_type: fromType, from_id: fromId, to_type: toType, to_id: toId, label });
    this.links = [...this.links, l];
    this.emit();
    return l;
  },
  async unlink(id) {
    await api('DELETE', `/api/links/${id}`);
    this.links = this.links.filter((l) => l.id !== id);
    this.emit();
  },
  linksOf(type, id) {
    const out = [];
    for (const l of this.links) {
      if (l.from_type === type && l.from_id === id) out.push({ link: l, type: l.to_type, item: this.get(l.to_type, l.to_id) });
      else if (l.to_type === type && l.to_id === id) out.push({ link: l, type: l.from_type, item: this.get(l.from_type, l.from_id) });
    }
    return out.filter((x) => x.item);
  },

  async saveSettings(patch) {
    const settings = { ...this.settings(), ...patch };
    this.user = await api('PUT', '/api/me', { settings });
    this.emit();
  },
  async saveProfile(values) {
    this.user = await api('PUT', '/api/me', values);
    this.emit();
  },
};
