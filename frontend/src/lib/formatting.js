// Formatting preferences shared by the Settings → Formatting tab and the
// persisted-settings loader.
//
// Unlike the theme or the background these are free-running numbers steered by
// sliders (the same control as Zoom), so there is no fixed list of legal values
// — the ranges below are the contract. Every read goes through clampValue, so a
// stale localStorage entry, a hand-edited blob or a loose string from an
// <input type="range"> can only ever produce a usable number.
//
// The values reach CSS as custom properties (see formattingVars). The speech
// text size is read by every tier; the offsets and card width shape the desktop
// shell directly and are mapped onto the phone layout's gutters in index.css.
// index.html also writes the four of them from localStorage before the app
// loads, so the saved layout is right on the first paint — keep the defaults
// here and in index.css in step with that inline script.

/** How far the interface sits from the top edge, in vh. */
export const TOP_OFFSET_RANGE = { min: 0, max: 20, step: 1, default: 10 };
/** How far the interface sits from the bottom edge, in vh. */
export const BOTTOM_OFFSET_RANGE = { min: 0, max: 20, step: 1, default: 10 };
/** Speech card type size, in rem. */
export const TEXT_SIZE_RANGE = { min: 0.85, max: 1.6, step: 0.05, default: 1.1 };
/** Speech card width, in px. The shell grows around it by the two 2rem gutters. */
export const CARD_WIDTH_RANGE = { min: 360, max: 960, step: 20, default: 540 };

/**
 * Snaps a persisted or dragged value onto the slider's grid and keeps it inside
 * the range. Anything that is not a finite number — a stale entry, a missing
 * field, a hand-edited blob — falls back to the default instead of poisoning
 * the stylesheet.
 */
export function clampValue(value, range) {
  if (value === undefined || value === null || value === '') return range.default;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return range.default;
  const snapped = Math.round((numeric - range.min) / range.step) * range.step + range.min;
  const clamped = Math.min(range.max, Math.max(range.min, snapped));
  // Grid arithmetic drifts (0.8500000000000001), so trim to the step's decimals.
  const decimals = (String(range.step).split('.')[1] || '').length;
  return Number(clamped.toFixed(decimals));
}

/**
 * The four custom properties App.jsx writes onto <body>. Speech text size is
 * consumed by every tier; the two offsets and the card width only by the desktop
 * layout, which is the one with a shell to offset and a card column to narrow.
 */
export function formattingVars({ topOffset, bottomOffset, textSize, cardWidth }) {
  return {
    '--fmt-top-offset': `${topOffset}vh`,
    '--fmt-bottom-offset': `${bottomOffset}vh`,
    '--fmt-speech-font-size': `${textSize}rem`,
    '--fmt-card-width': `${cardWidth}px`
  };
}
