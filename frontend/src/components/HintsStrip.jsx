/**
 * One rotating tip at the foot of the start screen.
 *
 * The rotation is state, the fade is CSS: the line is re-keyed on every change so
 * its entry animation replays, which keeps React out of the timing business and
 * means the strip cannot end up half-faded after a tab is restored.
 */

import { useEffect, useState } from 'react';
import { HINTS, HINT_INTERVAL_MS } from '../lib/hints.js';

export default function HintsStrip({ enabled = true }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % HINTS.length);
    }, HINT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="hint-strip">
      <span key={index} className="hint-line">
        {HINTS[index]}
      </span>
    </div>
  );
}
