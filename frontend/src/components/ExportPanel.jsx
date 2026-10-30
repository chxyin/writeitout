/**
 * Export runs — the training-data panel on #/admin.
 *
 * The dashboard answers questions about the deployment; this one builds a file
 * to take away. The controls are the questions someone assembling a fine-tuning
 * set actually asks: which days, whose runs, which marks (several bands at once,
 * because "the best and the worst" is one set), which fields, and what shape the
 * file should be. Nothing is stored on the server: the text is built per request
 * and handed back for the browser to save.
 */

import { useMemo, useState } from 'react';
import { exportRuns } from '../lib/stats.js';

const FIELD_CHOICES = [
  { id: 'time', label: 'When' },
  { id: 'speech', label: 'Speech' },
  { id: 'answer', label: 'Their POI' },
  { id: 'score', label: 'Score' },
  { id: 'grade', label: 'Chair’s label' },
  { id: 'reasoning', label: 'Chair’s reasoning' },
  { id: 'feedback', label: 'Chair’s advice' },
  { id: 'rewritten', label: 'Model rewrite' },
  { id: 'topic', label: 'Topic' },
  { id: 'committee', label: 'Committee' },
  { id: 'delegate', label: 'Delegation' },
  { id: 'sub', label: 'Account id' },
  { id: 'timing', label: 'Writing time' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'excluded', label: 'Excluded flag' }
];

const DEFAULT_FIELDS = [
  'time',
  'speech',
  'answer',
  'score',
  'grade',
  'reasoning',
  'feedback',
  'topic',
  'committee',
  'delegate'
];

const BAND_PRESETS = [
  { label: '7–10', band: [7, 10] },
  { label: '4–6', band: [4, 6] },
  { label: '1–3', band: [1, 3] },
  { label: '2–4', band: [2, 4] },
  { label: '8–10', band: [8, 10] }
];

const FORMATS = [
  { id: 'json', label: 'JSON', hint: 'one array of objects — loads whole, indented' },
  { id: 'jsonl', label: 'JSONL', hint: 'one object per line — the usual training shape' },
  { id: 'chat', label: 'Chat', hint: 'messages + completion, for fine-tuning a POI writer' },
  { id: 'csv', label: 'CSV', hint: 'spreadsheet, quoted where the text has commas' },
  { id: 'tsv', label: 'TSV', hint: 'tab-separated, pastes into a sheet cleanly' },
  { id: 'txt', label: 'Text', hint: 'plain writing, speech then answer' }
];

const sameBand = (a, b) => a[0] === b[0] && a[1] === b[1];

/** 1,234 → "1,234". */
const n = (value) => Number(value || 0).toLocaleString();

