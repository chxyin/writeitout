/**
 * The traffic panel: every arrival at the page, newest first.
 *
 * This is the one panel that shows individual visitors rather than aggregates.
 * Each row is one page load — the address, where the edge placed it, the device
 * the browser reported, and which route was opened — because the question it
 * answers is "who is reaching this thing", which the delegate table cannot: most
 * arrivals never sign in.
 *
 * It is admin-only and paginated by the server, so a busy deployment does not
 * ship its whole log to the browser to draw one screen of it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchTraffic, formatErrorCode } from '../lib/stats.js';

const WINDOWS = [
  { id: 1, label: '24 hours' },
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' }
];

const PAGE_SIZE = 100;

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('en-GB');
}

function formatStamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/** "Chrome · Windows", or the device class when the UA told us nothing. */
function deviceLabel(row) {
  const parts = [row.browser, row.os].filter((part) => part && part !== 'Other');
  return parts.length ? parts.join(' · ') : row.device || 'Unknown';
}

function whereLabel(row) {
  const parts = [row.city, row.region, row.country].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return row.country || '—';
}

function accountLabel(row, names) {
  if (!row.user_sub) return 'Guest';
  if (String(row.user_sub).startsWith('anon:')) return 'Guest';
  return names.get(row.user_sub) || 'Signed in';
}

function HourStrip({ hours }) {
  const peak = Math.max(1, ...hours.map((bucket) => bucket.count));
  return (
    <div className="traffic-hours" aria-label="Arrivals by hour">
      {hours.map((bucket) => (
        <span
          key={bucket.hour}
          className="traffic-hour"
          title={`${String(bucket.hour).padStart(2, '0')}:00 — ${formatCount(bucket.count)}`}
        >
          <span
            className="traffic-hour-bar"
            style={{ height: `${Math.max(3, Math.round((bucket.count / peak) * 100))}%` }}
          />
        </span>
      ))}
    </div>
  );
}

function TopList({ title, rows, empty }) {
  return (
    <div className="traffic-top">
      <span className="traffic-top-title">{title}</span>
      {rows.length === 0 && <span className="traffic-top-empty">{empty}</span>}
      {rows.map((row) => (
        <span key={row.label} className="traffic-top-row">
          <span className="traffic-top-label">{row.label}</span>
          <span className="traffic-top-count">{formatCount(row.count)}</span>
        </span>
      ))}
    </div>
  );
}

