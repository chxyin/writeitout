import { useEffect, useState } from 'react';

// Device tiers used by the responsive layout.
// mobile: <= 640px wide, or a short touch viewport — a phone on its side.
// tablet: 641-1024px wide (and not a short touch viewport).
// desktop: > 1024px.
//
// The short-viewport clause matters because a phone in landscape is wider than
// it is tall: an 844x390 iPhone is 844px wide, which used to land it in the
// tablet tier and give it the side-by-side panes meant for a tablet, while the
// short-landscape rules in index.css (gated on the mobile tier) never ran at all.
// `pointer: coarse` keeps a short desktop window on the desktop tier.
export const MOBILE_QUERY = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)';
export const TABLET_QUERY = '(min-width: 641px) and (max-width: 1024px)';
export const PORTRAIT_QUERY = '(orientation: portrait)';

function readViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { isMobile: false, isTablet: false, isDesktop: true, orientation: 'landscape' };
  }
  const isMobile = window.matchMedia(MOBILE_QUERY).matches;
  const isTablet = !isMobile && window.matchMedia(TABLET_QUERY).matches;
  const orientation = window.matchMedia(PORTRAIT_QUERY).matches ? 'portrait' : 'landscape';
  return { isMobile, isTablet, isDesktop: !isMobile && !isTablet, orientation };
}

/**
 * Reports the active device tier and orientation.
 * Uses window.matchMedia so it reacts to resizes and device rotation
 * without any additional dependency.
 */
export default function useBreakpoint() {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const mediaQueries = [MOBILE_QUERY, TABLET_QUERY, PORTRAIT_QUERY].map((query) =>
      window.matchMedia(query)
    );

    const syncViewport = () => {
      setViewport((previous) => {
        const next = readViewport();
        if (
          previous.isMobile === next.isMobile &&
          previous.isTablet === next.isTablet &&
          previous.isDesktop === next.isDesktop &&
          previous.orientation === next.orientation
        ) {
          return previous;
        }
        return next;
      });
    };

    // Subscribe with the modern API, falling back to the legacy Safari one.
    const unsubscribes = mediaQueries.map((mediaQuery) => {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', syncViewport);
        return () => mediaQuery.removeEventListener('change', syncViewport);
      }
      mediaQuery.addListener(syncViewport);
      return () => mediaQuery.removeListener(syncViewport);
    });

    // Resync in case the viewport changed between the first render and this effect.
    syncViewport();

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  return viewport;
}
