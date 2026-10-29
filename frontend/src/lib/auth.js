/**
 * The signed-in session, kept in one place.
 *
 * A Google ID token is a credential, not a session: it lives about an hour and
 * cannot be refreshed. So the app stores the token next to the claims it decoded
 * and the moment it expires, and treats the pair as the session. Every read
 * checks the clock, so a stale token can never be presented as a signed-in user.
 *
 * The backend (POST /api/auth/google) is the only party that can *verify* the
 * token; this module's job is to hold it, expire it and hand it to requests.
 */

import { useCallback, useEffect, useState } from 'react';
import { decodeGoogleCredential } from './googleAuth.js';

const SESSION_STORAGE_KEY = 'writeitout:session';

/** True while the credential is still inside its own validity window. */
function isLive(session) {
  if (!session || typeof session.credential !== 'string') return false;
  if (!session.exp) return false;
  return session.exp * 1000 > Date.now() + 30_000; // 30s of slack for clock skew
}

/**
 * Builds a session from the credential Google returned. A token that cannot be
 * decoded still signs the delegate in — the card falls back to a lettered avatar
 * — but it carries no expiry, so it is never persisted and cannot outlive the
 * page.
 */
export function createSession(credential) {
  const claims = decodeGoogleCredential(credential);
  if (!claims) return { credential, sub: '', name: '', email: '', picture: '', exp: 0 };
  return { credential, ...claims };
}

/** The stored session, or null when there is none or it has expired. */
export function loadSession() {
  if (typeof window === 'undefined') return null;
  let parsed;
  try {
    parsed = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const session = {
    credential: typeof parsed.credential === 'string' ? parsed.credential : '',
    sub: typeof parsed.sub === 'string' ? parsed.sub : '',
    name: typeof parsed.name === 'string' ? parsed.name : '',
    email: typeof parsed.email === 'string' ? parsed.email : '',
    picture: typeof parsed.picture === 'string' ? parsed.picture : '',
    exp: Number.isFinite(parsed.exp) ? parsed.exp : 0
  };
  if (!isLive(session)) return null;
  return session;
}

export function saveSession(session) {
  if (typeof window === 'undefined') return;
  try {
    if (session && session.exp) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Private browsing or a full quota: the session still lives in memory.
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Headers for an authenticated request, or an empty object when signed out.
 * `/api/grade` accepts both; the token is what lets the API meter a person
 * rather than an IP once its verification step is switched on.
 */
export function authorizationHeaders() {
  const session = loadSession();
  return session ? { Authorization: `Bearer ${session.credential}` } : {};
}

/**
 * The session, plus the two ways it changes. `signIn` returns the session it
 * built so the caller can tell a decoded credential from an unreadable one.
 */
export default function useAuthSession() {
  const [session, setSession] = useState(loadSession);

  const signIn = useCallback((credential) => {
    const next = createSession(credential);
    saveSession(next);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  // The token can expire while the tab sits open. Drop it on the same second
  // rather than on the next reload, so the profile card and the stored history
  // never claim a signed-in user the API would reject.
  useEffect(() => {
    if (!session || !session.exp) return undefined;
    const ms = session.exp * 1000 - Date.now();
    // A session that is already past its expiry is dropped on the next task
    // rather than inside the effect body, which must not start a state update.
    const timer = window.setTimeout(signOut, ms > 0 ? ms + 1000 : 0);
    return () => window.clearTimeout(timer);
  }, [session, signOut]);

  return { session, signIn, signOut };
}
