import { h, fmtDate, fmtNum, lastMonths, fmtMonth, monthKey, today, sum } from '../util.js';
import { store } from '../store.js';
import { card, chart, empty, openRecord, pageHead, dataTable, tile } from '../ui.js';
import { finance } from '../analytics.js';

export default {
  render() {
    const cur = store.settings().currency || '';
    const money = (n) => `${cur}${fmtNum(n)}`;
    const tx = [...store.list('transactions')].sort((a, b) => b.date.localeCompare(a.date));
    const months = lastMonths(6);
    const f = finance(store);
    const thisMonth = tx.filter((t) => monthKey(t.date) === monthKey(today()) && t.kind === 'expense');
    const cats = new Map();
    for (const t of thisMonth) cats.set(t.category || 'Other', (cats.get(t.category || 'Other') || 0) + t.amount);
    const topCats = [...cats].sort((a, b) => b[1] - a[1]);
    const monthly = (kind) => months.map((m) => sum(tx.filter((t) => t.kind === kind && monthKey(t.date) === m), (t) => t.amount));

    return h('div', { style: { display: 'contents' } },
      pageHead('Finance', 'Income, spending and savings — feeds the Finance score of your life balance.',
        h('button', { onclick: () => openRecord('transactions', null, { defaults: { kind: 'income' } }) }, '+ Income'),
        h('button', { class: 'primary', onclick: () => openRecord('transactions', null) }, '+ Expense')),
      h('div', { class: 'tiles' },
        tile('Income (this month)', money(f.income)),
        tile('Spent (this month)', money(f.expense)),
        tile('Invested / saved', money(f.saving)),
        tile('Savings rate', f.rate === null ? '—' : Math.round(f.rate), f.rate === null ? '' : '%', { text: `target ${store.settings().targets.savings_rate}%` })),
      tx.length ? h('div', { class: 'grid' },
        h('div', { class: 'span-7' }, card('Income vs spending', 'last 6 months', chart('bar', {
          labels: months.map(fmtMonth), unit: cur,
          datasets: [{ label: 'Income', data: monthly('income'), color: 'var(--s1)' }, { label: 'Expenses', data: monthly('expense'), color: 'var(--s2)' }, { label: 'Saved', data: monthly('saving'), color: 'var(--s3)' }],
        }))),
        h('div', { class: 'span-5' }, card('Spending by category', 'this month', topCats.length ? chart('bar', {
          labels: topCats.map((c) => c[0]), horizontal: true, unit: cur,
          datasets: [{ label: 'Spent', data: topCats.map((c) => c[1]), color: 'var(--s2)' }],
        }) : empty('No expenses this month.'))),
        h('div', { class: 'span-12' }, card('Transactions', `${tx.length}`, dataTable(tx.slice(0, 40), [
          { label: 'Date', get: (t) => fmtDate(t.date) },
          { label: 'Type', get: (t) => t.kind },
          { label: 'Category', get: (t) => t.category },
          { label: 'Note', get: (t) => t.note },
          { label: 'Amount', num: true, get: (t) => `${t.kind === 'income' ? '+' : '−'}${money(t.amount)}` },
        ], { onClick: (t) => openRecord('transactions', t) })))) : card(null, null, empty('Log income and expenses to see where your money goes.', 'Add transaction', () => openRecord('transactions', null))));
  },
};
