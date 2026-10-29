/**
 * Practice sessions, reps and history — the calls that move data between the
 * browser and the database.
 *
 * Every function is safe to fire and forget: a save that fails must never break
 * a practice session, so the failures resolve instead of throwing. The two
 * readers (`fetchHistory`, `fetchProfile`) return null on failure so the caller
 * can fall back to the local cache.
 */

import { api } from './api.js';

/** A stable id for a rep, so a retried save cannot be counted twice. */
export function repId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rep-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

export async function finishPracticeSession(sessionId, { repsDone, avgScore, completed, topic }) {
  if (!sessionId) return;
  try {
    await api.patch(`/api/sessions/${sessionId}`, {
      reps_done: repsDone,
      avg_score: Number.isFinite(avgScore) ? avgScore : null,
      completed: Boolean(completed),
      topic: topic ? topic.slice(0, 200) : null
    });
  } catch {
    // The local history entry still records the session.
  }
}

export async function recordRep(sessionId, rep) {
  if (!sessionId) return;
  try {
    await api.post(`/api/sessions/${sessionId}/reps`, rep);
  } catch {
    // Analytics only: the grade itself already happened.
  }
}

export async function sendActivity(sessionId) {
  try {
    await api.post('/api/activity', { session_id: sessionId || null }, { timeoutMs: 5000 });
  } catch {
    // A dropped heartbeat only under-counts a minute of practice.
  }
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

/** The delegate's answer-storage preference. */
export async function saveAnswerPreference(storeAnswers) {
  try {
    await api.patch('/api/profile', { mode: storeAnswers ? 'full' : 'redacted' });
    return true;
  } catch {
    return false;
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
