import { h } from '../util.js';
import { store, TYPES, TYPE_COLOR } from '../store.js';
import { card, pageHead, openRecord, resolveColor, cssVar, empty } from '../ui.js';

const hidden = new Set();
let showIsolated = false;
let raf = null;

function buildGraph() {
  const nodes = [];
  const index = new Map();
  for (const t of store.schema.linkable) {
    if (hidden.has(t)) continue;
    for (const r of store.list(t)) {
      const n = { id: `${t}:${r.id}`, type: t, item: r, label: store.title(t, r), deg: 0, x: 0, y: 0, vx: 0, vy: 0 };
      index.set(n.id, n);
      nodes.push(n);
    }
  }
  const edges = [];
  for (const l of store.links) {
    const a = index.get(`${l.from_type}:${l.from_id}`);
    const b = index.get(`${l.to_type}:${l.to_id}`);
    if (a && b) edges.push({ a, b, label: l.label });
  }
  // implicit edges: [[wiki links]] between notes
  const byTitle = new Map(store.list('notes').map((n) => [n.title.toLowerCase(), n]));
  for (const n of store.list('notes')) {
    for (const m of (n.body || '').matchAll(/\[\[([^\]]+)\]\]/g)) {
      const t = byTitle.get(m[1].toLowerCase());
      const a = index.get(`notes:${n.id}`);
      const b = t && index.get(`notes:${t.id}`);
      if (a && b && a !== b) edges.push({ a, b, label: 'mentions', implicit: true });
    }
  }
  for (const e of edges) { e.a.deg++; e.b.deg++; }
  const shown = showIsolated ? nodes : nodes.filter((n) => n.deg > 0);
  const R = Math.sqrt(shown.length) * 40 + 60;
  shown.forEach((n, i) => { const a = (i / shown.length) * Math.PI * 2; n.x = Math.cos(a) * R * (0.5 + Math.random() * 0.5); n.y = Math.sin(a) * R * (0.5 + Math.random() * 0.5); });
  return { nodes: shown, edges: edges.filter((e) => shown.includes(e.a) && shown.includes(e.b)), total: nodes.length };
}

