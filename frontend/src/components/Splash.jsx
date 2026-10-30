import { useEffect, useState } from 'react';
import { googleLogout } from '@react-oauth/google';
import PaperBackground from './PaperBackground.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import { loadSessionHistory } from '../lib/sessionHistory.js';
import { fetchHistory } from '../lib/practice.js';
import { sessionHash, ADMIN_HASH } from '../lib/route.js';
import { GOOGLE_CLIENT_ID } from '../lib/googleAuth.js';
// The wordmark is inlined as markup rather than dropped into an <img>: an SVG
// loaded through <img> is an isolated document, so the Google Fonts @import
// inside the file is blocked and "writeitout" would fall back to a system
// sans-serif. Inlined, the letters render in the page's Inter and the logo's own
// 20px grid pattern keeps working. `?raw` is a Vite built-in, so the file in
// src/assets stays the single source of truth.
import logoMarkup from '../assets/writeitout.svg?raw';
import { CHRONO } from '../lib/timer.js';

// Splash screen values. Reps is the session length and the timer is the per-rep
// countdown in seconds, 0 meaning off — a session starts with no clock, and the
// game draws no countdown chip, until a timer segment is picked. The timer's
// "N/A" segment is that off switch, so it is first, before the timed choices.
// Both pickers end in a "Custom" segment that swaps in a number box; what Play
// hands over is always the number, never the segment's label.
const CUSTOM = 'custom';

const REPS_OPTIONS = [
  { value: 4, label: '4' },
  { value: 6, label: '6' },
  { value: 8, label: '8' },
  { value: 10, label: '10' },
  { value: 12, label: '12' },
  { value: CUSTOM, label: 'Custom' }
];

// N/A is 0 — the same "no clock" value a timed session runs down to — so the
// segment is a real choice rather than a placeholder, and the picker opens on it.
// Chrono is the other kind of clock: a stopwatch that counts up and never submits
// for you, for a delegate who wants the time on screen without a deadline.
const TIMER_OPTIONS = [
  { value: 0, label: 'N/A' },
  { value: CHRONO, label: 'Chrono' },
  { value: 30, label: '30s' },
  { value: 45, label: '45s' },
  { value: CUSTOM, label: 'Custom' }
];

// Bounds for the custom box. One is the floor because a session of no reps is not
// a session, and the caps stop a typed typo from drawing a progress bar with
// thousands of segments in it.
const REPS_RANGE = { min: 1, max: 100 };
const TIMER_RANGE = { min: 1, max: 600 };

// Same thresholds as the feedback card: 7+ green, 5-6 orange, below that red.
// A session that ended without a graded rep has no score, so it gets no tone.
function scoreTone(score) {
  if (!Number.isFinite(score)) return 'score-none';
  if (score >= 7) return 'score-high';
  if (score >= 5) return 'score-mid';
  return 'score-low';
}

/** 8 → "8", 7.4 → "7.4", null → "—". A session average is not always a whole number. */
function formatScore(score) {
  if (!Number.isFinite(score)) return '—';
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function SegmentedControl({ label, options, value, onChange }) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.label}
            type="button"
            className={`seg-btn ${active ? 'active' : ''}`.trim()}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The number box behind a "Custom" segment. It owns the text it is typed into, so
 * clearing it or typing through "1" on the way to "12" never fights the caret, and
 * it reports every whole number it holds. An empty or half-typed box reports
 * nothing, which leaves the last good number in place for Play to hand over; on
 * blur the box snaps back to that number, so what is shown is what will be used.
 */
function CustomNumberBox({ label, value, min, max, onCommit }) {
  const [text, setText] = useState(String(value));

  const handleChange = (event) => {
    const next = event.target.value;
    setText(next);
    const parsed = Number(next);
    if (!next.trim() || !Number.isInteger(parsed)) return;
    // Clamped rather than rejected: 0 reps or a 9,999-segment progress bar are
    // both worse than quietly landing on the nearest usable number.
    onCommit(Math.min(max, Math.max(min, parsed)));
  };

  return (
    <input
      className="seg-input"
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      aria-label={`Custom ${label}`}
      value={text}
      onChange={handleChange}
      onBlur={() => setText(String(value))}
    />
  );
}

