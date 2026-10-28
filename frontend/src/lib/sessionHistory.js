/**
 * Session history for the splash screen's "Recent Sessions" list. One entry per
 * finished session — { topic, score, date } — newest first, in localStorage.
 * Only the splash screen reads it and only the end of a session writes it, so
 * the two sides live together here instead of each owning the storage key.
 */

export const HISTORY_STORAGE_KEY = 'writeitout_history';

/** Sessions past this fall off the end; the list never grows without bound. */
const MAX_ENTRIES = 20;

/**
 * Reads the saved sessions. A value that is not a list — or an entry that is not
 * a topic/score pair — is dropped, so a hand-edited or half-written entry can
 * only cost the bad rows rather than the whole list.
 */
export function loadSessionHistory() {
  if (typeof window === 'undefined') return [];
  let parsed;
  try {
    parsed = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.topic === 'string' &&
        // JSON has no Infinity/NaN, but a hand-edited file can still hold a string.
        Number.isFinite(entry.score)
    )
    .map((entry) => ({
      topic: entry.topic,
      score: entry.score,
      date: typeof entry.date === 'string' ? entry.date : ''
    }))
    .slice(0, MAX_ENTRIES);
}

/**
 * Records a finished session and returns the list as saved. `score` is the
 * average of the reps that were graded; the date is stamped here so the entry
 * keeps the day it was played even if the list is read much later.
 */
export function saveSessionResult({ topic, score }) {
  const entry = { topic, score, date: new Date().toLocaleDateString() };
  const sessions = [entry, ...loadSessionHistory()].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Private browsing or a full quota: the app still finishes, it just forgets.
  }
  return sessions;
}
