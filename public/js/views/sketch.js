import { h, clear, fmtDate } from '../util.js';
import { store } from '../store.js';
import { card, empty, pageHead, guard, confirmBox, linksSection, toast } from '../ui.js';

const W = 1600;
const H = 1000;
const COLORS = ['#0b0b0b', '#52514e', '#2a78d6', '#e34948', '#1baf7a', '#eda100', '#6250d6', '#e87ba4'];
const TOOLS = [['pen', '✎ Pen'], ['marker', '▬ Highlighter'], ['eraser', '⌫ Eraser'], ['line', '╱ Line'], ['rect', '▭ Box'], ['ellipse', '◯ Circle'], ['text', 'T Text']];

let state = { tool: 'pen', color: COLORS[0], size: 4, id: null, title: 'Untitled sketch', dirty: false };
let undo = [];
let redo = [];
let galleryEl;
let linksEl;
let canvas;
let ctx;

function snapshot() {
  undo.push(ctx.getImageData(0, 0, W, H));
  if (undo.length > 30) undo.shift();
  redo = [];
}
function restore(from, to) {
  if (!from.length) return;
  to.push(ctx.getImageData(0, 0, W, H));
  ctx.putImageData(from.pop(), 0, 0);
  state.dirty = true;
}
function blank() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
}

