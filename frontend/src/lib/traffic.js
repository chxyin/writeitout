/**
 * The arrival ping: one POST per page load, whatever the visitor is doing.
 *
 * The point of the traffic panel is to answer "who reached the site, from where,
 * on what, and is that device new" — which is a different question from "who
 * signed in". So this fires for everyone, before any auth decision, and carries
 * what the browser will volunteer about the machine it is running on.
 *
 * Nothing here is required for the app to work. Every field is best effort: a
 * browser missing `navigator.connection`, a blocked WebGL context or a fetch that
 * is cut off by navigation simply leaves that part of the row empty.
 */

import { API_BASE_URL } from './api.js';

// One page load, one row. A module flag rather than state so React's double
// render in development cannot send two.
let sent = false;

/** A short digest of the device-ish strings, so a return visit is recognisable. */
function digest(text) {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 16777619) >>> 0;
    high = Math.imul(high ^ code, 2246822519) >>> 0;
  }
  return low.toString(16).padStart(8, '0') + high.toString(16).padStart(8, '0');
}

/**
 * The graphics card, near enough. It is the single most distinguishing field an
 * ordinary page can read, and the extension that exposes it is what every
 * fingerprinting script uses — so if the panel is going to identify a device at
 * all, this is the honest way to say how.
 */
function gpuName() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    return String(renderer || '').slice(0, 120);
  } catch {
    return '';
  }
}

function connectionLabel() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return '';
  return [
    connection.effectiveType,
    connection.downlink ? `${connection.downlink}Mb` : '',
    connection.rtt ? `${connection.rtt}ms` : '',
    connection.saveData ? 'saver' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

/** Everything the browser will say about this device, as flat strings. */
export function deviceProfile() {
  const screenSize = window.screen
    ? `${window.screen.width}x${window.screen.height}`
    : '';
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  const languages = Array.isArray(navigator.languages) ? navigator.languages.join(',') : '';
  const gpu = gpuName();

  const profile = {
    screen: screenSize,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: String(window.devicePixelRatio || 1),
    platform: navigator.platform || '',
    cores: navigator.hardwareConcurrency || null,
    memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : '',
    touch,
    connection: connectionLabel(),
    gpu,
    cookies: navigator.cookieEnabled,
    standalone,
    language: navigator.language || '',
    languages,
    local_time: new Date().toString().replace(/\s*\(.*\)$/, '')
  };

  // The digest deliberately leaves out the clock and the window size: a phone
  // that rotates or a tab that is resized is the same device.
  profile.fingerprint = digest(
    [
      navigator.userAgent,
      screenSize,
      profile.dpr,
      profile.platform,
      profile.cores || '',
      profile.memory,
      gpu,
      navigator.language || '',
      Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    ].join('|')
  );

  return profile;
}

/**
 * Log this page load. Safe to call from an effect: it sends at most once, never
 * throws, and never delays anything the visitor can see.
 */
export async function reportVisit({ route, version } = {}) {
  if (sent) return;
  sent = true;
  try {
    const body = {
      ...deviceProfile(),
      route: route || window.location.hash || '#/',
      referrer: document.referrer || '',
      host: window.location.host || '',
      version: version || ''
    };
    await fetch(`${API_BASE_URL}/api/traffic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // keepalive lets the request finish even if the visitor leaves immediately,
      // which is exactly the visit worth counting.
      keepalive: true
    });
  } catch {
    // An unlogged visit is not the visitor's problem.
  }
}