export default function Splash({
  onStart,
  animOn = true,
  lowIntensity = false,
  // The Google session lives in App.jsx so the drill can use it too: the splash
  // only draws it. `session` is null when signed out, and a credential that
  // arrived but could not be decoded still counts as signed in — the profile card
  // then falls back to its lettered avatar.
  session = null,
  onSignIn,
  onSignOut,
  // The reps/timer from the last session (or the app defaults). Used only to seed
  // the pickers, so leaving a task and coming back keeps the same setup.
  initialSettings = null,
  // Bumped by App when a session has just been closed, so the list refetches.
  historyVersion = 0,
  // Trial mode's one-line notice, or empty when it is off (or signed in).
  trialNote = ''
}) {
  const user = session;
  const isLoggedIn = Boolean(session);
  // The one line under the button when Google reports a failure. Cleared on the
  // next attempt, so a stale error never sits next to a working button.
  const [authError, setAuthError] = useState('');
  // What Play will hand over. The numbers live here whichever segment is showing,
  // so a typed pick and a preset pick are the same thing to App.jsx. The initial
  // values come from the previous session rather than from constants.
  const [selectedReps, setSelectedReps] = useState(
    () => (initialSettings && initialSettings.reps) || 10
  );
  const [selectedTimer, setSelectedTimer] = useState(
    () => (initialSettings && initialSettings.timer) || 0
  );
  // Which row is sitting on its Custom segment. Kept apart from the numbers,
  // because a value alone cannot say whether "10" came from the preset or from the
  // box; a row that leaves Custom keeps the last typed number, so clicking between
  // the two never loses it.
  const [repsCustom, setRepsCustom] = useState(false);
  const [timerCustom, setTimerCustom] = useState(false);
  // Recent Sessions, written by App.jsx when a session finishes. Read straight
  // into state — the splash is mounted afresh on every page load, so there is
  // nothing to wait for — and then re-read whenever the account changes or another
  // tab saves a session (`storage`).
  const [recentSessions, setRecentSessions] = useState(() =>
    // Local entries only ever held a topic, a score and a date: there is no id to
    // open, so they stay plain rows while the database's own sessions are links.
    loadSessionHistory(session?.sub).map((entry) => ({ ...entry, id: '' }))
  );

  useEffect(() => {
    let cancelled = false;
    const syncFromStorage = () =>
      setRecentSessions(loadSessionHistory(session?.sub).map((entry) => ({ ...entry, id: '' })));
    syncFromStorage();
    window.addEventListener('storage', syncFromStorage);

    // Once signed in the database is the source of truth; the local bucket stays
    // as the instant (and offline) view. A failed fetch keeps what is on screen;
    // a successful one is used even when empty, because that is what the account
    // actually has.
    if (session) {
      fetchHistory().then((rows) => {
        if (cancelled || !rows) return;
        setRecentSessions(
          rows.map((row) => ({
            id: row.id || '',
            topic: row.topic || (row.completed ? 'Practice' : 'Ended early'),
            // An abandoned session has no average; show the dash, not a fake 0.
            score: Number.isFinite(row.score) ? row.score : null,
            date: row.date ? new Date(row.date).toLocaleDateString() : ''
          }))
        );
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('storage', syncFromStorage);
    };
  }, [session, historyVersion]);

  // A preset segment writes its own number; Custom only flips the row over to the
  // box, leaving whatever number was already there until the box reports a new one.
  const chooseReps = (value) => {
    setRepsCustom(value === CUSTOM);
    if (value !== CUSTOM) setSelectedReps(value);
  };

  const chooseTimer = (value) => {
    setTimerCustom(value === CUSTOM);
    if (value !== CUSTOM) setSelectedTimer(value);
  };

  // Google hands back a signed ID token (a JWT) rather than a profile. App owns
  // the session: it decodes the claims, stores the credential with its expiry and
  // hands the result back for the card. The sign-in counts either way: if the
  // token cannot be read the card shows its fallback avatar and "Delegate"
  // instead of pretending the delegate is signed out.
  const handleLoginSuccess = async ({ credential }) => {
    setAuthError('');
    const accepted = await onSignIn(credential);
    if (accepted === false) {
      setAuthError('Google signed you in, but this app rejected the credential. Please try again.');
    }
  };

  const handleLoginError = () => {
    setAuthError('Google sign-in did not finish. Please try again.');
  };

  // Signing out drops the stored session, then asks Google to forget the account
  // as well. That call only reaches into the loaded GIS script, so it is guarded:
  // signing out when Google's script never arrived must still sign the delegate
  // out of this app.
  const handleSignOut = () => {
    setAuthError('');
    onSignOut();
    try {
      googleLogout();
    } catch {
      // GIS is not on the page — there is nothing to clear on Google's side.
    }
  };

  // Play hands the whole configuration to App.jsx in one object, so the game
  // never has to know how the splash stores its state. Both values are plain
  // numbers by now — the Custom segment only contributes through its box.
  const handleStart = () => onStart({ reps: selectedReps, timer: selectedTimer });

  // What the lettered avatar shows: the delegate's initial once the name is
  // known, and the mock's "D" when there is no profile at all.
  const avatarLetter = (user?.name || 'D').trim().charAt(0).toUpperCase() || 'D';

  return (
    // is-logged-in / is-logged-out is what lets the mobile block stack the cards
    // in the right order: logo → settings → profile, or logo → sign-in → settings.
    <div className={`splash-screen ${isLoggedIn ? 'is-logged-in' : 'is-logged-out'}`}>
      <PaperBackground animOn={animOn} lowIntensity={lowIntensity} />

      <div className="split-layout">
        <div className="left-panel">
          <div className="hero-logo" dangerouslySetInnerHTML={{ __html: logoMarkup }} />

          {isLoggedIn ? (
            <div className="glass-card auth-card">
              <div className="user-row">
                <div className="user-info">
                  {/* The account photo Google returns with the token. A missing or
                      unreadable token leaves `user` null, and the card falls back
                      to the same lettered avatar the mock had. */}
                  {user?.picture ? (
                    <img
                      className="avatar"
                      src={user.picture}
                      alt={user.name || 'Google account'}
                      width="44"
                      height="44"
                      // Google's photo host 403s a request that arrives with a
                      // referrer from a site it does not know.
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="avatar" aria-hidden="true">
                      {avatarLetter}
                    </div>
                  )}
                  <div className="user-text">
                    <span className="user-name">{user?.name || 'Delegate'}</span>
                    {user?.email && <span className="user-email">{user.email}</span>}
                  </div>
                </div>
                <button type="button" className="logout-btn" onClick={handleSignOut}>
                  Sign Out
                </button>
              </div>

              {/* Only the deployment's admin sees this. The flag comes back from
                  the sign-in check, and the page behind the link checks the token
                  again — hiding the link is a courtesy, not the lock. */}
              {user?.is_admin && (
                <a className="admin-link" href={ADMIN_HASH}>
                  Developer statistics →
                </a>
              )}
            </div>
          ) : (
            <div className="glass-card auth-card">
              <div className="auth-subtitle">Sign in to keep your history under your account</div>
              {/* Google draws its own button inside an iframe, so it cannot be
                  restyled from here — the wrapper gives it the card's width and
                  the same rounded corners as the app's other buttons. The button
                  is only mounted when a client ID exists, because Google's script
                  throws on an empty one rather than failing quietly. */}
              {GOOGLE_CLIENT_ID ? (
                // Sized to the card rather than to a fixed 380: on a phone the
                // fixed width ran past the card's edge and clipped the label.
                <GoogleSignInButton
                  onSuccess={handleLoginSuccess}
                  onError={handleLoginError}
                />
              ) : (
                <p className="auth-error" role="alert">
                  Google sign-in is not configured for this build.
                </p>
              )}
              {authError && (
                <p className="auth-error" role="alert">
                  {authError}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="right-panel">
          <div className="glass-card">
            <h2 className="card-title">Start a Practice</h2>

            <div className="setting-row">
              <div className="setting-label">Runs</div>
              <div className="setting-control">
                <SegmentedControl
                  label="Runs"
                  options={REPS_OPTIONS}
                  value={repsCustom ? CUSTOM : selectedReps}
                  onChange={chooseReps}
                />
                {repsCustom && (
                  <CustomNumberBox
                    label="runs"
                    value={selectedReps}
                    min={REPS_RANGE.min}
                    max={REPS_RANGE.max}
                    onCommit={setSelectedReps}
                  />
                )}
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">Timer</div>
              <div className="setting-control">
                <SegmentedControl
                  label="Timer"
                  options={TIMER_OPTIONS}
                  value={timerCustom ? CUSTOM : selectedTimer}
                  onChange={chooseTimer}
                />
                {timerCustom && (
                  <CustomNumberBox
                    label="seconds per run"
                    value={selectedTimer}
                    min={TIMER_RANGE.min}
                    max={TIMER_RANGE.max}
                    onCommit={setSelectedTimer}
                  />
                )}
              </div>
            </div>

            {isLoggedIn && (
              <div className="history-section">
                <div className="history-title">Recent Sessions</div>
                <div className="history-list">
                  {recentSessions.length === 0 ? (
                    <p className="history-empty">No past practices</p>
                  ) : (
                    recentSessions.map((entry, index) => {
                      // Nothing in a stored entry is unique — two sessions can share
                      // a topic, a score and a date — so the row's position keys it.
                      const key = entry.id || `${entry.date}-${index}`;
                      const row = (
                        <>
                          <span className="history-topic">{entry.topic}</span>
                          <span className="history-date">{entry.date}</span>
                          <span className={`history-score ${scoreTone(entry.score)}`}>
                            {formatScore(entry.score)}
                            {Number.isFinite(entry.score) ? '/10' : ''}
                          </span>
                        </>
                      );
                      // A row with an id opens the session; a row without one came
                      // from this browser's old list and has nothing behind it.
                      return entry.id ? (
                        <a
                          className="history-item is-open"
                          key={key}
                          href={sessionHash(entry.id)}
                          title="Open this session"
                        >
                          {row}
                          <span className="history-open" aria-hidden="true">›</span>
                        </a>
                      ) : (
                        <div className="history-item" key={key}>{row}</div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              className="play-btn"
              style={isLoggedIn ? { marginTop: '0.5rem' } : undefined}
              onClick={handleStart}
            >
              Play
            </button>
            {trialNote && <p className="trial-note">{trialNote}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
