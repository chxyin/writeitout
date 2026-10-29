/**
 * One place for the chair API: base URL, the signed-in credential, a timeout and
 * a readable error.
 *
 * Every call is bounded in time. A Vercel function that hangs must surface as a
 * failed save, not as a screen stuck on "saving…".
 */

import { authorizationHeaders } from './auth.js';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8000' : 'https://writeitout-backend.vercel.app');

const DEFAULT_TIMEOUT_MS = 8_000;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(
  path,
  { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, keepalive = false } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : null),
        ...authorizationHeaders()
      },
      body: body ? JSON.stringify(body) : undefined,
      // A keepalive request is allowed to outlive the document, which is what
      // lets a save finish while the tab is closing.
      keepalive,
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data && typeof data.detail === 'string' ? data.detail : null;
      throw new ApiError(detail || `Request failed (${response.status})`, response.status);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body })
};

export { ApiError };
