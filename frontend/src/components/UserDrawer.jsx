/**
 * One delegate, from the developer's side — a drawer over #/admin.
 *
 * It answers two different questions in one place: "who is this and what have
 * they cost" at the top, and "show me exactly what they did" underneath. The
 * second half is the God Mode list: every run they ever submitted, with the
 * speech, their answer, the chair's verdict and what that run cost.
 *
 * Answer text appears only when it was actually stored. A delegate who opted out
 * of answer storage, or a deployment set to scores-only, shows "not stored" here
 * too — the point of that switch is that no page in the product can read it back.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchAdminUser, downloadRepsCsv, formatErrorCode, patchRep, deleteRep } from '../lib/stats.js';

/** 1,234 → "1,234"; missing → "—". */
function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '—';
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number === 0) return '$0';
  return number < 1 ? `$${number.toFixed(3)}` : `$${number.toFixed(2)}`;
}

function duration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total <= 0) return '0m';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (!hours) return minutes ? `${minutes}m` : `${total}s`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function when(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function day(iso) {
  if (!iso) return '—';
  // A join date arrives as a full timestamp, a practice day as a bare date.
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function seconds(ms) {
  if (ms === null || ms === undefined) return '—';
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

/** One run. Everything long is folded away, because the list can be hundreds. */
function RepCard({ rep, busy, onExclude, onDelete, onScore }) {
  const [confirming, setConfirming] = useState(false);

  const save = (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 10) return;
    if (value === Number(rep.score)) return;
    onScore(rep.id, value);
  };

  return (
    <details className={`user-rep ${rep.excluded ? 'is-excluded' : ''}`.trim()}>
      <summary className="user-rep-head">
        <span className={`user-rep-score ${rep.score >= 7 ? 'is-high' : rep.score >= 5 ? 'is-mid' : 'is-low'}`}>
          {rep.score === null ? '—' : `${rep.score}`}
        </span>
        <span className="user-rep-topic">{rep.topic || 'Practice'}</span>
        <span className="user-rep-meta">
          {rep.excluded && <span className="user-rep-tag is-excluded">excluded</span>}
          {rep.committee && <span className="user-rep-tag">{rep.committee}</span>}
          {rep.timed_out && <span className="user-rep-tag is-warn">buzzer</span>}
          <span className="user-rep-when">{when(rep.created_at)}</span>
        </span>
      </summary>

      <div className="user-rep-body">
        <div className="user-rep-grid">
          <span><b>Written in</b>{seconds(rep.write_ms)}</span>
          <span><b>Graded in</b>{seconds(rep.latency_ms)}</span>
          <span><b>Tokens</b>{count((rep.prompt_tokens || 0) + (rep.completion_tokens || 0))}</span>
          <span><b>Mode</b>{rep.mode === 'single' ? 'solutions only' : 'full speech'}</span>
        </div>

        <div className="user-rep-field">
          <span className="user-rep-label">The speech</span>
          <p className="user-rep-text">{rep.prompt || 'Not stored — this run predates the replay, or the answer text was not kept.'}</p>
        </div>

        <div className="user-rep-field">
          <span className="user-rep-label">Their answer</span>
          <p className="user-rep-text">
            {rep.answer || 'Not stored — the delegate opted out, or the deployment keeps scores only.'}
          </p>
        </div>

        <div className="user-rep-field">
          <span className="user-rep-label">Chair</span>
          {rep.grade_label && <p className="user-rep-label-line">{rep.grade_label}</p>}
          <p className="user-rep-text">
            {rep.reasoning || rep.constructive_feedback || 'No written feedback on this run.'}
          </p>
          {rep.constructive_feedback && rep.reasoning && (
            <p className="user-rep-text is-note">{rep.constructive_feedback}</p>
          )}
        </div>

        {rep.rewritten_poi && (
          <div className="user-rep-field">
            <span className="user-rep-label">What it should have said</span>
            <p className="user-rep-text">{rep.rewritten_poi}</p>
          </div>
        )}

        {/* Developer actions. Excluding is reversible and only hides the run from
            the statistics; deleting cannot be undone, so it asks first. */}
        <div className="user-rep-actions">
          <label className="user-rep-override">
            <span>Score</span>
            <input
              // Uncontrolled and keyed by the stored mark: a re-read after a save
              // remounts it on the new value, and typing in between is never
              // overwritten by a render.
              key={String(rep.score)}
              type="number"
              min="0"
              max="10"
              step="0.5"
              defaultValue={rep.score === null ? '' : String(rep.score)}
              disabled={busy}
              onBlur={(event) => save(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </label>
          <button
            type="button"
            className="user-rep-action"
            disabled={busy}
            onClick={() => onExclude(rep.id, !rep.excluded)}
          >
            {rep.excluded ? 'Include again' : 'Exclude from stats'}
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="user-rep-action is-danger"
                disabled={busy}
                onClick={() => onDelete(rep.id)}
              >
                Delete forever
              </button>
              <button
                type="button"
                className="user-rep-action is-quiet"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="user-rep-action is-quiet"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

export default function UserDrawer({ sub, onClose, onChanged = null }) {
  const [loaded, setLoaded] = useState({
    sub: '',
    data: null,
    status: 'loading',
    message: '',
    statusCode: 0,
    code: null
  });
  const [filter, setFilter] = useState('');
  // Bumped after every write so the drawer re-reads itself; the dashboard behind
  // it is refreshed through `onChanged`.
  const [token, setToken] = useState(0);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAdminUser(sub).then((result) => {
      if (cancelled) return;
      setLoaded(
        result.data
          ? { sub, data: result.data, status: 'ready', message: '', statusCode: 200, code: null }
          : {
              sub,
              data: null,
              status: 'error',
              message: result.message,
              statusCode: result.status || 0,
              code: result.code || null
            }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [sub, token]);

  // One place for the three writes: mark the row busy, run it, then refresh — or
  // say why it was refused.
  const act = async (id, work) => {
    setBusyId(id);
    setActionError('');
    const result = await work();
    setBusyId('');
    if (!result.ok) {
      setActionError(result.code ? `${result.message} (${result.code})` : result.message);
      return;
    }
    setToken((current) => current + 1);
    if (onChanged) onChanged();
  };

  // Escape closes the drawer, and the page behind it stops scrolling while it is
  // open — otherwise a phone scrolls the dashboard under the sheet.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const ready = loaded.status === 'ready' && loaded.sub === sub;
  const user = ready ? loaded.data.user : null;
  const reps = useMemo(() => (ready && loaded.data.reps) || [], [ready, loaded.data]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return reps;
    return reps.filter((rep) =>
      [rep.topic, rep.committee, rep.grade_label].some((field) =>
        String(field || '').toLowerCase().includes(needle)
      )
    );
  }, [filter, reps]);

  const stamp = new Date().toISOString().slice(0, 10);
  const who = user && user.email ? user.email.split('@')[0] : 'delegate';

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="user-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={user ? `${user.name || user.email} in detail` : 'Delegate in detail'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="user-drawer-top">
          <div className="user-drawer-id">
            {user && user.picture ? (
              <img className="avatar" src={user.picture} alt="" width="44" height="44" referrerPolicy="no-referrer" />
            ) : (
              <div className="avatar" aria-hidden="true">
                {String((user && (user.name || user.email)) || 'D').trim().charAt(0).toUpperCase() || 'D'}
              </div>
            )}
            <div className="user-drawer-names">
              <span className="user-drawer-name">{user ? user.name || 'Delegate' : 'Reading...'}</span>
              {user && user.email && <span className="user-drawer-email">{user.email}</span>}
              <span className="user-drawer-sub">sub · {sub}</span>
            </div>
          </div>
          <button type="button" className="user-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loaded.status === 'error' ? (
          <div className="stats-empty">
            <p>{loaded.message}</p>
            <p className="stats-error-code">
              <span>Error code</span>
              <code>{formatErrorCode(loaded.statusCode, loaded.code)}</code>
            </p>
          </div>
        ) : !ready ? (
          <div className="loading-message">Reading the delegate...</div>
        ) : (
          <>
            <div className="user-drawer-facts">
              <div className="stats-fact">
                <span className="stats-fact-label">Joined</span>
                <span className="stats-fact-value is-small">{day(user.created_at)}</span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">Last active</span>
                <span className="stats-fact-value is-small">{when(user.last_seen_at)}</span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">Total runs</span>
                <span className="stats-fact-value">{count(user.reps)}</span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">Average score</span>
                <span className="stats-fact-value">
                  {user.avg_score === null ? '—' : `${user.avg_score}/10`}
                </span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">Time on app</span>
                <span className="stats-fact-value">{duration(user.active_seconds)}</span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">Tokens</span>
                <span className="stats-fact-value">
                  {count(user.prompt_tokens + user.completion_tokens)}
                </span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">DeepSeek spend</span>
                <span className="stats-fact-value">{money(user.cost_usd)}</span>
              </div>
              <div className="stats-fact">
                <span className="stats-fact-label">Answers stored</span>
                <span className="stats-fact-value is-small">
                  {user.store_answers ? 'yes' : 'opted out'}
                </span>
              </div>
            </div>

            <section className="user-drawer-ips">
              <h3 className="stats-panel-title">Addresses</h3>
              {user.ips.length === 0 ? (
                <p className="stats-empty">No address recorded yet — they signed in before this was logged.</p>
              ) : (
                <div className="stats-table user-ips">
                  <div className="stats-table-head">
                    <span>IP</span>
                    <span className="stats-num">Seen</span>
                    <span className="stats-num">Last</span>
                  </div>
                  {user.ips.map((row) => (
                    <div className="stats-table-row" key={row.ip}>
                      <span className="user-ip-value">{row.ip}</span>
                      <span className="stats-num">{count(row.requests)}×</span>
                      <span className="stats-num">{when(row.last_seen)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="user-drawer-reps">
              <div className="user-drawer-reps-head">
                <h3 className="stats-panel-title">God Mode — every run ({count(reps.length)})</h3>
                <button
                  type="button"
                  className="stats-choice-btn is-inline"
                  onClick={() => downloadRepsCsv(reps, who, stamp)}
                >
                  Download CSV
                </button>
              </div>

              {reps.length > 4 && (
                <input
                  className="user-search"
                  type="search"
                  placeholder="Filter by topic, committee or grade..."
                  aria-label="Filter this delegate's runs"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              )}

              {actionError && <p className="auth-error" role="alert">{actionError}</p>}

              {reps.length === 0 ? (
                <p className="stats-empty">Nothing submitted yet.</p>
              ) : visible.length === 0 ? (
                <p className="stats-empty">No run matches that filter.</p>
              ) : (
                <div className="user-reps">
                  {visible.map((rep, position) => (
                    <RepCard
                      rep={rep}
                      key={rep.id || position}
                      busy={busyId === rep.id}
                      onExclude={(id, next) => act(id, () => patchRep(id, { excluded: next }))}
                      onDelete={(id) => act(id, () => deleteRep(id))}
                      onScore={(id, value) => act(id, () => patchRep(id, { score: value }))}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
