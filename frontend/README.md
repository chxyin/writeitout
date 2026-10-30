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

Every screen is filtered warm by default — a fixed pane (`body.night-light::after`)
in `src/index.css` holding a `backdrop-filter: sepia(...) saturate(...)
hue-rotate(...)`. It is a backdrop filter and not a `filter` on `<html>` on
purpose: a filtered ancestor becomes the containing block for `position: fixed`
descendants, which would make the settings scrim, the delegate drawer and the
trial gate scroll with the page instead of pinning to the screen.

**Settings → General → Night light** turns it off, and while it is on, a
**Warmth** slider picks the hue — 25° is orange, 65° is lemon, 45° is the warm
desk-lamp default. The preference is per browser, in the same localStorage entry
as the other settings (`nightLight`, `nightHue`), and nothing about it reaches the
server.

Two details worth keeping:

- The custom property `--night-hue` is written on `<html>` and read by the filter,
  so dragging the slider repaints without re-running the body-class effect.
- **Write only the unprefixed `backdrop-filter`.** Lightning CSS adds the
  `-webkit-` alias for Safari by itself; when both are written by hand it keeps
  the alias *only*, and Chrome ignores the prefixed name, so the whole feature
  silently disappears.

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

God Mode is not read-only. Each run carries three developer actions:

- **Score** — type a new mark and leave the box; `PATCH /api/admin/reps/{id}`
  replaces the chair's number.
- **Exclude from stats** — `reps.excluded`. The run stays in the list, greyed and
  tagged, so it can be put back, but every aggregate (counts, average, spread,
  topics, spend, clock use) ignores it. The delegate's own counters are rebuilt
  from the runs that still count, so the two can never disagree.
- **Delete** — `DELETE /api/admin/reps/{id}`, permanent, and it asks first.

Session-level numbers (runs per sitting, finish rate) still include a session
whose runs were excluded: those describe the sitting, not the marked answers.

## Trial mode

A switch on `#/admin` (beside the storage policy) that limits visitors without an
account to **one practice**, then asks them to sign in.

- The id is a cookie this page sets for itself (`writeitout_visitor`, a year,
  `SameSite=Lax`) and sends as `X-Visitor`, because the API is on another origin
  and a cookie it set would be third-party and dropped. The address is stored
  beside it in `trial_visits`; a browser with no cookie at all is counted by a
  hash of its address instead, so the gate still exists.
- The gate is enforced in `POST /api/grade`, not in the browser: a second
  anonymous practice is a 403 carrying the explanation. Signed-in delegates are
  never limited, and turning the switch off restores anonymous practice at once.
- The card's wording lives in `TRIAL_SIGNIN_COPY` on the server, so the API and
  the page cannot drift apart.

## Privacy

The one place a raw address is kept is `user_ips`, written when a delegate signs
in and when they press Play: one row per (account, address) with a request count
and first/last seen, never per run. Everything else stores only a salted hash
(`events.ip_hash`). It exists so the developer view can tie an account to the
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

