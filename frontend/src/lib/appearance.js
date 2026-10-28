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
