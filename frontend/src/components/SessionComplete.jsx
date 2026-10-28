export default function SessionComplete({ onStart }) {
  return (
    <div className="session-complete feedback-card">
      <div className="feedback-score">5/5</div>
      <div className="feedback-label">Session Complete</div>
      <p>Great job! You completed 5 reps.</p>
      <button className="next-btn" onClick={onStart}>
        Start New Session
      </button>
    </div>
  );
}
