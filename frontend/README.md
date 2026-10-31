# WriteItOut — frontend

React + Vite front end for the WriteItOut MUN POI trainer.

## Google sign-in setup

The splash screen signs delegates in with Google, which needs an OAuth client:

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   open the **OAuth 2.0 Client ID** of type **Web application** (this project's is
   `802894837975-lmjp3uam5tjc641a8sfknsb59218mtoe.apps.googleusercontent.com`).
2. Make sure **Authorised JavaScript origins** cover every origin the app is
   served from — `http://localhost:5173` for `npm run dev`, and
   `https://chxyin.github.io` for the GitHub Pages deploy.
3. `.env` already carries the client ID; Vite bakes it in at build time, so
   restart the dev server after changing it. A fork replaces the value in `.env`
   (and in the repository secret below) with its own client ID.
4. For the deployed site, set the same value as a repository secret named
   `VITE_GOOGLE_CLIENT_ID`; `.github/workflows/deploy.yml` passes it to the build.
   Without it the bundle falls back to the project client ID, so a deploy still
   signs in.

The client ID is public — it is checked against the page's origin, not kept
secret. The **ID token** it returns is the credential: the backend verifies it at
`POST /api/auth/google` and reads the account from it. `GET /api/me` returns the
same verified profile for a `Bearer` token.

## Deploying

`.github/workflows/deploy.yml` builds this folder and publishes `frontend/dist`
to GitHub Pages. It fires on `main` and on `master`, because the repository's
branch was renamed and a stale clone may still push the old name.

**The backend is on Vercel, and its production branch is `master`.** A push to
`main` alone updates the site but leaves the API on the previous build — the
frontend then quietly loses whatever the old API does not return. Push both:
`git push origin HEAD:main; git push origin HEAD:master`. You can tell which API
is live from `https://writeitout-backend.vercel.app/openapi.json`: the request
models there list every field the deployed code accepts.

The Pages site must be set to **Settings → Pages → Source: GitHub Actions**. With
the older "Deploy from a branch" source, GitHub publishes the branch's own folder
— which has no `index.html` at the root — and the whole site turns into a 404
while the workflow's `deploy` job fails in about a second. That mismatch is worth
checking first whenever the site is blank after a successful build.

## Routes

The address bar is the router — `src/lib/route.js`, about thirty lines, no
dependency:

| Address | Screen |
| --- | --- |
| `/writeitout/` | the start screen (sign in, pick runs and timer, Play) |
| `/writeitout/#/session/<id>` | one past session, replayed |
| `/writeitout/#/admin` | the developer statistics (admin accounts only) |

The session route is a hash because GitHub Pages serves files, not routes: a
direct visit to `/writeitout/session/<id>` would 404. A hash link still
bookmarks, shares, reloads and answers the back button, and both screens read
the same URL when the page is opened cold.

`#/session/<id>` shows the drill and the feedback card exactly as they were,
frozen: the speech, the answer read-only, the score and the chair's verdict,
with Prev/Next through the runs and the completion card at the end. Nothing can
be edited and no clock runs, because the session is over. Opening it signed out
asks for the Google sign-in in place; a session belonging to another account is
a 404.

## Night light

Every screen sits under a warm **darkening lens**, on by default — a fixed pane
(`body.night-light::after`) in `src/index.css`, `mix-blend-mode: multiply`, whose
colour and opacity are both derived from one number: a colour temperature.

**Settings → General → Night light** is a switch plus a dial from **1000K to
6000K** (default 5000K, a hair warmer than daylight). 6000K is daylight, so the
lens does nothing and the pane is not drawn at all. 3000K is a lamp; 1000K is
candlelight. Warmer always means dimmer, because the one dial feeds both numbers:

