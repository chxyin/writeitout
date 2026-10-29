/**
 * The end-of-session card.
 *
 * It wears the same glass as the speech card — translucent, blurred, the shell's
 * own border and radius — rather than the stark white of the feedback card, and
 * it carries its own Exit Task so leaving does not depend on the mode row that
 * the completion screen hides.
 */
export default function SessionComplete({
  onStart,
  onExit,
  total = 5,
  completed = 0,
  average = null,
  topic = ''
}) {
  const reps = completed === 1 ? 'rep' : 'reps';
  const finished = completed >= total;

  return (
    <div className="session-complete">
      <div className="session-complete-body">
        <span className="session-complete-kicker">
          {finished ? 'Session complete' : 'Session ended'}
        </span>

        <div className="session-complete-count">
          {completed}
          <span className="session-complete-total"> / {total}</span>
          <span className="session-complete-unit">{reps}</span>
        </div>

        <p className="session-complete-copy">
          {average !== null
            ? `Averaged ${average}/10 across ${completed} ${reps}.`
            : `You graded no reps this session — the attempt is still saved.`}
        </p>

        {topic && <p className="session-complete-topic">{topic}</p>}
      </div>

      <div className="session-complete-actions">
        <button type="button" className="session-exit-btn" onClick={onExit}>
          Exit Task
        </button>
        <button type="button" className="session-start-btn" onClick={onStart}>
          Start New Session
        </button>
      </div>
    </div>
  );
}
