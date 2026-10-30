import { useEffect, useRef, useState } from 'react';
import { ZOOM_RANGE } from '../lib/zoom.js';
import {
  COLOR_THEMES,
  BACKGROUNDS,
  NIGHT_HUE_RANGE,
  NIGHT_STRENGTH_RANGE,
  nightTint
} from '../lib/appearance.js';
import {
  TOP_OFFSET_RANGE,
  BOTTOM_OFFSET_RANGE,
  TEXT_SIZE_RANGE,
  CARD_WIDTH_RANGE,
  clampValue
} from '../lib/formatting.js';

// The menu is split into two tabs so the formatting controls have room to be
// legible: General holds everything that changes the look of the page itself
// (theme, background, motion, zoom), Formatting holds the layout preferences
// that ride on CSS custom properties.
const TABS = [
  { id: 'general', label: 'General' },
  { id: 'formatting', label: 'Formatting' }
];

// Readouts for the slider rows. Kept at module scope so the components below do
// not get a fresh function identity on every render.
const asPercent = (value) => `${Math.round(value * 100)}%`;
const asVh = (value) => `${value}vh`;
const asRem = (value) => `${value}rem`;
const asPx = (value) => `${value}px`;
// A hue angle, not a percentage: "45°" is what the slider in a colour picker
// would say, and it is the unit the CSS custom property takes.
const asHue = (value) => `${value}°`;
// Night light strength is a plain 0–100 percentage, the unit the reference
// design used ("Night Light 33%").
const asPercentOf100 = (value) => `${value}%`;

/**
 * One preference row: a minus / range / plus control with the readout doubling
 * as a reset to the default. Zoom and every Formatting preference share it, so
 * the tab looks and behaves exactly like the zoom bar it is modelled on.
 * `range` carries min / max / step / default, `formatValue` adds the unit.
 */
function SliderRow({ label, value, range, formatValue, onChange }) {
  const stepBy = (direction) => onChange(clampValue(value + direction * range.step, range));

  return (
    <div className="setting-item setting-item-column">
      <div className="setting-item-heading">
        <span>{label}</span>
        <button
          type="button"
          className="setting-value"
          onClick={() => onChange(range.default)}
          disabled={value === range.default}
          title={`Reset ${label} to ${formatValue(range.default)}`}
          aria-label={`${label} ${formatValue(value)}, reset to ${formatValue(range.default)}`}
        >
          {formatValue(value)}
        </button>
      </div>
      <div className="setting-slider-row">
        <button
          type="button"
          className="setting-step"
          onClick={() => stepBy(-1)}
          disabled={value <= range.min}
          aria-label={`Decrease ${label}`}
        >−</button>
        <input
          className="setting-range"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(event) => onChange(clampValue(event.target.value, range))}
          aria-label={label}
          aria-valuetext={formatValue(value)}
        />
        <button
          type="button"
          className="setting-step"
          onClick={() => stepBy(1)}
          disabled={value >= range.max}
          aria-label={`Increase ${label}`}
        >+</button>
      </div>
    </div>
  );
}

