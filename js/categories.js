import { getState, update, uid } from './storage.js';
import { e, icon, icons, empty, openModal, confirmDialog, toast } from './ui.js';
import { t, catName, number } from './translations.js';

const ICONS = ['tag', 'briefcase-business', 'banknote', 'chart-line', 'gift', 'utensils', 'car', 'shopping-bag', 'receipt', 'graduation-cap', 'heart-pulse', 'film', 'home', 'plane', 'wallet-cards', 'laptop', 'store', 'trending-up', 'circle-dollar-sign', 'car-front', 'receipt-text', 'popcorn', 'house', 'ellipsis'];
const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#db2777', '#0891b2', '#65a30d', '#ca8a04', '#475569', '#dc2626'];
let activeContainer = null;

function text(value) {
  return e(value == null ? '' : String(value));
}

function safeIcon(value) {
  const candidate = String(value || '').toLowerCase().trim();
  return /^[a-z0-9-]{1,40}$/.test(candidate) ? candidate : 'tag';
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#64748b';
}

function usedInfo(state, category) {
  const transactions = state.transactions.filter((transaction) => transaction.categoryId === category.id).length;
  const budgetMonths = Object.values(state.budgets || {}).filter((budget) => Object.prototype.hasOwnProperty.call(budget.categories || {}, category.id)).length;
  const recurring = (state.recurring || []).filter(rule => rule.categoryId === category.id).length;
  return { transactions, budgetMonths, recurring, used: transactions > 0 || budgetMonths > 0 || recurring > 0 };
}

function categoryForm(category = null) {
  const current = category || { names: { en: '', ar: '' }, type: 'expense', icon: 'tag', color: COLORS[0] };
  const state = getState();
  const usage = category ? usedInfo(state, category) : { used: false };
  return {
    title: category ? t('finance.category.editTitle') : t('finance.category.addTitle'),
    body: `<div class="form-grid" id="category-form-fields"><label class="field" for="category-name-en"><span>${text(t('finance.category.nameEn'))}</span><input id="category-name-en" name="nameEn" maxlength="100" required value="${text(current.names?.en || '')}"></label><label class="field" for="category-name-ar"><span>${text(t('finance.category.nameAr'))}</span><input id="category-name-ar" name="nameAr" maxlength="100" required value="${text(current.names?.ar || '')}" dir="rtl"></label><label class="field" for="category-type"><span>${text(t('finance.fields.type'))}</span><select id="category-type" name="type" required${usage.used ? ' disabled' : ''}><option value="income"${current.type === 'income' ? ' selected' : ''}>${text(t('finance.type.income'))}</option><option value="expense"${current.type === 'expense' ? ' selected' : ''}>${text(t('finance.type.expense'))}</option></select>${usage.used ? `<small class="muted">${text(t('finance.category.typeLocked'))}</small>` : ''}</label><label class="field" for="category-icon"><span>${text(t('finance.category.icon'))}</span><select id="category-icon" name="icon">${ICONS.map((value) => `<option value="${value}"${safeIcon(current.icon) === value ? ' selected' : ''}>${text(t(`finance.icon.${value}`))}</option>`).join('')}</select></label><label class="field" for="category-color"><span>${text(t('finance.category.color'))}</span><input id="category-color" name="color" type="color" value="${text(safeColor(current.color))}"></label></div>`,
  };
}

function normalizeCategory(form, existing = null) {
  const nameEn = String(form.get('nameEn') || '').trim();
  const nameAr = String(form.get('nameAr') || '').trim();
  const type = String(form.get('type') || existing?.type || '');
  const iconName = safeIcon(form.get('icon'));
  const color = safeColor(form.get('color'));
  if (!nameEn || !nameAr || nameEn.length > 100 || nameAr.length > 100) throw new Error(t('finance.validation.categoryNames'));
  if (type !== 'income' && type !== 'expense') throw new Error(t('finance.validation.type'));
  return { id: existing?.id || uid(), names: { en: nameEn, ar: nameAr }, type, icon: iconName, color };
}

export function openCategory(id = null) {
  const category = id ? getState().categories.find((item) => item.id === id) : null;
  if (id && !category) {
    toast(t('finance.category.notFound'), 'error');
    return;
  }
  const view = categoryForm(category);
  openModal({
    title: view.title,
    body: view.body,
    submitLabel: category ? t('finance.actions.save') : t('finance.actions.add'),
    onSubmit: async (form) => {
      const next = normalizeCategory(form, category);
      const currentState = getState();
      if (currentState.categories.some((item) => item.id !== next.id && (item.names.en.toLocaleLowerCase() === next.names.en.toLocaleLowerCase() || item.names.ar === next.names.ar))) {
        throw new Error(t('finance.validation.duplicateCategory'));
      }
      await update((draft) => {
        const index = draft.categories.findIndex((item) => item.id === next.id);
        if (index >= 0) draft.categories[index] = next;
        else draft.categories.push(next);
      });
      toast(category ? t('finance.category.updated') : t('finance.category.created'));
      if (activeContainer) drawCategories(activeContainer);
      return true;
    },
  });
}

