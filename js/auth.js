import { auth, api, resetAPI } from './api-client.js';

let session = { user: null, emailConfigured: false };

export async function loadSession() {
  const result = await auth();
  session = { user: result.user || null, emailConfigured: !!result.emailConfigured };
  return getSession();
}

export function getSession() {
  return structuredClone(session);
}

export function getUser() {
  return session.user ? structuredClone(session.user) : null;
}

export function can(permission) {
  const user = session.user;
  return !!user && user.status === 'active' && !user.mustChangePassword &&
    (user.role === 'SUPER_ADMIN' || (user.role === 'ADMIN' && user.permissions?.includes(permission)));
}

export async function logout() {
  await api('/auth/logout', { method: 'POST', body: {} });
  clearSession();
}

export function clearSession() {
  session = { user: null, emailConfigured: false };
  resetAPI();
}
