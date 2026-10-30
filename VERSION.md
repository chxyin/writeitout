# Versions

## Version 1.6 - Kelvin Night Light, the Traffic Log and the Stopwatch

- **Night light, rebuilt on the Kelvin scale.** One dial instead of two: 6000K is
  daylight and therefore off, 3000K a warm bulb, 1000K candlelight. The tint is a
  real blackbody colour, so the blue page actually loses its blue, and the opacity
  runs 0 to the same 0.6 cap. The switch is a shortcut to the ends of the dial and
  remembers the warmth it left. Saves from the two-dial version are migrated.
- **Who arrives: a traffic log.** Every page load, signed in or not, with the
  address, the location the edge resolved, the device the browser reported (screen,
  GPU, cores, memory, connection, language) and a device digest, in a new admin
  panel with counts, top countries/devices/routes, a by-hour strip, search and
  paging. Kept 90 days, admin-only.
- **Rotating hints** on the start screen, weighted towards the Formatting tab, with
  **Show hints** in Settings — and a tip that says so.
- **Two runs a day without signing in.** Counted from the runs themselves per Hong
  Kong day, enforced before the model call, lifted entirely by signing in. Trial
  mode still stacks on top as an optional one-practice limit.
- **Chrono**, the timer that only counts up: no deadline, no auto-submit, and the
  elapsed time recorded per run exactly as the countdown records it. It replaces
  the 15s segment.
- The Runs/Timer picker is right-aligned and about a tenth shorter.

## Version 1.5 - Flagged Runs

- **⚑ Flag AI error** on the feedback card: a delegate marks a run the chair got
  wrong. It changes no number — the run is marked (`reps.flagged`) and the export
  panel can pull exactly those runs with *Only runs flagged by a delegate*.
- **Ban an account from flagging** from the delegate drawer
  (`delegates.flag_banned`), for the delegate who flags everything for fun. The
  API refuses their flags with a 403 and the card says so.
- **Anonymous practice is now actually written.** The browser was only recording
  runs for signed-in accounts, so the guest attribution added in v1.4 had nothing
  to attribute; sessions and runs are now recorded for guests too.
- Export gained **JSON** and **TSV** alongside JSONL / Chat / CSV / Text.

## Version 1.4 - Charts, Anonymous Visitors and a Training Export

Builds on v1.3. The developer view becomes something you can read three ways and
take data out of.

- **Night light, rebuilt to the reference.** A multiplied amber pane over every
  screen, adjustable from 0 to 100% (capped at 0.6 opacity) with a hue dial;
  on by default. No more sepia cast.
- **Anonymous practice is recorded.** A visitor who never signs in practises
  under an address-derived key and appears in the delegate table as
  **Anonymous 203.0.113.24**. Guests never have answer text stored, whatever the
  deployment's answer policy says. They are counted separately from signed-in
  delegates, so the sign-up and retention numbers still mean accounts.
- **Every chart can be bars, pie or graph.** One switch in the toolbar redraws
  runs per day, marks per band, runs per sitting and the topic split. A long
  series is grouped into at most eight pie slices.
- **The delegate table is sortable** — last/first used, highest/lowest average,
  most/least time, most/fewest runs — with a new **Excl.** column counting the
  runs hidden from the figures.
- **God Mode can act on several runs at once.** *Select* turns the list into
  checkboxes with Exclude / Include actions, and the score box and Exclude button
  moved onto the run's own bar.
- **Export runs.** An admin panel that builds a training file from the runs
  themselves: date window, one or more mark bands, include/exclude delegates,
  field picker, and JSON / JSONL / Chat / CSV / TSV / Text output, with a preview
  count before downloading.

## Version 1.3 - Night Light and Self-Describing Failures

Builds on v1.2. The page ships warm, the developer view explains its own
failures, and one schema column that the live database never got is back.

- **Night light, on by default.** Every screen carries a warm cast (a backdrop
  filter, so fixed overlays such as the drawer and the trial gate keep pinning to
  the screen). **Settings → General** has the switch and a **Warmth** slider from
  orange to lemon; the choice is per browser.
- **Error codes.** A dashboard that fails now shows the HTTP status and the
  section that broke (`HTTP 503 · stats.habits`) instead of one grey sentence, so
  a screenshot is a diagnosis. The same code appears on the delegate drawer and
  after a refused edit.
- **Fixed: the dashboard could not be read at all.** `reps.excluded` was added to
  the queries but never to `schema.sql`, so every aggregate asked Postgres for a
  column that did not exist and the whole page answered 503. The column is now
  part of the schema's idempotent migrations, which is how the live database
  picks it up on the next cold start.

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
