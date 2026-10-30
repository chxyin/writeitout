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
 * One dial, on the scale a real one uses — colour temperature in kelvin. 6000K
 * is daylight, so it is also "off"; 3000K is a warm bulb; 1000K is candlelight.
 * The tint and its opacity both come from that single number, which is why
 * warmer always means dimmer, the way f.lux and Night Shift behave.
 *
 * The tint is a real blackbody colour, not a straight fade from white to orange.
 * That distinction is the whole reason this looks like night and the fade does
 * not: a fade keeps blue in the tint until the very bottom of the range (at
 * 3000K it is still rgb(255, 132, 102) — 40% blue), and multiplying a blue page
 * by a tint that still has blue in it leaves the page blue. A blackbody tint has
 * no blue left below ~3200K, so the blue actually goes.
 *
 * Multiply on a fixed pseudo-element does the darkening (index.css); this module
 * only decides the two numbers that drive it: the tint and the opacity.
 */
export const NIGHT_OFF_KELVIN = 6000;

/** Default 3400K: a warm bulb, about what the old 55% strength looked like. */
export const NIGHT_KELVIN_RANGE = { min: 1000, max: 6000, step: 100, default: 3400 };

/** The three landmarks drawn under the slider. */
export const NIGHT_KELVIN_MARKS = [
  { kelvin: 1000, label: 'Candle' },
  { kelvin: 3000, label: 'Bulb' },
  { kelvin: 6000, label: 'Daylight' }
];

const round255 = (value) => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Blackbody colour for a temperature, in sRGB — Tanner Helland's approximation of
 * the Planckian locus, which is accurate to within a couple of units over this
 * range and is what every "kelvin to rgb" snippet on the web implements.
 *
 * Returns integers, because it is used both for the lens (where float channels
 * would be pointless) and for the swatch next to the setting's label.
 */
export function kelvinToRgb(kelvin) {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  let blue;
  if (t >= 66) blue = 255;
  else if (t <= 19) blue = 0;
  else blue = 97.1197534314 * Math.log(t - 10) - 305.0447927307;
  return [round255(red), round255(green), round255(blue)];
}

/** The multipled pane's colour, as a CSS colour string. */
export function nightTint(kelvin) {
  const [red, green, blue] = kelvinToRgb(kelvin);
  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * The two numbers the overlay needs. Opacity runs 0 at 6000K to the 0.6 cap the
 * reference design uses at 1000K: past that a multiply over an already dark page
 * stops being a lens and starts being a blackout.
 */
export function nightLens(kelvin) {
  const warmth = (NIGHT_OFF_KELVIN - kelvin) / (NIGHT_OFF_KELVIN - NIGHT_KELVIN_RANGE.min);
  const opacity = Math.min(0.6, Math.max(0, warmth * 0.6));
  return { tint: nightTint(kelvin), opacity: Math.round(opacity * 1000) / 1000 };
}

/** Readout for the slider: "3400K", or "6000K · off" at the daylight end. */
export function nightLabel(kelvin) {
  return kelvin >= NIGHT_OFF_KELVIN ? '6000K · off' : `${kelvin}K`;
}

/**
 * Migration from the old two-dial version (strength 0–100 and a hue angle).
 *
 * Opacity used to be `strength * 0.006`, and this module's opacity is
 * `warmth * 0.6`, so the two line up at `kelvin = 6000 - strength * 50`. A saved
 * 55% therefore lands on 3300K, which is the closest the Kelvin dial can get to
 * the look that delegate was already using. Returns null when there is nothing
 * to migrate.
 */
export function kelvinFromStrength(strength) {
  if (typeof strength !== 'number' || !Number.isFinite(strength)) return null;
  const raw = NIGHT_OFF_KELVIN - strength * 50;
  const stepped = Math.round(raw / NIGHT_KELVIN_RANGE.step) * NIGHT_KELVIN_RANGE.step;
  return Math.max(NIGHT_KELVIN_RANGE.min, Math.min(NIGHT_OFF_KELVIN, stepped));
}
