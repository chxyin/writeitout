import HistoryNav from './HistoryNav.jsx';

export default function DrillForm({
  formExiting,
  loadingDrill,
  drillError,
  currentDrill,
  activePrompt,
  poi,
  wordCount,
  submitError,
  loading,
  onPoiChange,
  onSubmit,
  // History navigation, shared with the feedback view.
  onPrev,
  onNext,
  canPrev,
  canNext,
  historyIndex = 0,
  historyLength = 1
}) {
  // Colour cues only: there is no hard limit, but a delegate should see when a
  // POI is getting long enough that a chair may cut them off.
  const counterTone =
    wordCount >= 60 ? 'word-hard' : wordCount >= 50 ? 'word-soft' : wordCount >= 35 ? 'word-warn' : '';

  const handleKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      // Mirrors the Submit button's disabled state so the shortcut never fires
      // on an empty draft or while a grade is already in flight.
      if (poi && !loading) onSubmit();
    }
  };

  return (
    <div className={`drill-form ${formExiting ? 'is-exiting' : ''}`}>
      <div className="split-panes">
        <div className="left-pane app-middle">
          {loadingDrill && <div className="loading-message">Loading new speech...</div>}
          {!loadingDrill && drillError && <div className="loading-message error-message">{drillError}</div>}
          {!loadingDrill && !drillError && currentDrill && (
            <div className="prompt-card stagger-in stagger-3">
              <span className="prompt-tag">
                <span>{currentDrill.topic}</span>
                <span id="comm-text"> | {currentDrill.committee} - {currentDrill.delegate}</span>
              </span>
              <div className="prompt-scroll">"{activePrompt}"</div>
            </div>
          )}
        </div>

        <div className="right-pane app-bottom">
          {!loadingDrill && !drillError && currentDrill && <>
            <div className="poi-input-area stagger-in stagger-4">
              <div className="input-label">
                <span>Your POI</span>
                <span className={`word-counter ${counterTone}`.trim()}>{wordCount} words</span>
              </div>
              <textarea
                value={poi}
                onChange={(event) => onPoiChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your Point of Information here..."
                title="Ctrl/Cmd + Enter to submit"
              />
            </div>

            {/* History navigation sits between the field and Submit so the
                Submit button keeps its pinned position at the bottom edge. */}
            {historyLength > 1 && (
              <HistoryNav
                index={historyIndex}
                total={historyLength}
                onPrev={onPrev}
                onNext={onNext}
                canPrev={canPrev}
                canNext={canNext}
              />
            )}

            {submitError && (
              <div className="submit-error" role="alert">{submitError}</div>
            )}

            <button className="submit-btn stagger-in stagger-5" onClick={onSubmit} disabled={loading || !poi}>
              {loading ? 'Chair is Grading...' : 'Submit POI'}
            </button>
          </>}
        </div>
      </div>
    </div>
  );
}