function setupCanvas() {
  canvas = h('canvas', { class: 'sketch-canvas', width: W, height: H, 'aria-label': 'Sketch canvas' });
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  blank();
  let drawing = false;
  let start = null;
  let base = null;
  let last = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, p: e.pressure || 0.5 };
  };
  const stroke = () => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = state.tool === 'marker' ? 0.3 : 1;
    ctx.strokeStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
    ctx.lineWidth = state.tool === 'marker' ? state.size * 4 : state.tool === 'eraser' ? state.size * 5 : state.size;
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = pos(e);
    if (state.tool === 'text') {
      const text = prompt('Text to place:');
      if (!text) return;
      snapshot();
      ctx.globalAlpha = 1;
      ctx.fillStyle = state.color;
      ctx.font = `${Math.max(16, state.size * 6)}px system-ui, sans-serif`;
      ctx.fillText(text, p.x, p.y);
      state.dirty = true;
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    snapshot();
    drawing = true;
    start = p;
    last = p;
    if (['line', 'rect', 'ellipse', 'marker'].includes(state.tool)) base = ctx.getImageData(0, 0, W, H);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    stroke();
    if (state.tool === 'pen' || state.tool === 'eraser') {
      const pts = e.getCoalescedEvents ? e.getCoalescedEvents().map(pos) : [p];
      for (const q of pts) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(q.x, q.y);
        if (state.tool === 'pen' && e.pointerType === 'pen') ctx.lineWidth = state.size * (0.4 + q.p * 1.2);
        ctx.stroke();
        last = q;
      }
    } else if (state.tool === 'marker') {
      // redraw whole marker path from base so overlapping segments don't darken
      ctx.putImageData(base, 0, 0);
      (canvas._path ||= [start]).push(p);
      stroke();
      ctx.beginPath();
      canvas._path.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    } else {
      ctx.putImageData(base, 0, 0);
      stroke();
      ctx.beginPath();
      if (state.tool === 'line') { ctx.moveTo(start.x, start.y); ctx.lineTo(p.x, p.y); }
      if (state.tool === 'rect') ctx.rect(start.x, start.y, p.x - start.x, p.y - start.y);
      if (state.tool === 'ellipse') ctx.ellipse((start.x + p.x) / 2, (start.y + p.y) / 2, Math.abs(p.x - start.x) / 2, Math.abs(p.y - start.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    state.dirty = true;
  });
  const end = () => { drawing = false; base = null; canvas._path = null; ctx.globalAlpha = 1; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function thumb() {
  const t = document.createElement('canvas');
  t.width = 320;
  t.height = 200;
  t.getContext('2d').drawImage(canvas, 0, 0, 320, 200);
  return t.toDataURL('image/jpeg', 0.7);
}

async function save(titleIn) {
  state.title = titleIn.value.trim() || 'Untitled sketch';
  let data = canvas.toDataURL('image/png');
  // keep each save under hosting request limits (~4.5 MB on Vercel)
  if (data.length > 3000000) data = canvas.toDataURL('image/jpeg', 0.9);
  if (data.length > 3000000) data = canvas.toDataURL('image/jpeg', 0.7);
  const values = { title: state.title, data, thumb: thumb() };
  const row = await guard(() => (state.id ? store.update('sketches', state.id, values, { silent: true }) : store.create('sketches', values, { silent: true })), 'Sketch saved');
  if (row) {
    state.id = row.id;
    state.dirty = false;
    history.replaceState(null, '', `#/sketch?id=${row.id}`);
    renderGallery();
    renderLinks();
  }
}

async function load(id) {
  const row = await guard(() => store.fetchFull('sketches', id));
  if (!row) return;
  const img = new Image();
  img.onload = () => { blank(); ctx.drawImage(img, 0, 0, W, H); undo = []; redo = []; state.dirty = false; };
  if (row.data) img.src = row.data;
  else { blank(); }
  state.id = row.id;
  state.title = row.title;
  const t = document.getElementById('sketch-title');
  if (t) t.value = row.title;
  renderGallery();
  renderLinks();
}

function renderGallery() {
  if (!galleryEl) return;
  clear(galleryEl);
  const list = [...store.list('sketches')].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  galleryEl.append(list.length ? h('div', { class: 'gallery' }, list.map((s) => h('div', { class: 'mini', style: s.id === state.id ? { borderColor: 'var(--accent)' } : null, onclick: async () => {
    if (state.dirty && !(await confirmBox('Discard unsaved changes to the current sketch?', 'Discard'))) return;
    history.replaceState(null, '', `#/sketch?id=${s.id}`);
    load(s.id);
  } }, s.thumb ? h('img', { src: s.thumb, alt: s.title }) : null, h('div', { class: 'small', style: { fontWeight: 600 } }, s.title), h('div', { class: 'small muted' }, fmtDate(String(s.updated_at).slice(0, 10)))))) : empty('Saved sketches appear here.'));
}

function renderLinks() {
  if (!linksEl) return;
  clear(linksEl);
  const s = state.id && store.get('sketches', state.id);
  if (s) linksEl.append(card(null, null, linksSection('sketches', s)));
}

export default {
  keepOnChange: true,
  onStoreChange() { renderGallery(); },
  unmount() { galleryEl = null; linksEl = null; },
  render({ params }) {
    state = { ...state, id: null, title: 'Untitled sketch', dirty: false };
    undo = [];
    redo = [];
    setupCanvas();
    galleryEl = h('div');
    linksEl = h('div');
    renderGallery();
    const titleIn = h('input', { id: 'sketch-title', value: state.title, 'aria-label': 'Sketch title', style: { minWidth: '200px', flex: 1 } });
    const toolsBox = h('div', { class: 'seg' });
    const drawTools = () => { clear(toolsBox).append(...TOOLS.map(([k, l]) => h('button', { class: state.tool === k ? 'active' : '', onclick: () => { state.tool = k; drawTools(); } }, l))); };
    drawTools();
    const swatches = h('div', { class: 'row', style: { gap: '4px' } });
    const custom = h('input', { type: 'color', value: state.color, 'aria-label': 'Custom colour', oninput: (e) => { state.color = e.target.value; drawSw(); } });
    const drawSw = () => { clear(swatches).append(...COLORS.map((c) => h('button', { class: `swatch ${state.color === c ? 'active' : ''}`, style: { background: c }, 'aria-label': `Colour ${c}`, onclick: () => { state.color = c; drawSw(); } })), custom); };
    drawSw();
    const size = h('input', { type: 'range', min: 1, max: 30, value: state.size, 'aria-label': 'Brush size', oninput: (e) => { state.size = Number(e.target.value); } });
    const id = Number(params.get('id'));
    if (id) setTimeout(() => load(id), 0);
    const keys = (e) => {
      if (!canvas.isConnected) { document.removeEventListener('keydown', keys); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) restore(redo, undo); else restore(undo, redo); }
    };
    document.addEventListener('keydown', keys);

    return h('div', { style: { display: 'contents' } },
      pageHead('Sketch pad', 'Draw diagrams, mind maps and ideas. Works with mouse, touch and stylus (pressure-sensitive pen).'),
      card(null, null, h('div', { class: 'sketch-wrap' },
        h('div', { class: 'sketch-tools' }, titleIn,
          h('button', { onclick: async () => { if (state.dirty && !(await confirmBox('Start a new sketch? Unsaved changes will be lost.', 'New sketch'))) return; history.replaceState(null, '', '#/sketch'); state.id = null; state.dirty = false; titleIn.value = 'Untitled sketch'; blank(); undo = []; redo = []; renderGallery(); renderLinks(); } }, 'New'),
          h('button', { class: 'primary', onclick: () => save(titleIn) }, 'Save'),
          h('button', { onclick: () => { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `${titleIn.value || 'sketch'}.png`; a.click(); } }, 'Download PNG'),
          h('button', { class: 'danger', onclick: async () => { if (state.id && await confirmBox('Delete this sketch?')) { await guard(() => store.remove('sketches', state.id), 'Deleted'); state.id = null; blank(); history.replaceState(null, '', '#/sketch'); renderGallery(); renderLinks(); } else if (!state.id) toast('Not saved yet'); } }, 'Delete')),
        h('div', { class: 'sketch-tools' }, toolsBox, swatches, h('label', { class: 'row small ink2' }, 'Size', size),
          h('button', { onclick: () => restore(undo, redo), title: 'Undo (Ctrl+Z)' }, '↶ Undo'),
          h('button', { onclick: () => restore(redo, undo), title: 'Redo (Ctrl+Shift+Z)' }, '↷ Redo'),
          h('button', { onclick: () => { snapshot(); blank(); state.dirty = true; } }, 'Clear')),
        canvas)),
      linksEl,
      card('Gallery', null, galleryEl));
  },
};
