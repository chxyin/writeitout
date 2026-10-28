// Formatting preferences shared by the Settings → Formatting tab and the
// persisted-settings loader. Each option maps to a class on <body> (see
// formattingClasses below), and every one of those classes is defined in
// index.css inside the desktop media query — the values here and there must
// stay in sync.

export const OFFSET_OPTIONS = ['tight', 'balanced', 'loose'];
export const DEFAULT_BOTTOM_OFFSET = 'balanced';

export const TEXT_SIZE_OPTIONS = ['s', 'm', 'l'];
export const DEFAULT_TEXT_SIZE = 'm';

export const CARD_WIDTH_OPTIONS = ['narrow', 'normal', 'wide'];
export const DEFAULT_CARD_WIDTH = 'normal';

/**
 * Keeps a persisted value only if it is one of the known options. Anything else
 * (a stale entry, a hand-edited localStorage blob) falls back to the default
 * instead of putting an unknown class on <body>.
 */
export function pickOption(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

/**
 * The three classes that carry the formatting preferences into CSS. All three
 * are always returned — including the neutral ones — so the stylesheet states
 * every state explicitly instead of relying on the absence of a class.
 */
export function formattingClasses({ bottomOffset, textSize, cardWidth }) {
  return [`offset-${bottomOffset}`, `text-${textSize}`, `width-${cardWidth}`];
}
