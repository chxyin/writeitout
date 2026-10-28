import { useEffect, useState } from 'react';
import PaperBackground from './PaperBackground.jsx';
import { loadSessionHistory } from '../lib/sessionHistory.js';
// The wordmark is inlined as markup rather than dropped into an <img>: an SVG
// loaded through <img> is an isolated document, so the Google Fonts @import
// inside the file is blocked and "writeitout" would fall back to a system
// sans-serif. Inlined, the letters render in the page's Inter and the logo's own
// 20px grid pattern keeps working. `?raw` is a Vite built-in, so the file in
// src/assets stays the single source of truth.
import logoMarkup from '../assets/writeitout.svg?raw';

// Splash screen values. Reps is the session length and the timer is the per-rep
// countdown in seconds, 0 meaning off — a session starts with no clock, and the
// game draws no countdown chip, until a timer segment is picked. Both pickers end
// in a "Custom" segment that swaps in a number box; what Play hands over is always
// the number, never the segment's label.
const CUSTOM = 'custom';

const REPS_OPTIONS = [
  { value: 4, label: '4' },
  { value: 6, label: '6' },
  { value: 8, label: '8' },
  { value: 10, label: '10' },
  { value: 12, label: '12' },
  { value: 14, label: '14' },
  { value: CUSTOM, label: 'Custom' }
];

const TIMER_OPTIONS = [
  { value: 15, label: '15s' },
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
function scoreTone(score) {
  if (score >= 7) return 'score-high';
  if (score >= 5) return 'score-mid';
  return 'score-low';
}

/** 8 → "8", 7.4 → "7.4". A session's average is not always a whole number. */
function formatScore(score) {
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

export default function Splash({ onStart, animOn = true, lowIntensity = false }) {
  // Stand-in for the real Supabase session (handoff item 3). Sign In flips it, so
  // both states of the mock are reachable; Sign Out puts it back.
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // What Play will hand over. The numbers live here whichever segment is showing,
  // so a typed pick and a preset pick are the same thing to App.jsx.
  const [selectedReps, setSelectedReps] = useState(10);
  const [selectedTimer, setSelectedTimer] = useState(0);
  // Which row is sitting on its Custom segment. Kept apart from the numbers,
  // because a value alone cannot say whether "10" came from the preset or from the
  // box; a row that leaves Custom keeps the last typed number, so clicking between
  // the two never loses it.
  const [repsCustom, setRepsCustom] = useState(false);
  const [timerCustom, setTimerCustom] = useState(false);
  // Recent Sessions, written by App.jsx when a session finishes. Read straight
  // into state — the splash is mounted afresh on every page load, so there is
  // nothing to wait for — and then kept in step through the `storage` event,
  // which is what fires when another tab saves a session.
  const [recentSessions, setRecentSessions] = useState(loadSessionHistory);

  useEffect(() => {
    const syncFromStorage = () => setRecentSessions(loadSessionHistory());
    window.addEventListener('storage', syncFromStorage);
    return () => window.removeEventListener('storage', syncFromStorage);
  }, []);

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

  // Play hands the whole configuration to App.jsx in one object, so the game
  // never has to know how the splash stores its state. Both values are plain
  // numbers by now — the Custom segment only contributes through its box.
  const handleStart = () => onStart({ reps: selectedReps, timer: selectedTimer });

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
                  <div className="avatar">D</div>
                  <div className="user-text">
                    <span className="user-name">Delegate</span>
                    <span className="user-level">Level 4 • 650 XP</span>
                  </div>
                </div>
                <button type="button" className="logout-btn" onClick={() => setIsLoggedIn(false)}>
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div className="glass-card auth-card">
              <div className="auth-subtitle">Sign in to save your progress and streaks</div>
              <button type="button" className="auth-btn" onClick={() => setIsLoggedIn(true)}>
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.67 15.63 16.86 16.79 15.69 17.57V20.34H19.26C21.35 18.42 22.56 15.6 22.56 12.25Z" fill="#4285F4" />
                  <path d="M12 23C14.97 23 17.46 22.02 19.26 20.34L15.69 17.57C14.71 18.23 13.47 18.63 12 18.63C9.16 18.63 6.75 16.71 5.88 14.13H2.21V16.97C4.01 20.54 7.7 23 12 23Z" fill="#34A853" />
                  <path d="M5.88 14.13C5.66 13.47 5.54 12.76 5.54 12C5.54 11.24 5.66 10.53 5.88 9.87V7.03H2.21C1.48 8.49 1.04 10.19 1.04 12C1.04 13.81 1.48 15.51 2.21 16.97L5.88 14.13Z" fill="#FBBC05" />
                  <path d="M12 5.38C13.62 5.38 15.06 5.94 16.21 7.03L19.34 3.9C17.46 2.15 14.97 1 12 1C7.7 1 4.01 3.46 2.21 7.03L5.88 9.87C6.75 7.29 9.16 5.38 12 5.38Z" fill="#EA4335" />
                </svg>
                Continue with Google
              </button>
            </div>
          )}
        </div>

        <div className="right-panel">
          <div className="glass-card">
            <h2 className="card-title">Start a Practice</h2>

            <div className="setting-row">
              <div className="setting-label">Reps</div>
              <div className="setting-control">
                <SegmentedControl
                  label="Reps"
                  options={REPS_OPTIONS}
                  value={repsCustom ? CUSTOM : selectedReps}
                  onChange={chooseReps}
                />
                {repsCustom && (
                  <CustomNumberBox
                    label="reps"
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
                    label="seconds per rep"
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
                    recentSessions.map((session, index) => (
                      // Nothing in a stored entry is unique — two sessions can share
                      // a topic, a score and a date — so the row's position keys it.
                      <div className="history-item" key={`${session.date}-${index}`}>
                        <span className="history-topic">{session.topic}</span>
                        <span className="history-date">{session.date}</span>
                        <span className={`history-score ${scoreTone(session.score)}`}>
                          {formatScore(session.score)}/10
                        </span>
                      </div>
                    ))
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
          </div>
        </div>
      </div>
    </div>
  );
}
