/**
 * Dr. Frost Maths-style rep navigation.
 *
 * Prev walks back through the reps saved in App's history array and replays a
 * graded rep (no API call). Next walks forward and, once the user is standing on
 * the last saved rep, asks App to fetch a fresh drill. Both buttons are pure
 * navigation: all state lives in App so the drill and feedback views share it.
 */
export default function HistoryNav({ index, total, onPrev, onNext, canPrev, canNext }) {
  const position = Math.min(index + 1, Math.max(total, 1));

  return (
    <div className="history-nav">
      <button
        type="button"
        className="history-btn"
        onClick={onPrev}
        disabled={!canPrev}
        title="Previous rep"
      >
        <span aria-hidden="true">&lt;</span> Prev
      </button>
      <span className="history-position">
        {position} / {total}
      </span>
      <button
        type="button"
        className="history-btn"
        onClick={onNext}
        disabled={!canNext}
        title="Next rep"
      >
        Next <span aria-hidden="true">&gt;</span>
      </button>
    </div>
  );
}
