import { useState } from 'react';
import PaperBackground from './PaperBackground.jsx';
// The wordmark is inlined as markup rather than dropped into an <img>: an SVG
// loaded through <img> is an isolated document, so the Google Fonts @import
// inside the file is blocked and "writeitout" would fall back to a system
// sans-serif. Inlined, the letters render in the page's Inter and the logo's own
// 20px grid pattern keeps working. `?raw` is a Vite built-in, so the file in
// src/assets stays the single source of truth.
import logoMarkup from '../assets/writeitout.svg?raw';

// Splash screen values. Reps comes from the segmented picker (∞ is stored as
// Infinity, which App.jsx treats as a session with no end); the timer is the
// per-rep countdown in seconds, 0 meaning off.
const REPS_OPTIONS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: Infinity, label: '∞' }
];

const TIMER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' }
];

// Placeholder for the logged-in "Recent Sessions" list until sessions are stored
// (handoff item: save the score and topic when a session finishes).
const RECENT_SESSIONS = [
  { id: 1, topic: 'AI Governance', date: 'Yesterday', score: 8 },
  { id: 2, topic: 'Maritime Piracy', date: 'Oct 22', score: 6 },
  { id: 3, topic: 'Nuclear Deterrence', date: 'Oct 20', score: 9 },
  { id: 4, topic: 'Water Crisis', date: 'Oct 18', score: 4 },
  { id: 5, topic: 'Human Trafficking', date: 'Oct 15', score: 8 }
];

// Same thresholds as the feedback card: 7+ green, 5-6 orange, below that red.
function scoreTone(score) {
  if (score >= 7) return 'score-high';
  if (score >= 5) return 'score-mid';
  return 'score-low';
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
 * One label + switch row. The <input> stays in the DOM (hidden by
 * `.splash-screen input[type="checkbox"]`) because the visible switch is drawn by
 * `.toggle-switch` and its `:checked + .toggle-switch` state — so the input has to
 * be the switch's immediate previous sibling, and clicking anywhere in the label
 * toggles it natively.
 */
function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={() => onChange(!checked)} />
      <div className="toggle-switch" aria-hidden="true" />
    </label>
  );
}


export default function Splash({ onStart, animOn = true, lowIntensity = false }) {
  // Stand-in for the real Supabase session (handoff item 3). Sign In flips it, so
  // both states of the mock are reachable; Sign Out puts it back.
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [reps, setReps] = useState(5);
  const [timer, setTimer] = useState(0);
  const [streak, setStreak] = useState(false);
  const [hints, setHints] = useState(true);
  const [sound, setSound] = useState(true);
  const [shake, setShake] = useState(true);

  // Play hands the whole configuration to App.jsx in one object, so the game
  // never has to know how the splash stores its state.
  const handleStart = () => onStart({ reps, timer, streak, hints, sound, shake });

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
              <SegmentedControl label="Reps" options={REPS_OPTIONS} value={reps} onChange={setReps} />
            </div>
            <div className="setting-row">
              <div className="setting-label">Timer</div>
              <SegmentedControl label="Timer" options={TIMER_OPTIONS} value={timer} onChange={setTimer} />
            </div>

            <div className="divider" />

            <ToggleRow label="🔥 Streak Mode" checked={streak} onChange={setStreak} />
            <ToggleRow label="💡 Show Hints" checked={hints} onChange={setHints} />
            <ToggleRow label="🔊 Sound" checked={sound} onChange={setSound} />
            <ToggleRow label="📳 Screen Shake" checked={shake} onChange={setShake} />

            {isLoggedIn && (
              <div className="history-section">
                <div className="history-title">Recent Sessions</div>
                <div className="history-list">
                  {RECENT_SESSIONS.map((session) => (
                    <div className="history-item" key={session.id}>
                      <span className="history-topic">{session.topic}</span>
                      <span className="history-date">{session.date}</span>
                      <span className={`history-score ${scoreTone(session.score)}`}>{session.score}/10</span>
                    </div>
                  ))}
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
