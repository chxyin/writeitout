import { useState, useEffect, useRef, useCallback } from 'react';
import SettingsMenu from './components/SettingsMenu.jsx';
import {
  BACKGROUND_IDS,
  NIGHT_KELVIN_RANGE,
  NIGHT_OFF_KELVIN,
  kelvinFromStrength,
  nightLens
} from './lib/appearance.js';
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
import { HISTORY_STORAGE_KEY, loadSessionHistory, saveSessionResult } from './lib/sessionHistory.js';
import useAuthSession, { authorizationHeaders } from './lib/auth.js';
import { API_BASE_URL } from './lib/api.js';
import { visitorId } from './lib/trial.js';
import { countdownSeconds, isChrono } from './lib/timer.js';
import {
  beginPracticeSession,
  closeOrphanedSession,
  currentSessionId,
  endPracticeSession,
  flushSessionOnHide,
  importLocalHistory,
  fetchTrialState,
  flagRep,
  rateSession,
  recordRep,
  repId,
  saveAnswerPreference,
  fetchProfile,
  fetchDeploymentSettings,
  sendActivity
} from './lib/practice.js';
import Splash from './components/Splash.jsx';
import DrillForm from './components/DrillForm.jsx';
import FeedbackCard from './components/FeedbackCard.jsx';
import SessionComplete from './components/SessionComplete.jsx';
import TrialGate from './components/TrialGate.jsx';
import HintsStrip from './components/HintsStrip.jsx';
import { reportVisit } from './lib/traffic.js';
import SessionDetail from './components/SessionDetail.jsx';
import AdminStats from './components/AdminStats.jsx';
import TimeUpOverlay from './components/TimeUpOverlay.jsx';
import useBreakpoint from './hooks/useBreakpoint.js';
import useViewportHeight from './hooks/useViewportHeight.js';
import useRoute from './lib/route.js';

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

/**
 * The API caps every stored string, and a body that misses a cap is rejected
 * whole — which would cost the rep, not just the sentence that was too long.
 * Clipping here keeps the write valid; the limits match RepRequest in main.py.
 */
function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : null;
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
  // The stopwatch is the one timer value that is not a number of seconds.
  const chrono = isChrono(parsed.timer);
  const timer = chrono ? parsed.timer : Number(parsed.timer);
  if (!Number.isInteger(reps) || reps < 1 || reps > 100) return DEFAULT_SESSION;
  if (!chrono && (!Number.isInteger(timer) || timer < 0 || timer > 600)) return DEFAULT_SESSION;
  return { reps, timer };
}

function persistLastSession(settings) {
  try {
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota: the next visit just starts at defaults.
  }
}

/**
 * The preferences this version writes, and the ones this version's reset buttons
 * put back. They are the two halves of the Settings panel — General (the look of
 * the page) and Formatting (the four layout sliders) — so "Reset to defaults"
 * can mean the tab you are looking at rather than the whole panel.
 */
const GENERAL_SETTING_KEYS = [
  'animOn',
  'showTopic',
  'showComm',
  'lowIntensity',
  'nightKelvin',
  'nightLastWarm',
  'hints',
  'theme',
  'background',
  'zoom'
];
const FORMATTING_SETTING_KEYS = ['topOffset', 'bottomOffset', 'textSize', 'cardWidth'];

/**
 * Bumped when a default changes in a way existing saves should follow. A save
 * carries the version it was written by, so the migration below only ever runs
 * once per browser: a delegate who deliberately picked the old 3400K keeps it.
 */
const SETTINGS_VERSION = 2;

/** The temperature the app shipped with before SETTINGS_VERSION 2. */
const LEGACY_DEFAULT_KELVIN = 3400;

