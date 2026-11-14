/* Same-origin JSON API. Session cookies remain HttpOnly and never enter this module. */
let csrfToken = null;
let csrfPromise = null;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor(code, status = 0, message = code) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function validPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('://') || /[\r\n]/.test(path)) {
    throw new TypeError('API paths must be relative to /api');
  }
}

async function request(path, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (WRITE_METHODS.has(options.method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(`/api${path}`, {
      method: options.method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      redirect: 'error',
    });
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError('INVALID_RESPONSE', response.status); }
    if (!response.ok) {
      const code = typeof data?.error?.code === 'string' ? data.error.code : 'REQUEST_FAILED';
      if (response.status === 401 || code === 'ACCOUNT_SUSPENDED') {
        csrfToken = null;
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('moneytrack:auth-expired', { detail: { code } }));
      }
      // Never expose SQL/internal error text. The UI translates machine codes.
      throw new ApiError(code, response.status);
    }
    if (typeof data?.csrfToken === 'string') csrfToken = data.csrfToken;
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') throw new ApiError('REQUEST_TIMEOUT');
    throw new ApiError('NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function ensureCSRF() {
  if (csrfToken) return;
  if (!csrfPromise) csrfPromise = request('/auth/csrf', { method: 'GET' }).finally(() => { csrfPromise = null; });
  await csrfPromise;
  if (!csrfToken) throw new ApiError('CSRF_UNAVAILABLE');
}

export async function api(path, options = {}) {
  validPath(path);
  const method = String(options.method || 'GET').toUpperCase();
  if (WRITE_METHODS.has(method)) await ensureCSRF();
  return request(path, { ...options, method });
}

export async function auth() {
  return api('/auth/me');
}

export function resetAPI() {
  csrfToken = null;
  csrfPromise = null;
}
