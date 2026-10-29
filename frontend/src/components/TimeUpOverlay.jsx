/**
 * The clock hits zero.
 *
 * A full-screen red card that says, in the largest type in the app, that the rep
 * is over — because the moment is otherwise silent: the countdown simply reaches
 * 0:00 and the page carries on. It covers the whole shell for three seconds
 * while the answer that is on the page goes to the chair, then lifts to reveal
 * either the grading or the feedback card.
 *
 * It is deliberately a wall, not a message: nothing under it can be clicked, so
 * no one can keep typing after the bell. `pointer-events` is on for exactly that
 * reason, and the overlay is announced to a screen reader as an alert.
 */
export default function TimeUpOverlay({ phase, sending = false, hasAnswer = true }) {
  // 'in' and 'out' are both mounted; null means gone. The parent owns the clock —
  // 3s on screen, then 0.6s of fading — so the overlay never has to keep a timer
  // and can be unmounted from anywhere without leaving one behind.
  if (!phase) return null;

  const copy = !hasAnswer
    ? 'The page was empty — there was nothing to send.'
    : sending
      ? 'Sending what is on the page to the chair…'
      : 'The answer went in as it stood, cut off by the clock.';

  return (
    <div
      className={`time-up ${phase === 'out' ? 'is-leaving' : ''}`.trim()}
      role="alert"
      aria-live="assertive"
    >
      {/* The wash is its own layer so the type can sit on a clean gradient while
          the grid and the vignette animate behind it. */}
      <div className="time-up-wash" aria-hidden="true" />
      <div className="time-up-body">
        <span className="time-up-kicker">Clock ran out</span>
        <span className="time-up-title">
          Time&rsquo;s
          <br />
          Up!
        </span>
        <span className="time-up-copy">{copy}</span>
      </div>
    </div>
  );
}
