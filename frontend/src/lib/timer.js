/**
 * The rep timer, which comes in two kinds.
 *
 * A number is a countdown: seconds per rep, 0 meaning no clock at all. `CHRONO` is
 * the other kind — a stopwatch that only counts up, never runs out and never
 * submits the answer for you, so the delegate decides when the run is done.
 *
 * Both kinds record the same thing: the time from the speech appearing to the send
 * button is written on every run as `write_ms`, which is what the dashboard's
 * writing-time figures and the replay page read. A chrono run is therefore not a
 * special case in the data, only on screen.
 */
export const CHRONO = 'chrono';

/** True for the stopwatch mode, and for anything a stale save got wrong. */
export function isChrono(timer) {
  return timer === CHRONO;
}

/** The countdown length in seconds, with the stopwatch reading as "no countdown". */
export function countdownSeconds(timer) {
  if (isChrono(timer)) return 0;
  const seconds = Number(timer);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