- **tint** is the blackbody colour for that temperature (`kelvinToRgb` in
  `src/lib/appearance.js`, Tanner Helland's approximation) — the colour a real
  object at that temperature glows;
- **opacity** runs 0 at 6000K to the **0.6** cap at 1000K, past which the page is
  too dark to read.

A true blackbody tint, not a fade from white to orange, is what makes this work
on a blue page: a fade still carries blue until the bottom of the range (it is
`rgb(255, 132, 102)` at 3000K), and multiplying a blue page by a tint that still
has blue in it leaves the page blue. A blackbody tint has no blue left below
~3200K.

The switch is a shortcut for the ends of its own dial: off parks the temperature
at 6000K after remembering the warmth, on comes back to it. The temperature row
stays on screen at 6000K — hiding it the moment the dial reached daylight would
snatch the slider out from under the cursor mid-drag.

The preference is per browser, in the same localStorage entry as the other
settings (`nightKelvin`, plus `nightLastWarm` for the switch's memory), and
nothing about it reaches the server. Saves are versioned (`SETTINGS_VERSION` in
`App.jsx`): a save from the old two-dial version (`nightLight` +
`nightLightStrength`) is migrated on load — 55% becomes 3300K, an old "off"
becomes 6000K — and a save from before v1.7 that is still on the old 3400K default
follows the new 5000K one, while a temperature that was actually chosen stays put.
The conversion uses the published Helland curve; the blue term was mistyped for a
version, which made every temperature more orange than the physics says.

Two details worth keeping:

- `--night-tint` and `--night-opacity` are written on `<html>` and read by the
  pane, so dragging the dial repaints without re-running the body-class effect.
- The pane is a pseudo-element, not a `filter` on `<html>`/`#root`: a filtered
  ancestor becomes the containing block for every `position: fixed` overlay (the
  settings scrim, the delegate drawer, the trial gate), and those would scroll
  with the page instead of pinning to the screen.

A `backdrop-filter: sepia(...)` version was tried first and rejected: it turns a
blue page brown rather than dimming it, which is not what the reference does.

One limit worth knowing: multiply can only darken, so the saturated blue page
goes deep navy-slate rather than orange — no multiply can raise a channel the
page never had. White and near-white surfaces (the cards, the settings panel) do
go cream. Making the page itself amber would take a different blend mode
(`color` or `hue`) or repainting the background, not a stronger multiply.

## Developer statistics

`#/admin` is the one screen written for the person running the deployment: how
many delegates signed in, how many runs the chair graded, the score spread, what
the model costs, and who is practising most, over 7, 30 or 90 days. It is served
by `GET /api/admin/stats`, which is admin-only — the address list is the backend's
`ADMIN_EMAILS`, so the page cannot be unlocked from the browser. A signed-in
non-admin gets a "not an admin" card instead of the numbers.

The `ⓘ What these numbers mean` button opens the definitions: what counts as a
run, as an active delegate, and as spend, and that every day is a Hong Kong day.
`/api/auth/google` returns `is_admin` so the start screen can show the link; that
flag is cosmetic, the endpoint checks the token for itself.

A failed read shows an **error code** under the message — `HTTP 503 ·
stats.habits`. The dashboard is one request built from about eighteen queries, so
`store.py` tags each one with its section (`StatsError`), `main.py` returns
`{ message, code }` in the 503's `detail`, and `src/lib/api.js` hands the code to
the page. A screenshot then names the query that broke, without the driver's own
message — which can carry the DSN — ever leaving the server. The delegate drawer
shows the same code, and a failed write in God Mode appends it to the sentence.

Below the headline numbers the page answers three questions the totals cannot:

| Panel | What it reads |
| --- | --- |
| **Do they come back?** | D1/D7/D30 — the share of delegates who practised on the day, week and month after they joined — plus stickiness (today's actives ÷ the month's) and a cohort table of the last nine weeks of new accounts. All-time by nature: a 7-day window cannot hold a 30-day answer, so these ignore the range picker. |
| **How a sitting goes** | Median and average time per sitting (Play → close), runs per sitting, how many sittings reached the end, how many stopped after one run, the share that used a clock, the share of the clock typically used, estimated words per run, and a 0 → 8+ chart of where sittings stopped. |
| **Gone quiet** | Delegates by last graded run — a week, a fortnight, 30 days — with the ones silent for two weeks listed by name. "Never practised" is a separate count: an account that signed in and stopped there. |

Two switches live on the page as well, so a policy change does not need a
redeploy:

- **What gets stored** (admin) — `Keep answers` or `Scores only`, written to
  `app_settings` through `PATCH /api/admin/settings`. Only `full` stores text, so
  the page offers two choices rather than the API's three modes; the switch
  applies to new runs and never deletes what is already stored.
- **Don't save my answers** (delegate, in **Settings → General**) — the account's
  own opt-out, `PATCH /api/profile`, worded as the thing you would want to turn
  on. The gear is now drawn on the start screen too, because a privacy switch
  nobody can find before playing is not a switch. The server enforces both, on
  every write; the browser only decides what the toggle shows.

### Windows, the chart, and one delegate in detail

The picker offers Today, 7 days, 30 days, 90 days, **1 year** and **Custom**
(two calendar dates, inclusive of both ends). The window is `start`/`end` in Hong
Kong time, half-open on the server, so "1 Oct – 2 Oct" is exactly two days.

The runs-per-day chart carries a y scale and a date axis, and hovering (or
tabbing to) a bar shows that day in full: runs, delegates active, and spend.

Clicking a row in **Busiest delegates** opens a drawer for that account
(`GET /api/admin/users/{sub}`): name, email, the Google `sub`, join date, last
active, total runs, average score, time on app, tokens and estimated spend,
followed by the addresses that account has used (`user_ips`, one row per
address with a request count) and **God Mode** — every run they ever submitted,
newest first, each expandable to show the speech, their answer, the chair's
grade, reasoning and notes, the writing time and the grading time, and the
tokens that run cost. Long lists filter by topic, committee or grade, and
**Download CSV** exports every run. The dashboard's own table exports as a
summary CSV (name, email, runs, average, best, streak, last seen).

Answer text still obeys the storage policy: a delegate who opted out, or a
deployment set to scores-only, shows "not stored" in God Mode as well. That is
what the switch is for — an admin page that could read it back would make the
promise meaningless.


Writing time is recorded per run (`reps.write_ms`): the browser stamps when the
speech appeared and sends the difference at submit, so `Clock used` is measurable
without guessing from timestamps. It is a different number from `latency_ms`,
which is how long the grader took.

The completion card also asks one question — "Was this useful?" with **Yes** and
**Not yet** — written to `practice_sessions.rating` (`POST
/api/sessions/{id}/rating`). "Would repeat" on the dashboard is the share of
*answered* sittings marked useful; a delegate who closes the card without tapping
counts as neither, because no answer is not a no.

### Overwriting a run

God Mode is not read-only. Every run's bar carries the two things a developer
does most often, so neither needs the card opened:

- **Score** — type a new mark and leave the box; `PATCH /api/admin/reps/{id}`
  replaces the chair's number.
- **Exclude / Include** — `reps.excluded`. The run stays in the list, greyed and
  tagged, so it can be put back, but every aggregate (counts, average, spread,
  topics, spend, clock use) ignores it. The delegate's own counters are rebuilt
  from the runs that still count, so the two can never disagree.
- **Delete this run** (inside the card) — `DELETE /api/admin/reps/{id}`,
  permanent, and it asks first.

**Select** at the top of the list turns every row into a checkbox with a bar
above it — *Exclude selected*, *Include again*, *Select all* — because tidying a
batch of test runs one card at a time is the chore that stops people tidying.
The tick list only covers the rows the topic filter is showing.

Session-level numbers (runs per sitting, finish rate) still include a session
whose runs were excluded: those describe the sitting, not the marked answers.

### Delegates, sorting, and the anonymous

The delegate table is sortable with four buttons: **Last used / First used**,
**Highest / Lowest average**, **Most / Least time**, **Most / Fewest runs**.
Pressing the active button again flips the direction and the label flips with it,
so the button always says which end is on top. Time on app is the visible-minute
heartbeat count for that account, the same number the drawer shows.

Two more columns than before:

- **Excl.** — how many of that delegate's runs are hidden from the figures. The
  count is shown beside the run total, not subtracted from it, so "9 runs, 2
  hidden" is readable at a glance.
- **Anonymous rows.** A visitor who never signs in still practises, and that
  practice is recorded under an address-derived key (`anon:<hash>`, see
  `guest_sub()` in `backend/main.py`) with the address itself in `user_ips`. The
  table shows them as **Anonymous 203.0.113.24** rather than hiding them, and
  clicking one opens the same drawer. They are *not* counted as delegates in the
  sign-up, retention or cohort numbers — those are about accounts — so the
  Delegates card carries a "N anonymous visitors" note instead.

Guest runs never store text, whatever the deployment's answer policy says: there
is no account to hang consent on, so the mark is kept and the writing is not.
God Mode shows "not stored" for them, which is the truth rather than a bug.

### Charts: bars, pie or graph

**Charts** in the toolbar switches every graph on the page at once — runs per
day, marks per band, runs per sitting and the topic split:

- **Bars** — the default; hover (or tab to) a bar for that day in full.
- **Graph** — a line with a point per day; the same hover card, the trend is the
  point.
- **Pie** — a donut with a legend carrying exact counts and shares. A long series
  is grouped into at most eight slices (a 30-day window becomes five-day
  blocks and the legend says which days each slice covers), because thirty
  hairline wedges is not a chart.

Topics keep their row list under Bars — a topic name is too long for an axis —
and switch to the pie or line when the toolbar does.

## Export runs

The **Export runs** panel turns the database into a training file. Every control
is a question someone assembling a fine-tuning set asks:

- **From / To** — a window, defaulting to the ranged window above; *Use the
  window above* re-syncs it.
- **Marks** — preset bands (7–10, 4–6, 1–3, 2–4, 8–10) plus *From mark / To
  mark* for a custom one. Several bands can be active at once and are OR-ed:
  ticking 7–10 and 1–3 exports the best and the worst in one file.
- **Whose runs** — Everyone, Only ticked, or Everyone except ticked, with a
  searchable checklist and *Tick all shown*.
- **Fields** — what goes in the file: when, speech, their POI, score, the chair's
  label/reasoning/advice, the model rewrite, topic, committee, delegation,
  account id, writing time, tokens, the excluded flag.
- **Options** — only runs whose answers were stored (on by default), only runs a
  delegate flagged, include excluded runs, oldest first, and drop duplicate
  (speech, answer) pairs.
- **Format** — JSON (one indented array), JSONL (one object per line), Chat (the
  `messages` shape for fine-tuning a POI writer), CSV, TSV, or plain Text.
- **Preview count** runs the same query and reports the run count and file size
  without downloading anything.

`POST /api/admin/export` builds the file server-side and hands back its text; the
browser saves it as a Blob, so no export is stored on the server and none is
mailed anywhere. The response is capped at 5,000 rows (the store accepts up to
20,000) — well under the function's body limit, and a training set bigger than
that wants to be built in date slices anyway.

## Flagging a bad grade

The feedback card carries a quiet **⚑ Flag AI error** button. Pressing it sets
`reps.flagged` through `POST /api/reps/{id}/flag` and changes nothing else: the
mark stands, the averages do not move, and the run stays where it is. It is a
reading list for the developer, not a correction — the export panel's *Only runs
flagged by a delegate* filter is how that list is opened.

The endpoint only accepts a run the caller owns (guest identity included) and
answers 404 for anything else. An account a developer has stopped from flagging
gets a 403, and the card says so instead of pretending the flag worked.

That stop switch is in the delegate drawer: **Ban this account from flagging AI
errors** (`delegates.flag_banned`, `PATCH /api/admin/users/{sub}`). It exists for
the delegate who flags every run for fun, which is noise in the list rather than
a signal.

## Anonymous limits

Two rules stack, and both end the same way: a card asking for the Google sign-in.

- **Two runs a day, always.** A visitor who has not signed in gets two graded runs
  per Hong Kong day, counted from `reps` for the address-derived identity rather
  than from a counter, so it cannot drift out of step with what was practised. It
  resets at midnight. This is not a switch: it is the everyday limit, and signing
  in removes it entirely.
- **Trial mode, optional.** A switch on `#/admin` (beside the storage policy) that
  additionally limits a visitor without an account to **one practice ever**.

- The id is a cookie this page sets for itself (`writeitout_visitor`, a year,
  `SameSite=Lax`) and sends as `X-Visitor`, because the API is on another origin
  and a cookie it set would be third-party and dropped. The address is stored
  beside it in `trial_visits`; a browser with no cookie at all is counted by a
  hash of its address instead, so the gate still exists.
- Both gates are enforced in `POST /api/grade`, not in the browser: a refused run
  is a 403 carrying the explanation, and for the daily cap a
  `trial.daily_limit` code the page turns into the sign-in card. Signed-in
  delegates are never limited. The check sits before the model call, so a capped
  visitor costs nothing.
- `GET /api/trial` reports `runs_today`, `runs_left` and `daily_limit`, and the
  page refetches it after every graded run, so the start screen's note and the
  Play button agree with the server without a reload.
- The card's wording lives in `TRIAL_SIGNIN_COPY` on the server, so the API and
  the page cannot drift apart.

## The traffic log

`#/admin` ends with **Who arrives**: one row per page load, signed in or not, because
most arrivals never sign in and the delegate table cannot see them.

- `POST /api/traffic` is called once per page load from `src/lib/traffic.js`, before
  any auth decision, and never blocks anything the visitor sees (`keepalive`, errors
  swallowed).
- The server adds what only it can know: the address (`x-forwarded-for`), the
  resolved location from the platform's edge headers (`x-vercel-ip-country`,
  `-region`, `-city`, `-latitude`, `-longitude`, `-timezone`, `-asn`), and a
  browser/OS/device label plus a bot flag from the user agent. No third-party
  geolocation lookup is involved.
- The browser volunteers the rest: screen and viewport size, device pixel ratio,
  platform, CPU cores, device memory, touch support, connection type, language,
  timezone offset, standalone/PWA mode, whether cookies are on, the WebGL renderer,
  and a digest of the stable parts (`fingerprint`) so a returning device is
  recognisable across visits.
- `GET /api/admin/traffic` is admin-only and paginated (`days`, `limit`, `offset`,
  `q`), and returns the counts above the table: visits, distinct devices, distinct
  addresses, first-time visitors, the signed-in share and bots, plus top countries,
  devices and routes and a by-hour strip.
- Rows are pruned to **90 days** (`TRAFFIC_RETENTION_DAYS`), one insert in twenty
  doing the delete, because this app has no scheduler.

## Hints

The start screen carries one rotating tip, `src/components/HintsStrip.jsx` over
`src/lib/hints.js`. The list is ordered, not shuffled: the first half is the
Formatting tab, because "it looks wrong on my screen" is the complaint a delegate
can fix themselves. The rotation is state, the fade is a CSS animation keyed on the
line, and the last tip is that the tips can be turned off — **Settings → General →
Show hints**.

The strip is text: no pill, no border, no backdrop-filter. A caption with a box
around it reads as a control, and this is the one thing on the screen that is not
one; a text-shadow keeps it legible over the grid instead.

## Formatting

**Settings → Formatting** holds four numbers — top offset, bottom offset, speech
text size, speech card width — written onto `<body>` as `--fmt-*` custom
properties (`src/lib/formatting.js`) and read by `index.css`.

- **Desktop** reads all four directly: the shell is the card plus two gutters, and
  the offsets are the shell's own margins.
- **Phones and tablets** have no card column to narrow, so the values are mapped
  onto the numbers that layout does have — top/bottom offset become the space
  above and below the drill, and card width becomes the side gutters, inverted
  (dragging right widens the card to edge-to-edge, dragging left narrows it). Each
  expression keeps the shipped look at its default, which is why the phone block
  reads "the old fixed value + (slider − default)".
- The tab draws a **preview** of the drill on the app's own background, driven by
  the same four values. Without it a change is invisible while the panel is open —
  the panel covers the card, and on a phone the card is the whole screen.
- **Reset is per tab**: one button for General, one for Formatting, each disabled
  while its own half already sits at the defaults.

The saved values are also written by an inline script in `index.html` before the
app bundle runs. The stylesheet's `:root` defaults would otherwise paint first
and the saved numbers a moment later — a flash on fast machines, a "wrong size
until I touch a slider" on slow or old ones, where a post-load custom-property
write is not always repainted. The inline script clamps defensively and falls
back to the same defaults, so it can never disagree with the app.

## Mobile

The mobile tier is a fixed-height shell that follows the visible viewport
(`src/hooks/useViewportHeight.js` writes `--app-viewport-height`), so the POI field
and Submit stay above the on-screen keyboard. Three consequences are handled there:

- **The keyboard must not squeeze the speech away.** At a ~400px visual viewport
  the progress band and the composer used to consume everything, leaving a
  zero-height card. With `:root[data-keyboard="on"]` the shell collapses its
  gutters, hides the mode switch, holds a readable card and scrolls if it still
  does not fit.
- **Coming back must land at the top.** iOS scrolls the page to reveal a focused
  field and does not undo it. Losing focus, closing the keyboard, returning to the
  tab, rotating and submitting all call the same idempotent reset.
- **iOS focus zoom** is a browser behaviour, not a layout bug: Safari magnifies the
  page when a focused field computes to less than 16px and does not zoom out
  again. The fix is the threshold, not `user-scalable=no`: form fields on phones
  are pinned to a rendered 16px (`max(16px, calc(16px / var(--ui-scale)))`).

## The rep timer, including Chrono

The timer segment is either a number of seconds (a countdown, `0` meaning no clock)
or **Chrono**: a stopwatch that counts up, never expires and never submits for you.
`src/lib/timer.js` is the single place that knows the difference, so the countdown,
the auto-submit effect and the session row all treat it as "no countdown" without
special cases.

Chrono is not a special case in the data either: `write_ms` is recorded on every run
from the moment the speech appeared, and that is exactly what the stopwatch shows.
A chrono session records `seconds_per_rep = 0`.

## Privacy


Two tables keep a raw address. `user_ips` is written when a delegate signs in and
when they press Play: one row per (account, address) with a request count and
first/last seen, never per run. `traffic` keeps the address beside each page load,
plus what the device reported, for 90 days, and only `GET /api/admin/traffic`
serves it. Everything else stores only a salted hash (`events.ip_hash`). It exists so the developer view can tie an account to the
network it practised from, and the list is served only by the admin endpoint.

## Scripts

```bash
npm run dev      # dev server on http://localhost:5173/writeitout/
npm run build    # production build into dist/
npm run preview  # serve the built bundle
npm run lint     # eslint
```

### Why the build names old browsers

`vite.config.js` sets `build.cssTarget` to Safari 14 / Chrome 87 and friends.
Left at Vite 8's default, the CSS pipeline rewrites every breakpoint into the
range form `@media (width <= 1024px)`, which only Safari 16.4+ and Chrome 104+
understand — an older phone drops the block silently, so the home screen draws
its desktop two-column layout on a 390px screen. Naming older browsers keeps
`@media (max-width: 1024px)` in the output. Do not remove the setting without
rebuilding and checking that the compiled stylesheet still says `max-width`.

## React + Vite notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

