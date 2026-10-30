/**
 * Appearance options for Settings → General.
 *
 * These live in lib/ rather than in the component so two callers can share one
 * list: the menu that draws the swatches, and App.jsx, which validates a
 * preference restored from localStorage against the same ids. The ids double as
 * class names on <body> (`theme-*`, `background-*`), so a value whose option no
 * longer exists would otherwise add a class that nothing in index.css matches.
 */

export const COLOR_THEMES = [
  { id: 'default', label: 'Ocean', color: '#2B5CE6' },
  { id: 'midnight', label: 'Midnight', color: '#121212' },
  { id: 'forest', label: 'Forest', color: '#0B4A31' }
];

export const BACKGROUNDS = [
  { id: 'grid', label: 'Grid' },
  { id: 'spotlight', label: 'Spotlight' },
  { id: 'plain', label: 'Plain' }
];

export const BACKGROUND_IDS = BACKGROUNDS.map((option) => option.id);

/**
 * Night light: the warm cast that sits over every screen.
 *
 * Two dials only. `strength` is how strong the cast is — 0 is off, 100 is the
 * most the filter will ever do (the CSS caps it at 60% opacity, because a full
 * multiply over a dark page is mud). `hue` is the colour of the warmth: 25° is
 * orange, 45° a warm desk lamp, 65° lemon.
 */
export const NIGHT_STRENGTH_RANGE = { min: 0, max: 100, step: 5, default: 55 };

export const NIGHT_HUE_RANGE = { min: 20, max: 60, step: 1, default: 38 };

/** The yellow whose hue is the chosen angle — used for the swatch in Settings. */
export function nightTint(hue) {
  return `hsl(${hue} 100% 55%)`;
}
