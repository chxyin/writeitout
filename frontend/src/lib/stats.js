/**
 * The developer statistics behind #/admin.
 *
 * One request, one shape: the server does every aggregation, because the browser
 * has never seen the rest of the delegates' rows. A failure is handed back rather
 * than thrown, so the page can say what went wrong instead of showing an empty
 * dashboard that looks like a quiet week.
 */

import { api } from './api.js';

/**
 * The one line that makes a failure diagnosable: "HTTP 503 · stats.habits".
 * A request that never reached the API has no status at all, so it says that
 * rather than printing a 0 nobody would trust.
 */
export function formatErrorCode(statusCode, code) {
  const http = statusCode ? `HTTP ${statusCode}` : 'No response';
  return code ? `${http} · ${code}` : http;
}

/**
 * The windows the picker offers. `days` counts back from today in Hong Kong
 * time; `custom` hands two calendar dates to the same endpoint.
 */
export const STATS_RANGES = [
  { id: '1', days: 1, label: 'Today' },
  { id: '7', days: 7, label: '7 days' },
  { id: '30', days: 30, label: '30 days' },
  { id: '90', days: 90, label: '90 days' },
  { id: '365', days: 365, label: '1 year' },
  { id: 'custom', days: 0, label: 'Custom' }
];

/** The window a request belongs to: a preset id, plus the dates when custom. */
export function statsQuery({ rangeId, from, to }) {
  if (rangeId === 'custom' && from && to) {
    return `start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`;
  }
  const preset = STATS_RANGES.find((range) => range.id === rangeId);
  return `days=${preset && preset.days ? preset.days : 30}`;
}

export async function fetchAdminStats({ rangeId = '30', from = '', to = '' } = {}) {
  try {
    return {
      data: await api.get(`/api/admin/stats?${statsQuery({ rangeId, from, to })}`, {
        timeoutMs: 20_000
      })
    };
  } catch (error) {
    return {
      data: null,
      status: error && error.status ? error.status : 0,
      code: (error && error.code) || null,
      message: error && error.message ? error.message : 'The statistics could not be loaded.'
    };
  }
}

/** One delegate, everything they ever submitted, and the addresses they used. */
export async function fetchAdminUser(sub) {
  try {
    return { data: await api.get(`/api/admin/users/${encodeURIComponent(sub)}`, { timeoutMs: 25_000 }) };
  } catch (error) {
    return {
      data: null,
      status: error && error.status ? error.status : 0,
      code: (error && error.code) || null,
      message: error && error.message ? error.message : 'That delegate could not be read.'
    };
  }
}

/**
 * Overwrite one run: `{ excluded }` takes it out of (or back into) every
 * statistic, `{ score }` replaces the chair's mark. The server recounts the
 * delegate either way.
 */
export async function patchRep(id, body) {
  try {
    return { ok: true, data: await api.patch(`/api/admin/reps/${encodeURIComponent(id)}`, body) };
  } catch (error) {
    return {
      ok: false,
      code: (error && error.code) || null,
      message: (error && error.message) || 'That change was refused.'
    };
  }
}

/** Delete one run for good. There is no undo behind this. */
export async function deleteRep(id) {
  try {
    return { ok: true, data: await api.del(`/api/admin/reps/${encodeURIComponent(id)}`) };
  } catch (error) {
    return {
      ok: false,
      code: (error && error.code) || null,
      message: (error && error.message) || 'That run could not be deleted.'
    };
  }
}

/** 1,234 → "1,234"; null → "". Used by both CSV writers. */
function cell(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** A field safe to sit inside a CSV cell, whatever the answer text contains. */
function csvCell(value) {
  const text = cell(value).replace(/\r?\n/g, ' ');
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvText(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
}

/** Hand the text to the browser as a download, with no server round trip. */
function download(filename, text) {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The URL is only alive for this page; releasing it keeps a long session from
  // holding every export it ever made in memory.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The dashboard's own table, as a spreadsheet. */
export function downloadSummaryCsv(delegates, stamp) {
  download(
    `writeitout-summary-${stamp}.csv`,
    csvText(
      ['Name', 'Email', 'Runs', 'Average score', 'Best score', 'Longest streak', 'Last seen'],
      delegates.map((row) => [
        row.name,
        row.email,
        row.reps,
        row.average_score,
        row.best_score,
        row.longest_streak,
        row.last_seen_at
      ])
    )
  );
}

/** Every run of every delegate in the window, as a spreadsheet. */
export function downloadRepsCsv(reps, who, stamp) {
  download(
    `writeitout-${who}-${stamp}.csv`,
    csvText(
      [
        'Delegate',
        'Topic',
        'Drill',
        'Mode',
        'Submitted',
        'Score',
        'Timed out',
        'Seconds writing',
        'Seconds grading',
        'Prompt tokens',
        'Completion tokens',
        'Speech',
        'Answer',
        'AI feedback'
      ],
      reps.map((rep) => [
        who,
        rep.topic,
        rep.drill_id,
        rep.mode,
        rep.created_at,
        rep.score,
        rep.timed_out ? 'yes' : 'no',
        rep.write_ms === null || rep.write_ms === undefined ? '' : (rep.write_ms / 1000).toFixed(1),
        rep.latency_ms === null || rep.latency_ms === undefined ? '' : (rep.latency_ms / 1000).toFixed(1),
        rep.prompt_tokens,
        rep.completion_tokens,
        rep.prompt || 'not stored',
        rep.answer || 'not stored',
        [rep.grade_label, rep.reasoning, rep.constructive_feedback].filter(Boolean).join(' — ')
      ])
    )
  );
}
