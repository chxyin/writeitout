/**
 * Google's sign-in button, sized to the card that holds it.
 *
 * Google draws this button inside its own iframe at a fixed pixel width — it
 * does not shrink to fit, it edits nothing inside, and the app cannot restyle a
 * character of it. The card, meanwhile, is as wide as the screen allows. So the
 * width has to be given to Google, not taken from it: on a phone the old
 * hard-coded 380 was clipped by a ~300px card, and the tail of
 * "繼續透過 Google 帳戶操作" simply disappeared behind the card edge.
 *
 * The wrapper is measured before paint and the measurement is passed straight
 * through, so the label always has the room it was laid out for. Google clamps
 * the button to 200–400px itself; the same bounds are applied here so a narrow
 * screen never asks for a button Google will refuse to draw.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';

// The range Google accepts (see the GSI `width` option).
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function GoogleSignInButton({ onSuccess, onError }) {
  const wrapRef = useRef(null);
  // 0 means "not measured yet". The button is not mounted until there is a real
  // width to hand it, which is what keeps the first paint from showing the old
  // clipped layout for a frame.
  const [measured, setMeasured] = useState(0);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;

    const measure = () => {
      // clientWidth is the content box: no border, no scrollbar, exactly the
      // room the iframe gets.
      const next = Math.round(node.clientWidth);
      // Only a changed width is worth a re-render: Google redraws its whole
      // iframe when the prop moves, and a resize observer can fire for a
      // sub-pixel reason.
      setMeasured((previous) => (Math.abs(previous - next) >= 1 ? next : previous));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, measured));

  return (
    <div className="google-login-wrap" ref={wrapRef}>
      {measured > 0 && (
        // Keyed by width: changing it remounts Google's container, so the old
        // iframe is thrown away instead of being redrawn over.
        <GoogleLogin
          key={width}
          onSuccess={onSuccess}
          onError={onError}
          theme="filled_black"
          shape="rectangular"
          size="large"
          text="continue_with"
          width={String(width)}
        />
      )}
    </div>
  );
}
