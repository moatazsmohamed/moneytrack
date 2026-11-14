import { getState, update, localDate, uid } from './storage.js';
import { e, icon, icons, empty, openModal, confirmDialog, toast, download } from './ui.js';
import { t, money, number, formatDate, catName } from './translations.js';

export const PAGE_SIZE = 10;
const SORT_MODES = ['newest', 'oldest', 'highest', 'lowest'];
const filters = { search: '', type: 'all', category: 'all', start: '', end: '', sort: 'newest', page: 1 };
const resetFilters = () => Object.assign(filters, { search: '', type: 'all', category: 'all', start: '', end: '', sort: 'newest', page: 1 });
function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number), date = new Date(0);
  date.setFullYear(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
function parseAmount(raw) {
  raw = String(raw ?? '').trim();
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(raw)) throw new Error(t('finance.validation.amount'));
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error(t('finance.validation.amount'));
  return Number(amount.toFixed(2));
}
export function filterTransactions(transactions, requested = {}) {
  const f = { ...filters, ...requested }, search = String(f.search || '').trim().toLocaleLowerCase();
  return transactions.filter(tx => {
    if (search && !`${tx.title}\n${tx.description || ''}`.toLocaleLowerCase().includes(search)) return false;
    if (f.type && f.type !== 'all' && tx.type !== f.type) return false;
    if (f.category && f.category !== 'all' && tx.categoryId !== f.category) return false;
    if (f.start && tx.date < f.start) return false;
    if (f.end && tx.date > f.end) return false;
    return true;
  }).sort((a, b) => {
    if (f.sort === 'highest') return b.amount - a.amount || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
    if (f.sort === 'lowest') return a.amount - b.amount || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
    if (f.sort === 'oldest') return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
  });
}
export function openTransaction(id = null, type = 'expense') {
  const state = getState(), existing = id ? state.transactions.find(x => x.id === id) : null;
  if (id && !existing) return toast(t('finance.transaction.notFound'), 'error');
  const current = existing || { title: '', amount: '', type, categoryId: '', date: localDate(), description: '' };
  const options = (selectedType, selectedId) => getState().categories.filter(c => c.type === selectedType).map(c => `<option value="${e(c.id)}" ${selectedId === c.id ? 'selected' : ''}>${e(catName(c))}</option>`).join('');
  const modal = openModal({
    title: t(existing ? 'finance.transaction.editTitle' : 'finance.transaction.addTitle'),
    submitLabel: t(existing ? 'finance.actions.save' : 'finance.actions.add'),
    body: `<div class="form-grid"><label class="field span-2"><span>${t('finance.fields.title')}</span><input id="transaction-title" name="title" required maxlength="180" value="${e(current.title)}" placeholder="${t('finance.transaction.titlePlaceholder')}" autofocus></label><label class="field"><span>${t('finance.fields.amount')} (${e(state.prefs.currency)})</span><input id="transaction-amount" name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="1000000000000" required value="${e(current.amount)}"></label><label class="field"><span>${t('finance.fields.type')}</span><select id="transaction-type" name="type">${['income','expense'].map(x => `<option value="${x}" ${current.type === x ? 'selected' : ''}>${t('finance.type.' + x)}</option>`).join('')}</select></label><label class="field"><span>${t('finance.fields.category')}</span><select id="transaction-category" name="categoryId" required>${options(current.type, current.categoryId)}</select></label><label class="field"><span>${t('finance.fields.date')}</span><input id="transaction-date" type="date" name="date" required value="${current.date}"></label><label class="field span-2"><span>${t('finance.fields.description')}</span><textarea id="transaction-description" name="description" maxlength="1000" placeholder="${t('finance.transaction.descriptionPlaceholder')}">${e(current.description)}</textarea></label></div>`,
    onSubmit: async data => {
      const title = String(data.get('title') || '').trim(), description = String(data.get('description') || '').trim();
      const nextType = data.get('type'), categoryId = data.get('categoryId'), date = data.get('date');
      if (!title || title.length > 180) throw new Error(t('finance.validation.title'));
      if (description.length > 1000) throw new Error(t('finance.validation.description'));
      if (!['income','expense'].includes(nextType)) throw new Error(t('finance.validation.type'));
      if (!realDate(date)) throw new Error(t('finance.validation.date'));
      if (!getState().categories.some(c => c.id === categoryId && c.type === nextType)) throw new Error(t('finance.validation.category'));
      const amount = parseAmount(data.get('amount'));
      try {
        await update(s => {
          const next = { id: id || uid(), title, description, type: nextType, categoryId, date, amount, demo: false };
          const index = s.transactions.findIndex(x => x.id === id);
          if (id && index < 0) throw new Error(t('finance.transaction.notFound'));
          if (index >= 0) s.transactions[index] = next; else s.transactions.unshift(next);
        });
      } catch (error) { throw new Error(t('storageError')); }
      toast(t(existing ? 'finance.transaction.updated' : 'finance.transaction.created'));
    }
  });
  modal?.form.querySelector('#transaction-type').addEventListener('change', ev => {
    const select = modal.form.querySelector('#transaction-category');
    select.innerHTML = options(ev.target.value, select.value);
  });
}
export function transactionTable(list, { compact = false } = {}) {
  if (!list.length) return empty(t('finance.transaction.empty'), 'receipt-text');
  const state = getState();
  return `<div class="table-wrap"><table class="data-table" id="transactions-table"><thead><tr><th>${t('finance.fields.title')}</th><th class="compact-hide">${t('finance.fields.category')}</th><th class="compact-hide">${t('finance.fields.date')}</th><th>${t('finance.fields.type')}</th><th>${t('finance.fields.amount')}</th><th>${t('finance.fields.actions')}</th></tr></thead><tbody>${list.map(tx => {
    const cat = state.categories.find(c => c.id === tx.categoryId), label = catName(cat);
    return `<tr data-transaction-id="${e(tx.id)}"><td><div class="transaction-name"><span class="category-icon" style="color:${cat?.color || '#64748b'};background:${cat?.color || '#64748b'}15">${icon(cat?.icon || 'tag')}</span><span><strong title="${e(tx.title)}">${e(tx.title)}</strong><small>${compact ? e(label) : e(tx.description || label)}</small></span></div></td><td class="compact-hide muted">${e(label)}</td><td class="compact-hide muted">${e(formatDate(tx.date))}</td><td><span class="badge badge-${tx.type}">${t('finance.type.' + tx.type)}</span></td><td class="amount-${tx.type === 'income' ? 'positive' : 'negative'}">${tx.type === 'income' ? '+' : '−'}${e(money(tx.amount))}</td><td><div class="row-actions"><button class="icon-btn" data-edit-tx="${e(tx.id)}" aria-label="${e(t('finance.actions.edit') + ': ' + tx.title)}">${icon('pencil')}</button><button class="icon-btn delete" data-delete-tx="${e(tx.id)}" aria-label="${e(t('finance.actions.delete') + ': ' + tx.title)}">${icon('trash-2')}</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
export function bindTransactionActions(container) {
  if (container.dataset.txActionsBound) return;
  container.dataset.txActionsBound = 'true';
  container.addEventListener('click', async ev => {
    const edit = ev.target.closest('[data-edit-tx]');
    if (edit && container.contains(edit)) return openTransaction(edit.dataset.editTx);
    const remove = ev.target.closest('[data-delete-tx]');
    if (!remove || !container.contains(remove)) return;
    const tx = getState().transactions.find(x => x.id === remove.dataset.deleteTx);
    if (!tx || !await confirmDialog(t('finance.transaction.deleteTitle'), t('finance.transaction.deleteMessage', { name: tx.title }))) return;
    try { await update(s => { s.transactions = s.transactions.filter(x => x.id !== tx.id); }); toast(t('finance.transaction.deleted')); }
    catch { toast(t('storageError'), 'error'); }
  });
}
function draw(container) {
  const state = getState(), rows = filterTransactions(state.transactions), pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  filters.page = Math.min(pageCount, Math.max(1, filters.page));
  const categoryOptions = state.categories.filter(c => filters.type === 'all' || c.type === filters.type);
  const active = document.activeElement, refocus = active?.matches('[data-transaction-search]') && container.contains(active);
  const selection = refocus ? active.selectionStart : null;
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${t('transactionEyebrow')}</div><h1>${t('transactions')}</h1><p class="page-subtitle">${t('transactionSubtitle')}</p></div><div class="page-actions"><button class="btn btn-secondary" data-export-transactions>${icon('download')}${t('exportCSV')}</button><button class="btn btn-primary" data-add-transaction>${icon('plus')}${t('addTransaction')}</button></div></div><section class="card"><div class="toolbar"><label class="search-input"><span class="sr-only">${t('finance.transaction.search')}</span>${icon('search')}<input id="transaction-search" data-transaction-search type="search" value="${e(filters.search)}" placeholder="${t('finance.transaction.searchPlaceholder')}"></label><div class="segmented">${['all','income','expense'].map(type => `<button data-type="${type}" aria-pressed="${filters.type === type}" class="${filters.type === type ? 'active' : ''}">${t('finance.type.' + type)}</button>`).join('')}</div></div><div class="filters" id="transaction-filters"><label><span>${t('finance.fields.type')}</span><select class="select" data-filter="type">${['all','income','expense'].map(type => `<option value="${type}" ${filters.type === type ? 'selected' : ''}>${t('finance.type.' + type)}</option>`).join('')}</select></label><label><span>${t('finance.fields.category')}</span><select class="select" data-filter="category"><option value="all">${t('finance.filters.allCategories')}</option>${categoryOptions.map(c => `<option value="${e(c.id)}" ${filters.category === c.id ? 'selected' : ''}>${e(catName(c))}</option>`).join('')}</select></label><label><span>${t('finance.filters.from')}</span><input type="date" data-filter="start" value="${e(filters.start)}"></label><label><span>${t('finance.filters.to')}</span><input type="date" data-filter="end" value="${e(filters.end)}"></label><label><span>${t('finance.filters.sort')}</span><select class="select" data-filter="sort">${SORT_MODES.map(sort => `<option value="${sort}" ${filters.sort === sort ? 'selected' : ''}>${t('finance.sort.' + sort)}</option>`).join('')}</select></label><button class="btn btn-ghost" data-reset-transaction-filters>${icon('rotate-ccw')}${t('resetFilters')}</button></div><div class="card-head"><span class="muted" style="font-size:11px">${t('transactionCount', { count: number(rows.length) })}</span><span class="muted" style="font-size:10px">${t('savedLocally')}</span></div>${transactionTable(rows.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE))}${pageCount > 1 ? `<nav class="pagination" aria-label="${t('finance.pagination.label')}"><span>${t('showingRows', { start: number((filters.page - 1) * PAGE_SIZE + 1), end: number(Math.min(filters.page * PAGE_SIZE, rows.length)), total: number(rows.length) })}</span><div class="pagination-controls"><button class="btn btn-secondary" data-page="${filters.page - 1}" ${filters.page <= 1 ? 'disabled' : ''}>${t('previous')}</button><span>${t('finance.pagination.page', { page: number(filters.page), pages: number(pageCount) })}</span><button class="btn btn-secondary" data-page="${filters.page + 1}" ${filters.page >= pageCount ? 'disabled' : ''}>${t('next')}</button></div></nav>` : ''}</section>`;
  icons();
  if (refocus) { const search = container.querySelector('[data-transaction-search]'); search.focus(); if (selection !== null) search.setSelectionRange(selection, selection); }
}
function setFilter(name, value) {
  if ((name === 'start' || name === 'end') && value && !realDate(value)) return false;
  const candidate = { ...filters, [name]: value };
  if (candidate.start && candidate.end && candidate.start > candidate.end) { toast(t('invalidDateRange'), 'error'); return false; }
  filters[name] = value; filters.page = 1;
  if (name === 'type' && filters.category !== 'all' && !getState().categories.some(c => c.id === filters.category && (value === 'all' || c.type === value))) filters.category = 'all';
  return true;
}
export function renderTransactions(container) {
  draw(container); bindTransactionActions(container);
  container.addEventListener('input', ev => {
    if (ev.target.matches('[data-transaction-search]')) { filters.search = ev.target.value; filters.page = 1; draw(container); }
  });
  container.addEventListener('change', ev => { if (ev.target.matches('[data-filter]')) { if (setFilter(ev.target.dataset.filter, ev.target.value)) draw(container); else ev.target.value = filters[ev.target.dataset.filter]; } });
  container.addEventListener('click', ev => {
    if (ev.target.closest('[data-add-transaction]')) return openTransaction(null, filters.type === 'income' ? 'income' : 'expense');
    if (ev.target.closest('[data-export-transactions]')) { exportCSV(filterTransactions(getState().transactions)); return toast(t('csvExported')); }
    if (ev.target.closest('[data-reset-transaction-filters]')) { resetFilters(); return draw(container); }
    const type = ev.target.closest('[data-type]'); if (type) { setFilter('type', type.dataset.type); return draw(container); }
    const page = ev.target.closest('[data-page]'); if (page && !page.disabled) { filters.page = Number(page.dataset.page); draw(container); }
  });
}
export function setTransactionSearch(value) { resetFilters(); filters.search = String(value || ''); }
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function exportCSV(list = getState().transactions) {
  const state = getState(), headers = ['title','description','type','category','date','amount'].map(key => t('finance.fields.' + key));
  const rows = list.map(tx => [tx.title, tx.description, t('finance.type.' + tx.type), catName(state.categories.find(c => c.id === tx.categoryId)), tx.date, tx.amount.toFixed(2)]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  download(csv, `MoneyTrack-transactions-${localDate()}.csv`, 'text/csv;charset=utf-8');
  return csv;
}