/** bytes → "12 KB". */
function size(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export default function ExportPanel({ delegates = [], defaultStart = '', defaultEnd = '' }) {
  const [from, setFrom] = useState(defaultStart);
  const [to, setTo] = useState(defaultEnd);
  const [bands, setBands] = useState([]);
  const [bandLow, setBandLow] = useState('');
  const [bandHigh, setBandHigh] = useState('');
  const [mode, setMode] = useState('all'); // all | only | except
  const [picked, setPicked] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [fields, setFields] = useState(() => new Set(DEFAULT_FIELDS));
  const [includeHidden, setIncludeHidden] = useState(false);
  const [onlyWithText, setOnlyWithText] = useState(true);
  const [oldestFirst, setOldestFirst] = useState(true);
  const [dedupe, setDedupe] = useState(false);
  const [format, setFormat] = useState('jsonl');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const shownDelegates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return delegates;
    return delegates.filter((row) =>
      `${row.name || ''} ${row.email || ''} ${row.ip || ''}`.toLowerCase().includes(needle)
    );
  }, [delegates, search]);

  const togglePick = (sub) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(sub)) next.delete(sub);
      else next.add(sub);
      return next;
    });
  };

  const toggleField = (id) => {
    setFields((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addBand = (low, high) => {
    const min = Number(low);
    const max = Number(high);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    const band = [Math.min(min, max), Math.max(min, max)];
    setBands((current) => (current.some((item) => sameBand(item, band)) ? current : [...current, band]));
  };

  const removeBand = (band) => setBands((current) => current.filter((item) => !sameBand(item, band)));

  /** The request body, from the controls. */
  const body = (dryRun) => ({
    start: from || null,
    end: to || null,
    include: mode === 'only' ? [...picked] : [],
    exclude: mode === 'except' ? [...picked] : [],
    bands,
    include_hidden: includeHidden,
    only_with_text: onlyWithText,
    oldest_first: oldestFirst,
    dedupe,
    fields: [...fields],
    format,
    dry_run: dryRun
  });

  const run = async (dryRun) => {
    if (!fields.size) {
      setError('Pick at least one field to export.');
      return;
    }
    setBusy(dryRun ? 'preview' : 'download');
    setError('');
    setResult(null);
    const response = await exportRuns(body(dryRun));
    setBusy('');
    if (!response.ok || !response.data) {
      setError(response.message || 'The export could not be built.');
      return;
    }
    setResult(response.data);
    if (!dryRun && response.data.text) {
      const blob = new Blob([response.data.text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.data.filename || 'writeitout-export.txt';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  return (
    <section className="stats-panel stats-export">
      <h2 className="stats-panel-title">Export runs</h2>
      <p className="stats-panel-note">
        Builds a file from the runs themselves — speech, answer, mark and the chair’s notes.
        Nothing is kept on the server and no copy is mailed anywhere: the text is assembled for
        this request and handed to your browser.
      </p>

      <div className="export-row">
        <label className="export-field">
          <span>From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="export-field">
          <span>To</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button
          type="button"
          className="stats-choice-btn is-inline"
          onClick={() => {
            setFrom(defaultStart);
            setTo(defaultEnd);
          }}
        >
          Use the window above
        </button>
      </div>

      <div className="export-block">
        <span className="export-label">Marks</span>
        <p className="export-hint">
          Several bands are combined: 7–10 and 1–3 exports the best and the worst in one file.
          With nothing picked, every mark is included.
        </p>
        <div className="export-chips">
          {BAND_PRESETS.map((preset) => {
            const active = bands.some((band) => sameBand(band, preset.band));
            return (
              <button
                key={preset.label}
                type="button"
                className={`stats-filter ${active ? 'is-active' : ''}`.trim()}
                aria-pressed={active}
                onClick={() =>
                  active ? removeBand(preset.band) : addBand(preset.band[0], preset.band[1])
                }
              >
                {preset.label}
              </button>
            );
          })}
          {bands
            .filter((band) => !BAND_PRESETS.some((preset) => sameBand(preset.band, band)))
            .map((band) => (
              <button
                key={`${band[0]}-${band[1]}`}
                type="button"
                className="stats-filter is-active"
                onClick={() => removeBand(band)}
              >
                {band[0]}–{band[1]} ✕
              </button>
            ))}
        </div>
        <div className="export-row">
          <label className="export-field is-narrow">
            <span>From mark</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.5"
              value={bandLow}
              onChange={(event) => setBandLow(event.target.value)}
            />
          </label>
          <label className="export-field is-narrow">
            <span>To mark</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.5"
              value={bandHigh}
              onChange={(event) => setBandHigh(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="stats-choice-btn is-inline"
            onClick={() => {
              addBand(bandLow, bandHigh);
              setBandLow('');
              setBandHigh('');
            }}
            disabled={bandLow === '' || bandHigh === ''}
          >
            Add band
          </button>
        </div>
      </div>

      <div className="export-block">
        <span className="export-label">Whose runs</span>
        <div className="export-chips">
          {[
            { id: 'all', label: 'Everyone' },
            { id: 'only', label: 'Only ticked' },
            { id: 'except', label: 'Everyone except ticked' }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={`stats-choice-btn is-inline ${mode === option.id ? 'is-active' : ''}`.trim()}
              aria-pressed={mode === option.id}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode !== 'all' && (
          <>
            <input
              className="user-search"
              type="search"
              placeholder="Search name, email or address..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search delegates to export"
            />
            <div className="export-picker">
              {shownDelegates.length === 0 && <p className="stats-empty">No delegate matches.</p>}
              {shownDelegates.map((row) => {
                const anonymous = row.guest || String(row.sub || '').startsWith('anon:');
                return (
                  <label className="export-pick" key={row.sub}>
                    <input
                      type="checkbox"
                      checked={picked.has(row.sub)}
                      onChange={() => togglePick(row.sub)}
                    />
                    <span className="export-pick-name">
                      {anonymous ? row.ip || 'Anonymous' : row.name || row.email || 'Delegate'}
                    </span>
                    <span className="export-pick-meta">
                      {anonymous ? 'anonymous' : row.email || ''} · {n(row.reps)} runs
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="export-chips">
              <button
                type="button"
                className="stats-choice-btn is-inline"
                onClick={() => setPicked(new Set(shownDelegates.map((row) => row.sub)))}
              >
                Tick all shown
              </button>
              <button
                type="button"
                className="stats-choice-btn is-inline"
                onClick={() => setPicked(new Set())}
                disabled={!picked.size}
              >
                Clear ({picked.size})
              </button>
            </div>
          </>
        )}
      </div>

      <div className="export-block">
        <span className="export-label">Fields</span>
        <div className="export-chips">
          {FIELD_CHOICES.map((field) => {
            const active = fields.has(field.id);
            return (
              <label key={field.id} className={`stats-filter ${active ? 'is-active' : ''}`.trim()}>
                <input type="checkbox" checked={active} onChange={() => toggleField(field.id)} />
                <span>{field.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="export-block">
        <span className="export-label">Options</span>
        <div className="export-chips">
          {[
            { on: onlyWithText, set: setOnlyWithText, label: 'Only runs whose answers were stored' },
            { on: includeHidden, set: setIncludeHidden, label: 'Include excluded runs' },
            { on: oldestFirst, set: setOldestFirst, label: 'Oldest first' },
            { on: dedupe, set: setDedupe, label: 'Drop duplicate (speech, answer) pairs' }
          ].map((option) => (
            <label key={option.label} className={`stats-filter ${option.on ? 'is-active' : ''}`.trim()}>
              <input type="checkbox" checked={option.on} onChange={() => option.set(!option.on)} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="export-block">
        <span className="export-label">Format</span>
        <div className="export-chips">
          {FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`stats-choice-btn is-inline ${format === option.id ? 'is-active' : ''}`.trim()}
              aria-pressed={format === option.id}
              onClick={() => setFormat(option.id)}
              title={option.hint}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="export-hint">{FORMATS.find((option) => option.id === format).hint}.</p>
      </div>

      <div className="export-footer">
        <button
          type="button"
          className="stats-choice-btn is-inline"
          onClick={() => run(true)}
          disabled={busy !== ''}
        >
          {busy === 'preview' ? 'Counting…' : 'Preview count'}
        </button>
        <button
          type="button"
          className="play-btn export-download"
          onClick={() => run(false)}
          disabled={busy !== ''}
        >
          {busy === 'download' ? 'Building…' : 'Download'}
        </button>
        {result && (
          <span className="export-result">
            {n(result.count)} {result.count === 1 ? 'run' : 'runs'} · {size(result.bytes)}
            {result.dry_run ? ' — nothing downloaded yet' : ` · ${result.filename}`}
          </span>
        )}
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </section>
  );
}
