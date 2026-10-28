import { useState, useEffect, useRef, useCallback } from 'react';
import SettingsMenu from './components/SettingsMenu.jsx';
import { DEFAULT_ZOOM, clampZoom } from './lib/zoom.js';
import PaperBackground from './components/PaperBackground.jsx';
import DrillForm from './components/DrillForm.jsx';
import FeedbackCard from './components/FeedbackCard.jsx';
import SessionComplete from './components/SessionComplete.jsx';
import useBreakpoint from './hooks/useBreakpoint.js';

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

const SETTINGS_STORAGE_KEY = 'writeitout:settings';

const DEFAULT_SETTINGS = {
  animOn: true,
  showTopic: true,
  showComm: true,
  lowIntensity: false,
  theme: 'default',
  background: 'grid',
  zoom: DEFAULT_ZOOM
};

/**
 * Restores the settings saved by a previous visit. Anything malformed is
 * ignored field by field, so a stale or hand-edited entry can never break the
 * first render (a bad number would otherwise reach the zoom CSS variable).
 */
function loadSettings() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  let parsed;
  try {
    parsed = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_SETTINGS;
  return {
    animOn: Boolean(parsed.animOn ?? DEFAULT_SETTINGS.animOn),
    showTopic: Boolean(parsed.showTopic ?? DEFAULT_SETTINGS.showTopic),
    showComm: Boolean(parsed.showComm ?? DEFAULT_SETTINGS.showComm),
    lowIntensity: Boolean(parsed.lowIntensity ?? DEFAULT_SETTINGS.lowIntensity),
    theme: typeof parsed.theme === 'string' ? parsed.theme : DEFAULT_SETTINGS.theme,
    background: typeof parsed.background === 'string' ? parsed.background : DEFAULT_SETTINGS.background,
    zoom: clampZoom(parsed.zoom ?? DEFAULT_SETTINGS.zoom)
  };
}

function persistSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota: the app still works, it just forgets.
  }
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

  // Session length is the single source of truth for the progress bar, the
  // next-rep check and the completion screen. The set-length / repetition
  // picker will write to this state instead of a hard-coded number.
  const [sessionLength] = useState(5);

  // Settings state. Restored from localStorage on the first render, then
  // written back on every change so the app opens the way it was left.
  const [showMenu, setShowMenu] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const { animOn, showTopic, showComm, theme, background, lowIntensity, zoom } = settings;
  const exitTimer = useRef(null);

  const updateSetting = useCallback((key, value) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }, []);

  // Responsive tier. Desktops keep the original wide layout, tablets split the
  // prompt and the POI field into two columns, phones get a single column.
  const { isMobile, isTablet, orientation } = useBreakpoint();
  const tier = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

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
    persistSettings(settings);
  }, [settings]);

  // Zoom rides on a single CSS variable consumed by the app shell and the
  // settings button, so the whole UI scales consistently without any layout
  // code knowing about it.
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(zoom));
  }, [zoom]);

  // Mirror the tier onto <body> so page-level rules (settings button, papers)
  // follow the same breakpoints as the app shell. data-* survives the
  // className reset above, so the two effects never fight each other.
  useEffect(() => {
    document.body.dataset.tier = tier;
    document.body.dataset.orientation = orientation;
    return () => {
      delete document.body.dataset.tier;
      delete document.body.dataset.orientation;
    };
  }, [tier, orientation]);

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  const wordCount = poi.trim() ? poi.trim().split(/\s+/).length : 0;

  const handleSubmit = async () => {
    if (!currentDrill || !poi || loading) return;
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
    if (nextRepCount >= sessionLength) {
      setSessionComplete(true);
      return;
    }
    fetchRandomDrill();
  };

  const handleBackToEdit = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setFeedback(null);
    setShowFeedback(false);
    setFormExiting(false);
    setSubmitError('');
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

  const handlePoiChange = (value) => {
    setPoi(value);
    if (submitError) setSubmitError('');
  };

  const getScoreColor = (score) => {
    if (score >= 9) return '#34C759';
    if (score >= 7) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  };

  return (
    <>
      <SettingsMenu
        open={showMenu}
        onToggle={() => setShowMenu(!showMenu)}
        animOn={animOn}
        onAnimToggle={() => updateSetting('animOn', !animOn)}
        showTopic={showTopic}
        onShowTopicToggle={() => updateSetting('showTopic', !showTopic)}
        showComm={showComm}
        onShowCommToggle={() => updateSetting('showComm', !showComm)}
        lowIntensity={lowIntensity}
        onLowIntensityToggle={() => updateSetting('lowIntensity', !lowIntensity)}
        theme={theme}
        onThemeChange={(value) => updateSetting('theme', value)}
        background={background}
        onBackgroundChange={(value) => updateSetting('background', value)}
        zoom={zoom}
        onZoomChange={(value) => updateSetting('zoom', value)}
      />

      <PaperBackground animOn={animOn} lowIntensity={lowIntensity} />

      <div
        className={`app-container mode-${mode}`}
        data-tier={tier}
        data-orientation={orientation}
      >
        <div className="progress-bar stagger-in stagger-1">
          <div
            className="progress-segments"
            role="progressbar"
            aria-label="Session progress"
            aria-valuemin={0}
            aria-valuemax={sessionLength}
            aria-valuenow={repCount}
          >
            {Array.from({ length: sessionLength }, (_, index) => (
              <span
                key={index}
                className={`progress-segment ${index < repCount ? 'filled' : ''}`}
              />
            ))}
          </div>
          <span className="progress-counter">{Math.min(repCount + 1, sessionLength)} / {sessionLength}</span>
        </div>
        <div className="toggle-container stagger-in stagger-2">
          <span style={{ opacity: mode === 'full' ? 1 : 0.5 }}>Full Speech</span>
          <div className={`toggle-switch ${mode === 'full' ? 'active' : ''}`} onClick={() => setMode(mode === 'full' ? 'single' : 'full')}>
            <div className="toggle-knob"></div>
          </div>
          <span style={{ opacity: mode === 'single' ? 1 : 0.5 }}>Solutions Only</span>
        </div>

        {sessionComplete ? (
          <SessionComplete onStart={handleStartSession} total={sessionLength} />
        ) : !showFeedback ? (
          <DrillForm
            formExiting={formExiting}
            loadingDrill={loadingDrill}
            drillError={drillError}
            currentDrill={currentDrill}
            activePrompt={activePrompt}
            poi={poi}
            wordCount={wordCount}
            submitError={submitError}
            loading={loading}
            onPoiChange={handlePoiChange}
            onSubmit={handleSubmit}
          />
        ) : (
          <FeedbackCard
            feedback={feedback}
            scoreColor={getScoreColor(feedback.score)}
            originalPoi={poi}
            onNext={handleNextRep}
            onBack={handleBackToEdit}
          />
        )}
      </div>
    </>
  );
}
