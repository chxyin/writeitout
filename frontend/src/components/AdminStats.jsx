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
import useBreakpoint from '../hooks/useBreakpoint.js';
import { fetchAdminStats, STATS_RANGES } from '../lib/stats.js';
import { saveStorageMode } from '../lib/practice.js';
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

export default function AdminStats({
  session = null,
  onSignIn,
  animOn = true,
  lowIntensity = false
}) {
  const [days, setDays] = useState(30);
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
  const { isMobile, isTablet, orientation } = useBreakpoint();
  const tier = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  const key = `${days}:${reload}`;
  const status = !session
    ? 'signed-out'
    : loaded.key === key
      ? loaded.status
      : 'loading';

  useEffect(() => {
    if (!session) return undefined;

    let cancelled = false;
    fetchAdminStats(days).then((result) => {
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
  }, [days, key, session]);

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

  // Both charts scale to their own busiest bar, so a quiet week still shows its
  // shape instead of a flat line along the floor.
  const busiestDay = Math.max(1, ...daily.map((day) => day.reps));
  const busiestScore = Math.max(1, ...scores.map((row) => row.reps));
  const busiestDropoff = Math.max(1, ...((habits && habits.dropoff) || []).map((row) => row.sessions));

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
                  <span>last {data.days} days, Hong Kong time</span>
                </>
              )}
            </div>
          </div>

          {status === 'ready' && (
            <div className="stats-range" role="group" aria-label="Time window">
              {STATS_RANGES.map((range) => (
                <button
                  key={range.days}
                  type="button"
                  className={`stats-range-btn ${range.days === days ? 'is-active' : ''}`.trim()}
                  aria-pressed={range.days === days}
                  onClick={() => setDays(range.days)}
                >
                  {range.label}
                </button>
              ))}
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
                  <div className="stats-chart" role="img" aria-label={`Runs per day over the last ${data.days} days`}>
                    {daily.map((day) => (
                      <div className="stats-bar-slot" key={day.day}>
                        <div
                          className={`stats-bar ${day.reps === 0 ? 'is-empty' : ''}`.trim()}
                          style={{ height: `${Math.round((day.reps / busiestDay) * 100)}%` }}
                          title={`${formatDay(day.day)}: ${day.reps} runs · ${day.active_users} active · ${formatMoney(day.cost_usd)}`}
                        />
                      </div>
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
                  <h2 className="stats-panel-title">Busiest delegates</h2>
                  {delegates.length === 0 ? (
                    <p className="stats-empty">No accounts yet.</p>
                  ) : (
                    <div className="stats-table">
                      <div className="stats-table-head">
                        <span>Delegate</span>
                        <span className="stats-num">Runs</span>
                        <span className="stats-num">Avg</span>
                        <span className="stats-num">Best</span>
                      </div>
                      {delegates.map((row) => (
                        <div className="stats-table-row" key={row.email || row.name || row.reps}>
                          <span className="stats-delegate">
                            <span className="stats-delegate-name">{row.name || 'Delegate'}</span>
                            {row.email && <span className="stats-delegate-email">{row.email}</span>}
                          </span>
                          <span className="stats-num">{formatCount(row.reps)}</span>
                          <span className="stats-num">{formatAverage(row.average_score)}</span>
                          <span className="stats-num">{formatAverage(row.best_score)}</span>
                        </div>
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
    </div>
  );
}
