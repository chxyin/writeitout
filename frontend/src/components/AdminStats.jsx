/**
 * Developer statistics: #/admin.
 *
 * This is the one screen that is not for a delegate. It answers "is anyone using
 * this, and how is it going" — how many people signed in, how many runs the chair
 * graded, how the scores are spread, what the model costs, and who is practising
 * most. Every number is computed by the API from the whole database; the browser
 * has never seen the other accounts' rows, and it is not given any answer text
 * here, only counts.
 *
 * It is admin-only, and the check is the server's: the page draws a "not an
 * admin" card when the endpoint answers 403 rather than deciding for itself. The
 * info button explains the numbers in plain words, because a dashboard nobody can
 * read is a dashboard nobody opens.
 */

import { useEffect, useState } from 'react';
import PaperBackground from './PaperBackground.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import UserDrawer from './UserDrawer.jsx';
import useBreakpoint from '../hooks/useBreakpoint.js';
import { fetchAdminStats, downloadSummaryCsv, STATS_RANGES } from '../lib/stats.js';
import { saveStorageMode, saveTrialMode } from '../lib/practice.js';
import { GOOGLE_CLIENT_ID } from '../lib/googleAuth.js';
import { goHome } from '../lib/route.js';

/** 1,234 → "1,234". Counts are read at a glance, so they keep their separators. */
function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString();
}

/** 6.1666 → "6.2"; null → "—". Averages are never shown to more than one decimal. */
function formatAverage(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(1);
}

/** 0.0412 → "4.1%"; the rate the dashboard shows as a share. */
function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${(number * 100).toFixed(number * 100 >= 10 ? 0 : 1)}%`;
}

/**
 * Spend is small, so a fixed two decimals would read "$0.00" for a week of
 * practice. Three decimals until it is worth a dollar, then the usual two.
 */
function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number === 0) return '$0';
  if (number < 1) return `$${number.toFixed(3)}`;
  return `$${number.toFixed(2)}`;
}

/** 3,725s → "1h 2m"; 95s → "1m 35s". Time on app, not per-run time. */
function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total <= 0) return '0m';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (!hours) return minutes ? `${minutes}m` : `${Math.floor(total)}s`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** 29 Oct — the axis label for a day in the series. */
function formatDay(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso || '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One headline number, with a line of context under it. */
function StatCard({ label, value, detail, tone }) {
  return (
    <div className={`stats-card ${tone ? `is-${tone}` : ''}`.trim()}>
      <span className="stats-card-label">{label}</span>
      <span className="stats-card-value">{value}</span>
      {detail && <span className="stats-card-detail">{detail}</span>}
    </div>
  );
}

/** A smaller label/figure/note triple, for the panels that come in rows. */
function Fact({ label, value, detail }) {
  return (
    <div className="stats-fact">
      <span className="stats-fact-label">{label}</span>
      <span className="stats-fact-value">{value}</span>
      {detail && <span className="stats-fact-detail">{detail}</span>}
    </div>
  );
}

/** 0.62 → "62%". The clock read is a share, not a duration. */
function formatShare(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${Math.round(number * 100)}%`;
}

// Two real choices, not three: `off` and `redacted` behave identically on the
// server — anything but `full` discards the text — so offering both would be a
// switch that does nothing.
const STORAGE_CHOICES = [
  { mode: 'full', label: 'Keep answers', hint: 'Answers and the chair’s notes are stored.' },
  { mode: 'off', label: 'Scores only', hint: 'Only marks and counts are stored. The text is dropped as it is written.' }
];

// The delegate table's filters. Each one is a question a developer actually asks
// of this list ("who never came back", "whose scores are stuck below 5"), and
// ticking several narrows the list — they are read as AND, which is what a
// checkbox row implies.
const todayIso = () => new Date().toISOString().slice(0, 10);

const DELEGATE_FILTERS = [
  { id: 'practised', label: 'Has practised', test: (row) => row.reps > 0 },
  { id: 'never', label: 'Never practised', test: (row) => !row.reps },
  {
    id: 'new',
    label: 'New in window',
    test: (row, start) => Boolean(row.created_at && start && row.created_at.slice(0, 10) >= start)
  },
  {
    id: 'quiet',
    label: 'Quiet 14+ days',
    // A delegate who never practised is "never", not "quiet": that is a
    // different problem and it has its own filter.
    test: (row) =>
      Boolean(
        row.reps > 0 &&
          (!row.last_practice_on ||
            (Date.parse(`${todayIso()}T00:00:00`) - Date.parse(`${row.last_practice_on}T00:00:00`)) /
              86_400_000 >
              14)
      )
  },
  {
    id: 'low',
    label: 'Average under 5',
    test: (row) => Number.isFinite(row.average_score) && row.average_score < 5
  },
  {
    id: 'high',
    label: 'Average 7 or better',
    test: (row) => Number.isFinite(row.average_score) && row.average_score >= 7
  },
  { id: 'streak', label: 'Streak of 3+', test: (row) => Number(row.longest_streak) >= 3 },
  { id: 'optedOut', label: 'Answers not stored', test: (row) => row.store_answers === false }
];

