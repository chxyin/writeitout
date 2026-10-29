import { useEffect } from 'react';

// The visible height of the page, written to --app-viewport-height.
//
// `100dvh` tracks the browser's own chrome (URL bar, toolbar) but not the
// on-screen keyboard: on iOS the keyboard shrinks the visual viewport while the
// layout viewport — and therefore dvh — stays put. The mobile shell is a
// fixed-height column that never scrolls, so its bottom band (the POI field and
// Submit) would sit under the keyboard with no way to scroll it back into view.
// Following visualViewport lets that band ride above the keyboard instead.
//
// Desktop and tablet ignore the value; only the mobile tier reads it, and every
// use falls back to 100dvh when the property is missing.
export default function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;

    const sync = () => {
      // A pinch-zoom also shrinks the visual viewport. Sizing the shell to it
      // would fight the zoom, so while zoomed in the layout is left alone.
      if (viewport && viewport.scale !== 1) return;
      const height = viewport ? viewport.height : window.innerHeight;
      if (height > 0) {
        root.style.setProperty('--app-viewport-height', `${Math.round(height)}px`);
      }
    };

    sync();
    if (viewport) {
      viewport.addEventListener('resize', sync);
      // iOS fires scroll on the visual viewport as the keyboard slides in.
      viewport.addEventListener('scroll', sync);
    }
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', sync);
        viewport.removeEventListener('scroll', sync);
      }
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      root.style.removeProperty('--app-viewport-height');
    };
  }, []);
}
