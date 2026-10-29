/**
 * Google Sign-In pieces shared by the app shell (the provider), the session
 * store and the splash screen.
 *
 * The client ID is baked into the bundle at build time by Vite from
 * `VITE_GOOGLE_CLIENT_ID`, so one deployment talks to exactly one OAuth client.
 * It is not a secret: Google checks the origin the token is requested from, and
 * the value is readable in the built JS either way. The fallback is this
 * project's own Web client, which keeps a build that forgets the variable from
 * shipping a sign-in button that cannot work; set the variable to point a fork
 * at its own client.
 */

import { jwtDecode } from 'jwt-decode';

const PROJECT_CLIENT_ID =
  '802894837975-lmjp3uam5tjc641a8sfknsb59218mtoe.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || PROJECT_CLIENT_ID;

/**
 * Reads the profile and the session-critical claims out of the ID token Google
 * hands back on a successful sign-in. The token is a signed JWT that arrived
 * straight from Google's own script, so this only *decodes* the payload — it
 * never verifies the signature, which is the backend's job (POST /api/auth/google
 * does exactly that).
 *
 * Returns null when there is no token or it cannot be read. That is exactly the
 * "signed in but no profile" case the splash card draws its fallback avatar for.
 *
 * `sub` is the stable account id — unlike the address, it never changes — and
 * `exp` is the token's own expiry (seconds since the epoch), which the session
 * store uses to drop a stale credential instead of trusting it after a reload.
 */
export function decodeGoogleCredential(credential) {
  if (typeof credential !== 'string' || credential.length === 0) return null;
  let claims;
  try {
    claims = jwtDecode(credential);
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  // Every claim is optional in the ID token, so each one is narrowed here and a
  // missing one leaves an empty string rather than undefined in the UI.
  return {
    sub: typeof claims.sub === 'string' ? claims.sub : '',
    name: typeof claims.name === 'string' ? claims.name : '',
    email: typeof claims.email === 'string' ? claims.email : '',
    picture: typeof claims.picture === 'string' ? claims.picture : '',
    emailVerified: claims.email_verified === true,
    exp: Number.isFinite(claims.exp) ? claims.exp : 0
  };
}
