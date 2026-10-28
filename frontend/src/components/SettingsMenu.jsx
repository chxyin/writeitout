import { useState } from 'react';
import { ZOOM_RANGE } from '../lib/zoom.js';
import { COLOR_THEMES, BACKGROUNDS } from '../lib/appearance.js';
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
  animOn,
  onAnimToggle,
  showTopic,
  onShowTopicToggle,
  showComm,
  onShowCommToggle,
  lowIntensity,
  onLowIntensityToggle,
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
  onCardWidthChange
}) {
  // Kept in component state rather than in the persisted settings: the menu is
  // closed and reopened all the time, and which tab you looked at last is not a
  // preference worth remembering.
  const [tab, setTab] = useState('general');

  return (
    <div className="settings-container">
      <button className="settings-btn" onClick={onToggle}>
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
                <div className={`toggle-switch-sm ${animOn ? 'active' : ''}`} onClick={onAnimToggle}><div className="toggle-knob-sm"></div></div>
              </div>
              <div className="setting-item">
                <span>Show Topic Tag</span>
                <div className={`toggle-switch-sm ${showTopic ? 'active' : ''}`} onClick={onShowTopicToggle}><div className="toggle-knob-sm"></div></div>
              </div>
              <div className="setting-item">
                <span>Show Comm/Delegation</span>
                <div className={`toggle-switch-sm ${showComm ? 'active' : ''}`} onClick={onShowCommToggle}><div className="toggle-knob-sm"></div></div>
              </div>
              <div className="setting-item">
                <span>Low Intensity</span>
                <div className={`toggle-switch-sm ${lowIntensity ? 'active' : ''}`} onClick={onLowIntensityToggle}><div className="toggle-knob-sm"></div></div>
              </div>
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
                Tap a value to reset it. Formatting applies to desktop layouts — phones keep
                their own full-screen layout.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
