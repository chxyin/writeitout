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

/** One rep in the history timeline. `feedback` stays null until it is graded. */
function createRep(drill) {
  return { drill, poi: '', feedback: null };
}

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
  // Dr. Frost Maths-style rep history. Every rep the user has seen is one
  // { drill, poi, feedback } entry and the rep on screen is history[currentIndex]
  // (feedback stays null until the chair grades it). < Prev / Next > only move
  // the index and replay a saved entry — they never call the API.
  const [history, setHistory] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadingDrill, setLoadingDrill] = useState(true);
  const [drillError, setDrillError] = useState('');
  const [sessionComplete, setSessionComplete] = useState(false);
  const [mode, setMode] = useState('single'); // 'single' or 'full'
  const [poi, setPoi] = useState('');
  const [loading, setLoading] = useState(false);
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

  // The rep on screen is read straight out of the history, so the drill view and
  // the feedback view can never disagree about which rep is being looked at.
  const currentEntry = history[currentIndex] || null;
  const currentDrill = currentEntry ? currentEntry.drill : null;
  const feedback = currentEntry ? currentEntry.feedback : null;
  // One rep per graded entry, so re-grading an old rep cannot inflate progress.
  const gradedCount = history.reduce(
    (total, entry) => total + (entry.feedback ? 1 : 0),
    0
  );

  const activePrompt = currentDrill
    ? mode === 'single' ? currentDrill.single_claim : currentDrill.full_speech
    : '';

  // Fetches one drill. Kept free of state writes so the caller decides whether
  // the result becomes a fresh rep or replaces a skipped one.
  const requestDrill = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/random-speech`);
    if (!response.ok) throw new Error(`Speech request failed (${response.status})`);
    const data = await response.json();
    return {
      committee: data.committee,
      delegate: data.country,
      topic: data.topic,
      full_speech: data.text,
      single_claim: data.single_claim
    };
  }, []);

  const loadFirstRep = useCallback(async () => {
    setLoadingDrill(true);
    setDrillError('');
    try {
      const drill = await requestDrill();
      setHistory([createRep(drill)]);
      setCurrentIndex(0);
      setPoi('');
    } catch (error) {
      setDrillError(error.message);
    } finally {
      setLoadingDrill(false);
    }
  }, [requestDrill]);

  useEffect(() => {
    const loadDrill = setTimeout(loadFirstRep, 0);
    return () => clearTimeout(loadDrill);
  }, [loadFirstRep]);

  // < Prev / Next > and ← Back share this: load a saved rep, no API call. The
  // entry's own POI is pushed back into the textarea so an old answer can still
  // be read (and re-edited) after navigating away.
  const goToEntry = useCallback((index) => {
    const entry = history[index];
    if (!entry) return;
    setCurrentIndex(index);
    setPoi(entry.poi);
    setShowFeedback(Boolean(entry.feedback));
    setSubmitError('');
    setDrillError('');
    setFormExiting(false);
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, [history]);

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

  // Fetches the next drill and makes it the rep on screen. A rep that was never
  // answered (skipped with Next >) is overwritten rather than appended, so the
  // timeline only keeps reps the user actually saw.
  const startNewRep = useCallback(async () => {
    if (loadingDrill) return;
    setLoadingDrill(true);
    setDrillError('');
    setSubmitError('');
    setShowFeedback(false);
    setFormExiting(false);
    try {
      const entry = createRep(await requestDrill());
      if (currentEntry && !currentEntry.feedback) {
        setHistory((entries) =>
          entries.map((item, index) => (index === currentIndex ? entry : item))
        );
      } else {
        setHistory((entries) => [...entries, entry]);
        setCurrentIndex(history.length);
      }
      setPoi('');
    } catch (error) {
      setDrillError(error.message);
    } finally {
      setLoadingDrill(false);
    }
  }, [currentEntry, currentIndex, history.length, loadingDrill, requestDrill]);

  const wordCount = poi.trim() ? poi.trim().split(/\s+/).length : 0;

  // ▸ Navigation guards. Prev needs somewhere to go; Next is only blocked at the
  // end of the timeline when a draft would be thrown away (Submit is right there).
  const canPrev = currentIndex > 0 && !loading;
  const atEndOfHistory = currentIndex >= history.length - 1;
  const hasUnsavedDraft = !feedback && poi.trim().length > 0;
  const canNext = !loading && !loadingDrill && !(atEndOfHistory && hasUnsavedDraft);

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

      // The pending rep already occupies history[currentIndex] (it was seeded
      // when the drill arrived), so grading fills that slot instead of appending
      // a duplicate — history never holds two versions of the same rep.
      setHistory((entries) =>
        entries.map((entry, index) =>
          index === currentIndex ? { drill: currentDrill, poi, feedback: data } : entry
        )
      );
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

  // Next > : walk forward through saved reps, and only fetch a new drill once the
  // user is standing on the last one (Dr. Frost's "end of the timeline").
  const handleNext = () => {
    if (currentIndex < history.length - 1) {
      goToEntry(currentIndex + 1);
      return;
    }
    if (gradedCount >= sessionLength) {
      setSessionComplete(true);
      return;
    }
    startNewRep();
  };

  const handlePrev = () => {
    if (currentIndex === 0) return;
    goToEntry(currentIndex - 1);
  };

  // ← Back leaves the card for the drill of the same rep, POI included, so an
  // answer can be re-read and re-graded in place.
  const handleBackToEdit = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setShowFeedback(false);
    setFormExiting(false);
    setSubmitError('');
  };

  const handleStartSession = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setSessionComplete(false);
    setShowFeedback(false);
    setFormExiting(false);
    setSubmitError('');
    loadFirstRep();
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
        {/* Top band: progress + mode toggle, never shrinks and never scrolls. */}
        <div className="app-top">
          <div className="progress-bar stagger-in stagger-1">
            <div
              className="progress-segments"
              role="progressbar"
              aria-label="Session progress"
              aria-valuemin={0}
              aria-valuemax={sessionLength}
              aria-valuenow={gradedCount}
            >
              {Array.from({ length: sessionLength }, (_, index) => (
                <span
                  key={index}
                  className={`progress-segment ${index < gradedCount ? 'filled' : ''}`}
                />
              ))}
            </div>
            <span className="progress-counter">{Math.min(currentIndex + 1, sessionLength)} / {sessionLength}</span>
          </div>
          <div className="toggle-container stagger-in stagger-2">
            <span style={{ opacity: mode === 'full' ? 1 : 0.5 }}>Full Speech</span>
            <div className={`toggle-switch ${mode === 'full' ? 'active' : ''}`} onClick={() => setMode(mode === 'full' ? 'single' : 'full')}>
              <div className="toggle-knob"></div>
            </div>
            <span style={{ opacity: mode === 'single' ? 1 : 0.5 }}>Solutions Only</span>
          </div>
        </div>

        {sessionComplete ? (
          <SessionComplete onStart={handleStartSession} total={sessionLength} />
        ) : !showFeedback || !feedback ? (
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
            onPrev={handlePrev}
            onNext={handleNext}
            canPrev={canPrev}
            canNext={canNext}
            historyIndex={currentIndex}
            historyLength={history.length}
          />
        ) : (
          // Keyed by rep so the copied/expanded state never leaks between reps.
          <FeedbackCard
            key={`rep-${currentIndex}`}
            feedback={feedback}
            scoreColor={getScoreColor(feedback.score)}
            originalPoi={poi}
            onNext={handleNext}
            onBack={handleBackToEdit}
            onPrev={handlePrev}
            canPrev={canPrev}
            canNext={canNext}
            historyIndex={currentIndex}
            historyLength={history.length}
            initialShowOriginal={currentIndex < history.length - 1}
          />
        )}
      </div>
    </>
  );
}
