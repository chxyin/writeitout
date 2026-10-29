import { useState, useEffect, useRef, useCallback } from 'react';
import SettingsMenu from './components/SettingsMenu.jsx';
import { BACKGROUND_IDS } from './lib/appearance.js';
import { DEFAULT_ZOOM, clampZoom } from './lib/zoom.js';
import {
  TOP_OFFSET_RANGE,
  BOTTOM_OFFSET_RANGE,
  TEXT_SIZE_RANGE,
  CARD_WIDTH_RANGE,
  clampValue,
  formattingVars
} from './lib/formatting.js';
import PaperBackground from './components/PaperBackground.jsx';
// The game header's mark: the standalone paper icon, not the wordmark. It is
// shapes only (no embedded <style>/font like the logos carry), so a plain <img>
// renders it exactly as drawn and the browser can cache the file.
import appIcon from './assets/writeitout_icon.svg';
import { saveSessionResult } from './lib/sessionHistory.js';
import useAuthSession, { authorizationHeaders } from './lib/auth.js';
import Splash from './components/Splash.jsx';
import DrillForm from './components/DrillForm.jsx';
import FeedbackCard from './components/FeedbackCard.jsx';
import SessionComplete from './components/SessionComplete.jsx';
import useBreakpoint from './hooks/useBreakpoint.js';
import useViewportHeight from './hooks/useViewportHeight.js';

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

/** 30 → "0:30", 90 → "1:30". The rep countdown in the top band. */
function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

const SETTINGS_STORAGE_KEY = 'writeitout:settings';

/** How long to wait for a grade before giving up (the backend allows 40s). */
const GRADE_TIMEOUT_MS = 45_000;

/** One rep in the history timeline. `feedback` stays null until it is graded. */
function createRep(drill) {
  return { drill, poi: '', feedback: null };
}

const LAST_SESSION_STORAGE_KEY = 'writeitout:last-session';

/** What the splash screen opens on before a session has ever been started. */
const DEFAULT_SESSION = { reps: 10, timer: 0 };

/**
 * The reps/timer pair from the last session, so exiting a task and pressing Play
 * again does not silently reset the delegate to 10 reps and no clock. Bounds are
 * the picker's own; anything else falls back rather than reaching the layout.
 */
