/**
 * One chart, three ways of drawing it.
 *
 * The dashboard asks three questions that are all "how is this spread out" —
 * runs per day, runs per sitting, marks per band — and the right drawing depends
 * on what the reader is looking for. Bars answer "when"; a line makes a trend
 * readable at a glance; a pie answers "how much of the whole" for a handful of
 * categories. Rather than pick one and argue, the toolbar switches every chart
 * at once and each one is drawn from the same series.
 *
 * The series is always the same shape — `{ key, label, value, tip }` — so a
 * caller never has to think about which drawing is showing. `tip` is the hover
 * card's lines (bars and points only); a pie slice carries a native title.
 */

const PIE_COLOURS = [
  '#FFB020',
  '#FF7A45',
  '#FFD166',
  '#4F8DF7',
  '#8AB4FF',
  '#C9D8FF',
  '#F2A0C0',
  '#7ED0C3'
];

/** More than this many slices is a blurred wheel, so neighbouring items merge. */
const MAX_SLICES = 8;

/** Group a long series into at most MAX_SLICES buckets, keeping the order. */
function toSlices(series) {
  if (series.length <= MAX_SLICES) return series.map((item) => ({ ...item, merged: false }));
  const size = Math.ceil(series.length / MAX_SLICES);
  const slices = [];
  for (let index = 0; index < series.length; index += size) {
    const chunk = series.slice(index, index + size);
    const first = chunk[0].label;
    const last = chunk[chunk.length - 1].label;
    slices.push({
      key: chunk[0].key,
      label: chunk.length > 1 ? `${first} – ${last}` : first,
      value: chunk.reduce((total, item) => total + item.value, 0),
      merged: chunk.length > 1
    });
  }
  return slices;
}

/** One SVG wedge, from `start` to `end` radians, clockwise from 12 o'clock. */
function wedge(cx, cy, radius, start, end) {
  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function Pie({ series, ariaLabel }) {
  const slices = toSlices(series);
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <p className="stats-empty">Nothing in this window yet.</p>;

  // A plain loop rather than a map: the running angle is local state of the
  // drawing, and the compiler treats a closure that mutates it as a leak.
  const paths = [];
  let angle = -Math.PI / 2;
  slices.forEach((slice, index) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    paths.push({
      key: slice.key,
      d: wedge(50, 50, 48, angle, angle + sweep),
      colour: PIE_COLOURS[index % PIE_COLOURS.length],
      slice,
      share: slice.value / total
    });
    angle += sweep;
  });

  return (
    <div className="stats-pie">
      <svg className="stats-pie-svg" viewBox="0 0 100 100" role="img" aria-label={ariaLabel}>
        {paths.length === 1 ? (
          <circle cx="50" cy="50" r="48" fill={paths[0].colour} />
        ) : (
          paths.map((path) => (
            <path key={path.key} d={path.d} fill={path.colour}>
              <title>
                {`${path.slice.label}: ${path.slice.value} (${Math.round(path.share * 100)}%)`}
              </title>
            </path>
          ))
        )}
        <circle cx="50" cy="50" r="26" className="stats-pie-hole" />
        <text x="50" y="48" className="stats-pie-total" textAnchor="middle">
          {total}
        </text>
        <text x="50" y="58" className="stats-pie-caption" textAnchor="middle">
          total
        </text>
      </svg>

      <ul className="stats-pie-legend">
        {paths.map((path) => (
          <li key={path.key}>
            <span className="stats-pie-swatch" style={{ background: path.colour }} />
            <span className="stats-pie-label" title={path.slice.label}>
              {path.slice.label}
            </span>
            <span className="stats-pie-value">
              {path.slice.value}
              <em>{Math.round(path.share * 100)}%</em>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Line({ series, height }) {
  const peak = Math.max(1, ...series.map((item) => item.value));
  const last = Math.max(1, series.length - 1);
  const points = series.map((item, index) => ({
    ...item,
    x: (index / last) * 100,
    y: 100 - (item.value / peak) * 100
  }));
  const line = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

  return (
    <div className="stats-chart stats-chart-line" style={{ height }} role="img">
      <svg
        className="stats-line-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline points={line} vectorEffect="non-scaling-stroke" />
      </svg>
      {points.map((point) => (
        <span
          className="stats-point"
          key={point.key}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          tabIndex={0}
        >
          <span className={`stats-point-dot ${point.value === 0 ? 'is-empty' : ''}`.trim()} />
          {point.tip && (
            <span className="stats-tip" role="tooltip">
              {point.tip.map((lineText, index) =>
                index === 0 ? <b key={index}>{lineText}</b> : <span key={index}>{lineText}</span>
              )}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function Bars({ series, height }) {
  const peak = Math.max(1, ...series.map((item) => item.value));
  return (
    <div className="stats-chart" style={{ height }} role="img">
      {series.map((item) => (
        <div className="stats-bar-slot" key={item.key} tabIndex={0}>
          <div
            className={`stats-bar ${item.value === 0 ? 'is-empty' : ''}`.trim()}
            style={{ height: `${Math.round((item.value / peak) * 100)}%` }}
          />
          {item.tip && (
            <span className="stats-tip" role="tooltip">
              {item.tip.map((lineText, index) =>
                index === 0 ? <b key={index}>{lineText}</b> : <span key={index}>{lineText}</span>
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function StatsChart({
  series,
  type = 'bars',
  height = 130,
  ariaLabel = 'Chart',
  axis = true
}) {
  if (!series.length) return <p className="stats-empty">Nothing in this window yet.</p>;

  if (type === 'pie') {
    return (
      <div className="stats-chart-frame">
        <Pie series={series} ariaLabel={ariaLabel} />
      </div>
    );
  }

  const peak = Math.max(1, ...series.map((item) => item.value));
  const step = Math.max(1, Math.ceil(series.length / 7));

  return (
    <>
      <div className="stats-chart-frame">
        <div className="stats-chart-scale" aria-hidden="true" style={{ height }}>
          <span>{peak}</span>
          <span>{Math.round(peak / 2)}</span>
          <span>0</span>
        </div>
        {type === 'line' ? (
          <Line series={series} height={height} />
        ) : (
          <Bars series={series} height={height} />
        )}
      </div>
      {axis && (
        <div className="stats-chart-axis" aria-hidden="true">
          {series.map((item, index) => (
            <span key={item.key}>{index % step === 0 ? item.label : ''}</span>
          ))}
        </div>
      )}
    </>
  );
}
