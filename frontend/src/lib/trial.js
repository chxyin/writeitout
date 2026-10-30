/**
 * The trial's visitor id.
 *
 * It is a cookie the page sets for itself rather than one the API sets: the API
 * lives on another origin, so its cookie would be third-party and the browser
 * would quietly drop it. First-party here, sent to the API as a header, and it is
 * only ever used to count practices.
 */

const COOKIE = 'writeitout_visitor';

function readCookie() {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // Fall through to the timestamp form.
  }
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** The id this browser keeps, created on first use and kept for a year. */
export function visitorId() {
  const existing = readCookie();
  if (existing.length >= 8) return existing;
  const id = randomId();
  try {
    document.cookie = `${COOKIE}=${id}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // A blocked cookie still gets the in-page id for this visit.
  }
  return id;
}
