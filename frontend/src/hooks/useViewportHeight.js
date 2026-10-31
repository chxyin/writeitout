import { useEffect } from 'react';

/**
 * The visible height of the page, written to --app-viewport-height, plus the
 * keyboard state the mobile tier styles off.
 *
 * `100dvh` tracks the browser's own chrome (URL bar, toolbar) but not the
 * on-screen keyboard: on iOS the keyboard shrinks the visual viewport while the
 * layout viewport — and therefore dvh — stays put. The mobile shell is a
 * fixed-height column that never scrolls, so its bottom band (the POI field and
 * Submit) would sit under the keyboard with no way to scroll it back into view.
 * Following visualViewport lets that band ride above the keyboard instead.
 *
 * Two things beyond that, both of them about getting *back*:
 *
 * 1. `data-keyboard="on"` while the keyboard covers a sixth of the screen. The
 *    shell shrinks to the visual viewport, and at a ~400px viewport the progress
 *    band plus the composer used to eat the entire screen, leaving a zero-height
 *    speech card — "by the second POI you cannot see anything". index.css uses
 *    the attribute to keep a readable card and let the shell scroll instead.
 *
 * 2. A baseline reset. iOS scrolls the page to reveal a focused field and does
 *    not undo it; a phone that has been scrolled once stays scrolled, with the
 *    drill riding up under the browser chrome. Losing focus, closing the
 *    keyboard, coming back to the tab, rotating and submitting all call the same
 *    reset: re-measure, drop the keyboard flag, and scroll the shell and the page
 *    back to the top. It is deliberately idempotent — it runs on every focusout,
 *    and does nothing when the layout is already at rest.
 *
 * Desktop and tablet ignore the attribute and the value; only the mobile tier
 * reads either, and every CSS use falls back to 100dvh when it is missing.
 */

/** How much of the screen the keyboard has to cover before it counts as open. */
const KEYBOARD_THRESHOLD = 120;

export default function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const shell = () => document.querySelector('.app-container');

    const measure = () => (viewport ? viewport.height : window.innerHeight);

    const resetScroll = () => {
      // Only the page and the shell; a scroller inside the card keeps its own
      // position, because that is where the delegate was reading.
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      const element = shell();
      if (element && element.scrollTop) element.scrollTop = 0;
    };

    const sync = () => {
      // A pinch-zoom also shrinks the visual viewport. Sizing the shell to it
      // would fight the zoom, so while zoomed in the layout is left alone.
      if (viewport && viewport.scale !== 1) return;
      const height = measure();
      if (height > 0) {
        root.style.setProperty('--app-viewport-height', `${Math.round(height)}px`);
      }
      // The keyboard is a big, sudden loss of height. On a phone the URL bar is
      // worth ~100px, so anything past the threshold is the keyboard.
      const covered = window.innerHeight - height;
      const keyboard = covered > KEYBOARD_THRESHOLD;
      if (keyboard) {
        root.dataset.keyboard = 'on';
      } else if (root.dataset.keyboard) {
        delete root.dataset.keyboard;
        // The keyboard closing is the moment the layout has room again, and the
        // moment iOS would otherwise leave the page scrolled where the field was.
        resetScroll();
      }
    };

    const onFocusOut = () => {
      // A tap on Submit blurs the field first and submits second, so this runs
      // before the next rep is drawn: giving the new rep a page at the top is
      // what keeps the second POI as visible as the first.
      window.setTimeout(() => {
        resetScroll();
        sync();
      }, 0);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        sync();
        resetScroll();
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
    window.addEventListener('pageshow', sync);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', sync);
        viewport.removeEventListener('scroll', sync);
      }
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.removeEventListener('pageshow', sync);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', onVisibility);
      delete root.dataset.keyboard;
      root.style.removeProperty('--app-viewport-height');
    };
  }, []);
}