async function deleteCategory(id) {
  const state = getState();
  const category = state.categories.find((item) => item.id === id);
  if (!category) return;
  const info = usedInfo(state, category);
  if (!info.used) {
    if (!await confirmDialog(t('finance.category.deleteTitle'), t('finance.category.deleteMessage', { name: catName(category) }))) return;
    try {
      await update((draft) => {
        draft.categories = draft.categories.filter((item) => item.id !== id);
        Object.values(draft.budgets || {}).forEach((budget) => { delete budget.categories[id]; });
      });
    } catch {
      toast(t('storageError'), 'error');
      return;
    }
    toast(t('finance.category.deleted'));
    if (activeContainer) drawCategories(activeContainer);
    return;
  }
  const replacements = state.categories.filter((item) => item.id !== id && item.type === category.type);
  if (!replacements.length) {
    toast(t('finance.category.noReplacement'), 'error');
    return;
  }
  const body = `<p class="notice">${text(t('finance.category.reassignNotice', { name: catName(category) }))}</p><label class="field" for="replacement-category"><span>${text(t('finance.category.replacement'))}</span><select id="replacement-category" name="replacementId" required>${replacements.map((replacement) => `<option value="${text(replacement.id)}">${text(catName(replacement))}</option>`).join('')}</select></label>`;
  openModal({
    title: t('finance.category.reassignTitle'),
    body,
    submitLabel: t('finance.actions.reassignAndDelete'),
    onSubmit: async (form) => {
      const replacementId = String(form.get('replacementId') || '');
      const replacement = getState().categories.find((item) => item.id === replacementId && item.type === category.type && item.id !== id);
      if (!replacement) throw new Error(t('finance.validation.replacement'));
      try {
        await update((draft) => {
          draft.transactions.forEach((transaction) => {
            if (transaction.categoryId === id) transaction.categoryId = replacementId;
          });
          Object.values(draft.budgets || {}).forEach((budget) => { delete budget.categories[id]; });
          draft.categories = draft.categories.filter((item) => item.id !== id);
        }, { categoryReplacements: { [id]: replacementId } });
      } catch {
        throw new Error(t('storageError'));
      }
      toast(t('finance.category.reassigned'));
      if (activeContainer) drawCategories(activeContainer);
      return true;
    },
  });
}

function categoryCard(category, state) {
  const usage = usedInfo(state, category);
  return `<article class="category-card" data-category-id="${text(category.id)}"><div class="category-card-head"><span class="category-icon" style="--category-color:${text(safeColor(category.color))}">${icon(safeIcon(category.icon))}</span><div><h3>${text(catName(category))}</h3><p class="muted">${text(t(`finance.type.${category.type}`))}</p></div><div class="category-card-actions"><button type="button" class="icon-btn" data-edit-category="${text(category.id)}" aria-label="${text(t('finance.actions.edit'))}" title="${text(t('finance.actions.edit'))}">${icon('pencil')}</button><button type="button" class="icon-btn" data-delete-category="${text(category.id)}" aria-label="${text(t('finance.actions.delete'))}" title="${text(t('finance.actions.delete'))}">${icon('trash-2')}</button></div></div><div class="muted category-card-meta">${text(t('finance.category.usage', { count: number(usage.transactions), months: number(usage.budgetMonths) }))}</div></article>`;
}

function drawCategories(container) {
  const state = getState();
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${text(t('categoryEyebrow'))}</div><h1>${text(t('categories'))}</h1><p class="page-subtitle">${text(t('finance.category.listDescription'))}</p></div></div><div class="card" id="categories-card"><div class="card-head"><div><h2 class="section-title">${text(t('finance.category.listTitle'))}</h2><p class="muted">${text(t('finance.category.listDescription'))}</p></div><button type="button" class="btn btn-primary" data-add-category>${icon('plus')}<span>${text(t('finance.actions.add'))}</span></button></div>${state.categories.length ? `<div class="category-grid" id="categories-grid">${state.categories.map((category) => categoryCard(category, state)).join('')}</div>` : empty(t('finance.category.empty'), 'tags')}</div>`;
  icons();
}

export function renderCategories(container) {
  activeContainer = container;
  drawCategories(container);
  if (container.dataset.categoryViewBound === 'true') return;
  container.dataset.categoryViewBound = 'true';
  container.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-category]');
    if (add) {
      openCategory();
      return;
    }
    const edit = event.target.closest('[data-edit-category]');
    if (edit) {
      openCategory(edit.dataset.editCategory);
      return;
    }
    const remove = event.target.closest('[data-delete-category]');
    if (remove) deleteCategory(remove.dataset.deleteCategory);
  });
}

export { ICONS, COLORS };