function mountCanvas(canvas, g) {
  const ctx = canvas.getContext('2d');
  let w = 0; let hgt = 0; let dpr = 1;
  const view = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let hover = null;
  let drag = null;
  let pan = null;
  const colors = {};
  for (const t of Object.keys(TYPE_COLOR)) colors[t] = resolveColor(TYPE_COLOR[t]);
  const ink = cssVar('--ink'); const ink2 = cssVar('--ink-2'); const grid = cssVar('--axis'); const surface = cssVar('--surface');
  const radius = (n) => 5 + Math.sqrt(n.deg) * 3;
  const neighbors = new Map(g.nodes.map((n) => [n, new Set()]));
  for (const e of g.edges) { neighbors.get(e.a).add(e.b); neighbors.get(e.b).add(e.a); }

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = r.width; hgt = r.height;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const tick = () => {
    if (alpha > 0.005) {
      const N = g.nodes;
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const a = N[i]; const b = N[j];
          let dx = b.x - a.x; let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random(); dy = Math.random(); d2 = 1; }
          const f = (900 * alpha) / d2;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d;
          a.vx -= dx * f * 10; a.vy -= dy * f * 10; b.vx += dx * f * 10; b.vy += dy * f * 10;
        }
      }
      for (const e of g.edges) {
        const dx = e.b.x - e.a.x; const dy = e.b.y - e.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 90) * 0.04 * alpha;
        e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f; e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
      }
      for (const n of N) {
        n.vx -= n.x * 0.01 * alpha; n.vy -= n.y * 0.01 * alpha;
        if (n === drag?.node) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.6; n.vy *= 0.6;
        n.x += n.vx; n.y += n.vy;
      }
      alpha *= 0.985;
    }
    draw();
    raf = requestAnimationFrame(tick);
  };

  const toScreen = (n) => [(n.x * view.k) + w / 2 + view.x, (n.y * view.k) + hgt / 2 + view.y];
  const toWorld = (sx, sy) => [(sx - w / 2 - view.x) / view.k, (sy - hgt / 2 - view.y) / view.k];

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const focus = hover ? neighbors.get(hover) : null;
    for (const e of g.edges) {
      const on = !hover || e.a === hover || e.b === hover;
      const [x1, y1] = toScreen(e.a); const [x2, y2] = toScreen(e.b);
      ctx.strokeStyle = on && hover ? ink2 : grid;
      ctx.globalAlpha = on ? 1 : 0.25;
      ctx.lineWidth = on && hover ? 1.5 : 1;
      ctx.setLineDash(e.implicit ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (hover && on && e.label && view.k > 0.6) {
        ctx.setLineDash([]);
        ctx.fillStyle = ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(e.label, (x1 + x2) / 2, (y1 + y2) / 2 - 4);
      }
    }
    ctx.setLineDash([]);
    for (const n of g.nodes) {
      const [x, y] = toScreen(n);
      const on = !hover || n === hover || focus.has(n);
      ctx.globalAlpha = on ? 1 : 0.2;
      const r = radius(n) * Math.min(1.6, Math.max(0.7, view.k));
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = colors[n.type]; ctx.fill();
      if (on && (n === hover || (focus && focus.has(n)) || n.deg >= 2 || view.k > 1.3 || g.nodes.length < 25)) {
        ctx.fillStyle = n === hover ? ink : ink2;
        ctx.font = `${n === hover ? 600 : 400} 12px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const label = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        ctx.fillText(label, x, y + r + 14);
      }
    }
    ctx.globalAlpha = 1;
  }

  const pick = (sx, sy) => {
    for (let i = g.nodes.length - 1; i >= 0; i--) {
      const n = g.nodes[i];
      const [x, y] = toScreen(n);
      const r = radius(n) * Math.min(1.6, Math.max(0.7, view.k)) + 6;
      if ((sx - x) ** 2 + (sy - y) ** 2 <= r * r) return n;
    }
    return null;
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    const [sx, sy] = local(e);
    const n = pick(sx, sy);
    canvas.setPointerCapture(e.pointerId);
    if (n) drag = { node: n, moved: false };
    else pan = { sx, sy, x: view.x, y: view.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    if (drag) {
      const [wx, wy] = toWorld(sx, sy);
      drag.node.x = wx; drag.node.y = wy; drag.moved = true;
      alpha = Math.max(alpha, 0.3);
    } else if (pan) {
      view.x = pan.x + (sx - pan.sx); view.y = pan.y + (sy - pan.sy);
    } else {
      hover = pick(sx, sy);
      canvas.style.cursor = hover ? 'pointer' : 'grab';
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (drag && !drag.moved) openRecord(drag.node.type, drag.node.item);
    drag = null; pan = null;
  });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    const [wx, wy] = toWorld(sx, sy);
    view.k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    view.x = sx - w / 2 - wx * view.k; view.y = sy - hgt / 2 - wy * view.k;
  }, { passive: false });

  if (raf) cancelAnimationFrame(raf);
  tick();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

let cleanup = null;

export default {
  unmount() { if (cleanup) cleanup(); cleanup = null; },
  render() {
    if (cleanup) cleanup();
    const g = buildGraph();
    const canvas = h('canvas', { class: 'graph-canvas', role: 'img', 'aria-label': `Network of ${g.nodes.length} records and ${g.edges.length} connections` });
    const legend = h('div', { class: 'legend' }, store.schema.linkable.map((t) => h('span', { class: hidden.has(t) ? 'off' : '', role: 'button', tabindex: 0, onclick: () => { if (hidden.has(t)) hidden.delete(t); else hidden.add(t); store.emit(); } },
      h('i', { class: 'dot', style: { background: TYPE_COLOR[t] } }), `${TYPES[t].label} (${store.list(t).length})`)));
    requestAnimationFrame(() => { if (canvas.isConnected) cleanup = mountCanvas(canvas, g); });
    const linkCounts = new Map();
    for (const l of store.links) for (const k of [`${l.from_type}:${l.from_id}`, `${l.to_type}:${l.to_id}`]) linkCounts.set(k, (linkCounts.get(k) || 0) + 1);
    const hubs = [...linkCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => { const [t, id] = k.split(':'); return { t, item: store.get(t, Number(id)), n }; }).filter((x) => x.item);

    return h('div', { style: { display: 'contents' } },
      pageHead('Connections', 'Every person, skill, goal, exam, note, project and tracker — and how they relate. Drag nodes, scroll to zoom, click to open. Dashed lines are [[wiki links]] between notes.',
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showIsolated, onchange: (e) => { showIsolated = e.target.checked; store.emit(); } }), 'Show unconnected records')),
      legend,
      g.nodes.length ? canvas : card(null, null, empty(g.total ? 'Nothing is connected yet. Open any record and use “Connections” to link it — e.g. a mentor to a skill, a note to an exam.' : 'Add some records first.')),
      hubs.length ? card('Most connected', 'your hubs', h('div', { class: 'row' }, hubs.map((x) => h('span', { class: 'chip link', onclick: () => openRecord(x.t, x.item) }, h('span', { class: 'dot', style: { background: TYPE_COLOR[x.t] } }), `${store.title(x.t, x.item)} · ${x.n}`)))) : null);
  },
};
