import { useState } from 'react';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, DEFAULT_ZOOM, clampZoom } from '../lib/zoom.js';
import { OFFSET_OPTIONS, TEXT_SIZE_OPTIONS, CARD_WIDTH_OPTIONS } from '../lib/formatting.js';

const COLOR_THEMES = [
  { id: 'default', label: 'Ocean', color: '#2B5CE6' },
  { id: 'midnight', label: 'Midnight', color: '#121212' },
  { id: 'forest', label: 'Forest', color: '#0B4A31' }
];

const BACKGROUNDS = [
  { id: 'grid', label: 'Grid' },
  { id: 'glow', label: 'Glow' },
  { id: 'spotlight', label: 'Spotlight' },
  { id: 'plain', label: 'Plain' }
];

// The menu is split into two tabs so the formatting controls have room to be
// legible: General holds everything that changes the look of the page itself
// (theme, background, motion, zoom), Formatting holds the layout preferences
// that ride on <body> classes.
const TABS = [
  { id: 'general', label: 'General' },
  { id: 'formatting', label: 'Formatting' }
];

// Option ids come from lib/formatting.js so the UI and the persisted-settings
// loader can never drift apart; only the labels live here.
const labels = (ids, map) => ids.map((id) => ({ id, label: map[id] }));

const OFFSET_CHOICES = labels(OFFSET_OPTIONS, { tight: 'Tight', balanced: 'Balanced', loose: 'Loose' });
const TEXT_SIZE_CHOICES = labels(TEXT_SIZE_OPTIONS, { s: 'S', m: 'M', l: 'L' });
const CARD_WIDTH_CHOICES = labels(CARD_WIDTH_OPTIONS, { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' });

/** A row of mutually exclusive buttons — the same idiom as the background swatches. */
function SegmentedControl({ label, value, options, onChange }) {
  return (
    <div className="setting-item setting-item-column">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`segmented-option ${value === option.id ? 'active' : ''}`}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
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
              <div className="setting-item setting-item-column">
                <div className="setting-item-heading">
                  <span>Zoom</span>
                  <button
                    className="zoom-value"
                    onClick={() => onZoomChange(DEFAULT_ZOOM)}
                    disabled={zoom === DEFAULT_ZOOM}
                    title="Reset zoom to 100%"
                    aria-label={`Zoom ${Math.round(zoom * 100)} percent, reset to 100 percent`}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                </div>
                <div className="zoom-controls">
                  <button
                    className="zoom-btn"
                    onClick={() => onZoomChange(clampZoom(zoom - ZOOM_STEP))}
                    disabled={zoom <= ZOOM_MIN}
                    aria-label="Zoom out"
                  >−</button>
                  <input
                    className="zoom-slider"
                    type="range"
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step={ZOOM_STEP}
                    value={zoom}
                    onChange={(event) => onZoomChange(clampZoom(event.target.value))}
                    aria-label="Zoom level"
                  />
                  <button
                    className="zoom-btn"
                    onClick={() => onZoomChange(clampZoom(zoom + ZOOM_STEP))}
                    disabled={zoom >= ZOOM_MAX}
                    aria-label="Zoom in"
                  >+</button>
                </div>
              </div>
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
              <SegmentedControl
                label="Bottom Offset"
                value={bottomOffset}
                options={OFFSET_CHOICES}
                onChange={onBottomOffsetChange}
              />
              <SegmentedControl
                label="Speech Text Size"
                value={textSize}
                options={TEXT_SIZE_CHOICES}
                onChange={onTextSizeChange}
              />
              <SegmentedControl
                label="Speech Card Width"
                value={cardWidth}
                options={CARD_WIDTH_CHOICES}
                onChange={onCardWidthChange}
              />
              <p className="settings-note">
                Formatting applies to desktop layouts. Phones keep their own full-screen
                layout.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
