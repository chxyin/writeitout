/**
 * Practice sessions, reps and history — the calls that move data between the
 * browser and the database.
 *
 * A session is opened once (Play), written to as reps are graded, and closed
 * exactly once — by finishing the session, by Exit Task, or by the page going
 * away. The recorder below owns that lifecycle so no screen has to remember it:
 *
 *   * reps graded before the session row exists are queued, not dropped;
 *   * the open session id is kept in localStorage, so a reload or a closed tab
 *     leaves a marker that the next load closes out as an abandoned session;
 *   * the close request uses `keepalive`, so navigating away cannot cancel it.
 *
 * Every function is safe to fire and forget: a failed save must never break a
 * practice session, so failures resolve instead of throwing. The readers return
 * null on failure so callers can fall back to the local cache.
 */

import { api, API_BASE_URL } from './api.js';
import { authorizationHeaders } from './auth.js';

const OPEN_SESSION_KEY = 'writeitout:open-session';
const MAX_QUEUED_REPS = 20;

/** The session open in this tab, if any. */
let sessionId = null;
/** Reps graded before the row id arrived. */
let queuedReps = [];
/** What we know about the open session, for the pagehide fallback. */
let progress = { repsDone: 0, average: null, topic: null };

/** A stable id for a rep, so a retried save cannot be counted twice. */
export function repId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rep-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function rememberOpenSession(id) {
  try {
    window.localStorage.setItem(OPEN_SESSION_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Private browsing: the in-memory id still works for this page.
  }
}

function readOpenSession() {
  try {
    const raw = window.localStorage.getItem(OPEN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function forgetOpenSession() {
  try {
    window.localStorage.removeItem(OPEN_SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

function closeBody({ repsDone = 0, avgScore = null, completed = false, topic = null }) {
  return {
    reps_done: Math.max(0, Math.min(1000, Math.round(repsDone) || 0)),
    avg_score: Number.isFinite(avgScore) ? avgScore : null,
    completed: Boolean(completed),
    topic: topic ? String(topic).slice(0, 200) : null
  };
}

function postRep(id, rep) {
  if (!id) return;
  api
    .post(`/api/sessions/${id}/reps`, rep, { timeoutMs: 6000, keepalive: true })
    .catch(() => {
      // Analytics only: the grade itself already happened.
    });
}

/**
 * Close a session left open by a previous page load. Called before a new session
 * starts and once when the app boots signed in.
 */
export async function closeOrphanedSession() {
  const open = readOpenSession();
  if (!open) return;
  try {
    await api.patch(`/api/sessions/${open.id}`, closeBody({ completed: false }), {
      timeoutMs: 6000,
      keepalive: true
    });
  } catch {
    // It is abandoned either way; the marker is cleared below.
  }
  if (!sessionId) forgetOpenSession();
}

export async function startPracticeSession({ reps, timer }) {
  try {
    const data = await api.post('/api/sessions', {
      reps_target: Math.max(1, Math.min(100, Math.round(reps))),
      seconds_per_rep: Math.max(0, Math.min(600, Math.round(timer)))
    });
    return data && data.session_id ? data.session_id : null;
  } catch {
    return null;
  }
}

/** Open the row for a new session and flush anything graded before it existed. */
export async function beginPracticeSession(settings) {
  await closeOrphanedSession();
  sessionId = null;
  queuedReps = [];
  progress = { repsDone: 0, average: null, topic: null };

  const id = await startPracticeSession(settings);
  if (!id) return null;

  sessionId = id;
  rememberOpenSession(id);
  const pending = queuedReps;
  queuedReps = [];
  pending.forEach((rep) => postRep(id, rep));
  return id;
}

/** Record one graded rep. Queued while the row id is still in flight. */
export function recordRep(rep) {
  progress.repsDone += 1;
  if (rep && rep.topic) progress.topic = rep.topic;
  if (!sessionId) {
    if (queuedReps.length < MAX_QUEUED_REPS) queuedReps.push(rep);
    return;
  }
  postRep(sessionId, rep);
}

/**
 * Close the session. Always called — completion, Exit Task, and the completion
 * card's own exit — so a session is never left dangling with a null score.
 */
export async function endPracticeSession({ repsDone, avgScore, completed, topic }) {
  const open = readOpenSession();
  const target = sessionId || (open ? open.id : null);
  if (!target) {
    forgetOpenSession();
    return;
  }

  if (sessionId && queuedReps.length) {
    const pending = queuedReps;
    queuedReps = [];
    pending.forEach((rep) => postRep(sessionId, rep));
  }

  try {
    await api.patch(`/api/sessions/${target}`, closeBody({ repsDone, avgScore, completed, topic }), {
      timeoutMs: 6000,
      keepalive: true
    });
  } catch {
    // The local history entry still records the session.
  }
  if (sessionId === target) sessionId = null;
  forgetOpenSession();
}

/**
 * The page is going away: close the row without waiting for an answer.
 * `keepalive` is what lets the request outlive the document.
 */
export function flushSessionOnHide() {
  const open = readOpenSession();
  const target = sessionId || (open ? open.id : null);
  if (!target) return;
  try {
    fetch(`${API_BASE_URL}/api/sessions/${target}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
      body: JSON.stringify(closeBody({ ...progress, avgScore: progress.average, completed: false })),
      keepalive: true
    }).catch(() => {});
  } catch {
    // Nothing else can be done as the page unloads.
  }
  forgetOpenSession();
}

export async function sendActivity(sessionIdOrNull) {
  try {
    await api.post('/api/activity', { session_id: sessionIdOrNull || null }, { timeoutMs: 5000 });
  } catch {
    // A dropped heartbeat only under-counts a minute of practice.
  }
}

/** The id of the session this tab is recording, for the heartbeat. */
export function currentSessionId() {
  return sessionId;
}

export async function sendEvents(events) {
  if (!events || events.length === 0) return;
  try {
    await api.post('/api/events', { events }, { timeoutMs: 5000 });
  } catch {
    // Telemetry is never allowed to affect the UI.
  }
}

/** The account's saved sessions, or null when the API cannot be reached. */
export async function fetchHistory(limit = 20) {
  try {
    const data = await api.get(`/api/sessions?limit=${limit}`);
    return Array.isArray(data?.sessions) ? data.sessions : null;
  } catch {
    return null;
  }
}

/**
 * One past session and its reps, for the replay page. Unlike the readers above
 * this one throws: the page has to tell "this is not your session" from "the
 * network dropped", and both from "the API is asleep".
 */
export async function fetchSessionDetail(id) {
  return api.get(`/api/sessions/${id}`, { timeoutMs: 12_000 });
}

export async function fetchProfile() {
  try {
    return await api.get('/api/profile');
  } catch {
    return null;
  }
}

/** Push the entries a delegate built before the database existed. */
export async function importLocalHistory(entries) {
  if (!entries || entries.length === 0) return 0;
  try {
    const data = await api.post('/api/sessions/import', {
      entries: entries.slice(0, 100).map((entry) => ({
        topic: String(entry.topic || '').slice(0, 200),
        score: Number(entry.score)
      }))
    });
    return data && Number.isFinite(data.imported) ? data.imported : 0;
  } catch {
    return 0;
  }
}

/**
 * The completion card's one tap: 1 = useful, 0 = not yet. Sent with the session
 * id captured before the session closed, because closing clears the recorder's
 * own. Failure is silent — a lost tap is not worth showing the delegate an error
 * on the screen that ends their practice.
 */
export async function rateSession(id, rating) {
  if (!id) return false;
  try {
    await api.post(`/api/sessions/${id}/rating`, { rating }, { timeoutMs: 6000 });
    return true;
  } catch {
    return false;
  }
}

/** The trial's state for this browser: mode on, and whether the free practice is spent. */
export async function fetchTrialState() {
  try {
    return await api.get('/api/trial', { timeoutMs: 6000 });
  } catch {
    return null;
  }
}

/** The delegate's answer-storage preference. */
export async function saveAnswerPreference(storeAnswers) {
  try {
    await api.patch('/api/profile', { mode: storeAnswers ? 'full' : 'redacted' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The deployment-wide switches the start screen needs to know about. Only the
 * answer-storage mode for now: a delegate's own switch is a request, and the
 * deployment can overrule it, so the card has to be able to say so.
 */
export async function fetchDeploymentSettings() {
  try {
    const data = await api.get('/api/settings');
    return data && typeof data.poi_storage_mode === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** Admin: the deployment-wide answer-storage policy. */
export async function saveStorageMode(mode) {
  try {
    return await api.patch('/api/admin/settings', { mode });
  } catch {
    return null;
  }
}

/** Admin: whether an anonymous visitor gets one practice before the sign-in. */
export async function saveTrialMode(enabled) {
  try {
    return await api.patch('/api/admin/settings', { trial_mode: Boolean(enabled) });
  } catch {
    return null;
  }
}
