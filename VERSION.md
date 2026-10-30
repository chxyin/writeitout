# Versions

## Version 1.2 - Practice Statistics and Answer Storage

Builds on v1.1. The developer view grows from "how much was graded" to "is this
being used as a habit", and the two answer-storage policies become switches
instead of environment variables.

- **Retention.** `#/admin` now reads D1/D7/D30 (the share who practised on the
  day, week and month after joining), stickiness (today's actives ÷ the month's)
  and a nine-week cohort table of new accounts. All-time by design: a 7-day
  window cannot hold a 30-day answer, so these ignore the range picker.
- **How a sitting goes.** Median and average time per sitting, runs per sitting,
  finish rate, "left after one run", the share of sittings that used a clock, the
  share of the clock typically used, estimated words per run, and a chart of
  where sittings stopped.
- **Gone quiet.** Delegates by last graded run, with the ones silent for two
  weeks listed by name, and a separate count for accounts that signed in and
  never practised.
- **Writing time is recorded.** Each run stores `write_ms` — the time from the
  speech appearing to the submit — which is what makes "clock used" measurable.
  It is separate from `latency_ms`, the grader's own round-trip.
- **Answer storage is switchable.** `What gets stored` on `#/admin` (keep answers
  or scores only) and `Save my answers` on the profile card. Both were already
  enforced server-side; now neither needs a redeploy or a database edit. The
  admin switch affects new runs and never deletes what is already stored.

## Version 1.1 - Locked Mobile Shell, Unlimited POI, Persisted Zoom

Tag: `v1.1`. Builds on the componentized architecture and the responsive tier work.

- **Mobile layout is a fixed shell.** On phones the app is pinned to the visible viewport (`100dvh`, page scrolling disabled) and the speech card is the only thing that scrolls. The POI textarea and Submit button stay anchored to the bottom edge, so you can always type and submit without hunting for the button.
- **Landscape fallback.** Screens too short to fit shell + card + input (e.g. 640x360) let the shell itself scroll, with the speech card held at a 120px minimum so nothing overlaps.
- **No more 40-word cap or helper text.** The helper sentence is gone and the counter shows the live word count. A Point of Information of any length can be submitted.
- **Zoom control in Settings.** 80%-160% in 10% steps via a slider and +/- steppers; tapping the percentage resets to 100%. Zoom is applied through the `--ui-scale` CSS variable and every viewport calculation divides by it, so the layout stays intact at any zoom level.
- **Settings persist.** All preferences (animations, topic/committee tags, low intensity, zoom, colour, background) are stored in `localStorage` under `writeitout:settings` and restored on load, with per-field validation.
- **Safe areas.** `viewport-fit=cover` is set so iOS notch and home-bar insets resolve correctly.

If the mobile layout ever regresses, the pre-refactor state is still available at tag `v1.0-stable-pre-refactor`.

## Version 1.0 - Stable Pre-Refactor

This is the fully functional version before the componentization. If the new architecture breaks, revert to the git tag v1.0-stable-pre-refactor.