function loadLastSession() {
  if (typeof window === 'undefined') return DEFAULT_SESSION;
  let parsed;
  try {
    parsed = JSON.parse(window.localStorage.getItem(LAST_SESSION_STORAGE_KEY) || 'null');
  } catch {
    return DEFAULT_SESSION;
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_SESSION;
  const reps = Number(parsed.reps);
  const timer = Number(parsed.timer);
  if (!Number.isInteger(reps) || reps < 1 || reps > 100) return DEFAULT_SESSION;
  if (!Number.isInteger(timer) || timer < 0 || timer > 600) return DEFAULT_SESSION;
  return { reps, timer };
}

function persistLastSession(settings) {
  try {
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota: the next visit just starts at defaults.
  }
}

const DEFAULT_SETTINGS = {
  animOn: true,
  showTopic: true,
  showComm: true,
  lowIntensity: false,
  theme: 'default',
  background: 'grid',
  zoom: DEFAULT_ZOOM,
  // Settings → Formatting. Each default is the value the app has always had, so
  // untouched preferences leave the layout exactly as it was.
  topOffset: TOP_OFFSET_RANGE.default,
  bottomOffset: BOTTOM_OFFSET_RANGE.default,
  textSize: TEXT_SIZE_RANGE.default,
  cardWidth: CARD_WIDTH_RANGE.default
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
    // A background whose swatch has been removed (the old Glow) falls back to the
    // default instead of leaving <body> with a class nothing in index.css styles.
    background: BACKGROUND_IDS.includes(parsed.background)
      ? parsed.background
      : DEFAULT_SETTINGS.background,
    zoom: clampZoom(parsed.zoom ?? DEFAULT_SETTINGS.zoom),
    topOffset: clampValue(parsed.topOffset, TOP_OFFSET_RANGE),
    bottomOffset: clampValue(parsed.bottomOffset, BOTTOM_OFFSET_RANGE),
    textSize: clampValue(parsed.textSize, TEXT_SIZE_RANGE),
    cardWidth: clampValue(parsed.cardWidth, CARD_WIDTH_RANGE)
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
  // Remaining seconds on the current rep when the splash screen asked for a
  // timer; 0 = the clock is off, or a timed rep has run out.
  const [timeLeft, setTimeLeft] = useState(0);

  // View routing. The splash screen collects the practice settings; the game view
  // is the drill loop below. gameSettings is what Play handed over — { reps, timer }
  // — or null before the first session: reps is the session length, timer the
  // per-rep countdown. It is persisted too, so the splash can start on the numbers
  // the delegate last chose instead of snapping back to their defaults.
  const [currentView, setCurrentView] = useState('splash');
  const [gameSettings, setGameSettings] = useState(loadLastSession);

  // The Google session. Held here rather than in the splash so the drill can use
  // it as well: the request headers carry the credential and the history bucket
  // is keyed by the account id.
  const { session, signIn, signOut } = useAuthSession();

  // Verify the credential with the API as soon as Google hands it over. A token
  // can be well formed and still be rejected — expired, revoked, or minted for
  // another client ID — and finding that out at the sign-in is much better than
  // at the first submit. Offline, the local session stands and the first grade
  // checks it again.
  const handleSignIn = useCallback(
    async (credential) => {
      signIn(credential);
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential })
        });
        if (response.status === 401 || response.status === 403) {
          signOut();
          return false;
        }
      } catch {
        // Network failure: keep the session rather than punishing the delegate
        // for a flaky connection to the chair API.
      }
      return true;
    },
    [signIn, signOut]
  );

  // Session length is the single source of truth for the progress bar, the
  // next-rep check and the completion screen. It comes from the splash screen's
  // Reps picker now; ∞ arrives as Infinity, which is exactly "there is no last
  // rep", so the completion screen never fires for it.
  const sessionLength = gameSettings ? gameSettings.reps : 5;
  const unlimitedSession = !Number.isFinite(sessionLength);
  // Seconds allowed per rep, 0 meaning the timer is off.
  const repSeconds = gameSettings ? gameSettings.timer : 0;

  // Settings state. Restored from localStorage on the first render, then
  // written back on every change so the app opens the way it was left.
  const [showMenu, setShowMenu] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const { animOn, showTopic, showComm, theme, background, lowIntensity, zoom } = settings;
  // Settings → Formatting: four free-running layout numbers, carried to CSS as
  // the --fmt-* custom properties below.
  const { topOffset, bottomOffset, textSize, cardWidth } = settings;
  const closeMenu = useCallback(() => setShowMenu(false), []);
  const exitTimer = useRef(null);
  // When the rep on screen runs out, as an absolute epoch millisecond. The clock
  // reads this rather than counting its own ticks: a backgrounded tab throttles
  // timers to one a minute (and iOS suspends them), which used to hand back
  // minutes of extra time and fire the auto-submit late.
  const deadlineRef = useRef(0);
  // True once this rep's clock has auto-submitted it. Cleared by everything that
  // puts a rep (or a fresh clock) on screen, so a rep can be sent by the timer
  // only once per countdown — and the graded entry that comes back can never
  // re-trigger the submit that produced it.
  const autoSubmittedRef = useRef(false);

  const updateSetting = useCallback((key, value) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }, []);

  // Settings → panel footer. A copy of the constant rather than the constant
  // itself, so the state object never aliases the module-level default.
  const resetSettings = useCallback(() => setSettings({ ...DEFAULT_SETTINGS }), []);
  // Key by key, so the reset button greys out once there is nothing left to put
  // back — the same "disabled at the default" rule the slider readouts follow.
  const settingsAreDefault = Object.entries(DEFAULT_SETTINGS).every(
    ([key, value]) => settings[key] === value
  );

  // Responsive tier. Desktops keep the original wide layout, tablets split the
  // prompt and the POI field into two columns, phones get a single column.
  const { isMobile, isTablet, orientation } = useBreakpoint();
  const tier = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
  // Keeps the mobile shell one visible screen tall when the keyboard opens; the
  // other tiers ignore the value it writes.
  useViewportHeight();

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

  // The rep's clock has run out. Every load path resets timeLeft to repSeconds,
  // so a zero here can only mean a timed rep really expired — never the off
  // setting, which has no clock and never reaches this branch.
  const clockExpired = repSeconds > 0 && timeLeft === 0 && Boolean(currentDrill);

  // One segment per rep stops fitting once a custom session runs long — 100 reps
  // need ~800px of 4px blocks — and the row would push the counter and the timer
  // chip out of the shell. The segments shrink with the count instead.
  const segmentMetrics =
    sessionLength > 60
      ? { min: 1, gap: 2 }
      : sessionLength > 40
        ? { min: 2, gap: 2 }
        : sessionLength > 24
          ? { min: 3, gap: 3 }
          : { min: 4, gap: 4 };

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

  // Starts the rep's countdown: the deadline is fixed here and never re-derived
  // from a tick, so the remaining time stays true across tab changes. A session
  // with no timer leaves the deadline at 0, which `timeLeft` and the expired
  // check both read as "no clock".
  const startClock = useCallback(() => {
    deadlineRef.current = repSeconds > 0 ? Date.now() + repSeconds * 1000 : 0;
    setTimeLeft(repSeconds);
  }, [repSeconds]);

  const loadFirstRep = useCallback(async () => {
    setLoadingDrill(true);
    setDrillError('');
    try {
      const drill = await requestDrill();
      setHistory([createRep(drill)]);
      setCurrentIndex(0);
      setPoi('');
      // First rep of a session: the splash screen's Timer value starts over.
      autoSubmittedRef.current = false;
      startClock();
    } catch (error) {
      setDrillError(error.message);
    } finally {
      setLoadingDrill(false);
    }
  }, [requestDrill, startClock]);

  // The first drill is fetched when the game view opens, not on mount: a session
  // only exists once Play has been pressed, and the splash screen has no use for
  // a speech. `history.length` keeps a later re-render from fetching a second one.
  useEffect(() => {
    if (currentView !== 'game' || history.length) return undefined;
    const loadDrill = setTimeout(loadFirstRep, 0);
    return () => clearTimeout(loadDrill);
  }, [currentView, history.length, loadFirstRep]);

  // Rep timer: read the remaining time off the deadline while a POI can still be
  // written. Half-second sampling keeps the chip in step with the wall clock
  // without re-rendering on ticks that do not change a whole second. Feedback and
  // the completion screen pause it; at zero the clock stops on its own and the
  // auto-submit below (a separate effect) takes over. A visibility change is
  // sampled immediately, so returning to a tab that was hidden for minutes shows
  // the truth at once instead of a stale minute.
  useEffect(() => {
    if (!repSeconds || showFeedback || sessionComplete || !currentDrill) return undefined;
    const sync = () => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    const tick = setInterval(sync, 500);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [repSeconds, showFeedback, sessionComplete, currentDrill]);

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
    // Same rule as a fresh rep: the countdown belongs to the rep on screen, and
    // its one automatic submit is available again.
    autoSubmittedRef.current = false;
    startClock();
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, [history, startClock]);

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

  // Settings → Formatting rides on custom properties rather than body classes:
  // the values are numbers now, not a fixed set of choices. index.css reads them
  // only inside its desktop media query, and a style property survives the
  // className reset above, so this can stay an effect of its own.
  useEffect(() => {
    const vars = formattingVars({ topOffset, bottomOffset, textSize, cardWidth });
    Object.entries(vars).forEach(([name, value]) => {
      document.body.style.setProperty(name, value);
    });
  }, [topOffset, bottomOffset, textSize, cardWidth]);

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
      autoSubmittedRef.current = false;
      startClock();
    } catch (error) {
      setDrillError(error.message);
    } finally {
      setLoadingDrill(false);
    }
  }, [currentEntry, currentIndex, history.length, loadingDrill, requestDrill, startClock]);

  const wordCount = poi.trim() ? poi.trim().split(/\s+/).length : 0;

  // ▸ Navigation guards. Prev needs somewhere to go; Next is only blocked at the
  // end of the timeline when a draft would be thrown away (Submit is right there).
  const canPrev = currentIndex > 0 && !loading;
  const atEndOfHistory = currentIndex >= history.length - 1;
  const hasUnsavedDraft = !feedback && poi.trim().length > 0;
  const canNext = !loading && !loadingDrill && !(atEndOfHistory && hasUnsavedDraft);

  // One place for the grading request, so the Submit button and the clock send
  // exactly the same payload. `timed_out` is what tells the chair the answer may
  // stop mid-sentence: it is true whenever the rep's clock has run out, which
  // also covers a manual retry after a failed auto-submit.
  const submitPoi = useCallback(async () => {
    if (!currentDrill || !poi || loading) return;
    setLoading(true);
    setSubmitError('');
    // The chair may take its time, but not forever: the backend gives DeepSeek 40
    // seconds, so a request that outlives this ceiling is lost, and without the
    // abort Submit would sit on "Chair is Grading..." until the page reloaded.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GRADE_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}/api/grade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Sent when signed in so the API can meter a delegate rather than an IP.
          ...authorizationHeaders()
        },
        body: JSON.stringify({
          speech: currentDrill.full_speech,
          poi: poi,
          is_solutions_only: mode === 'single',
          timed_out: clockExpired
        }),
        signal: controller.signal
      });

      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        // The API rejected the stored credential: expired, revoked, or minted for
        // another app. Drop it so the card stops claiming a signed-in account,
        // and say why rather than showing the generic failure line.
        signOut();
        throw new Error('Your session expired. Please sign in again.');
      }
      if (!response.ok) {
        throw new Error(describeApiError(data, response.status));
      }
      if (!data || typeof data.score !== 'number') {
        throw new Error('The chair returned an unexpected response. Please try again.');
      }

      // The pending rep already occupies history[currentIndex] (it was seeded
      // when the drill arrived), so grading fills that slot instead of appending
      // a duplicate — history never holds two versions of the same rep. The
      // timeout flag is kept with the entry so the card can say why it stopped.
      setHistory((entries) =>
        entries.map((entry, index) =>
          index === currentIndex
            ? { drill: currentDrill, poi, feedback: data, timedOut: clockExpired }
            : entry
        )
      );
      setFormExiting(true);
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        setShowFeedback(true);
        setFormExiting(false);
      }, 300);
    } catch (error) {
      const aborted = Boolean(error) && error.name === 'AbortError';
      setSubmitError(
        aborted
          ? 'The chair took too long to answer. Please try again.'
          : error.message || 'Error connecting to Chair API.'
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [clockExpired, currentDrill, currentIndex, loading, mode, poi, signOut]);

  const handleSubmit = () => submitPoi();

  // What the clock does at zero: send whatever stands in the box, flagged so the
  // chair knows the answer was cut off rather than finished. It runs once per
  // countdown — the graded entry that comes back would otherwise re-trigger the
  // very submit that produced it — and it never fires on an empty box, which has
  // nothing to grade and would be rejected anyway. A manual retry still carries
  // the flag while the clock reads zero, so a failed auto-submit is not silently
  // graded as a finished answer.
  useEffect(() => {
    if (!repSeconds || showFeedback || sessionComplete || !currentDrill) return;
    if (!clockExpired || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    if (!poi.trim()) return;
    // Queued rather than called here: the submit opens with a state update, and
    // an effect body must not start one. The ref above still bounds it to a
    // single call per countdown.
    queueMicrotask(() => submitPoi());
  }, [repSeconds, showFeedback, sessionComplete, currentDrill, clockExpired, poi, submitPoi]);


  /**
   * Closes out a finished session: records it for the splash screen's Recent
   * Sessions list, then shows the completion card. The score is the average of
   * the reps that were actually graded, and the topic stays a single line — a
   * session usually mixes several, so those are labelled by how many it covered
   * rather than by an arbitrary first one.
   */
  const completeSession = () => {
    const graded = history.filter((entry) => entry.feedback);
    if (graded.length) {
      const topics = [...new Set(graded.map((entry) => entry.drill.topic))];
      const total = graded.reduce((sum, entry) => sum + entry.feedback.score, 0);
      saveSessionResult(
        {
          topic: topics.length === 1 ? topics[0] : `${topics.length} topics`,
          // One decimal: the list shows "7.4/10", and a whole average stays "8".
          score: Math.round((total / graded.length) * 10) / 10
        },
        // Signed-in delegates keep a bucket per account; a guest uses the shared one.
        session?.sub
      );
    }
    setSessionComplete(true);
  };

  // Next > : walk forward through saved reps, and only fetch a new drill once the
  // user is standing on the last one (Dr. Frost's "end of the timeline").
  const handleNext = () => {
    if (currentIndex < history.length - 1) {
      goToEntry(currentIndex + 1);
      return;
    }
    if (gradedCount >= sessionLength) {
      completeSession();
      return;
    }
    startNewRep();
  };

  const handlePrev = () => {
    if (currentIndex === 0) return;
    goToEntry(currentIndex - 1);
  };

  // ← Back leaves the card for the drill of the same rep, POI included, so an
  // answer can be re-read and re-graded in place. The clock restarts with the
  // rep, the same as goToEntry does — without that, a rep whose time ran out
  // would come back already expired and instantly auto-submit itself again.
  const handleBackToEdit = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setShowFeedback(false);
    setFormExiting(false);
    setSubmitError('');
    autoSubmittedRef.current = false;
    startClock();
  };

  const handleStartSession = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setSessionComplete(false);
    setShowFeedback(false);
    setFormExiting(false);
    setSubmitError('');
    loadFirstRep();
  };

  // "Exit Task" abandons the session and goes back to the splash screen. Nothing
  // is written to Recent Sessions — only a finished session saves a score — but
  // every bit of game state is dropped, so the next Play fetches a fresh speech
  // and starts its own progress bar. Clearing the history is also what stops the
  // rep timer: the countdown effect only runs while a drill is on screen.
  const handleExitTask = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setCurrentView('splash');
    setHistory([]);
    setCurrentIndex(0);
    setPoi('');
    setShowFeedback(false);
    setSessionComplete(false);
    setFormExiting(false);
    setSubmitError('');
    setDrillError('');
    setLoadingDrill(true);
    autoSubmittedRef.current = false;
    // No rep on screen from here on, so the countdown has nothing to point at.
    deadlineRef.current = 0;
    setTimeLeft(0);
    // The panel belongs to the drill; leaving with it open would re-open it on
    // the next Play, over a screen the delegate had already dismissed.
    setShowMenu(false);
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

  // The splash screen replaces the whole shell — no gear, no papers of its own,
  // no progress bar: it is its own full-screen view with its own settings card.
  // Every hook above has already run, so this early return costs nothing.
  if (currentView === 'splash') {
    return (
      <Splash
        animOn={animOn}
        lowIntensity={lowIntensity}
        session={session}
        onSignIn={handleSignIn}
        onSignOut={signOut}
        initialSettings={gameSettings}
        onStart={(next) => {
          setGameSettings(next);
          persistLastSession(next);
          setCurrentView('game');
        }}
      />
    );
  }

  return (
    <>
      <SettingsMenu
        open={showMenu}
        onToggle={() => setShowMenu(!showMenu)}
        onClose={closeMenu}
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
        topOffset={topOffset}
        onTopOffsetChange={(value) => updateSetting('topOffset', value)}
        bottomOffset={bottomOffset}
        onBottomOffsetChange={(value) => updateSetting('bottomOffset', value)}
        textSize={textSize}
        onTextSizeChange={(value) => updateSetting('textSize', value)}
        cardWidth={cardWidth}
        onCardWidthChange={(value) => updateSetting('cardWidth', value)}
        onResetDefaults={resetSettings}
        settingsAreDefault={settingsAreDefault}
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
            {/* Brand mark: the paper icon at the head of the progress row. A plain
                <img> with its own box, so it never stretches or shifts the
                segments. Decorative — the page title already carries the name. */}
            <img className="app-logo" src={appIcon} alt="" width="24" height="24" aria-hidden="true" />
            <div
              className="progress-segments"
              style={{
                '--segment-min': `${segmentMetrics.min}px`,
                '--segment-gap': `${segmentMetrics.gap}px`
              }}
              role="progressbar"
              aria-label="Session progress"
              aria-valuemin={0}
              aria-valuemax={unlimitedSession ? undefined : sessionLength}
              aria-valuenow={gradedCount}
            >
              {/* ∞ has no segment count to draw, so the counter carries progress. */}
              {!unlimitedSession && Array.from({ length: sessionLength }, (_, index) => (
                <span
                  key={index}
                  className={`progress-segment ${index < gradedCount ? 'filled' : ''}`}
                />
              ))}
            </div>
            <span className="progress-counter">
              {unlimitedSession ? `${gradedCount} / ∞` : `${Math.min(currentIndex + 1, sessionLength)} / ${sessionLength}`}
            </span>
            {repSeconds > 0 && (
              <span
                className={`rep-timer ${timeLeft === 0 ? 'is-done' : ''}`.trim()}
                role="timer"
                title={`${repSeconds} seconds per rep`}
              >
                {formatClock(timeLeft)}
              </span>
            )}
          </div>
          <div className="mode-row stagger-in stagger-2">
            {/* The way out of a drill. Sits at the leading edge of the mode row,
                so the Full Speech / Solutions Only switch stays centred. */}
            <button
              type="button"
              className="exit-task-btn"
              onClick={handleExitTask}
              title="Leave this task and go back to the start screen"
            >
              Exit Task
            </button>
            <div className="toggle-container">
              <span style={{ opacity: mode === 'full' ? 1 : 0.5 }}>Full Speech</span>
              <button
                type="button"
                role="switch"
                aria-checked={mode === 'full'}
                aria-label="Show the full speech instead of the solutions only"
                className={`toggle-switch ${mode === 'full' ? 'active' : ''}`}
                onClick={() => setMode(mode === 'full' ? 'single' : 'full')}
              >
                <span className="toggle-knob"></span>
              </button>
              <span style={{ opacity: mode === 'single' ? 1 : 0.5 }}>Solutions Only</span>
            </div>
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
            timedOut={Boolean(currentEntry?.timedOut)}
          />
        )}
      </div>
    </>
  );
}
