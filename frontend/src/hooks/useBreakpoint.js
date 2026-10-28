import { useEffect, useState } from 'react';

// Device tiers used by the responsive layout.
// mobile: <= 640px, tablet: 641-1024px, desktop: > 1024px.
export const MOBILE_QUERY = '(max-width: 640px)';
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