export default function SettingsMenu({
  open,
  onToggle,
  // Dismissing the panel: a click outside it, Escape, or leaving the drill.
  onClose,
  animOn,
  onAnimToggle,
  showTopic,
  onShowTopicToggle,
  showComm,
  onShowCommToggle,
  lowIntensity,
  onLowIntensityToggle,
  nightLight,
  onNightLightToggle,
  nightStrength,
  onNightStrengthChange,
  nightHue,
  onNightHueChange,
  theme,
  onThemeChange,
  background,
  onBackgroundChange,
  zoom,
  onZoomChange,
  topOffset,
  onTopOffsetChange,
  bottomOffset,
  onBottomOffsetChange,
  textSize,
  onTextSizeChange,
  cardWidth,
  onCardWidthChange,
  // Answer storage. Hidden entirely when signed out, because there is no account
  // to hang the preference on.
  showAnswerToggle = false,
  storeAnswers = true,
  answersLocked = false,
  answerSaving = false,
  onToggleAnswers,
  onResetDefaults,
  settingsAreDefault
}) {
  // Kept in component state rather than in the persisted settings: the menu is
  // closed and reopened all the time, and which tab you looked at last is not a
  // preference worth remembering.
  const [tab, setTab] = useState('general');
  const containerRef = useRef(null);

  // A floating panel has to be dismissible the way people expect one to be: a
  // press anywhere else, or Escape. Without this the only way out was the gear
  // itself, and the panel sat over the drill while the clock ran.
  useEffect(() => {
    if (!open) return undefined;
    const dismissOnOutsidePress = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) onClose();
    };
    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', dismissOnOutsidePress);
    document.addEventListener('touchstart', dismissOnOutsidePress, { passive: true });
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('mousedown', dismissOnOutsidePress);
      document.removeEventListener('touchstart', dismissOnOutsidePress);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open, onClose]);

  return (
    <div className="settings-container" ref={containerRef}>
      <button
        className="settings-btn"
        onClick={onToggle}
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0 1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </button>

      {open && (
        <div className="settings-menu">
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {TABS.map((option) => (
              <button
                type="button"
                role="tab"
                key={option.id}
                aria-selected={tab === option.id}
                className={`settings-tab ${tab === option.id ? 'active' : ''}`}
                onClick={() => setTab(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {tab === 'general' ? (
            <>
              <div className="setting-item">
                <span>Falling Papers</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={animOn}
                  aria-label="Falling papers"
                  className={`toggle-switch-sm ${animOn ? 'active' : ''}`}
                  onClick={onAnimToggle}
                >
                  <span className="toggle-knob-sm" />
                </button>
              </div>
              <div className="setting-item">
                <span>Show Topic Tag</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showTopic}
                  aria-label="Show topic tag"
                  className={`toggle-switch-sm ${showTopic ? 'active' : ''}`}
                  onClick={onShowTopicToggle}
                >
                  <span className="toggle-knob-sm" />
                </button>
              </div>
              <div className="setting-item">
                <span>Show Comm/Delegation</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showComm}
                  aria-label="Show committee and delegation"
                  className={`toggle-switch-sm ${showComm ? 'active' : ''}`}
                  onClick={onShowCommToggle}
                >
                  <span className="toggle-knob-sm" />
                </button>
              </div>
              <div className="setting-item">
                <span>Low Intensity</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={lowIntensity}
                  aria-label="Low intensity"
                  className={`toggle-switch-sm ${lowIntensity ? 'active' : ''}`}
                  onClick={onLowIntensityToggle}
                >
                  <span className="toggle-knob-sm" />
                </button>
              </div>

              {/* Night light. On by default, so the row carries both the switch
                  and — when it is on — the one dial it has: the colour of the
                  warmth. The swatch is the hue itself, which is easier to judge
                  than a number on a screen that is already amber. */}
              <div className="setting-item is-stacked">
                <div className="setting-copy">
                  <span className="setting-night-label">
                    Night light
                    <span
                      className="setting-night-swatch"
                      style={{ background: nightTint(nightHue) }}
                      aria-hidden="true"
                    />
                  </span>
                  <small>
                    {nightLight
                      ? 'A warm lens over every colour, for practising after dark.'
                      : 'Colours are as the app was designed — no warm cast.'}
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={nightLight}
                  aria-label="Night light"
                  className={`toggle-switch-sm ${nightLight ? 'active' : ''}`}
                  onClick={onNightLightToggle}
                >
                  <span className="toggle-knob-sm" />
                </button>
              </div>
              {nightLight && (
                <>
                  <SliderRow
                    label="Strength"
                    value={nightStrength}
                    range={NIGHT_STRENGTH_RANGE}
                    formatValue={asPercentOf100}
                    onChange={onNightStrengthChange}
                  />
                  <SliderRow
                    label="Warmth"
                    value={nightHue}
                    range={NIGHT_HUE_RANGE}
                    formatValue={asHue}
                    onChange={onNightHueChange}
                  />
                </>
              )}

              {/* The one setting that is about the account rather than the screen:
                  it lives here because this is where a delegate looks for "what
                  this app does with my stuff". It is worded as the opt-out, so the
                  switch being on matches the thing being asked for. */}
              {showAnswerToggle && (
                <div className="setting-item is-stacked">
                  <div className="setting-copy">
                    <span>Don’t save my answers</span>
                    <small>
                      {answersLocked
                        ? 'This deployment keeps scores only, so nothing is stored either way.'
                        : !storeAnswers
                          ? 'Only marks are kept — the answer text and the chair’s notes are discarded.'
                          : 'Answers are kept so a past run can be reread in full, with the chair’s notes.'}
                    </small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={answersLocked || !storeAnswers}
                    aria-label="Don’t save my answers"
                    className={`toggle-switch-sm ${answersLocked || !storeAnswers ? 'active' : ''}`}
                    disabled={answersLocked || answerSaving}
                    onClick={onToggleAnswers}
                  >
                    <span className="toggle-knob-sm" />
                  </button>
                </div>
              )}
              <SliderRow
                label="Zoom"
                value={zoom}
                range={ZOOM_RANGE}
                formatValue={asPercent}
                onChange={onZoomChange}
              />
              <div style={{ height: '1px', background: '#ddd', margin: '4px 0' }}></div>
              <div className="setting-item">
                <span>Color</span>
                <div className="theme-dots" role="group" aria-label="Choose color theme">
                  {COLOR_THEMES.map((option) => (
                    <button
                      className={`theme-dot ${theme === option.id ? 'active' : ''}`}
                      style={{ '--theme-color': option.color }}
                      aria-label={option.label}
                      title={option.label}
                      key={option.id}
                      onClick={() => onThemeChange(option.id)}
                    />
                  ))}
                </div>
              </div>
              <div className="setting-item setting-item-column">
                <span>Background</span>
                <div className="background-options" role="group" aria-label="Choose background">
                  {BACKGROUNDS.map((option) => (
                    <button
                      className={`background-option background-option-${option.id} ${background === option.id ? 'active' : ''}`}
                      key={option.id}
                      onClick={() => onBackgroundChange(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <SliderRow
                label="Top Offset"
                value={topOffset}
                range={TOP_OFFSET_RANGE}
                formatValue={asVh}
                onChange={onTopOffsetChange}
              />
              <SliderRow
                label="Bottom Offset"
                value={bottomOffset}
                range={BOTTOM_OFFSET_RANGE}
                formatValue={asVh}
                onChange={onBottomOffsetChange}
              />
              <SliderRow
                label="Speech Text Size"
                value={textSize}
                range={TEXT_SIZE_RANGE}
                formatValue={asRem}
                onChange={onTextSizeChange}
              />
              <SliderRow
                label="Speech Card Width"
                value={cardWidth}
                range={CARD_WIDTH_RANGE}
                formatValue={asPx}
                onChange={onCardWidthChange}
              />
              <p className="settings-note">
                Tap a value to reset it. Speech text size applies on every screen;
                the offsets and card width shape the desktop layout, where there is
                a shell to offset and a card column to narrow.
              </p>
            </>
          )}

          {/* One button for the whole panel, so it sits in the same place from
              either tab: the point of the sliders is to try values out, and this
              is the way back to the layout the app ships with. Greyed out once
              every preference already sits at its default. */}
          <div className="settings-reset-row">
            <button
              type="button"
              className="settings-reset"
              onClick={onResetDefaults}
              disabled={settingsAreDefault}
              title={
                settingsAreDefault
                  ? 'Every setting is already at its default'
                  : 'Put the toggles, zoom, color, background and every slider back to their defaults'
              }
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
