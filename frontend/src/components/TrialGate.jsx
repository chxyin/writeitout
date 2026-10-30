/**
 * The sign-in gate trial mode puts in front of a second practice.
 *
 * It has to say plainly why the sign-in exists, because the honest answer —
 * "because we are counting users for a school project" — is also the one that
 * makes a stranger willing to sign in with Google.
 */

import GoogleSignInButton from './GoogleSignInButton.jsx';
import { GOOGLE_CLIENT_ID } from '../lib/googleAuth.js';

export default function TrialGate({
  notice,
  onSignIn,
  onDismiss,
  onExit,
  authError,
  onAuthError
}) {
  const handleSignIn = async ({ credential }) => {
    onAuthError('');
    const accepted = await onSignIn(credential);
    if (accepted === false) {
      onAuthError('Google signed you in, but this app rejected the credential. Please try again.');
    }
  };

  return (
    <div className="trial-backdrop" role="dialog" aria-modal="true" aria-labelledby="trial-title">
      <div className="glass-card trial-gate">
        <h2 className="card-title" id="trial-title">One practice, then sign in</h2>
        <p className="trial-copy">{notice}</p>

        {GOOGLE_CLIENT_ID && onSignIn ? (
          <GoogleSignInButton
            onSuccess={handleSignIn}
            onError={() => onAuthError('Google sign-in did not finish. Please try again.')}
          />
        ) : (
          <p className="auth-error" role="alert">Google sign-in is not configured for this build.</p>
        )}
        {authError && <p className="auth-error" role="alert">{authError}</p>}

        <div className="trial-actions">
          <button type="button" className="exit-task-btn" onClick={onDismiss}>
            Keep looking around
          </button>
          <button type="button" className="exit-task-btn" onClick={onExit}>
            Back to start
          </button>
        </div>
      </div>
    </div>
  );
}
