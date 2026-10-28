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
  onSubmit
}) {
  return (
    <div className={`drill-form ${formExiting ? 'is-exiting' : ''}`}>
      <div className="split-panes">
        <div className="left-pane">
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

        <div className="right-pane">
          {!loadingDrill && !drillError && currentDrill && <>
            <div className="poi-input-area stagger-in stagger-4">
              <div className="input-label">
                <span>Your POI</span>
                <span className="word-counter">{wordCount} words</span>
              </div>
              <textarea
                value={poi}
                onChange={(event) => onPoiChange(event.target.value)}
                placeholder="Type your Point of Information here..."
              />
            </div>

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
