import nodemailer from 'nodemailer';

let transport;
let transportInitialized = false;

function getTransport() {
  if (transportInitialized) return transport;
  transportInitialized = true;
  const url = process.env.SMTP_URL;
  if (url) transport = nodemailer.createTransport(url);
  else if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
  }
  return transport;
}

export function isEmailConfigured() { return Boolean(getTransport() && process.env.SMTP_FROM); }

async function send({ to, subject, text, html }) {
  const tx = getTransport();
  if (!tx || !process.env.SMTP_FROM) {
    const error = new Error('SMTP is not configured');
    error.code = 'EMAIL_UNAVAILABLE';
    throw error;
  }
  try {
    await tx.sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
  } catch (error) {
    const wrapped = new Error('Email delivery failed');
    wrapped.code = 'EMAIL_DELIVERY_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

const appUrl = () => (process.env.PUBLIC_APP_URL || 'https://moneycash-sigma-one.vercel.app').replace(/\/$/, '');

export function verificationUrl(token) { return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`; }
export function resetUrl(token) { return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`; }

export async function sendVerificationEmail({ to, fullName, token, language = 'ar' }) {
  const url = verificationUrl(token);
  const arabic = language === 'ar';
  return send({ to, subject: arabic ? 'تحقق من بريدك في MoneyTrack' : 'Verify your MoneyTrack email', text: arabic ? `مرحباً ${fullName}، افتح الرابط للتحقق من بريدك: ${url}` : `Hello ${fullName}, verify your email with this link: ${url}`, html: `<p>${arabic ? 'مرحباً' : 'Hello'} ${escapeHtml(fullName)},</p><p><a href="${escapeHtml(url)}">${arabic ? 'تحقق من البريد' : 'Verify email'}</a></p>` });
}

export async function sendPasswordResetEmail({ to, fullName, token, language = 'ar' }) {
  const url = resetUrl(token);
  const arabic = language === 'ar';
  return send({ to, subject: arabic ? 'إعادة تعيين كلمة مرور MoneyTrack' : 'Reset your MoneyTrack password', text: arabic ? `مرحباً ${fullName}، افتح الرابط لإعادة تعيين كلمة المرور: ${url}` : `Hello ${fullName}, reset your password with this link: ${url}`, html: `<p>${arabic ? 'مرحباً' : 'Hello'} ${escapeHtml(fullName)},</p><p><a href="${escapeHtml(url)}">${arabic ? 'إعادة تعيين كلمة المرور' : 'Reset password'}</a></p>` });
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