export default function AdminStats({
  session = null,
  onSignIn,
  animOn = true,
  lowIntensity = false
}) {
  const [rangeId, setRangeId] = useState('30');
  // The custom picker's own dates. Kept apart from the active range so typing a
  // date does not refetch on every keystroke: the range only switches to
  // `custom` once both ends are filled in.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openUser, setOpenUser] = useState(null);
  // Which delegate filters are ticked, as ids. Independent of the date window:
  // the window chooses the numbers, the ticks choose the rows.
  const [rowsFilter, setRowsFilter] = useState([]);
  const [rowSearch, setRowSearch] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [reload, setReload] = useState(0);
  // One object for the fetch, keyed by the request it belongs to. Nothing has to
  // be reset synchronously when the window or the account changes: a request
  // whose key no longer matches simply reads as "loading".
  const [loaded, setLoaded] = useState({ key: '', status: 'idle', data: null, message: '' });
  const [authError, setAuthError] = useState('');
  // The deployment-wide answer-storage policy. null means "whatever the server
  // last reported"; once the admin flips it the local value leads, so the switch
  // does not jump back while the save is in flight.
  const [storageMode, setStorageMode] = useState(null);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  // Trial mode: one anonymous practice, then a sign-in. Same idea as the answer
  // switch — a deployment policy that should not need a redeploy to change.
  const [trialMode, setTrialMode] = useState(null);
  const [trialSaving, setTrialSaving] = useState(false);
  const [trialError, setTrialError] = useState('');
  const { isMobile, isTablet, orientation } = useBreakpoint();
  const tier = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  const key = `${rangeId}:${from}:${to}:${reload}`;
  const status = !session
    ? 'signed-out'
    : loaded.key === key
      ? loaded.status
      : 'loading';

  useEffect(() => {
    if (!session) return undefined;

    let cancelled = false;
    fetchAdminStats({ rangeId, from, to }).then((result) => {
      if (cancelled) return;
      if (result.data) {
        setLoaded({ key, status: 'ready', data: result.data, message: '' });
        return;
      }
      setLoaded({
        key,
        status: result.status === 403 ? 'forbidden' : 'error',
        data: null,
        message: result.message
      });
    });

    return () => {
      cancelled = true;
    };
  }, [from, key, rangeId, session, to]);

  // The tab says what the page is, and the app's own title comes back when the
  // page closes — the same courtesy the replayed session pays.
  useEffect(() => {
    const previous = document.title;
    document.title = 'Statistics · WriteItOut';
    return () => {
      document.title = previous;
    };
  }, []);

  const data = status === 'ready' ? loaded.data : null;
  const totals = data ? data.totals : null;
  const daily = (data && data.daily) || [];
  const scores = (data && data.scores) || [];
  const topics = (data && data.topics) || [];
  const delegates = (data && data.delegates) || [];
  const retention = (data && data.retention) || null;
  const habits = (data && data.habits) || null;
  const lapsed = (data && data.lapsed) || null;

  // The switch reads `full` as "keep" and anything else as "scores only", which
  // is exactly how the server decides whether to store the text.
  const storageValue = storageMode || (data && data.storage_mode) || 'full';
  const storageChoice = storageValue === 'full' ? 'full' : 'off';

  const chooseStorage = async (mode) => {
    if (mode === storageValue || storageSaving) return;
    const previous = storageMode;
    setStorageMode(mode);
    setStorageSaving(true);
    setStorageError('');
    const saved = await saveStorageMode(mode);
    setStorageSaving(false);
    if (!saved || !saved.ok) {
      setStorageMode(previous);
      setStorageError('That setting could not be saved. Try again.');
    }
  };

  const trialValue = trialMode !== null ? trialMode : Boolean(data && data.trial_mode);

  const chooseTrial = async (enabled) => {
    if (enabled === trialValue || trialSaving) return;
    const previous = trialMode;
    setTrialMode(enabled);
    setTrialSaving(true);
    setTrialError('');
    const saved = await saveTrialMode(enabled);
    setTrialSaving(false);
    if (!saved || !saved.ok) {
      setTrialMode(previous);
      setTrialError('That setting could not be saved. Try again.');
    }
  };

  // Both charts scale to their own busiest bar, so a quiet week still shows its
  // shape instead of a flat line along the floor.
  const busiestDay = Math.max(1, ...daily.map((day) => day.reps));
  const busiestScore = Math.max(1, ...scores.map((row) => row.reps));
  const busiestDropoff = Math.max(1, ...((habits && habits.dropoff) || []).map((row) => row.sessions));

  // Every ticked filter has to pass, and the search box has to match either the
  // name or the address.
  const shownDelegates = delegates.filter((row) => {
    const ticked = DELEGATE_FILTERS.filter((filter) => rowsFilter.includes(filter.id));
    if (!ticked.every((filter) => filter.test(row, data && data.start))) return false;
    const needle = rowSearch.trim().toLowerCase();
    if (!needle) return true;
    return `${row.name || ''} ${row.email || ''}`.toLowerCase().includes(needle);
  });

  const handleSignIn = async ({ credential }) => {
    setAuthError('');
    const accepted = await onSignIn(credential);
    if (accepted === false) {
      setAuthError('Google signed you in, but this app rejected the credential. Please try again.');
    }
  };

  return (
    <div className="session-page stats-page">
      <PaperBackground animOn={animOn} lowIntensity={lowIntensity} />

      <div
        className="app-container mode-full session-shell stats-shell"
        data-tier={tier}
        data-orientation={orientation}
      >
        <div className="session-top stats-top">
          <button type="button" className="exit-task-btn session-back" onClick={goHome}>
            ← Start screen
          </button>

          <div className="session-heading">
            <h1 className="session-title">Statistics</h1>
            <div className="session-meta">
              <span>Developer view</span>
              {totals && (
                <>
                  <span className="session-meta-dot" aria-hidden="true">·</span>
                  <span>
                    {data.start && data.end
                      ? `${formatDay(data.start)} → ${formatDay(data.end)}`
                      : `last ${data.days} days`}{' '}
                    · Hong Kong time
                  </span>
                </>
              )}
            </div>
          </div>

          {status === 'ready' && (
            <div className="stats-range-wrap">
              <div className="stats-range" role="group" aria-label="Time window">
                {STATS_RANGES.map((range) => (
                  <button
                    key={range.id}
                    type="button"
                    className={`stats-range-btn ${range.id === rangeId ? 'is-active' : ''}`.trim()}
                    aria-pressed={range.id === rangeId}
                    onClick={() => setRangeId(range.id)}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
              {rangeId === 'custom' && (
                <div className="stats-dates">
                  <label className="stats-date">
                    <span>From</span>
                    <input
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(event) => setFrom(event.target.value)}
                    />
                  </label>
                  <label className="stats-date">
                    <span>To</span>
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(event) => setTo(event.target.value)}
                    />
                  </label>
                  {!(from && to) && <span className="stats-dates-hint">Pick both ends</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {status === 'signed-out' ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">Sign in to see the statistics</h2>
            <p className="session-gate-copy">
              The numbers cover every account on this deployment, so the page needs to know who
              is asking. Only the developer account is allowed in.
            </p>
            {GOOGLE_CLIENT_ID && onSignIn ? (
              <GoogleSignInButton
                onSuccess={handleSignIn}
                onError={() => setAuthError('Google sign-in did not finish. Please try again.')}
              />
            ) : (
              <p className="auth-error" role="alert">Google sign-in is not configured for this build.</p>
            )}
            {authError && <p className="auth-error" role="alert">{authError}</p>}
          </div>
        ) : status === 'forbidden' ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">This account is not an admin</h2>
            <p className="session-gate-copy">
              The statistics are limited to the developer account that runs this deployment. If
              that should be you, add your address to ADMIN_EMAILS on the backend.
            </p>
            <button type="button" className="play-btn" onClick={goHome}>Back to the start</button>
          </div>
        ) : status === 'error' ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">The statistics could not be read</h2>
            <p className="session-gate-copy">
              {loaded.message || 'The chair’s records are not reachable right now.'}
            </p>
            <div className="stats-gate-actions">
              <button type="button" className="play-btn" onClick={() => setReload((n) => n + 1)}>
                Try again
              </button>
              <button type="button" className="exit-task-btn" onClick={goHome}>
                Back to the start
              </button>
            </div>
          </div>
        ) : status === 'loading' ? (
          <div className="loading-message">Reading the numbers...</div>
        ) : (
          <>
            <div className="stats-toolbar">
              <button
                type="button"
                className="stats-info-btn"
                aria-expanded={infoOpen}
                aria-controls="stats-info"
                onClick={() => setInfoOpen((open) => !open)}
              >
                <span className="stats-info-mark" aria-hidden="true">i</span>
                What these numbers mean
              </button>
              <span className="stats-updated">Updated {formatWhen(data.generated_at)}</span>
            </div>

            {infoOpen && (
              <div className="stats-info" id="stats-info">
                <div className="stats-info-grid">
                  <div>
                    <strong>A run</strong>
                    <span>One POI the chair graded. The session length is counted in runs.</span>
                  </div>
                  <div>
                    <strong>Delegates</strong>
                    <span>Google accounts that have signed in at least once.</span>
                  </div>
                  <div>
                    <strong>Active today / 7d / 30d</strong>
                    <span>
                      Delegates who had the app open in that window. A visible minute sends one
                      heartbeat, so a tab left in the background does not count.
                    </span>
                  </div>
                  <div>
                    <strong>Average score</strong>
                    <span>The chair’s marks out of 10 across every graded run in the window.</span>
                  </div>
                  <div>
                    <strong>Clock ran out</strong>
                    <span>Runs the timer submitted for the delegate, so they may stop mid-sentence.</span>
                  </div>
                  <div>
                    <strong>Spend</strong>
                    <span>
                      An estimate: DeepSeek’s list price × the tokens the grader used. Cache hits
                      are not recorded, so it errs high.
                    </span>
                  </div>
                  <div>
                    <strong>Time on app</strong>
                    <span>Visible minutes summed across everyone — not time spent typing alone.</span>
                  </div>
                  <div>
                    <strong>Days</strong>
                    <span>Every day here is a Hong Kong day, which is the day delegates experience.</span>
                  </div>
                  <div>
                    <strong>Back on day 1 / 7 / 30</strong>
                    <span>
                      Of the delegates who joined long enough ago to have had that day, the share
                      who practised on it. Accounts too new to have had day 30 are not counted
                      against the rate.
                    </span>
                  </div>
                  <div>
                    <strong>Stickiness</strong>
                    <span>
                      Today's active delegates divided by the month's. High means people come
                      back most days; low means practice happens in bursts.
                    </span>
                  </div>
                  <div>
                    <strong>Week joined</strong>
                    <span>
                      One line per week of new accounts, and how many of them practised in each
                      of the four weeks that followed. This is the "is it becoming a habit" read.
                    </span>
                  </div>
                  <div>
                    <strong>Time per sitting</strong>
                    <span>
                      From Play to the end of the session. A sitting that was never closed is
                      left out, and one left open overnight is capped at four hours.
                    </span>
                  </div>
                  <div>
                    <strong>Left after one run</strong>
                    <span>
                      Sittings that stopped without reaching the end of their first run — the
                      clearest sign the first thing they saw did not land.
                    </span>
                  </div>
                  <div>
                    <strong>Clock used</strong>
                    <span>
                      Of the time allowed, the share a delegate typically used before submitting.
                      Only timed runs can be measured, and only from the release that started
                      recording writing time.
                    </span>
                  </div>
                  <div>
                    <strong>Would repeat</strong>
                    <span>
                      Of the sittings that got the one-tap question at the end, the share marked
                      useful. Only answered sittings count, so leaving without tapping is not a
                      "no".
                    </span>
                  </div>
                  <div>
                    <strong>Gone quiet</strong>
                    <span>
                      Delegates counted from their last graded run. "Never practised" is a
                      different problem: an account that signed in and stopped there.
                    </span>
                  </div>
                  <div>
                    <strong>What gets stored</strong>
                    <span>
                      Keep answers stores the text so a run can be reread; Scores only keeps the
                      marks and counts and drops the text as it is written.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {totals.reps === 0 ? (
              <div className="glass-card session-gate">
                <h2 className="card-title">No runs in this window</h2>
                <p className="session-gate-copy">
                  {totals.reps_all > 0
                    ? `${formatCount(totals.reps_all)} runs are on record, but none in the last ${data.days} days. Try a longer window.`
                    : 'Nothing has been graded yet. The first signed-in run will fill this page.'}
                </p>
              </div>
            ) : (
              <>
                <div className="stats-cards">
                  <StatCard
                    label="Delegates"
                    value={formatCount(totals.delegates)}
                    detail={`${formatCount(totals.delegates_new)} new in this window`}
                  />
                  <StatCard
                    label="Active today"
                    value={formatCount(data.active.dau)}
                    detail={`${formatCount(data.active.wau)} this week · ${formatCount(data.active.mau)} this month`}
                  />
                  <StatCard
                    label="Runs graded"
                    value={formatCount(totals.reps)}
                    detail={`${formatCount(totals.reps_all)} all time`}
                  />
                  <StatCard
                    label="Average score"
                    value={`${formatAverage(totals.avg_score)}/10`}
                    detail={`median ${formatAverage(totals.median_score)} · ${formatCount(totals.sessions)} sessions`}
                    tone={
                      Number(totals.avg_score) >= 7
                        ? 'high'
                        : Number(totals.avg_score) >= 5
                          ? 'mid'
                          : 'low'
                    }
                  />
                  <StatCard
                    label="Clock ran out"
                    value={formatPercent(totals.timed_out_reps / totals.reps)}
                    detail={`${formatCount(totals.timed_out_reps)} of ${formatCount(totals.reps)} runs`}
                  />
                  <StatCard
                    label="Spend"
                    value={formatMoney(totals.cost_usd)}
                    detail={
                      totals.cost_per_rep_usd !== null
                        ? `${formatMoney(totals.cost_per_rep_usd)} per run`
                        : 'no runs yet'
                    }
                  />
                  <StatCard
                    label="Time on app"
                    value={formatDuration(totals.active_seconds)}
                    detail={
                      totals.avg_latency_ms !== null
                        ? `${(totals.avg_latency_ms / 1000).toFixed(1)}s per grade`
                        : 'no grades timed yet'
                    }
                  />
                  <StatCard
                    label="Sessions"
                    value={formatCount(totals.sessions)}
                    detail={`${formatCount(totals.sessions_completed)} finished · ${formatCount(totals.sessions_open)} left open`}
                  />
                </div>

                <section className="stats-panel">
                  <h2 className="stats-panel-title">Runs per day</h2>
                  <div className="stats-chart-frame">
                    <div className="stats-chart-scale" aria-hidden="true">
                      <span>{busiestDay}</span>
                      <span>{Math.round(busiestDay / 2)}</span>
                      <span>0</span>
                    </div>
                    <div
                      className="stats-chart"
                      role="img"
                      aria-label={`Runs per day from ${formatDay(data.start)} to ${formatDay(data.end)}`}
                    >
                      {daily.map((day) => (
                        <div className="stats-bar-slot" key={day.day} tabIndex={0}>
                          <div
                            className={`stats-bar ${day.reps === 0 ? 'is-empty' : ''}`.trim()}
                            style={{ height: `${Math.round((day.reps / busiestDay) * 100)}%` }}
                          />
                          {/* The hover card is the same information the bar's own
                              `title` carries, but readable: a native tooltip can
                              take a second to appear and cannot be styled. */}
                          <span className="stats-tip" role="tooltip">
                            <b>{formatDay(day.day)}</b>
                            <span>{formatCount(day.reps)} {day.reps === 1 ? 'run' : 'runs'}</span>
                            <span>{formatCount(day.active_users)} active · {formatMoney(day.cost_usd)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="stats-chart-axis" aria-hidden="true">
                    {daily.map((day, index) => (
                      <span key={day.day}>
                        {index % Math.max(1, Math.ceil(daily.length / 7)) === 0 ? formatDay(day.day) : ''}
                      </span>
                    ))}
                  </div>
                  <p className="stats-chart-caption">
                    {daily.length > 0 && `${formatDay(daily[0].day)} → ${formatDay(daily[daily.length - 1].day)}`}
                    <span className="stats-chart-peak">busiest day: {busiestDay} runs</span>
                  </p>
                </section>

                {retention && (
                  <section className="stats-panel">
                    <h2 className="stats-panel-title">Do they come back?</h2>
                    <p className="stats-panel-note">
                      All time, whatever the range above says — a 7-day window cannot hold a
                      30-day answer.
                    </p>
                    <div className="stats-facts">
                      <Fact
                        label="Back the next day"
                        value={formatPercent(retention.d1.rate)}
                        detail={`${formatCount(retention.d1.hit)} of ${formatCount(retention.d1.of)} delegates`}
                      />
                      <Fact
                        label="Back on day 7"
                        value={formatPercent(retention.d7.rate)}
                        detail={`${formatCount(retention.d7.hit)} of ${formatCount(retention.d7.of)}`}
                      />
                      <Fact
                        label="Back on day 30"
                        value={formatPercent(retention.d30.rate)}
                        detail={`${formatCount(retention.d30.hit)} of ${formatCount(retention.d30.of)}`}
                      />
                      <Fact
                        label="Stickiness"
                        value={data.active.mau ? formatPercent(data.active.dau / data.active.mau) : '—'}
                        detail={`${formatCount(data.active.dau)} today per ${formatCount(data.active.mau)} a month`}
                      />
                    </div>

                    {retention.cohorts.length > 0 && (
                      <div className="stats-table stats-cohorts">
                        <div className="stats-table-head">
                          <span>Week joined</span>
                          <span className="stats-num">New</span>
                          <span className="stats-num">Wk 1</span>
                          <span className="stats-num">Wk 2</span>
                          <span className="stats-num">Wk 3</span>
                          <span className="stats-num">Wk 4</span>
                        </div>
                        {retention.cohorts
                          .slice()
                          .reverse()
                          .map((row) => (
                            <div className="stats-table-row" key={row.week}>
                              <span className="stats-cohort-week">{formatDay(row.week)}</span>
                              <span className="stats-num">{formatCount(row.delegates)}</span>
                              {[row.w1, row.w2, row.w3, row.w4].map((count, band) => (
                                <span className="stats-num" key={band}>
                                  {row.delegates
                                    ? `${Math.round((count / row.delegates) * 100)}%`
                                    : '—'}
                                </span>
                              ))}
                            </div>
                          ))}
                      </div>
                    )}
                    <p className="stats-chart-caption">
                      Each row is one week's new accounts
                      <span className="stats-chart-peak">share who practised again that week</span>
                    </p>
                  </section>
                )}

                {habits && (
                  <section className="stats-panel">
                    <h2 className="stats-panel-title">How a sitting goes</h2>
                    <div className="stats-facts">
                      <Fact
                        label="Time per sitting"
                        value={
                          Number.isFinite(habits.median_session_seconds)
                            ? formatDuration(habits.median_session_seconds)
                            : '—'
                        }
                        detail={
                          Number.isFinite(habits.avg_session_seconds)
                            ? `${formatDuration(habits.avg_session_seconds)} on average`
                            : 'no closed sitting yet'
                        }
                      />
                      <Fact
                        label="Runs per sitting"
                        value={formatAverage(habits.avg_runs)}
                        detail={`${formatCount(habits.sessions)} sittings in this window`}
                      />
                      <Fact
                        label="Ran to the end"
                        value={formatPercent(habits.finish_rate)}
                        detail={`${formatCount(habits.finished)} of ${formatCount(habits.sessions)}`}
                      />
                      <Fact
                        label="Left after one run"
                        value={formatPercent(
                          habits.sessions ? habits.one_and_done / habits.sessions : null
                        )}
                        detail={`${formatCount(habits.one_and_done)} sittings`}
                      />
                      <Fact
                        label="With a clock"
                        value={formatPercent(habits.timed_share)}
                        detail={`${formatCount(habits.timed)} timed, the rest untimed`}
                      />
                      <Fact
                        label="Clock used"
                        value={formatShare(habits.median_clock_share)}
                        detail={
                          habits.clock_measured
                            ? `median of ${formatCount(habits.clock_measured)} timed runs`
                            : 'no timed run measured yet'
                        }
                      />
                      <Fact
                        label="Would repeat"
                        value={formatPercent(habits.useful_share)}
                        detail={
                          habits.rated
                            ? `${formatCount(habits.useful)} of ${formatCount(habits.rated)} rated useful`
                            : 'no sitting rated yet'
                        }
                      />
                      <Fact
                        label="Words per run"
                        value={
                          Number.isFinite(totals.avg_chars)
                            ? formatCount(Math.round(totals.avg_chars / 6))
                            : '—'
                        }
                        detail="estimated from the answer's length"
                      />
                    </div>

                    <div
                      className="stats-chart"
                      role="img"
                      aria-label="How many runs each sitting reached"
                    >
                      {habits.dropoff.map((row) => (
                        <div className="stats-bar-slot" key={row.runs}>
                          <div
                            className={`stats-bar ${row.sessions === 0 ? 'is-empty' : ''}`.trim()}
                            style={{ height: `${Math.round((row.sessions / busiestDropoff) * 100)}%` }}
                            title={`${row.runs}${row.runs === 8 ? '+' : ''} runs: ${row.sessions} sittings`}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="stats-chart-caption">
                      Runs reached per sitting, 0 → 8+
                      <span className="stats-chart-peak">where people stop</span>
                    </p>
                  </section>
                )}

                {lapsed && (
                  <section className="stats-panel">
                    <h2 className="stats-panel-title">Gone quiet</h2>
                    <div className="stats-facts">
                      <Fact label="Practised this week" value={formatCount(lapsed.active_7)} />
                      <Fact label="This fortnight" value={formatCount(lapsed.active_14)} />
                      <Fact label="Silent 14+ days" value={formatCount(lapsed.quiet_14)} />
                      <Fact label="Silent 30+ days" value={formatCount(lapsed.quiet_30)} />
                      <Fact
                        label="Never practised"
                        value={formatCount(lapsed.never)}
                        detail="signed in, no run yet"
                      />
                    </div>

                    {lapsed.delegates.length === 0 ? (
                      <p className="stats-empty">Nobody has been away for two weeks.</p>
                    ) : (
                      <div className="stats-table stats-lapsed">
                        <div className="stats-table-head">
                          <span>Delegate</span>
                          <span className="stats-num">Runs</span>
                          <span className="stats-num">Last run</span>
                        </div>
                        {lapsed.delegates.map((row) => (
                          <div className="stats-table-row" key={row.email || row.name || row.days_ago}>
                            <span className="stats-delegate">
                              <span className="stats-delegate-name">{row.name || 'Delegate'}</span>
                              {row.email && <span className="stats-delegate-email">{row.email}</span>}
                            </span>
                            <span className="stats-num">{formatCount(row.reps)}</span>
                            <span className="stats-num">
                              {row.days_ago === 1
                                ? 'yesterday'
                                : `${formatCount(row.days_ago)} days ago`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <div className="stats-columns">
                  <section className="stats-panel">
                    <h2 className="stats-panel-title">Score spread</h2>
                    <div className="stats-rows">
                      {scores.map((row) => (
                        <div className="stats-row" key={row.score}>
                          <span className="stats-row-key">{row.score}</span>
                          <div className="stats-row-track">
                            <div
                              className={`stats-row-fill ${row.score >= 7 ? 'is-high' : row.score >= 5 ? 'is-mid' : 'is-low'}`}
                              style={{ width: `${Math.round((row.reps / busiestScore) * 100)}%` }}
                            />
                          </div>
                          <span className="stats-row-value">{row.reps}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="stats-panel">
                    <h2 className="stats-panel-title">Topics</h2>
                    {topics.length === 0 ? (
                      <p className="stats-empty">No topics in this window.</p>
                    ) : (
                      <div className="stats-rows">
                        {topics.map((row) => (
                          <div className="stats-row is-topic" key={row.topic}>
                            <span className="stats-row-topic" title={row.topic}>{row.topic}</span>
                            <span className="stats-row-value">{row.reps}</span>
                            <span className={`stats-row-score ${row.avg_score >= 7 ? 'is-high' : row.avg_score >= 5 ? 'is-mid' : 'is-low'}`}>
                              {formatAverage(row.avg_score)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className="stats-panel">
                  <div className="stats-panel-head">
                    <h2 className="stats-panel-title">
                      Delegates{' '}
                      <span className="stats-panel-count">
                        {formatCount(shownDelegates.length)} of {formatCount(delegates.length)}
                      </span>
                    </h2>
                    <button
                      type="button"
                      className="stats-choice-btn is-inline"
                      onClick={() => downloadSummaryCsv(shownDelegates, new Date().toISOString().slice(0, 10))}
                      disabled={shownDelegates.length === 0}
                    >
                      Download CSV
                    </button>
                  </div>

                  <div className="stats-filters" role="group" aria-label="Filter delegates">
                    {DELEGATE_FILTERS.map((filter) => {
                      const active = rowsFilter.includes(filter.id);
                      return (
                        <label
                          key={filter.id}
                          className={`stats-filter ${active ? 'is-active' : ''}`.trim()}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() =>
                              setRowsFilter((current) =>
                                current.includes(filter.id)
                                  ? current.filter((id) => id !== filter.id)
                                  : [...current, filter.id]
                              )
                            }
                          />
                          <span>{filter.label}</span>
                        </label>
                      );
                    })}
                    {(rowsFilter.length > 0 || rowSearch) && (
                      <button
                        type="button"
                        className="stats-filter is-clear"
                        onClick={() => {
                          setRowsFilter([]);
                          setRowSearch('');
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <input
                    className="user-search"
                    type="search"
                    placeholder="Search name or email..."
                    aria-label="Search delegates"
                    value={rowSearch}
                    onChange={(event) => setRowSearch(event.target.value)}
                  />

                  {delegates.length === 0 ? (
                    <p className="stats-empty">No accounts yet.</p>
                  ) : shownDelegates.length === 0 ? (
                    <p className="stats-empty">No delegate matches those filters.</p>
                  ) : (
                    <div className="stats-table">
                      <div className="stats-table-head">
                        <span>Delegate</span>
                        <span className="stats-num">Runs</span>
                        <span className="stats-num">Avg</span>
                        <span className="stats-num">Best</span>
                      </div>
                      {shownDelegates.map((row) => (
                        <button
                          type="button"
                          className="stats-table-row is-clickable"
                          key={row.sub || row.email || row.name || row.reps}
                          onClick={() => setOpenUser(row.sub || null)}
                          disabled={!row.sub}
                          title={row.sub ? 'Open this delegate' : 'No account id on this row'}
                        >
                          <span className="stats-delegate">
                            <span className="stats-delegate-name">{row.name || 'Delegate'}</span>
                            {row.email && <span className="stats-delegate-email">{row.email}</span>}
                          </span>
                          <span className="stats-num">{formatCount(row.reps)}</span>
                          <span className="stats-num">{formatAverage(row.average_score)}</span>
                          <span className="stats-num">{formatAverage(row.best_score)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="stats-panel stats-storage">
                  <h2 className="stats-panel-title">What gets stored</h2>
                  <p className="stats-panel-note">
                    New runs only — changing this does not delete answers already saved. A
                    delegate can still opt out on their own profile card.
                  </p>
                  <div className="stats-choice" role="group" aria-label="Answer storage">
                    {STORAGE_CHOICES.map((choice) => {
                      const active = storageChoice === choice.mode;
                      return (
                        <button
                          key={choice.mode}
                          type="button"
                          className={`stats-choice-btn ${active ? 'is-active' : ''}`.trim()}
                          aria-pressed={active}
                          disabled={storageSaving}
                          onClick={() => chooseStorage(choice.mode)}
                        >
                          <span className="stats-choice-label">{choice.label}</span>
                          <span className="stats-choice-hint">{choice.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  {storageError && <p className="auth-error" role="alert">{storageError}</p>}
                  <p className="stats-footnote">
                    {storageSaving ? 'Saving…' : 'Changes take effect immediately.'}
                  </p>

                  <h2 className="stats-panel-title stats-panel-title-spaced">Trial mode</h2>
                  <p className="stats-panel-note">
                    While this is on, a visitor who has not signed in gets one practice, tracked
                    by a cookie and their address. The next attempt asks for the Google sign-in
                    instead. Signed-in delegates are never limited.
                  </p>
                  <div className="stats-choice" role="group" aria-label="Trial mode">
                    {[
                      { on: false, label: 'Off', hint: 'Anyone can practise without an account.' },
                      {
                        on: true,
                        label: 'One practice, then sign in',
                        hint: 'The gate explains why, in the words on the sign-in card.'
                      }
                    ].map((choice) => {
                      const active = trialValue === choice.on;
                      return (
                        <button
                          key={String(choice.on)}
                          type="button"
                          className={`stats-choice-btn ${active ? 'is-active' : ''}`.trim()}
                          aria-pressed={active}
                          disabled={trialSaving}
                          onClick={() => chooseTrial(choice.on)}
                        >
                          <span className="stats-choice-label">{choice.label}</span>
                          <span className="stats-choice-hint">{choice.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  {trialError && <p className="auth-error" role="alert">{trialError}</p>}
                </section>

                <p className="stats-footnote">
                  Answers stored: {storageValue} · grader: {data.model} ·{' '}
                  {formatCount(totals.prompt_tokens + totals.completion_tokens)} tokens in this window
                </p>
              </>
            )}
          </>
        )}
      </div>

      {openUser && (
        <UserDrawer
          sub={openUser}
          onClose={() => setOpenUser(null)}
          // A deleted or excluded run changes every number on this page, so the
          // dashboard re-reads itself while the drawer stays open.
          onChanged={() => setReload((count) => count + 1)}
        />
      )}
    </div>
  );
}
