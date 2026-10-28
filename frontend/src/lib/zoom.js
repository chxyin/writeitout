// Zoom limits shared by the settings UI and the persisted-settings loader.
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;

/** The same limits in the shape SettingsMenu's shared slider row expects. */
export const ZOOM_RANGE = { min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP, default: DEFAULT_ZOOM };

/** Keeps a zoom value in range and removes floating point drift (1.2000000002). */
export function clampZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ZOOM;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, numeric));
  return Math.round(clamped * 100) / 100;
}
