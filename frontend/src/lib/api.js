/**
 * One place for the chair API: base URL, the signed-in credential, a timeout and
 * a readable error.
 *
 * Every call is bounded in time. A Vercel function that hangs must surface as a
 * failed save, not as a screen stuck on "savingâ€¦".
 */

import { authorizationHeaders } from './auth.js';
import { visitorId } from './trial.js';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8000' : 'https://writeitout-backend.vercel.app');

const DEFAULT_TIMEOUT_MS = 8_000;

class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // A short machine label the server attached ("stats.habits"). It is what
    // turns "it broke" into a diagnosis, so the page shows it to the reader.
    this.code = code;
  }
}

/**
 * The error body, as a message and a code. FastAPI's `detail` is a string for
 * most failures and an object `{ message, code }` for the ones that carry a
 * code â€” both shapes arrive here and leave as two strings.
 */
function readError(data) {
  const detail = data && data.detail;
  if (typeof detail === 'string') return { message: detail, code: null };
  const object = detail && typeof detail === 'object' ? detail : null;
  return {
    message: (object && object.message) || null,
    code: (object && object.code) || (data && data.code) || null
  };
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
        ...authorizationHeaders(),
        // The trial's counter. It is only read by the grade endpoint, and only
        // when the deployment has trial mode on.
        'X-Visitor': visitorId()
      },
      body: body ? JSON.stringify(body) : undefined,
      // A keepalive request is allowed to outlive the document, which is what
      // lets a save finish while the tab is closing.
      keepalive,
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const { message, code } = readError(data);
      throw new ApiError(message || `Request failed (${response.status})`, response.status, code);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' })
};

export { ApiError };