const DEFAULT_SETTINGS = {
  // Written into every save so loadSettings can tell a fresh entry from an old one.
  version: SETTINGS_VERSION,
  animOn: true,
  showTopic: true,
  showComm: true,
  lowIntensity: false,
  // Night light ships on: it is the setting a delegate practising late wants
  // before they know it exists, and the switch is one press away in Settings.
  // The temperature is the one dial it has; 6000K is daylight and therefore off,
  // so this single number is both the colour and the switch. `nightLastWarm` is
  // only memory, so the switch can come back to the warmth it left behind.
  nightKelvin: NIGHT_KELVIN_RANGE.default,
  nightLastWarm: NIGHT_KELVIN_RANGE.default,
  // The rotating tips on the start screen: one place a delegate is told the
  // Formatting tab exists, and the switch that turns them off is one of them.
  hints: true,
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
  // Night light migration, before the object below so both fields agree. A save
  // from the old two-dial version had a separate on/off flag: off becomes 6000K
  // (daylight, no lens) and on is mapped from the old strength dial, where 55%
  // lines up with 3300K. A delegate who never touched either gets the default.
  const savedKelvin =
    parsed.nightKelvin ??
    (parsed.nightLight === false ? NIGHT_OFF_KELVIN : kelvinFromStrength(parsed.nightLightStrength)) ??
    DEFAULT_SETTINGS.nightKelvin;
  // A save from before the 5000K default that still sits on the old 3400K default
  // never moved the dial, so it follows the new one. Any other temperature is a
  // choice and is left alone.
  const kelvinSource =
    !parsed.version && savedKelvin === LEGACY_DEFAULT_KELVIN ? NIGHT_KELVIN_RANGE.default : savedKelvin;
  const nightKelvin = clampValue(kelvinSource, NIGHT_KELVIN_RANGE);
  return {
    version: SETTINGS_VERSION,
    animOn: Boolean(parsed.animOn ?? DEFAULT_SETTINGS.animOn),
    showTopic: Boolean(parsed.showTopic ?? DEFAULT_SETTINGS.showTopic),
    showComm: Boolean(parsed.showComm ?? DEFAULT_SETTINGS.showComm),
    lowIntensity: Boolean(parsed.lowIntensity ?? DEFAULT_SETTINGS.lowIntensity),
    // Absent means "never chosen", and the default is on — so a missing
    // temperature falls back to the warm default, not to daylight.
    nightKelvin,
    // The warmth the switch returns to. Always a temperature that does something,
    // because coming back to 6000K would look like a broken switch.
    nightLastWarm: clampValue(
      parsed.nightLastWarm ?? (nightKelvin < NIGHT_OFF_KELVIN ? nightKelvin : DEFAULT_SETTINGS.nightLastWarm),
      NIGHT_KELVIN_RANGE
    ),
    hints: Boolean(parsed.hints ?? DEFAULT_SETTINGS.hints),
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
  // The completion card's one tap. `completedSessionId` is captured when the
  // session closes, because the recorder forgets the id as soon as it does.
  const [sessionRating, setSessionRating] = useState(null);
  const [completedSessionId, setCompletedSessionId] = useState(null);
  const [poi, setPoi] = useState('');
  const [loading, setLoading] = useState(false);
  const [formExiting, setFormExiting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // Remaining seconds on the current rep when the splash screen asked for a
  // timer; 0 = the clock is off, or a timed rep has run out.
  const [timeLeft, setTimeLeft] = useState(0);
  // Stopwatch mode's counterpart to timeLeft: seconds since the speech appeared.
  const [elapsed, setElapsed] = useState(0);
  // null → the red "Time's Up!" card is not showing; 'in' → it is, and the clock
  // for it is running; 'out' → it is fading. The rep's countdown reaches 0:00
  // every time, so this is what makes that second visible.
  const [timeUpPhase, setTimeUpPhase] = useState(null);

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

  // Answer storage: the delegate's own switch (shown in Settings), and the
  // deployment's policy, which outranks it. Both are read once per sign-in; the
  // server enforces them on every write either way, so these values only decide
  // what the switch looks like.
  const [storeAnswers, setStoreAnswers] = useState(true);
  const [deploymentMode, setDeploymentMode] = useState(null);
  const [answersSaving, setAnswersSaving] = useState(false);

  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    fetchProfile().then((profile) => {
      if (cancelled || !profile) return;
      if (typeof profile.store_answers === 'boolean') setStoreAnswers(profile.store_answers);
    });
    fetchDeploymentSettings().then((settings) => {
      if (!cancelled && settings) setDeploymentMode(settings.poi_storage_mode);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const answersLocked = deploymentMode !== null && deploymentMode !== 'full';

  // Trial mode: while it is on, a visitor without an account gets one practice.
  // Read on load and re-read when the account changes, because signing in has to
  // lift the gate immediately.
  const [trial, setTrial] = useState(null);
  const [trialBlocked, setTrialBlocked] = useState(false);
  const [trialNotice, setTrialNotice] = useState('');
  const [trialAuthError, setTrialAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchTrialState().then((state) => {
      if (!cancelled && state) setTrial(state);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleToggleAnswers = async () => {
    if (answersLocked || answersSaving) return;
    const next = !storeAnswers;
    setStoreAnswers(next);
    setAnswersSaving(true);
    const saved = await saveAnswerPreference(next);
    setAnswersSaving(false);
    // A refusal puts the switch back, so the menu never claims a setting the
    // server did not accept.
    if (!saved) setStoreAnswers(!next);
  };

  // The address bar is the router: the start screen is the root, a past session
  // is #/session/<id>. Re-read on every hash change, so the back button and a
  // deep link both land on the right screen.
  const route = useRoute();

  // Verify the credential with the API as soon as Google hands it over. A token
  // can be well formed and still be rejected — expired, revoked, or minted for
  // another client ID — and finding that out at the sign-in is much better than
  // at the first submit. Offline, the local session stands and the first grade
  // checks it again.
  const handleSignIn = useCallback(
    async (credential) => {
      const next = signIn(credential);
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
        // Only the server knows whether this address runs the deployment, so the
        // session is upgraded once it has answered. It decides nothing but the
        // Statistics link; the endpoint behind it checks the token again.
        const data = await response.json().catch(() => null);
        if (data && data.is_admin) signIn(credential, true);
      } catch {
        // Network failure: keep the session rather than punishing the delegate
        // for a flaky connection to the chair API.
      }

      // One-time migration: the sessions this browser kept before the database
      // existed (the guest bucket and this account's own) move into the account.
      if (next && next.sub) {
        const marker = `writeitout:imported:${next.sub}`;
        let alreadyImported;
        try {
          alreadyImported = window.localStorage.getItem(marker) === '1';
        } catch {
          alreadyImported = true; // cannot read storage: never re-import blind
        }
        if (!alreadyImported) {
          const local = [...loadSessionHistory(undefined), ...loadSessionHistory(next.sub)];
          const imported = await importLocalHistory(local);
          try {
            window.localStorage.setItem(marker, '1');
            if (imported > 0) window.localStorage.removeItem(HISTORY_STORAGE_KEY);
          } catch {
            // The marker is best-effort; the database still deduped by session id.
          }
        }
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
  // Seconds allowed per rep, 0 meaning there is no countdown. The stopwatch is the
  // other kind of clock: it counts up, so it has no length and nothing expires.
  const timerSetting = gameSettings ? gameSettings.timer : 0;
  const chrono = isChrono(timerSetting);
  const repSeconds = countdownSeconds(timerSetting);

  // Settings state. Restored from localStorage on the first render, then
  // written back on every change so the app opens the way it was left.
  const [showMenu, setShowMenu] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const {
    animOn,
    showTopic,
    showComm,
    theme,
    background,
    lowIntensity,
    zoom,
    nightKelvin,
    hints
  } = settings;
  // Settings → Formatting: four free-running layout numbers, carried to CSS as
  // the --fmt-* custom properties below.
  const { topOffset, bottomOffset, textSize, cardWidth } = settings;
  const closeMenu = useCallback(() => setShowMenu(false), []);
  const exitTimer = useRef(null);
  // Bumped whenever the account's history may have changed (a session closed, a
  // local import finished), so the splash refetches instead of showing a stale list.
  const [historyVersion, setHistoryVersion] = useState(0);
  // When the rep on screen runs out, as an absolute epoch millisecond. The clock
  // reads this rather than counting its own ticks: a backgrounded tab throttles
  // timers to one a minute (and iOS suspends them), which used to hand back
  // minutes of extra time and fire the auto-submit late.
  const deadlineRef = useRef(0);
  // When the rep on screen appeared, in epoch milliseconds. Every path that puts
  // a rep up — the first one, Next ›, and ‹ Prev reopening an old one — goes
  // through `startClock`, so the time the delegate spent writing is simply "now
  // minus this" at submit. It is a different measurement from the grade's own
  // `latency_ms`, which is how long the chair took to answer.
  const repOpenedRef = useRef(0);
  // True once this rep's clock has auto-submitted it. Cleared by everything that
  // puts a rep (or a fresh clock) on screen, so a rep can be sent by the timer
  // only once per countdown — and the graded entry that comes back can never
  // re-trigger the submit that produced it.
  const autoSubmittedRef = useRef(false);
  // True while a grade is in flight. The "Time's Up!" card reads it without
  // subscribing to `loading`, so its own timer is not restarted by a re-render.
  const submitPendingRef = useRef(false);

  const updateSetting = useCallback((key, value) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }, []);

  // The night light switch is a shortcut for the ends of its own temperature
  // dial: off parks the dial at 6000K (daylight) after remembering the warmth,
  // and on returns to that warmth rather than to the default.
  const toggleNightLight = useCallback(() => {
    setSettings((previous) => {
      if (previous.nightKelvin < NIGHT_OFF_KELVIN) {
        return { ...previous, nightLastWarm: previous.nightKelvin, nightKelvin: NIGHT_OFF_KELVIN };
      }
      return { ...previous, nightKelvin: previous.nightLastWarm };
    });
  }, []);

  const changeNightKelvin = useCallback((value) => {
    setSettings((previous) => ({
      ...previous,
      nightKelvin: value,
      nightLastWarm: value < NIGHT_OFF_KELVIN ? value : previous.nightLastWarm
    }));
  }, []);

  // Settings → panel footer. One button per tab: General puts back the look of the
  // page, Formatting puts back the four layout sliders, and neither touches the
  // other. A copy of the constant rather than the constant itself, so the state
  // object never aliases the module-level default.
  const resetSettingsGroup = useCallback((keys) => {
    setSettings((previous) => {
      const next = { ...previous };
      keys.forEach((key) => {
        next[key] = DEFAULT_SETTINGS[key];
      });
      return next;
    });
  }, []);
  const resetGeneral = useCallback(() => resetSettingsGroup(GENERAL_SETTING_KEYS), [resetSettingsGroup]);
  const resetFormatting = useCallback(() => resetSettingsGroup(FORMATTING_SETTING_KEYS), [resetSettingsGroup]);
  // Key by key, so each reset button greys out once its own half is back at the
  // defaults — the same "disabled at the default" rule the slider readouts follow.
  const groupIsDefault = (keys) => keys.every((key) => settings[key] === DEFAULT_SETTINGS[key]);
  const generalAreDefault = groupIsDefault(GENERAL_SETTING_KEYS);
  const formattingAreDefault = groupIsDefault(FORMATTING_SETTING_KEYS);

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

  // The completion card's summary: how many reps actually earned a score, their
  // average, and the topic(s) they covered.
  const gradedEntries = history.filter((entry) => entry.feedback);
  const sessionAverage = gradedEntries.length
    ? Math.round(
        (gradedEntries.reduce((sum, entry) => sum + entry.feedback.score, 0) /
          gradedEntries.length) *
          10
      ) / 10
    : null;
  const sessionTopics = [...new Set(gradedEntries.map((entry) => entry.drill.topic))];
  const sessionLabel =
    sessionTopics.length === 0
      ? ''
      : sessionTopics.length === 1
        ? sessionTopics[0]
        : `${sessionTopics.length} topics`;

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
      id: data.id,
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
    // The writing-time stopwatch starts with the countdown, whether or not there
    // is a countdown at all.
    repOpenedRef.current = Date.now();
    setTimeLeft(repSeconds);
    setElapsed(0);
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
      setTimeUpPhase(null);
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

  // Stopwatch mode: count up from the moment this rep's speech appeared. The same
  // interval writes the number the chip shows and nothing else — no deadline, no
  // auto-submit — and it pauses with feedback like the countdown does. `write_ms`
  // is captured from the same start time when the answer is sent, so what the chip
  // showed and what the statistics record are the same measurement.
  useEffect(() => {
    if (!chrono || showFeedback || sessionComplete || !currentDrill) return undefined;
    const tick = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - repOpenedRef.current) / 1000)));
    }, 500);
    return () => clearInterval(tick);
  }, [chrono, showFeedback, sessionComplete, currentDrill]);

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
    setTimeUpPhase(null);
    startClock();
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, [history, startClock]);

  // At 6000K the lens is daylight and does nothing, so the dial doubles as the
  // off switch: the class only lands on <body> when there is something to show.
  const nightOn = nightKelvin < NIGHT_OFF_KELVIN;

  useEffect(() => {
    document.body.className = '';
    if (theme !== 'default') document.body.classList.add(`theme-${theme}`);
    if (!animOn) document.body.classList.add('no-anim');
    if (!showTopic) document.body.classList.add('hide-topic');
    if (!showComm) document.body.classList.add('hide-comm');
    document.body.classList.add(`background-${background}`);
    if (lowIntensity) document.body.classList.add('low-intensity');
    if (nightOn) document.body.classList.add('night-light');
  }, [theme, background, lowIntensity, animOn, showTopic, showComm, nightOn]);

  // The warm cast's tint and opacity, both derived from the one temperature. They
  // ride on custom properties so dragging the dial repaints the overlay without
  // re-running the body-class effect above.
  useEffect(() => {
    const lens = nightLens(nightKelvin);
    document.documentElement.style.setProperty('--night-tint', lens.tint);
    document.documentElement.style.setProperty('--night-opacity', String(lens.opacity));
  }, [nightKelvin]);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  // One arrival, logged once per page load. Fire and forget: the traffic panel is
  // for the person running the deployment, and nothing a visitor sees waits on it.
  useEffect(() => {
    reportVisit({ route: window.location.hash || '#/' });
  }, []);

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
      setTimeUpPhase(null);
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
    // Read by the "Time's Up!" card, which stays up until the chair has
    // answered (or until its own safety limit) — so the fade lands on the
    // feedback rather than on a page that is still saying "Chair is Grading".
    submitPendingRef.current = true;
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
          ...authorizationHeaders(),
          // The trial's counter key. Harmless when trial mode is off.
          'X-Visitor': visitorId()
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
      // A refusal here is the anonymous cap: either the admin trial switch or the
      // two-runs-a-day limit. The server names which one, and the page puts the
      // sign-in card in place of the answer box rather than a red error line.
      const refusal = data ? data.detail : null;
      const refusalText = typeof refusal === 'string' ? refusal : refusal && refusal.message;
      const capped =
        response.status === 403 &&
        (refusalText?.includes('enforcing sign-ins') ||
          (refusal && typeof refusal === 'object' && typeof refusal.code === 'string' && refusal.code.startsWith('trial.')));
      if (capped) {
        setTrialNotice(refusalText || '');
        setTrialBlocked(true);
        throw new Error('Sign in to keep practising.');
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
      // The rep id is minted here and kept on the entry, because "flag this run"
      // needs the same id the recorder posts.
      const entryRepId = repId();
      setHistory((entries) =>
        entries.map((entry, index) =>
          index === currentIndex
            ? { drill: currentDrill, poi, feedback: data, timedOut: clockExpired, repId: entryRepId }
            : entry
        )
      );

      // The anonymous caps are counted by the server, so ask it again rather than
      // guessing: one graded run just moved the needle, and the start screen's
      // note and the Play gate both read this.
      if (!session) {
        fetchTrialState().then((state) => {
          if (state) setTrial(state);
        });
      }

      // Persist the rep while the cost trail is still in hand. The recorder queues
      // it if the session row is still being created. Fire-and-forget: the
      // delegate has their feedback whether or not the write lands. Guests are
      // recorded too — the server files them under the address-derived key, and
      // practice nobody can see is practice the dashboard pretends never happened.
      recordRep({
        id: entryRepId,
          drill_id: String(currentDrill.id || currentDrill.topic || 'unknown'),
          topic: currentDrill.topic || null,
          mode: mode === 'single' ? 'single' : 'full',
          score: data.score,
          timed_out: clockExpired,
          poi,
          // The replay page is built from these: the speech exactly as it stood
          // on screen, and the chair's whole verdict. The server redacts them
          // under the delegate's opt-out, so this is only ever a request to keep
          // them — not a decision.
          prompt_text: clip(
            mode === 'single' ? currentDrill.single_claim : currentDrill.full_speech,
            6000
          ),
          grade_label: clip(data.grade_label, 40),
          reasoning: clip(data.reasoning, 2000),
          constructive_feedback: clip(data.constructive_feedback, 2000),
          rewritten_poi: clip(data.rewritten_poi, 4000),
          rewrite_explanation: clip(data.rewrite_explanation, 2000),
          latency_ms: data.latency_ms ?? null,
          // Time from the speech appearing to this submit. Capped at an hour:
          // a rep reopened after lunch is not a one-hour answer.
          write_ms: repOpenedRef.current
            ? Math.min(Date.now() - repOpenedRef.current, 3_600_000)
            : null,
          prompt_tokens: data.usage?.prompt_tokens ?? null,
          completion_tokens: data.usage?.completion_tokens ?? null,
          model: data.usage?.model ?? null
        });

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
      submitPendingRef.current = false;
      setLoading(false);
    }
  }, [clockExpired, currentDrill, currentIndex, loading, mode, poi, session, signOut]);

  const handleSubmit = () => submitPoi();

  // What the clock does at zero: announce it, then send whatever stands in the
  // box, flagged so the chair knows the answer was cut off rather than finished.
  // It runs once per countdown — the graded entry that comes back would otherwise
  // re-trigger the very submit that produced it — and it never fires on an empty
  // box, which has nothing to grade and would be rejected anyway; the card still
  // appears and says so. A manual retry still carries the flag while the clock
  // reads zero, so a failed auto-submit is not silently graded as a finished
  // answer.
  useEffect(() => {
    if (!repSeconds || showFeedback || sessionComplete || !currentDrill) return;
    if (!clockExpired || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    setTimeUpPhase('in');
    if (!poi.trim()) return;
    // Queued rather than called here: the submit opens with a state update, and
    // an effect body must not start one. The ref above still bounds it to a
    // single call per countdown.
    queueMicrotask(() => submitPoi());
  }, [repSeconds, showFeedback, sessionComplete, currentDrill, clockExpired, poi, submitPoi]);

  // How long the red card stays up. It runs for three seconds, then fades; if the
  // chair has still not answered by then it holds on (up to a hard 8s, so a hung
  // request cannot trap the delegate on a red screen) and lifts the moment the
  // feedback exists — which is what "fade when the grading appears" means.
  useEffect(() => {
    if (!timeUpPhase) return undefined;

    if (timeUpPhase === 'out') {
      const done = setTimeout(() => setTimeUpPhase(null), 620);
      return () => clearTimeout(done);
    }

    const openedAt = Date.now();
    let handle;
    const tick = () => {
      const elapsed = Date.now() - openedAt;
      const settled = !submitPendingRef.current || elapsed >= 8000;
      if (elapsed >= 3000 && settled) {
        setTimeUpPhase('out');
        return;
      }
      handle = setTimeout(tick, 120);
    };
    handle = setTimeout(tick, 3000);
    return () => clearTimeout(handle);
  }, [timeUpPhase]);


  /**
   * Closes out a finished session: records it for the splash screen's Recent
   * Sessions list, then shows the completion card. The score is the average of
   * the reps that were actually graded, and the topic stays a single line — a
   * session usually mixes several, so those are labelled by how many it covered
   * rather than by an arbitrary first one.
   */
  const completeSession = () => {
    const graded = history.filter((entry) => entry.feedback);    const total = graded.reduce((sum, entry) => sum + entry.feedback.score, 0);
    const average = graded.length ? Math.round((total / graded.length) * 10) / 10 : null;
    const topics = [...new Set(graded.map((entry) => entry.drill.topic))];
    const label = topics.length === 0
      ? 'Practice'
      : topics.length === 1
        ? topics[0]
        : `${topics.length} topics`;

    // One write path for both stores: the local bucket is the instant/offline
    // view, the API row is the durable one.
    if (graded.length) saveSessionResult({ topic: label, score: average }, session?.sub);
    setCompletedSessionId(currentSessionId());
    setSessionRating(null);
    endPracticeSession({
      repsDone: graded.length,
      avgScore: average,
      completed: true,
      topic: label
    }).finally(() => setHistoryVersion((version) => version + 1));

    setSessionComplete(true);
  };

  // Next > : walk forward through saved reps, and only fetch a new drill once the
  // user is standing on the last one (Dr. Frost's "end of the timeline").
  // The completion card's tap. Shown once, then replaced by a line of thanks; a
  // failed send still thanks the delegate, because the tap is a courtesy, not a
  // form they have to complete.
  const handleRateSession = (value) => {
    setSessionRating(value);
    if (completedSessionId) rateSession(completedSessionId, value);
  };

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
    setTimeUpPhase(null);
    startClock();
  };

  const handleStartSession = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setSessionComplete(false);
    setShowFeedback(false);
    setFormExiting(false);
    setSubmitError('');
    loadFirstRep();
    // A new run out of the completion screen opens a new row.
    if (gameSettings) beginPracticeSession(gameSettings);
  };

  // Play: remember the numbers, open the drill, and open the server-side row the
  // reps will hang from. Reps graded before that row exists are queued by the
  // recorder rather than dropped.
  const handleStart = (next) => {
    // Out of free runs: Play asks for the sign-in instead of opening a drill the
    // chair would then refuse to grade. This covers both anonymous caps — the
    // admin trial switch and the two-a-day limit.
    if (trial && !session && !trial.allowed) {
      setTrialNotice(trial.notice || '');
      setTrialBlocked(true);
      return;
    }
    setGameSettings(next);
    persistLastSession(next);
    setCurrentView('game');
    beginPracticeSession(next);
  };

  // "Exit Task" leaves the drill for the splash. It ALWAYS closes the session:
  // even one with no graded reps is written as an abandoned session, so the time
  // and the attempt are not silently lost. The view switches only after the close
  // request resolves, so the splash's refetch sees the new row.
  const handleExitTask = async () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    const graded = history.filter((entry) => entry.feedback);
    const total = graded.reduce((sum, entry) => sum + entry.feedback.score, 0);
    const average = graded.length ? Math.round((total / graded.length) * 10) / 10 : null;
    const topics = [...new Set(graded.map((entry) => entry.drill.topic))];
    const label = topics.length === 0
      ? 'Practice'
      : topics.length === 1
        ? topics[0]
        : `${topics.length} topics`;

    if (graded.length) saveSessionResult({ topic: label, score: average }, session?.sub);
    // Wait for the close, but not forever: a slow network must not trap the
    // delegate on the exit button. When the write lands later the history
    // version bumps and the splash refetches.
    const saving = endPracticeSession({
      repsDone: graded.length,
      avgScore: average,
      completed: false,
      topic: label
    });
    await Promise.race([
      saving,
      new Promise((resolve) => {
        window.setTimeout(resolve, 1200);
      })
    ]);
    saving.finally(() => setHistoryVersion((version) => version + 1));

    setCurrentView('splash');
    setHistory([]);
    setCurrentIndex(0);
    setPoi('');
    setShowFeedback(false);
    setSessionComplete(false);
    // Leaving drops the card's tap target with it: a later session must never be
    // rated with an id from an earlier one.
    setCompletedSessionId(null);
    setSessionRating(null);
    setFormExiting(false);
    setSubmitError('');
    setDrillError('');
    setLoadingDrill(true);
    autoSubmittedRef.current = false;
    setTimeUpPhase(null);
    // No rep on screen from here on, so the countdown has nothing to point at.
    deadlineRef.current = 0;
    setTimeLeft(0);
    // The panel belongs to the drill; leaving with it open would re-open it on
    // the next Play, over a screen the delegate had already dismissed.
    setShowMenu(false);
  };

  // One heartbeat per visible minute while a session is open. The interval is
  // paused by the browser in a background tab, and the visibility check covers
  // the first tick after returning, so idle time is never counted as practice.
  useEffect(() => {
    if (currentView !== 'game' || !session) return undefined;
    const beat = () => {
      if (document.visibilityState === 'visible') sendActivity(currentSessionId());
    };
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [currentView, session]);

  // A session left open by a reload or a closed tab is closed out the next time
  // the app runs signed in, so it cannot stay "in progress" forever.
  useEffect(() => {
    if (!session) return;
    closeOrphanedSession();
  }, [session]);

  // The page is going away mid-session: close the row with a keepalive request.
  useEffect(() => {
    const flush = () => flushSessionOnHide();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const handlePoiChange = (value) => {
    setPoi(value);
    if (submitError) setSubmitError('');
  };

  // "The chair got this one wrong" — per-run, kept in memory for the session.
  // The flag lives on the server once it lands; this only decides whether the
  // button still reads as pressable.
  const [flaggedReps, setFlaggedReps] = useState(() => new Set());
  const [flagSaving, setFlagSaving] = useState(false);
  const [flagError, setFlagError] = useState('');

  const handleFlag = async () => {
    const entry = history[currentIndex];
    const targetId = entry && entry.repId;
    if (!targetId || flagSaving) return;
    setFlagSaving(true);
    setFlagError('');
    const result = await flagRep(targetId);
    setFlagSaving(false);
    if (!result.ok) {
      setFlagError(
        result.status === 403
          ? 'Flagging is turned off for this account.'
          : result.message
      );
      return;
    }
    setFlaggedReps((current) => new Set(current).add(targetId));
  };

  const getScoreColor = (score) => {
    if (score >= 9) return '#34C759';
    if (score >= 7) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  };

  // The splash screen replaces the whole shell — no gear, no papers of its own,
  // no progress bar: it is its own full-screen view with its own settings card.
  // Every hook above has already run, so this early return costs nothing.
  if (route.name === 'session') {
    return (
      <SessionDetail
        sessionId={route.id}
        session={session}
        onSignIn={handleSignIn}
        animOn={animOn}
        lowIntensity={lowIntensity}
      />
    );
  }

  // The developer's own screen. It is not part of the delegate's flow: the URL
  // is the way in, and the API refuses any account that is not an admin.
  if (route.name === 'admin') {
    return (
      <AdminStats
        session={session}
        onSignIn={handleSignIn}
        animOn={animOn}
        lowIntensity={lowIntensity}
      />
    );
  }

  // The gear belongs to the app, not to the drill: settings are worth reaching
  // from the start screen too — the answer-storage opt-out lives in here, and a
  // privacy switch nobody can find before playing is not a switch.
  const settingsMenu = (
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
      nightLight={nightOn}
      onNightLightToggle={toggleNightLight}
      nightKelvin={nightKelvin}
      onNightKelvinChange={changeNightKelvin}
      hints={hints}
      onHintsToggle={() => updateSetting('hints', !hints)}
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
      showAnswerToggle={Boolean(session)}
      storeAnswers={storeAnswers}
      answersLocked={answersLocked}
      answerSaving={answersSaving}
      onToggleAnswers={handleToggleAnswers}
      onResetGeneral={resetGeneral}
      generalAreDefault={generalAreDefault}
      onResetFormatting={resetFormatting}
      formattingAreDefault={formattingAreDefault}
      isMobile={isMobile}
    />
  );

  // The sign-in gate trial mode raises. It is the same card from either view, so
  // it sits beside the settings menu rather than inside the drill. Signing in
  // drops it: the gate belongs to "not signed in", so it needs no state reset.
  const trialGate = trialBlocked && !session ? (
    <TrialGate
      title={
        trial && trial.trial_mode && !trial.allowed
          ? 'One practice, then sign in'
          : 'Sign in to keep practising'
      }
      notice={trialNotice || (trial && trial.notice) || ''}
      onSignIn={async (credential) => {
        const accepted = await handleSignIn(credential);
        if (accepted !== false) {
          setTrialBlocked(false);
          setTrialAuthError('');
        }
        return accepted;
      }}
      onDismiss={() => setTrialBlocked(false)}
      onExit={() => {
        setTrialBlocked(false);
        setShowMenu(false);
      }}
      authError={trialAuthError}
      onAuthError={setTrialAuthError}
    />
  ) : null;

  if (currentView === 'splash') {
    return (
      <>
        <Splash
          animOn={animOn}
          lowIntensity={lowIntensity}
          session={session}
          onSignIn={handleSignIn}
          onSignOut={signOut}
          initialSettings={gameSettings}
          historyVersion={historyVersion}
          onStart={handleStart}
          trialNote={
            trial && !session
              ? trial.allowed
                ? trial.signed_in
                  ? ''
                  : `Two free runs a day without signing in — ${trial.runs_left ?? 2} left today.`
                : 'Both free runs for today are used — sign in to keep practising.'
              : ''
          }
        />
        <HintsStrip enabled={hints} />
        {settingsMenu}
        {trialGate}
      </>
    );
  }

  return (
    <>
      {settingsMenu}
      {trialGate}

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
            {chrono ? (
              <span
                className="rep-timer is-chrono"
                role="timer"
                title="Stopwatch — counts up until you send the answer. Nothing expires."
              >
                {formatClock(elapsed)}
              </span>
            ) : repSeconds > 0 ? (
              <span
                className={`rep-timer ${timeLeft === 0 ? 'is-done' : ''}`.trim()}
                role="timer"
                title={`${repSeconds} seconds per run`}
              >
                {formatClock(timeLeft)}
              </span>
            ) : null}
          </div>
          {/* The mode switch has nothing to switch once the session is over, and
              leaving Exit Task in the row only invites an overlap in a narrow
              window. The completion card carries its own Exit Task instead. */}
          {!sessionComplete && (
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
          )}
        </div>

        {sessionComplete ? (
          <SessionComplete
            onStart={handleStartSession}
            onExit={handleExitTask}
            total={sessionLength}
            completed={gradedCount}
            average={sessionAverage}
            topic={sessionLabel}
            onRate={handleRateSession}
            rating={sessionRating}
          />
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
            onFlag={currentEntry?.repId ? handleFlag : null}
            flagged={Boolean(currentEntry?.repId && flaggedReps.has(currentEntry.repId))}
            flagSaving={flagSaving}
            flagError={flagError}
          />
        )}
      </div>

      {/* Above the shell, not inside it: the clock running out is the one moment
          the whole page should stop being usable. The card owns no timer — App
          does — so leaving the drill mid-fade cannot strand a timeout. */}
      <TimeUpOverlay
        phase={timeUpPhase}
        sending={loading}
        hasAnswer={Boolean(poi.trim())}
      />
    </>
  );
}
