/**
 * The app's two screens, in the URL.
 *
 * The start screen is the root; a past session is `#/session/<id>`. A hash is
 * used rather than a clean path because the site is served by GitHub Pages,
 * which hands back a file for a path and a 404 for anything else — a direct
 * visit to /writeitout/session/… would never reach the app. A hash is still a
 * real address: it can be bookmarked, shared, reloaded, and the back button
 * returns to the start screen.
 */

import { useEffect, useState } from 'react';

/** The session id in a route, or '' when this is not a session route. */
export function parseRoute(hash) {
  const raw = String(hash === undefined ? window.location.hash : hash).replace(/^#/, '');
  const match = /^\/session\/([0-9a-fA-F-]{8,64})\/?$/.exec(raw);
  return match ? { name: 'session', id: match[1].toLowerCase() } : { name: 'home', id: '' };
}

/** The address of the start screen. */
export const HOME_HASH = '#/';

/** The address of one past session. */
export function sessionHash(id) {
  return `#/session/${id}`;
}

export function goHome() {
  window.location.hash = HOME_HASH;
}

/** The current route, re-read on every hash change (including the back button). */
export default function useRoute() {
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const sync = () => setRoute(parseRoute());
    window.addEventListener('hashchange', sync);
    // A deep link that arrives with no hash at all still needs the parsed route,
    // which the initial state already holds — this only keeps it in step.
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  return route;
}
