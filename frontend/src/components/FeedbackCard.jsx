export default function FeedbackCard({ feedback, scoreColor, onNext }) {
  return (
    <div className="feedback-card">
      <div className="feedback-score" style={{ color: scoreColor }}>{feedback.score}/10</div>
      <div className="feedback-label">{feedback.grade_label}</div>

      <p><strong>Reasoning:</strong> {feedback.reasoning}</p>
      <p><strong>Advice:</strong> {feedback.constructive_feedback}</p>

      <div className="rewrite-box">
        <span>Your POI, Improved</span>
        <p>"{feedback.rewritten_poi}"</p>
      </div>

      <button className="next-btn" onClick={onNext}>
        Next Rep →
      </button>
    </div>
  );
}
