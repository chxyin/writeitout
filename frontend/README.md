# WriteItOut — frontend

React + Vite front end for the WriteItOut MUN POI trainer.

## Google sign-in setup

The splash screen signs delegates in with Google, which needs an OAuth client:

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type **Web application**.
2. Add the origins the app is served from under **Authorised JavaScript origins**
   — `http://localhost:5173` for `npm run dev`, and `https://chxyin.github.io`
   for the GitHub Pages deploy.
3. Copy `.env.example` to `.env` and paste the client ID into
   `VITE_GOOGLE_CLIENT_ID`. Vite bakes it in at build time, so restart the dev
   server after changing it.
4. For the deployed site, add the same value as a repository secret named
   `VITE_GOOGLE_CLIENT_ID`; `.github/workflows/deploy.yml` passes it to the build.

Without a client ID the app still runs: the sign-in button is rendered, but
Google refuses to issue a token, and the splash screen stays signed out.

## Scripts

```bash
npm run dev      # dev server on http://localhost:5173/writeitout/
npm run build    # production build into dist/
npm run preview  # serve the built bundle
npm run lint     # eslint
```

## React + Vite notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
