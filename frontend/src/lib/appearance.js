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
 * The filter itself lives in index.css; this is only the dial for it. The hue is
 * a real hue angle, so the slider runs from orange (25°) through amber to a
 * lemon yellow (65°). 45° is the colour of a warm desk lamp, which is the
 * default: the feature is on unless it is turned off, on the theory that
 * somebody practising at midnight wants the warm screen before they know to ask
 * for it.
 */
export const NIGHT_HUE_RANGE = { min: 25, max: 65, step: 1, default: 45 };

/** The yellow whose hue is the chosen angle — used for the swatch in Settings. */
export function nightTint(hue) {
  return `hsl(${hue} 100% 55%)`;
}
