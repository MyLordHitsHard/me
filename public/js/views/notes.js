import { h, clear, markdown, debounce, fmtDate } from '../util.js';
import { store } from '../store.js';
import { card, empty, pageHead, guard, confirmBox, linksSection, linkChip } from '../ui.js';

let sel = null;
let preview = false;
let q = '';
let tag = '';
let listEl;
let editorEl;

const tagsOf = (n) => (n.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

function sorted() {
  return [...store.list('notes')]
    .filter((n) => (!q || `${n.title} ${n.body || ''} ${n.tags || ''}`.toLowerCase().includes(q)) && (!tag || tagsOf(n).includes(tag)))
    .sort((a, b) => (b.pinned - a.pinned) || String(b.updated_at).localeCompare(String(a.updated_at)));
}

function renderList() {
  if (!listEl) return;
  clear(listEl);
  const notes = sorted();
  const allTags = [...new Set(store.list('notes').flatMap(tagsOf))].sort();
  listEl.append(
    h('input', { type: 'search', placeholder: 'Search notes…', value: q, style: { width: '100%', marginBottom: '8px' }, oninput: (e) => { q = e.target.value.toLowerCase(); renderListKeepFocus(); } }),
    allTags.length ? h('div', { class: 'row', style: { marginBottom: '8px' } }, allTags.map((t) => h('span', { class: 'chip link', style: t === tag ? { borderColor: 'var(--accent)', color: 'var(--ink)' } : null, onclick: () => { tag = tag === t ? '' : t; renderList(); } }, `#${t}`))) : null,
    notes.length ? h('div', { class: 'list notes-list' }, notes.map((n) => h('div', { class: `list-item ${n.id === sel ? 'sel' : ''}`, onclick: () => { history.replaceState(null, '', `#/notes?id=${n.id}`); select(n.id); } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, n.pinned ? '📌 ' : '', n.title), h('div', { class: 'small muted' }, fmtDate(String(n.updated_at).slice(0, 10)), ' · ', (n.body || '').replace(/\s+/g, ' ').slice(0, 50))))))
      : empty(store.list('notes').length ? 'No matches' : 'No notes yet'),
  );
}
function renderListKeepFocus() {
  renderList();
  const i = listEl.querySelector('input[type=search]');
  i.focus();
  i.setSelectionRange(i.value.length, i.value.length);
}

function select(id) {
  sel = id;
  renderList();
  renderEditor();
}

async function newNote(title = 'Untitled note') {
  const n = await guard(() => store.create('notes', { title, body: '' }, { silent: true }));
  if (!n) return;
  history.replaceState(null, '', `#/notes?id=${n.id}`);
  preview = false;
  select(n.id);
  editorEl.querySelector('input.title')?.select();
}

function renderEditor() {
  if (!editorEl) return;
  clear(editorEl);
  const n = store.get('notes', sel);
  if (!n) { editorEl.append(card(null, null, empty('Select a note or create a new one.', 'New note', () => newNote()))); return; }
  const status = h('span', { class: 'small muted' }, 'Saved');
  const persist = async () => {
    const values = { title: titleIn.value.trim() || 'Untitled note', body: body.value, tags: tagsIn.value };
    const ok = await guard(() => store.update('notes', n.id, values, { silent: true }));
    status.textContent = ok ? 'Saved' : 'Not saved';
    renderList();
  };
  const save = debounce(persist, 700);
  const dirty = () => { status.textContent = 'Saving…'; save(); };
  const titleIn = h('input', { class: 'title', value: n.title, oninput: dirty, 'aria-label': 'Title' });
  const tagsIn = h('input', { value: n.tags || '', placeholder: 'tags, comma separated', oninput: dirty, style: { flex: 1 }, 'aria-label': 'Tags' });
  const body = h('textarea', { oninput: dirty, placeholder: 'Write in Markdown: # heading, **bold**, - lists, - [ ] tasks, [[Other note]] links…', 'aria-label': 'Note body' }, n.body || '');
  const view = h('div', { class: 'md', html: markdown(n.body || '') });
  view.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-wikilink]');
    if (!a) return;
    e.preventDefault();
    const target = store.list('notes').find((x) => x.title.toLowerCase() === a.dataset.wikilink.toLowerCase());
    if (target) { history.replaceState(null, '', `#/notes?id=${target.id}`); select(target.id); } else newNote(a.dataset.wikilink);
  });
  const backlinks = store.list('notes').filter((x) => x.id !== n.id && (x.body || '').toLowerCase().includes(`[[${n.title.toLowerCase()}]]`));
  editorEl.append(card(null, null,
    h('div', { class: 'note-editor', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      titleIn,
      h('div', { class: 'row' },
        tagsIn,
        h('div', { class: 'seg' },
          h('button', { class: preview ? '' : 'active', onclick: () => { preview = false; renderEditor(); } }, 'Write'),
          h('button', { class: preview ? 'active' : '', onclick: async () => { await persist(); preview = true; renderEditor(); } }, 'Preview')),
        h('button', { class: n.pinned ? 'active' : '', onclick: async () => { await guard(() => store.update('notes', n.id, { pinned: !n.pinned }, { silent: true })); renderList(); renderEditor(); } }, n.pinned ? '📌 Pinned' : 'Pin'),
        h('button', { class: 'danger', onclick: async () => { if (await confirmBox(`Delete “${n.title}”?`)) { await guard(() => store.remove('notes', n.id), 'Note deleted'); sel = null; renderList(); renderEditor(); } } }, 'Delete'),
        status),
      preview ? view : body,
      backlinks.length ? h('div', null, h('div', { class: 'section-title' }, 'Backlinks'), h('div', { class: 'row' }, backlinks.map((b) => linkChip('notes', b)))) : null,
      linksSection('notes', n))));
}

export default {
  keepOnChange: true,
  onStoreChange() {
    if (sel && !store.get('notes', sel)) { sel = null; renderEditor(); }
    renderList();
  },
  async render({ params }) {
    listEl = h('div');
    editorEl = h('div');
    const id = Number(params.get('id'));
    if (id && store.get('notes', id)) sel = id;
    else if (!store.get('notes', sel)) sel = sorted()[0]?.id || null;
    const layout = h('div', { style: { display: 'contents' } },
      pageHead('Notes', 'Markdown notes with tags, [[wiki links]], backlinks and connections to anything in your life.',
        h('button', { class: 'primary', onclick: () => newNote() }, '+ New note')),
      h('div', { class: 'notes-layout' }, h('div', null, card(null, null, listEl)), editorEl));
    renderList();
    renderEditor();
    if (params.get('new')) setTimeout(() => newNote(), 0);
    return layout;
  },
};