export default function TrafficPanel({ delegates = [] }) {
  const [days, setDays] = useState(7);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  // One piece of state instead of three: the request a result belongs to travels
  // with the result, so "loading" is derived (has the answer for the current
  // controls arrived yet?) rather than a flag toggled from inside an effect.
  const [result, setResult] = useState({ key: '', data: null, error: '' });
  const requestKey = `${days}|${search}|${offset}`;
  const loading = result.key !== requestKey;
  const data = result.data;
  const error = result.error;

  const names = useMemo(() => {
    const map = new Map();
    delegates.forEach((delegate) => {
      if (!delegate || !delegate.user_sub) return;
      map.set(delegate.user_sub, delegate.display_name || delegate.email || 'Signed in');
    });
    return map;
  }, [delegates]);

  useEffect(() => {
    let cancelled = false;
    const key = `${days}|${search}|${offset}`;
    fetchTraffic({ days, limit: PAGE_SIZE, offset, q: search }).then((answer) => {
      if (cancelled) return;
      if (!answer.data) {
        setResult({
          key,
          data: null,
          error: `${answer.message || 'The traffic log could not be read.'} · ${formatErrorCode(
            answer.status,
            answer.code
          )}`
        });
        return;
      }
      setResult({ key, data: answer.data, error: '' });
    });
    return () => {
      cancelled = true;
    };
  }, [days, search, offset]);

  const submitSearch = useCallback(
    (event) => {
      event.preventDefault();
      setOffset(0);
      setSearch(query.trim());
    },
    [query]
  );

  const chooseWindow = useCallback((next) => {
    setOffset(0);
    setDays(next);
  }, []);

  const summary = (data && data.summary) || null;
  const rows = (data && data.rows) || [];
  const total = (data && data.total) || 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const signedShare =
    summary && summary.visits
      ? `${Math.round((summary.signed_in / summary.visits) * 100)}%`
      : '0%';

  return (
    <section className="stats-panel traffic-panel">
      <div className="stats-panel-head">
        <div>
          <h2 className="stats-panel-title">Who arrives</h2>
          <p className="stats-panel-note">
            Every page load, signed in or not: address, location from the edge, the device the
            browser reports, and the route it opened. Kept for 90 days.
          </p>
        </div>
        <span className="stats-panel-count">{loading ? 'Loading…' : `${formatCount(total)} rows`}</span>
      </div>

      <div className="traffic-controls">
        <div className="stats-choice traffic-window" role="group" aria-label="Traffic window">
          {WINDOWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`stats-choice-btn ${days === option.id ? 'is-active' : ''}`.trim()}
              aria-pressed={days === option.id}
              onClick={() => chooseWindow(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form className="traffic-search" onSubmit={submitSearch}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Address, city, browser, route…"
            aria-label="Search the traffic log"
          />
          <button type="submit">Search</button>
          {search && (
            <button
              type="button"
              className="traffic-clear"
              onClick={() => {
                setQuery('');
                setSearch('');
                setOffset(0);
              }}
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {summary && (
        <>
          <div className="stats-cards">
            <div className="stats-card">
              <span className="stats-card-label">Page loads</span>
              <span className="stats-card-value">{formatCount(summary.visits)}</span>
              <span className="stats-card-detail">In this window</span>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">Devices</span>
              <span className="stats-card-value">{formatCount(summary.unique_devices)}</span>
              <span className="stats-card-detail">{formatCount(summary.unique_ips)} addresses</span>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">New here</span>
              <span className="stats-card-value">{formatCount(summary.new_visitors)}</span>
              <span className="stats-card-detail">First visit in this window</span>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">Signed in</span>
              <span className="stats-card-value">{signedShare}</span>
              <span className="stats-card-detail">Everyone else never signed in</span>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">Bots</span>
              <span className="stats-card-value">{formatCount(summary.bots)}</span>
              <span className="stats-card-detail">Crawlers and previews</span>
            </div>
          </div>

          <div className="traffic-breakdown">
            <HourStrip hours={data.hours || []} />
            <div className="traffic-tops">
              <TopList title="Countries" rows={data.countries || []} empty="No arrivals yet." />
              <TopList title="Devices" rows={data.devices || []} empty="No arrivals yet." />
              <TopList title="Routes" rows={data.routes || []} empty="No arrivals yet." />
            </div>
          </div>

          <div className="traffic-table-wrap">
            <table className="traffic-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Address</th>
                  <th scope="col">Where</th>
                  <th scope="col">Device</th>
                  <th scope="col">Screen</th>
                  <th scope="col">Route</th>
                  <th scope="col">Who</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="traffic-empty">
                      Nothing logged in this window.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className={row.bot ? 'is-bot' : ''}>
                    <td>{formatStamp(row.at)}</td>
                    <td className="traffic-mono">{row.ip || '—'}</td>
                    <td title={row.asn ? `AS${row.asn}` : undefined}>{whereLabel(row)}</td>
                    <td>
                      {deviceLabel(row)}
                      {row.device && row.device !== 'Bot' && (
                        <span className="traffic-tag">{row.device}</span>
                      )}
                      {row.bot && <span className="traffic-tag is-bot">Bot</span>}
                    </td>
                    <td className="traffic-mono">
                      {row.screen || '—'}
                      {row.dpr && row.dpr !== '1' ? ` @${row.dpr}` : ''}
                    </td>
                    <td className="traffic-mono">{row.route || '—'}</td>
                    <td>{accountLabel(row, names)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="traffic-pager">
            <span>
              {total === 0 ? 'No rows' : `${formatCount(from)}–${formatCount(to)} of ${formatCount(total)}`}
            </span>
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Newer
            </button>
            <button
              type="button"
              disabled={to >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Older
            </button>
          </div>
        </>
      )}
    </section>
  );
}
