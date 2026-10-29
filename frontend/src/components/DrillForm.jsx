import HistoryNav from './HistoryNav.jsx';

/**
 * The drill: the speech on the left, the composer on the right.
 *
 * `frozen` is the same screen after the session is over — used by the replay
 * page. Everything that made it a task is switched off (no clock, no editing,
 * no submit), the word count stays as a fact, and the button becomes the way
 * through to what the chair said.
 */
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
  historyLength = 1,
  // Replay mode: read-only, and the primary button opens the chair's feedback.
  frozen = false,
  onSeeFeedback = null,
  canSeeFeedback = true,
  // What to say when the answer was not kept (an opted-out account).
  answerMissing = false
}) {
  // Colour cues only: there is no hard limit, but a delegate should see when a
  // POI is getting long enough that a chair may cut them off.
  const counterTone =
    wordCount >= 60 ? 'word-hard' : wordCount >= 50 ? 'word-soft' : wordCount >= 35 ? 'word-warn' : '';

  const handleKeyDown = (event) => {
    if (frozen) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      // Mirrors the Submit button's disabled state so the shortcut never fires
      // on an empty draft or while a grade is already in flight. A draft of only
      // spaces counts as empty: the server strips it and would reject the POI.
      if (poi.trim() && !loading) onSubmit();
    }
  };

  return (
    <div className={`drill-form ${formExiting ? 'is-exiting' : ''} ${frozen ? 'is-frozen' : ''}`.trim()}>
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
              {activePrompt ? (
                <div className="prompt-scroll">"{activePrompt}"</div>
              ) : (
                <div className="prompt-scroll prompt-missing">
                  The speech was not saved with this rep.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="right-pane app-bottom">
          {!loadingDrill && !drillError && currentDrill && <>
            <div className="poi-input-area stagger-in stagger-4">
              <div className="input-label">
                <span>Your POI</span>
                <span className={`word-counter ${counterTone}`.trim()}>
                  {frozen
                    ? answerMissing
                      ? 'not saved'
                      : `${wordCount} words · read-only`
                    : `${wordCount} words`}
                </span>
              </div>
              {frozen && answerMissing ? (
                // An empty box would read as "the delegate wrote nothing"; the
                // truth is that the answer was never kept.
                <div className="frozen-answer-missing">
                  Your answer was not saved for this rep.
                </div>
              ) : frozen ? (
                // Read-only review: the answer grows to its own length. A
                // textarea would keep its one-line height and scroll inside a
                // 100px box, which is the wrong shape for reading something back.
                <div className="frozen-answer">&quot;{poi}&quot;</div>
              ) : (
                <textarea
                  value={poi}
                  onChange={(event) => onPoiChange(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your Point of Information here..."
                  title="Ctrl/Cmd + Enter to submit"
                />
              )}
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

            {frozen ? (
              canSeeFeedback ? (
                <button
                  className="submit-btn stagger-in stagger-5"
                  onClick={onSeeFeedback}
                  title="What the chair said about this answer"
                >
                  Chair&apos;s feedback →
                </button>
              ) : (
                // A disabled red CTA the size of Submit reads as "press me". The
                // truth is there is nothing behind it, so say that instead.
                <div className="frozen-note">
                  Only the score was kept for this rep — the chair&apos;s feedback was not
                  stored with it.
                </div>
              )
            ) : (
              <button className="submit-btn stagger-in stagger-5" onClick={onSubmit} disabled={loading || !poi.trim()}>
                {loading ? 'Chair is Grading...' : 'Submit POI'}
              </button>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}
