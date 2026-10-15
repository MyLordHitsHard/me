import { h } from '../util.js';
import { store } from '../store.js';
import { card, pageHead, guard, openRecord, linkChip } from '../ui.js';
import { swotAuto } from '../analytics.js';

const Q = {
  S: { title: 'Strengths', hint: 'Internal · helpful', color: 'var(--s3)' },
  W: { title: 'Weaknesses', hint: 'Internal · harmful', color: 'var(--s2)' },
  O: { title: 'Opportunities', hint: 'External · helpful', color: 'var(--s1)' },
  T: { title: 'Threats', hint: 'External · harmful', color: 'var(--s8)' },
};

export default {
  render() {
    const auto = swotAuto(store, store.settings().targets);
    const manual = store.list('swot_items');
    const quad = (k) => {
      const input = h('input', { placeholder: `Add ${{ S: 'a strength', W: 'a weakness', O: 'an opportunity', T: 'a threat' }[k]}…`, style: { flex: 1 } });
      const add = async () => {
        if (!input.value.trim()) return;
        await guard(() => store.create('swot_items', { quadrant: k, text: input.value.trim() }));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const mine = manual.filter((m) => m.quadrant === k);
      return h('div', { class: 'q', style: { borderTop: `3px solid ${Q[k].color}` } },
        h('h2', null, h('span', { class: 'badge', style: { background: Q[k].color } }, k), Q[k].title, h('span', { class: 'small muted', style: { fontWeight: 400, marginLeft: 'auto' } }, Q[k].hint)),
        h('ul', null,
          mine.map((m) => h('li', null, m.text, ' ', h('button', { class: 'sm ghost danger', 'aria-label': 'Remove', onclick: () => guard(() => store.remove('swot_items', m.id)) }, '✕'))),
          auto[k].map((a) => h('li', { class: 'auto' }, a.text, ' ', a.item ? linkChip(a.type, a.item) : null))),
        !mine.length && !auto[k].length ? h('p', { class: 'small muted' }, 'Nothing yet — add your own, or log more data for automatic suggestions.') : null,
        h('div', { class: 'row', style: { marginTop: '10px' } }, input, h('button', { class: 'sm', onclick: add }, 'Add')));
    };
    const first = (k) => [...manual.filter((m) => m.quadrant === k).map((m) => m.text), ...auto[k].map((a) => a.text)][0];
    const s = first('S'); const w = first('W'); const o = first('O'); const t = first('T');
    const strategies = [
      s && o ? ['SO · Attack', `Use “${s}” to capture “${o}”.`] : null,
      w && o ? ['WO · Build', `Turn “${o}” into a way to fix “${w}”.`] : null,
      s && t ? ['ST · Defend', `Lean on “${s}” to counter “${t}”.`] : null,
      w && t ? ['WT · Avoid', `Prioritise fixing “${w}” before “${t}” hits.`] : null,
    ].filter(Boolean);

    return h('div', { style: { display: 'contents' } },
      pageHead('SWOT analysis', 'Generated from your data (◆) and editable with your own points. Updates as you log.',
        h('button', { onclick: () => openRecord('goals', null, { defaults: { area: 'career' } }) }, '+ Turn into a goal')),
      h('div', { class: 'swot' }, ['S', 'W', 'O', 'T'].map(quad)),
      strategies.length ? card('Strategy ideas (TOWS)', 'pairs your top items', h('div', { class: 'insights' }, strategies.map(([k, txt]) => h('div', { class: 'insight info' }, h('span', { class: 'ic' }, '→'), h('div', null, h('strong', null, k), h('div', null, txt)))))) : null);
  },
};
