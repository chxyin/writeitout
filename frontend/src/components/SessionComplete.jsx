export default function SessionComplete({ onStart, total = 5 }) {
  return (
    <div className="session-complete feedback-card">
      <div className="feedback-score">{total}/{total}</div>
      <div className="feedback-label">Session Complete</div>
      <p>Great job! You completed {total} reps.</p>
      <button className="next-btn" onClick={onStart}>
        Start New Session
      </button>
    </div>
  );
}
