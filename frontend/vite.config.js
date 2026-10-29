import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/

// Lightning CSS (Vite 8's CSS pipeline) only rewrites media queries into the
// modern range form — `@media (width <= 1024px)` — when every target browser
// understands it. Left at the default target, the built stylesheet came out in
// that form, and phones old enough to miss it (Safari before 16.4, Chrome
// before 104) dropped the whole block: the home screen then rendered as the
// desktop two-column layout on a 390px screen. Naming older browsers here keeps
// the classic `max-width` / `min-width` syntax in the output.
const CSS_TARGETS = ['chrome87', 'edge88', 'firefox78', 'safari14', 'ios14']

export default defineConfig({
  base: '/writeitout/',
  plugins: [react()],
  build: {
    cssTarget: CSS_TARGETS,
  },
})
