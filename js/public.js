import { applyPublicPrefs, getPublicPrefs, pEscape, pIcon, pIcons, pt, setPublicPrefs } from './platform-i18n.js';

let apiModulePromise;
async function client() {
  if (!apiModulePromise) apiModulePromise = import('./api-client.js').catch(() => null);
  return apiModulePromise;
}

export async function publicApi(path, options = {}) {
  const mod = await client();
  if (typeof mod?.api === 'function') return mod.api(path, options);
  const method = options.method || 'GET';
  const response = await fetch(`/api${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  let payload = null;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) { const error = new Error(payload?.error?.message || payload?.message || pt('errorGeneric')); error.code = payload?.error?.code || `HTTP_${response.status}`; error.status = response.status; throw error; }
  return payload;
}

export function friendlyError(error) {
  const code = String(error?.code || '');
  const known = { EMAIL_UNAVAILABLE: 'emailUnavailable', EMAIL_DELIVERY_FAILED: 'emailDeliveryFailed', NETWORK_ERROR: 'networkError', UNAUTHORIZED: 'unauthorized', FORBIDDEN: 'unauthorized', ACCOUNT_SUSPENDED: 'accountSuspended', CSRF_INVALID: 'sessionExpired', SESSION_EXPIRED: 'sessionExpired', REVISION_CONFLICT: 'errorGeneric' };
  return pt(known[code] || 'errorGeneric');
}

function textFor(value, lang = getPublicPrefs().language) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.en || value.ar || '';
}

function showToast(message, type = 'success') {
  const root = document.querySelector('#toast-root') || (() => { const el = document.createElement('div'); el.id = 'toast-root'; el.className = 'toast-region'; document.body.append(el); return el; })();
  const toast = document.createElement('div'); toast.className = `toast ${type === 'error' ? 'error' : ''}`; toast.setAttribute('role', type === 'error' ? 'alert' : 'status'); toast.textContent = message; root.append(toast); setTimeout(() => toast.remove(), 5000);
}

function setFormMessage(form, message, type = 'error') {
  let node = form.querySelector('.form-message');
  if (!node) { node = document.createElement('div'); node.className = 'form-message'; node.setAttribute('role', 'alert'); form.prepend(node); }
  node.className = `form-message ${type}`; node.textContent = message;
}

function renderPublished(content) {
  const lang = getPublicPrefs().language;
  const faqRoot = document.querySelector('[data-public-faq]');
  if (faqRoot) {
    const faqs = Array.isArray(content?.faqs) ? content.faqs : [];
    faqRoot.innerHTML = faqs.length ? faqs.map((item) => `<details class="faq-item"><summary>${pEscape(textFor(item.data?.question || item.question, lang))}</summary><p>${pEscape(textFor(item.data?.answer || item.answer, lang))}</p></details>`).join('') : `<p class="muted">${pEscape(pt('noFaqs'))}</p>`;
  }
  const announcements = Array.isArray(content?.announcements) ? content.announcements : [];
  const announcementRoot = document.querySelector('[data-public-announcements]');
  if (announcementRoot) announcementRoot.innerHTML = announcements.length ? announcements.map((item) => `<article class="announcement-card"><h3>${pEscape(textFor(item.data?.title || item.title, lang))}</h3><p>${pEscape(textFor(item.data?.body || item.body, lang))}</p></article>`).join('') : `<p class="muted">${pEscape(pt('noAnnouncements'))}</p>`;
  const settings = content?.settings || {};
  const name = textFor(settings.platformName, lang);
  if (name) document.querySelectorAll('[data-platform-name]').forEach((node) => { node.textContent = name; });
}

async function loadPublished() {
  if (!document.querySelector('[data-public-content]')) return;
  try { renderPublished(await publicApi('/public/content')); }
  catch { document.querySelectorAll('[data-public-faq],[data-public-announcements]').forEach((root) => { root.innerHTML = `<p class="muted">${pEscape(pt('serviceUnavailable'))}</p>`; }); }
}

async function handleContact(form) {
  if (!form.reportValidity()) return;
  const submit = form.querySelector('[type=submit]'); const original = submit?.textContent;
  if (submit) { submit.disabled = true; submit.textContent = pt('saving'); }
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    await publicApi('/public/contact', { method: 'POST', body: { name: data.name, email: data.email, message: data.message, website: data.website || '' } });
    form.reset(); setFormMessage(form, pt('contactSuccess'), 'success');
  } catch (error) { setFormMessage(form, error?.code === 'EMAIL_UNAVAILABLE' ? pt('emailUnavailable') : friendlyError(error), 'error'); }
  finally { if (submit) { submit.disabled = false; submit.textContent = original || pt('save'); } }
}

function wireCommon() {
  const routeEnglish = /^\/en(?:\/|$)/.test(location.pathname);
  const current = getPublicPrefs();
  if (routeEnglish && current.language !== 'en') setPublicPrefs({ language: 'en' });
  if (!routeEnglish && location.pathname === '/' && current.language === 'en') { location.replace('/en'); return current; }
  const prefs = applyPublicPrefs();
  document.querySelectorAll('[data-action="language"]').forEach((button) => button.addEventListener('click', () => {
    const next = getPublicPrefs().language === 'ar' ? 'en' : 'ar';
    setPublicPrefs({ language: next });
    if (document.body.dataset.publicPage === 'home') location.assign(next === 'en' ? '/en' : '/');
    else window.dispatchEvent(new CustomEvent('moneytrack:public-language'));
  }));
  document.querySelectorAll('[data-action="theme"]').forEach((button) => button.addEventListener('click', () => setPublicPrefs({ theme: getPublicPrefs().theme === 'dark' ? 'light' : 'dark' })));
  const menu = document.querySelector('[data-action="menu"]'); const nav = document.querySelector('.site-nav');
  menu?.addEventListener('click', () => { const open = !nav?.classList.contains('open'); nav?.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => { nav.classList.remove('open'); menu?.setAttribute('aria-expanded', 'false'); }));
  document.querySelectorAll('[data-contact-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); handleContact(form); }));
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = String(new Date().getFullYear()); });
  pIcons();
  return prefs;
}

function updateLanguageLinks() {
  const language = getPublicPrefs().language;
  document.querySelectorAll('[data-language-route]').forEach((link) => { const target = link.dataset.languageRoute; link.href = target === 'home' && language === 'en' ? '/en' : target === 'home' ? '/' : `${link.pathname}${link.hash || ''}`; });
}

document.addEventListener('DOMContentLoaded', async () => {
  wireCommon(); updateLanguageLinks(); await loadPublished(); pIcons();
});
