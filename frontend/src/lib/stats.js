/**
 * The developer statistics behind #/admin.
 *
 * One request, one shape: the server does every aggregation, because the browser
 * has never seen the rest of the delegates' rows. A failure is handed back rather
 * than thrown, so the page can say what went wrong instead of showing an empty
 * dashboard that looks like a quiet week.
 */

import { api } from './api.js';

/** How many days of history the dashboard can ask for. */
export const STATS_RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' }
];

export async function fetchAdminStats(days = 30) {
  try {
    return { data: await api.get(`/api/admin/stats?days=${days}`, { timeoutMs: 20_000 }) };
  } catch (error) {
    return {
      data: null,
      status: error && error.status ? error.status : 0,
      message: error && error.message ? error.message : 'The statistics could not be loaded.'
    };
  }
}
