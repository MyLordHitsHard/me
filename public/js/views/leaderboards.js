import { h, fmtNum } from '../util.js';
import { api, store } from '../store.js';
import { card, empty, pageHead, guard, tile } from '../ui.js';

export const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

let selected = null;

export default {
  async render({ params }) {
    const boards = await api('GET', '/api/leaderboards');
    selected = params.get('b') || selected || (boards.find((b) => b.joined) || boards[0])?.key;
    const board = selected ? await api('GET', `/api/leaderboards/${encodeURIComponent(selected)}`).catch(() => null) : null;
    const groups = [['metric', 'Activity boards'], ['skill', 'Skill boards'], ['tracker', 'Custom tracker boards']];

    const toggle = async (b) => {
      await guard(() => api(b.joined ? 'DELETE' : 'POST', `/api/leaderboards/${encodeURIComponent(b.key)}/join`), b.joined ? 'You left the leaderboard' : 'You joined — good luck!');
      selected = b.key;
      store.emit();
    };

    const list = h('div', null, groups.map(([kind, label]) => {
      const bs = boards.filter((b) => b.kind === kind);
      if (!bs.length) return null;
      return h('div', { style: { marginBottom: '12px' } }, h('div', { class: 'section-title' }, label),
        h('div', { class: 'list' }, bs.map((b) => h('div', { class: `list-item ${b.key === selected ? 'sel' : ''}`, style: b.key === selected ? { background: 'var(--surface-2)' } : null, onclick: () => { location.hash = `#/leaderboards?b=${encodeURIComponent(b.key)}`; } },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, b.title), h('div', { class: 'small muted' }, `${b.members} member${b.members === 1 ? '' : 's'}${b.eligible ? '' : ' · add this to your dashboard to join'}`)),
          b.joined ? h('span', { class: 'chip' }, 'joined') : null))));
    }));

    let detail;
    if (!board) detail = empty('Pick a leaderboard');
    else {
      const me = board.rows.find((r) => r.me);
      detail = card(board.title, `${board.rows.length} ranked · unit: ${board.unit || '—'}`,
        h('div', { class: 'tiles', style: { marginBottom: '12px' } },
          tile('Your score', fmtNum(board.myScore, 1), board.unit),
          tile('Your rank', me ? `#${me.rank}` : '—', me ? `of ${board.rows.length}` : '', { text: me ? 'visible to members' : 'join to be ranked' })),
        h('div', { class: 'row', style: { marginBottom: '8px' } },
          h('button', { class: board.joined ? '' : 'primary', disabled: !board.eligible && !board.joined, onclick: () => toggle(board) }, board.joined ? 'Leave leaderboard' : 'Join leaderboard'),
          h('span', { class: 'small muted' }, 'Only your display name, headline and this score are shown to other members.')),
        board.rows.length ? h('div', null, board.rows.map((r) => h('div', { class: `lb-row ${r.me ? 'me' : ''}` },
          h('div', { class: `lb-rank ${r.rank <= 3 ? 'top' : ''}` }, r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`),
          h('div', null, h('div', { style: { fontWeight: 600 } }, r.display_name, r.me ? ' (you)' : ''), h('div', { class: 'small muted' }, `@${r.username}${r.headline ? ` · ${r.headline}` : ''}`)),
          h('div', { class: 'num', style: { fontWeight: 650 } }, `${fmtNum(r.score, 1)} `, h('span', { class: 'small muted' }, board.unit)))))
          : empty('Nobody has joined yet — be the first.'));
    }

    return h('div', { style: { display: 'contents' } },
      pageHead('Leaderboards', 'Opt-in, friendly competition with other LifeOS users. Join a board for any skill or tracker you follow, or for overall activity.'),
      h('div', { class: 'grid' }, h('div', { class: 'span-4' }, card('Boards', null, list)), h('div', { class: 'span-8' }, detail)));
  },
};
