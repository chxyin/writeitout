/**
 * A past session, replayed.
 *
 * This is the drill and the feedback card again — the same two screens, in the
 * same order — with every way of changing something taken away. There is no
 * clock, the answer cannot be edited, and the primary button leads to what the
 * chair said instead of sending the rep off to be graded. The session is over;
 * the page is only showing what was already decided.
 *
 * It lives at #/session/<id> so a session can be reloaded, bookmarked or opened
 * from a message, which is also why it handles being opened signed out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PaperBackground from './PaperBackground.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import DrillForm from './DrillForm.jsx';
import FeedbackCard from './FeedbackCard.jsx';
import SessionComplete from './SessionComplete.jsx';
import useBreakpoint from '../hooks/useBreakpoint.js';
import { fetchSessionDetail } from '../lib/practice.js';
import { GOOGLE_CLIENT_ID } from '../lib/googleAuth.js';
import { goHome } from '../lib/route.js';

/** Same thresholds as the splash list and the feedback card. */
function scoreTone(score) {
  if (!Number.isFinite(score)) return 'score-none';
  if (score >= 7) return 'score-high';
  if (score >= 5) return 'score-mid';
  return 'score-low';
}

function scoreColor(score) {
  if (!Number.isFinite(score)) return 'var(--text-muted, #8A8A8E)';
  if (score >= 9) return '#34C759';
  if (score >= 7) return 'var(--accent-orange)';
  return 'var(--accent-red)';
}

