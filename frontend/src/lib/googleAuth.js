/**
 * Google Sign-In pieces shared by the app shell (the provider) and the splash
 * screen (the button and the profile card).
 *
 * The client ID is baked into the bundle at build time by Vite from
 * `VITE_GOOGLE_CLIENT_ID`, so one deployment talks to exactly one OAuth client.
 * It is not a secret: Google checks the origin the token is requested from, and
 * the value is readable in the built JS either way.
 */

import { jwtDecode } from 'jwt-decode';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

/**
 * Reads the profile out of the ID token Google hands back on a successful
 * sign-in. The token is a signed JWT that arrived straight from Google's own
 * script, so this only *decodes* the payload — it never verifies the signature,
 * which is a backend job if an endpoint ever needs to trust the claims.
 *
 * Returns null when there is no token or it cannot be read. That is exactly the
 * "signed in but no profile" case the splash card draws its fallback avatar for.
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
    name: typeof claims.name === 'string' ? claims.name : '',
    email: typeof claims.email === 'string' ? claims.email : '',
    picture: typeof claims.picture === 'string' ? claims.picture : ''
  };
}
