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

## Routes

The address bar is the router — `src/lib/route.js`, about thirty lines, no
dependency:

| Address | Screen |
| --- | --- |
| `/writeitout/` | the start screen (sign in, pick runs and timer, Play) |
| `/writeitout/#/session/<id>` | one past session, replayed |

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
