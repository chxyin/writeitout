import { useEffect, useRef, useState } from 'react';
import { ZOOM_RANGE } from '../lib/zoom.js';
import {
  COLOR_THEMES,
  BACKGROUNDS,
  NIGHT_KELVIN_MARKS,
  NIGHT_KELVIN_RANGE,
  nightLabel,
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
// Night light temperature reads as a colour temperature, with the daylight end
// spelled out as "off" because that is what it is.
const asKelvin = (value) => nightLabel(value);

/**
 * One preference row: a minus / range / plus control with the readout doubling
 * as a reset to the default. Zoom and every Formatting preference share it, so
 * the tab looks and behaves exactly like the zoom bar it is modelled on.
 * `range` carries min / max / step / default, `formatValue` adds the unit.
 */
function SliderRow({ label, value, range, formatValue, onChange, footnote }) {
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
      {footnote}
    </div>
  );
}

/**
 * A thumbnail of the drill, driven by the four Formatting numbers.
 *
 * The tab is useless if you cannot see what it does: the panel covers the real
 * card while it is open, and on a phone the card is the only thing on screen to
 * begin with. So the preview is the card itself, scaled to the panel — the same
 * gaps, the same type ratio, the same widths, computed from the same numbers the
 * sliders hold rather than from CSS variables the panel does not share.
 *
 * The three multipliers below compress 0–20vh and 360–960px into panel-sized
 * pixels; they are a thumbnail's scale, not a second source of truth.
 */
function FormattingPreview({ topOffset, bottomOffset, textSize, cardWidth }) {
  // 360px–960px of card reads as 46%–100% of the preview's width.
  const widthPercent =
    46 + ((cardWidth - CARD_WIDTH_RANGE.min) / (CARD_WIDTH_RANGE.max - CARD_WIDTH_RANGE.min)) * 54;

  return (
    <div className="fmt-preview" aria-hidden="true">
      <div
        className="fmt-preview-frame"
        style={{
          // 4px of frame on top of the slider's own gap, so the card's rounded
          // corner never meets the frame's edge and reads as clipped.
          paddingTop: `${4 + Math.round(topOffset * 0.55)}px`,
          paddingBottom: `${4 + Math.round(bottomOffset * 0.55)}px`
        }}
      >
        <div
          className="fmt-preview-card"
          style={{ width: `${Math.round(widthPercent)}%`, fontSize: `${(textSize * 0.62).toFixed(2)}rem` }}
        >
          <span className="fmt-preview-tag">NPT | UNSC · France</span>
          “The Treaty remains the cornerstone of the disarmament architecture.”
        </div>
        <div className="fmt-preview-composer">Submit POI</div>
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
  nightKelvin,
  onNightKelvinChange,
  hints,
  onHintsToggle,
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
  // One reset per tab: General puts back the page's look, Formatting puts back
  // the four layout sliders. `*AreDefault` greys the pair out independently.
  onResetGeneral,
  generalAreDefault,
  onResetFormatting,
  formattingAreDefault,
  // Zoom is desktop-only. On a phone it is hidden (see the note in the render)
  // because CSS zoom on the shell is what re-triggers iOS focus magnification.
  isMobile = false
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

              {/* Night light. On by default: a switch, plus the one dial it has —
                  colour temperature. The swatch is the tint that dial is
                  producing, because a number is hard to judge on a screen that is
                  already amber. */}
              <div className="setting-item is-stacked">
                <div className="setting-copy">
                  <span className="setting-night-label">
                    Night light
                    {nightLight && (
                      <span
                        className="setting-night-swatch"
                        style={{ background: nightTint(nightKelvin) }}
                        aria-hidden="true"
                      />
                    )}
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
              {/* The temperature row stays put even at 6000K: hiding it the
                  moment the dial reaches daylight would snatch the slider out
                  from under the cursor mid-drag. */}
              <SliderRow
                label="Temperature"
                value={nightKelvin}
                range={NIGHT_KELVIN_RANGE}
                formatValue={asKelvin}
                onChange={onNightKelvinChange}
                footnote={
                  <div className="setting-kelvin-scale" aria-hidden="true">
                    <div className="setting-kelvin-bar" />
                    <div className="setting-kelvin-labels">
                      {NIGHT_KELVIN_MARKS.map((mark) => (
                        <span key={mark.kelvin}>
                          {mark.kelvin}K · {mark.label}
                        </span>
                      ))}
                    </div>
                  </div>
                }
              />

              {/* The tips themselves. Last of the look-and-feel rows, and it says
                  what it does: one of the tips is that this switch exists, so a
                  delegate who is tired of them can find the off button. */}
              <div className="setting-item is-stacked">
                <div className="setting-copy">
                  <span>Show hints</span>
                  <small>
                    {hints
                      ? 'One rotating tip at the foot of the start screen — formatting, night light, the switches.'
                      : 'No tips on the start screen. This switch turns them back on.'}
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hints}
                  aria-label="Show hints"
                  className={`toggle-switch-sm ${hints ? 'active' : ''}`}
                  onClick={onHintsToggle}
                >
                  <span className="toggle-knob-sm" />
                </button>
              </div>

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
              {/* Zoom is a desktop nicety. On a phone it is hidden rather than
                  left to do nothing: the phone tier forces its scale to 1, and
                  CSS zoom on the shell is what makes iOS magnify the POI field
                  on focus. Desktop keeps the row and the behaviour. */}
              {!isMobile && (
                <SliderRow
                  label="Zoom"
                  value={zoom}
                  range={ZOOM_RANGE}
                  formatValue={asPercent}
                  onChange={onZoomChange}
                />
              )}
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
              <FormattingPreview
                topOffset={topOffset}
                bottomOffset={bottomOffset}
                textSize={textSize}
                cardWidth={cardWidth}
              />
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
                Every screen honours these: the offsets are the margins above and
                below the drill, and the card width sets how wide the speech is —
                on a phone a wider card means thinner side margins.
              </p>
            </>
          )}

          {/* One button per tab, so a reset only ever touches the half you are
              looking at. Each greys out while its own half already sits at the
              defaults — the same rule the slider readouts follow. */}
          <div className="settings-reset-row">
            {tab === 'general' ? (
              <button
                type="button"
                className="settings-reset"
                onClick={onResetGeneral}
                disabled={generalAreDefault}
                title={
                  generalAreDefault
                    ? 'The general settings are already at their defaults'
                    : 'Put the switches, night light, hints, theme, background and zoom back to their defaults'
                }
              >
                Reset general settings
              </button>
            ) : (
              <button
                type="button"
                className="settings-reset"
                onClick={onResetFormatting}
                disabled={formattingAreDefault}
                title={
                  formattingAreDefault
                    ? 'The formatting settings are already at their defaults'
                    : 'Put the top offset, bottom offset, text size and card width back to their defaults'
                }
              >
                Reset formatting settings
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