function formatScore(score) {
  if (!Number.isFinite(score)) return '—';
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** "29 Oct 2026, 4:05 pm" — the day the session was played. */
function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The clock time of one rep, for the strip above it. */
function formatClockTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** 205 → "3m 25s", 42 → "42s". */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  if (!minutes) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function wordCount(text) {
  if (!text) return 0;
  const trimmed = String(text).trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function SessionDetail({
  sessionId,
  session = null,
  onSignIn,
  animOn = true,
  lowIntensity = false
}) {
  // One piece of state for the fetch, keyed by id. `idle` or a stale id both mean
  // "still loading", which is why nothing has to be set synchronously when the
  // effect starts — signing out therefore needs no reset either.
  const [loaded, setLoaded] = useState({ id: '', status: 'idle', detail: null });
  const [authError, setAuthError] = useState('');
  const [index, setIndex] = useState(0);
  // drill → feedback, or summary once the last rep has been read.
  const [step, setStep] = useState('drill');
  const { isMobile, isTablet, orientation } = useBreakpoint();
  const tier = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  const status = !session
    ? 'signed-out'
    : loaded.id === sessionId
      ? loaded.status
      : 'loading';

  useEffect(() => {
    if (!session) return undefined;

    let cancelled = false;
    fetchSessionDetail(sessionId)
      .then((data) => {
        if (cancelled) return;
        if (!data || !data.session) {
          setLoaded({ id: sessionId, status: 'missing', detail: null });
          return;
        }
        setLoaded({ id: sessionId, status: 'ready', detail: data });
        setIndex(0);
        setStep('drill');
      })
      .catch((error) => {
        if (cancelled) return;
        // 404 is "not yours or not there" — the API deliberately does not tell
        // the two apart. Everything else is a network or server problem.
        setLoaded({
          id: sessionId,
          status: error && error.status === 404 ? 'missing' : 'error',
          detail: null
        });
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, session]);

  const detail = status === 'ready' ? loaded.detail : null;

  // The tab title names the session, and is put back when the page closes.
  useEffect(() => {
    const previous = document.title;
    const topic = detail && detail.session ? detail.session.topic : '';
    if (status === 'ready' && topic) document.title = `${topic} · WriteItOut`;
    return () => {
      document.title = previous;
    };
  }, [status, detail]);

  // Every rep and every step starts at the top: a long speech would otherwise
  // reopen scrolled to wherever the previous one ended. The scroller is this
  // page itself — it is pinned to the viewport — not the window.
  const pageRef = useRef(null);
  useEffect(() => {
    const scroller = pageRef.current;
    if (!scroller) return;
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: 0 });
    else scroller.scrollTop = 0;
  }, [index, step]);

  const reps = (detail && detail.reps) || [];
  const rep = reps[index] || null;
  const sessionRow = detail ? detail.session : null;

  const handleNextRep = useCallback(() => {
    setStep('drill');
    setIndex((current) => Math.min(current + 1, Math.max(reps.length - 1, 0)));
  }, [reps.length]);

  const handlePrevRep = useCallback(() => {
    setStep('drill');
    setIndex((current) => Math.max(current - 1, 0));
  }, []);

  const handleNext = useCallback(() => {
    if (step === 'drill') {
      if (rep && rep.feedback) setStep('feedback');
      return;
    }
    if (index >= reps.length - 1) {
      setStep('summary');
      return;
    }
    handleNextRep();
  }, [handleNextRep, index, rep, reps.length, step]);

  const handleSignIn = async ({ credential }) => {
    setAuthError('');
    const accepted = await onSignIn(credential);
    if (accepted === false) {
      setAuthError('Google signed you in, but this app rejected the credential. Please try again.');
    }
  };

  const summaryProps = useMemo(() => {
    if (!sessionRow) return null;
    return {
      total: Math.max(sessionRow.reps_target || 0, sessionRow.reps_done || 0) || 1,
      completed: sessionRow.reps_done || 0,
      average: Number.isFinite(sessionRow.score) ? sessionRow.score : null,
      topic: sessionRow.topic || (sessionRow.completed ? 'Practice' : 'Ended early')
    };
  }, [sessionRow]);

  const goBack = goHome;

  return (
    <div className="session-page" ref={pageRef}>
      <PaperBackground animOn={animOn} lowIntensity={lowIntensity} />

      <div className="app-container mode-full session-shell" data-tier={tier} data-orientation={orientation}>
        <div className="session-top">
          <button type="button" className="exit-task-btn session-back" onClick={goBack}>
            ← Start screen
          </button>

          {status === 'ready' && sessionRow ? (
            <div className="session-heading">
              <h1 className="session-title">
                {sessionRow.topic || (sessionRow.completed ? 'Practice session' : 'Ended early')}
              </h1>
              <div className="session-meta">
                <span>{formatWhen(sessionRow.started_at)}</span>
                {sessionRow.duration_seconds ? (
                  <>
                    <span className="session-meta-dot" aria-hidden="true">·</span>
                    <span>{formatDuration(sessionRow.duration_seconds)}</span>
                  </>
                ) : null}
                {sessionRow.seconds_per_rep > 0 && (
                  <>
                    <span className="session-meta-dot" aria-hidden="true">·</span>
                    <span>{sessionRow.seconds_per_rep}s per run</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="session-heading">
              <h1 className="session-title">Past session</h1>
            </div>
          )}

          {status === 'ready' && sessionRow && (
            <div className="session-badges">
              <span className={`session-badge ${sessionRow.completed ? 'is-complete' : 'is-ended'}`}>
                {sessionRow.completed ? 'Complete' : 'Ended early'}
              </span>
              <span className={`session-badge is-score ${scoreTone(sessionRow.score)}`}>
                {formatScore(sessionRow.score)}
                {Number.isFinite(sessionRow.score) ? '/10' : ''}
              </span>
            </div>
          )}
        </div>

        {step === 'summary' && summaryProps ? (
          <SessionComplete
            frozen
            onExit={goBack}
            onStart={goBack}
            exitLabel="Back to the start"
            startLabel="Start a new session"
            total={summaryProps.total}
            completed={summaryProps.completed}
            average={summaryProps.average}
            topic={summaryProps.topic}
          />
        ) : status === 'loading' ? (
          <div className="loading-message">Loading the session...</div>
        ) : status === 'signed-out' ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">Sign in to see this session</h2>
            <p className="session-gate-copy">
              Practice sessions belong to the account that played them, so the page needs to
              know who is asking.
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
        ) : status === 'missing' ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">This session could not be found</h2>
            <p className="session-gate-copy">
              It may belong to another account, or the link may be mistyped.
            </p>
            <button type="button" className="play-btn" onClick={goBack}>Back to the start</button>
          </div>
        ) : status === 'error' ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">The session could not be loaded</h2>
            <p className="session-gate-copy">
              The chair&apos;s records are not reachable right now. Try opening it again in a moment.
            </p>
            <button type="button" className="play-btn" onClick={goBack}>Back to the start</button>
          </div>
        ) : reps.length === 0 ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">No runs were saved for this session</h2>
            <p className="session-gate-copy">
              {sessionRow && sessionRow.reps_done > 0
                ? 'This session came from your old browser history, which only kept the summary — the speech, your answers and the chair’s feedback were never stored.'
                : 'The session ended before a run was submitted, so there is nothing to replay. The attempt is still in the totals.'}
            </p>
            <button type="button" className="play-btn" onClick={goBack}>Back to the start</button>
          </div>
        ) : !rep ? (
          <div className="glass-card session-gate">
            <h2 className="card-title">This run is missing</h2>
            <p className="session-gate-copy">The session has runs, but not this one.</p>
            <button type="button" className="play-btn" onClick={goBack}>Back to the start</button>
          </div>
        ) : (
          <>
            <div className="session-rep-strip">
              <span className={`session-rep-score ${scoreTone(rep.score)}`}>
                {formatScore(rep.score)}
                {Number.isFinite(rep.score) ? '/10' : ''}
              </span>
              <span className="rep-chip">{rep.mode === 'single' ? 'Solutions Only' : 'Full Speech'}</span>
              {rep.timed_out && <span className="rep-chip is-warn">Clock ran out</span>}
              {formatClockTime(rep.created_at) && (
                <span className="rep-chip is-quiet">{formatClockTime(rep.created_at)}</span>
              )}
              <span className="rep-chip is-quiet">
                {wordCount(rep.answer)} {wordCount(rep.answer) === 1 ? 'word' : 'words'}
              </span>
              {rep.prompt_source === 'dataset' && (
                <span className="rep-chip is-quiet" title="The exact prompt was not stored; it was rebuilt from the speech dataset.">
                  speech rebuilt
                </span>
              )}
            </div>

            {step === 'feedback' && rep.feedback ? (
              <FeedbackCard
                key={`${rep.id}-feedback`}
                frozen
                feedback={rep.feedback}
                scoreColor={scoreColor(rep.feedback.score)}
                originalPoi={rep.answer || ''}
                initialShowOriginal
                timedOut={Boolean(rep.timed_out)}
                onBack={() => setStep('drill')}
                onNext={handleNext}
                onPrev={handlePrevRep}
                canPrev={index > 0}
                canNext={index < reps.length - 1}
                historyIndex={index}
                historyLength={reps.length}
                backLabel="← Your answer"
                nextLabel={index >= reps.length - 1 ? 'Session summary →' : 'Next run →'}
              />
            ) : (
              <DrillForm
                key={`${rep.id}-drill`}
                frozen
                loadingDrill={false}
                drillError=""
                currentDrill={{
                  topic: rep.drill.topic || rep.topic,
                  committee: rep.drill.committee,
                  delegate: rep.drill.delegate
                }}
                activePrompt={rep.prompt || ''}
                poi={rep.answer || ''}
                answerMissing={!rep.answer}
                wordCount={wordCount(rep.answer)}
                submitError=""
                loading={false}
                onPoiChange={() => {}}
                onSubmit={() => {}}
                onSeeFeedback={() => setStep('feedback')}
                canSeeFeedback={Boolean(rep.feedback)}
                onPrev={handlePrevRep}
                onNext={handleNextRep}
                canPrev={index > 0}
                canNext={index < reps.length - 1}
                historyIndex={index}
                historyLength={reps.length}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
