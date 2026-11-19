import { getPublicPrefs, pEscape, pIcons, pt, applyPublicPrefs, setPublicPrefs } from './platform-i18n.js';
import { publicApi, friendlyError } from './public.js';

function message(form, text, type = 'error') {
  let node = form.querySelector('.form-message');
  if (!node) { node = document.createElement('div'); node.className = 'form-message'; node.setAttribute('role', 'alert'); form.prepend(node); }
  node.className = `form-message ${type}`; node.textContent = text;
}
function validPassword(value) { return typeof value === 'string' && value.length >= 12; }
function err(error) { return error?.code === 'EMAIL_UNAVAILABLE' ? pt('emailUnavailable') : error?.code === 'EMAIL_DELIVERY_FAILED' ? pt('emailDeliveryFailed') : friendlyError(error); }
function setBusy(form, busy) { const submit = form.querySelector('[type=submit]'); if (!submit) return; if (busy) { submit.dataset.original = submit.textContent; submit.disabled = true; submit.textContent = pt('saving'); } else { submit.disabled = false; submit.textContent = submit.dataset.original || submit.textContent; } }
function queryToken() { return new URLSearchParams(location.search).get('token') || ''; }

async function submitLogin(form) {
  if (!form.reportValidity()) return;
  setBusy(form, true);
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const result = await publicApi('/auth/login', { method: 'POST', body: { email: data.email, password: data.password, remember: data.remember === 'on' } });
    const user = result.user || {};
    if (user.mustChangePassword) location.assign('/app#settings');
    else if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') location.assign('/admin');
    else location.assign('/app');
  } catch (error) { message(form, err(error)); setBusy(form, false); }
}

async function submitRegister(form) {
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (!validPassword(data.password)) return message(form, pt('passwordShort'));
  if (data.password !== data.confirmPassword) return message(form, pt('passwordMismatch'));
  if (data.acceptTerms !== 'on') return message(form, pt('consentRequired'));
  setBusy(form, true);
  try {
    const result = await publicApi('/auth/register', { method: 'POST', body: { fullName: data.fullName, email: data.email, password: data.password, confirmPassword: data.confirmPassword, acceptTerms: true, language: getPublicPrefs().language } });
    const ar = getPublicPrefs().language === 'ar';
    if (result.verificationRequired) { message(form, ar ? 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني قبل تسجيل الدخول.' : 'Your account was created. Verify your email before logging in.', 'success'); form.reset(); }
    else if (result.emailDisabled) {
      message(form, ar ? 'تم إنشاء الحساب بنجاح. خدمة البريد غير مهيأة حاليًا، فالحساب جاهز للدخول مباشرةً.' : 'Your account is ready. Email delivery is not configured right now, so you can sign in directly.', 'success');
      form.reset();
      setTimeout(() => { window.location.href = '/login'; }, 1500);
    }
    else message(form, ar ? 'تم إنشاء الحساب.' : 'Your account was created.', 'success');
  } catch (error) { message(form, err(error)); }
  finally { setBusy(form, false); }
}

async function submitForgot(form) {
  if (!form.reportValidity()) return;
  setBusy(form, true);
  try { await publicApi('/auth/forgot-password', { method: 'POST', body: { email: new FormData(form).get('email'), language: getPublicPrefs().language } }); message(form, getPublicPrefs().language === 'ar' ? 'إذا كان الحساب موجوداً وكانت خدمة البريد مهيأة، ستصل تعليمات الاستعادة.' : 'If the account exists and email is configured, recovery instructions will arrive.', 'success'); }
  catch (error) { message(form, err(error)); }
  finally { setBusy(form, false); }
}

async function submitReset(form) {
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.token) return message(form, getPublicPrefs().language === 'ar' ? 'رابط الاستعادة غير مكتمل.' : 'The recovery link is incomplete.');
  if (!validPassword(data.password)) return message(form, pt('passwordShort'));
  if (data.password !== data.confirmPassword) return message(form, pt('passwordMismatch'));
  setBusy(form, true);
  try { await publicApi('/auth/reset-password', { method: 'POST', body: { token: data.token, password: data.password, confirmPassword: data.confirmPassword } }); message(form, getPublicPrefs().language === 'ar' ? 'تم تغيير كلمة المرور. يمكنك تسجيل الدخول.' : 'Your password was changed. You can now log in.', 'success'); form.reset(); }
  catch (error) { message(form, err(error)); }
  finally { setBusy(form, false); }
}

async function submitVerify(form) {
  const token = new FormData(form).get('token') || queryToken();
  if (!token) return message(form, getPublicPrefs().language === 'ar' ? 'رابط التحقق غير مكتمل.' : 'The verification link is incomplete.');
  setBusy(form, true);
  try { await publicApi('/auth/verify-email', { method: 'POST', body: { token } }); message(form, getPublicPrefs().language === 'ar' ? 'تم التحقق من البريد. يمكنك تسجيل الدخول.' : 'Your email is verified. You can log in now.', 'success'); }
  catch (error) { message(form, err(error)); }
  finally { setBusy(form, false); }
}

async function submitResend(form) {
  if (!form.reportValidity()) return;
  setBusy(form, true);
  try { await publicApi('/auth/resend-verification', { method: 'POST', body: { email: new FormData(form).get('email'), language: getPublicPrefs().language } }); message(form, getPublicPrefs().language === 'ar' ? 'إذا كان الحساب يحتاج التحقق وكانت خدمة البريد مهيأة، ستصل رسالة جديدة.' : 'If the account needs verification and email is configured, a new message will arrive.', 'success'); }
  catch (error) { message(form, err(error)); }
  finally { setBusy(form, false); }
}

function bindAuthForm(form) {
  const kind = form.dataset.authForm;
  form.addEventListener('submit', (event) => { event.preventDefault(); const actions = { login: submitLogin, register: submitRegister, forgot: submitForgot, reset: submitReset, verify: submitVerify, resend: submitResend }; actions[kind]?.(form); });
  if (kind === 'reset') { const field = form.elements.token; if (field && !field.value) field.value = queryToken(); }
}

// public.js owns the shared language/theme controls; bind forms once here.
document.addEventListener('DOMContentLoaded', () => { applyPublicPrefs(); document.querySelectorAll('[data-auth-form]').forEach(bindAuthForm); pIcons(); });
