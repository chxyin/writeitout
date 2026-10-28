import { useState, useEffect, useRef, useCallback } from 'react';

const COLOR_THEMES = [
  { id: 'default', label: 'Ocean', color: '#2B5CE6' },
  { id: 'midnight', label: 'Midnight', color: '#121212' },
  { id: 'forest', label: 'Forest', color: '#0B4A31' }
];

const BACKGROUNDS = [
  { id: 'grid', label: 'Grid' },
  { id: 'glow', label: 'Glow' },
  { id: 'spotlight', label: 'Spotlight' },
  { id: 'plain', label: 'Plain' }
];

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? 'http://127.0.0.1:8000'
    : 'https://writeitout-backend.vercel.app');

function describeApiError(data, status) {
  const detail = data && data.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => item && item.msg).filter(Boolean);
    if (messages.length) return messages.join(' ');
  }
  if (status === 429) return 'The chair is busy. Please wait a moment and try again.';
  return `The chair could not grade that POI (error ${status}). Please try again.`;
}

export default function App() {
  const [currentDrill, setCurrentDrill] = useState(null);
  const [loadingDrill, setLoadingDrill] = useState(true);
  const [drillError, setDrillError] = useState('');
  const [repCount, setRepCount] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [mode, setMode] = useState('single'); // 'single' or 'full'
  const [poi, setPoi] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [formExiting, setFormExiting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitError, setSubmitError] = useState('');
  
  // Settings State
  const [showMenu, setShowMenu] = useState(false);
  const [animOn, setAnimOn] = useState(true);
  const [showTopic, setShowTopic] = useState(true);
  const [showComm, setShowComm] = useState(true);
  const [theme, setTheme] = useState('default');
  const [background, setBackground] = useState('grid');
  const [lowIntensity, setLowIntensity] = useState(false);
  const exitTimer = useRef(null);

  const activePrompt = currentDrill
    ? mode === 'single' ? currentDrill.single_claim : currentDrill.full_speech
    : '';

  const fetchRandomDrill = useCallback(async () => {
    setLoadingDrill(true);
    setDrillError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/random-speech`);
      if (!response.ok) throw new Error(`Speech request failed (${response.status})`);
      const data = await response.json();
      setCurrentDrill({
        committee: data.committee,
        delegate: data.country,
        topic: data.topic,
        full_speech: data.text,
        single_claim: data.single_claim
      });
    } catch (error) {
      setDrillError(error.message);
    } finally {
      setLoadingDrill(false);
    }
  }, []);

  useEffect(() => {
    const loadDrill = setTimeout(fetchRandomDrill, 0);
    return () => clearTimeout(loadDrill);
  }, [fetchRandomDrill]);

  useEffect(() => {
    document.body.className = '';
    if (theme !== 'default') document.body.classList.add(`theme-${theme}`);
    if (!animOn) document.body.classList.add('no-anim');
    if (!showTopic) document.body.classList.add('hide-topic');
    if (!showComm) document.body.classList.add('hide-comm');
    document.body.classList.add(`background-${background}`);
    if (lowIntensity) document.body.classList.add('low-intensity');
  }, [theme, background, lowIntensity, animOn, showTopic, showComm]);

  useEffect(() => {
    const container = document.getElementById('paper-container');
    if (!container) return;
    container.innerHTML = '';
    if (!animOn || lowIntensity) return;
    const isTouch = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    const paperCount = lowIntensity ? 3 : (isTouch ? 4 : 9);
    for (let i = 0; i < paperCount; i++) {
      const paper = document.createElement('div');
      paper.classList.add('paper');
      const size = Math.random() * 40 + 40;
      paper.style.width = `${size}px`;
      paper.style.height = `${size * 1.3}px`;
      paper.style.left = `${Math.random() * 100}vw`;
      paper.style.animationDuration = `${Math.random() * 10 + 18}s`;
      paper.style.animationDelay = `${Math.random() * -20}s`;
      paper.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(paper);
    }

    let frameId = 0;
    const onMove = (e) => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
      const x = (e.clientX / window.innerWidth - 0.5) * 28;
      const y = (e.clientY / window.innerHeight - 0.5) * 18;
      container.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        frameId = 0;
      });
    };
    const canParallax = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
    if (canParallax) window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      if (canParallax) window.removeEventListener('mousemove', onMove);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [animOn, lowIntensity]);

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  const wordCount = poi.trim() ? poi.trim().split(/\s+/).length : 0;
  const isOverLimit = wordCount > 40;

  const handleSubmit = async () => {
    if (!currentDrill || !poi || isOverLimit || loading) return;
    setLoading(true);
    setSubmitError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speech: currentDrill.full_speech,
          poi: poi,
          is_solutions_only: mode === 'single'
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(describeApiError(data, response.status));
      }
      if (!data || typeof data.score !== 'number') {
        throw new Error('The chair returned an unexpected response. Please try again.');
      }

      setFeedback(data);
      setFormExiting(true);
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        setShowFeedback(true);
        setFormExiting(false);
      }, 300);
    } catch (error) {
      setSubmitError(error.message || 'Error connecting to Chair API.');
    } finally {
      setLoading(false);
    }
  };

  const handleNextRep = () => {
    setFeedback(null);
    setShowFeedback(false);
    setFormExiting(false);
    setPoi('');
    setSubmitError('');
    const nextRepCount = repCount + 1;
    setRepCount(nextRepCount);
    if (nextRepCount >= 5) {
      setSessionComplete(true);
      return;
    }
    fetchRandomDrill();
  };

  const handleStartSession = () => {
    setRepCount(0);
    setSessionComplete(false);
    setFeedback(null);
    setShowFeedback(false);
    setFormExiting(false);
    setPoi('');
    setSubmitError('');
    fetchRandomDrill();
  };

  const getScoreColor = (score) => {
    if (score >= 9) return '#34C759';
    if (score >= 7) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  };

  return (
    <>
      <div className="settings-container">
        <button className="settings-btn" onClick={() => setShowMenu(!showMenu)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0 1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>

        {showMenu && (
          <div className="settings-menu">
            <div className="setting-item">
              <span>Falling Papers</span>
              <div className={`toggle-switch-sm ${animOn ? 'active' : ''}`} onClick={() => setAnimOn(!animOn)}><div className="toggle-knob-sm"></div></div>
            </div>
            <div className="setting-item">
              <span>Show Topic Tag</span>
              <div className={`toggle-switch-sm ${showTopic ? 'active' : ''}`} onClick={() => setShowTopic(!showTopic)}><div className="toggle-knob-sm"></div></div>
            </div>
            <div className="setting-item">
              <span>Show Comm/Delegation</span>
              <div className={`toggle-switch-sm ${showComm ? 'active' : ''}`} onClick={() => setShowComm(!showComm)}><div className="toggle-knob-sm"></div></div>
            </div>
            <div className="setting-item">
              <span>Low Intensity</span>
              <div className={`toggle-switch-sm ${lowIntensity ? 'active' : ''}`} onClick={() => setLowIntensity(!lowIntensity)}><div className="toggle-knob-sm"></div></div>
            </div>
            <div style={{ height: '1px', background: '#ddd', margin: '4px 0' }}></div>
            <div className="setting-item">
              <span>Color</span>
              <div className="theme-dots" role="group" aria-label="Choose color theme">
                {COLOR_THEMES.map((option) => (
                  <button
                    className={`theme-dot ${theme === option.id ? 'active' : ''}`}
                    style={{ '--theme-color': option.color }}
                    aria-label={option.label}
                    title={option.label}
                    key={option.id}
                    onClick={() => setTheme(option.id)}
                  />
                ))}
              </div>
            </div>
            <div className="setting-item setting-item-column">
              <span>Background</span>
              <div className="background-options" role="group" aria-label="Choose background">
                {BACKGROUNDS.map((option) => (
                  <button
                    className={`background-option background-option-${option.id} ${background === option.id ? 'active' : ''}`}
                    key={option.id}
                    onClick={() => setBackground(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="paper-container" id="paper-container"></div>

      <div className={`app-container mode-${mode}`}>
        <div className="progress-bar stagger-in stagger-1"><div className="progress-fill" style={{ width: `${(repCount / 5) * 100}%` }}></div></div>
        <div className="toggle-container stagger-in stagger-2">
          <span style={{ opacity: mode === 'full' ? 1 : 0.5 }}>Full Speech</span>
          <div className={`toggle-switch ${mode === 'full' ? 'active' : ''}`} onClick={() => setMode(mode === 'full' ? 'single' : 'full')}>
            <div className="toggle-knob"></div>
          </div>
          <span style={{ opacity: mode === 'single' ? 1 : 0.5 }}>Solutions Only</span>
        </div>

        {sessionComplete ? (
          <div className="session-complete feedback-card">
            <div className="feedback-score">5/5</div>
            <div className="feedback-label">Session Complete</div>
            <p>Great job! You completed 5 reps.</p>
            <button className="next-btn" onClick={handleStartSession}>
              Start New Session
            </button>
          </div>
        ) : !showFeedback ? (
          <div className={`drill-form ${formExiting ? 'is-exiting' : ''}`}>
            <div className="split-panes">
              <div className="left-pane">
                {loadingDrill && <div className="loading-message">Loading new speech...</div>}
                {!loadingDrill && drillError && <div className="loading-message error-message">{drillError}</div>}
                {!loadingDrill && !drillError && currentDrill && (
                  <div className="prompt-card stagger-in stagger-3">
                    <span className="prompt-tag">
                      <span>{currentDrill.topic}</span>
                      <span id="comm-text"> | {currentDrill.committee} - {currentDrill.delegate}</span>
                    </span>
                    <div className="prompt-scroll">"{activePrompt}"</div>
                  </div>
                )}
              </div>

              <div className="right-pane">
                {!loadingDrill && !drillError && currentDrill && <>
                  <div className="poi-input-area stagger-in stagger-4">
                    <div className="input-label">
                      <span>Your POI</span>
                      <span className="word-counter" style={{ color: isOverLimit ? 'var(--accent-red)' : '' }}>{wordCount} / 40 words</span>
                    </div>
                    {mode === 'single' && (
                      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '8px' }}>
                        Your goal is to attack the funding, feasibility, or logic of these proposed solutions.
                      </p>
                    )}
                    <textarea
                      value={poi}
                      onChange={(e) => {
                        setPoi(e.target.value);
                        if (submitError) setSubmitError('');
                      }}
                      placeholder="Type your Point of Information here..."
                    />
                  </div>

                  {submitError && (
                    <div className="submit-error" role="alert">{submitError}</div>
                  )}

                  <button className="submit-btn stagger-in stagger-5" onClick={handleSubmit} disabled={loading || !poi || isOverLimit}>
                    {loading ? 'Chair is Grading...' : 'Submit POI'}
                  </button>
                </>}
              </div>
            </div>
          </div>
        ) : (
          <div className="feedback-card">
            <div className="feedback-score" style={{ color: getScoreColor(feedback.score) }}>{feedback.score}/10</div>
            <div className="feedback-label">{feedback.grade_label}</div>
            
            <p><strong>Reasoning:</strong> {feedback.reasoning}</p>
            <p><strong>Advice:</strong> {feedback.constructive_feedback}</p>

            <div className="rewrite-box">
              <span>Your POI, Improved</span>
              <p>"{feedback.rewritten_poi}"</p>
            </div>

            <button className="next-btn" onClick={handleNextRep}>
              Next Rep →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
