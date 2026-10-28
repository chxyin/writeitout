import { useEffect, useRef, useState } from 'react';
import HistoryNav from './HistoryNav.jsx';

const COPIED_RESET_MS = 1800;

/**
 * Copies text with the async Clipboard API when it is available, and falls
 * back to a hidden textarea so the button still works on plain-HTTP hosts.
 */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  const succeeded = document.execCommand('copy');
  document.body.removeChild(helper);
  return succeeded ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
}

export default function FeedbackCard({
  feedback,
  scoreColor,
  originalPoi,
  onNext,
  onBack,
  // History navigation, shared with the drill view.
  onPrev,
  canPrev,
  canNext,
  historyIndex = 0,
  historyLength = 1,
  // Reps reached through < Prev are being reviewed, so the original answer is
  // expanded by default (the toggle still collapses it again).
  initialShowOriginal = false
}) {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(initialShowOriginal);
  const copyTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await copyToClipboard(feedback.rewritten_poi || '');
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard access can be blocked; the rewrite stays selectable by hand.
      setCopied(false);
    }
  };

  return (
    <div className="feedback-card app-middle">
      {/* Everything above the footer scrolls on desktop; the footer is pinned to
          the bottom of the card so Back/Next never move between reps. */}
      <div className="feedback-body">
        <div className="feedback-score" style={{ color: scoreColor }}>{feedback.score}/10</div>
        <div className="feedback-label">{feedback.grade_label}</div>

        <p><strong>Reasoning:</strong> {feedback.reasoning}</p>
        <p><strong>Advice:</strong> {feedback.constructive_feedback}</p>

        <div className="rewrite-box">
          <div className="rewrite-header">
            <span>Your POI, Improved</span>
            <button type="button" className="copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p>&quot;{feedback.rewritten_poi}&quot;</p>

          {originalPoi && (
            <>
              <button
                type="button"
                className="see-poi-link"
                onClick={() => setShowOriginal((visible) => !visible)}
                aria-expanded={showOriginal}
              >
                {showOriginal ? 'Hide your POI' : 'See your POI'}
              </button>
              {showOriginal && <p className="original-poi">&quot;{originalPoi}&quot;</p>}
            </>
          )}
        </div>
      </div>

      <div className="feedback-footer app-bottom">
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
        <div className="feedback-actions">
          <button className="back-btn" type="button" onClick={onBack}>
            ← Back
          </button>
          <button className="next-btn" type="button" onClick={onNext}>
            Next Rep →
          </button>
        </div>
      </div>
    </div>
  );
}
