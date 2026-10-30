/**
 * The rotating tips on the start screen.
 *
 * Ordered, not shuffled. The first half is the Formatting tab, because "it looks
 * wrong on my screen" is the one complaint a delegate can fix for themselves, and
 * those four controls are the fix. The rest cover the things nobody finds on their
 * own — the night light, the falling papers, the topic tag — and the last two
 * mention the two switches that hide things (including this strip), because a tip
 * that cannot be turned off is an advert.
 */
export const HINTS = [
  'Text too small at the back? Settings → Formatting → Text size.',
  'Prompt too wide or too narrow? Settings → Formatting → Card width.',
  'Card sitting too high? Settings → Formatting → Top offset.',
  'Answer box sitting under your thumbs? Settings → Formatting → Bottom offset.',
  'Nothing here is fixed: if the layout looks wrong on your screen, format it yourself.',
  'The whole app too small? The gear has Zoom — or Ctrl / ⌘ with + and −.',
  'Practising on a phone? Formatting has wider cards and a taller gap for the keyboard.',
  'The Formatting tab is the one to open first if anything looks off.',
  'Falling papers distracting? Settings → General → Falling papers.',
  'Want a harder rep? Hide the topic tag: General → Show topic tag.',
  'Hide committee and delegation details too: General → Show comm/delegation.',
  'Low intensity dims the decoration without touching your text.',
  'Night light warms every colour: General → Night light, then drag the temperature.',
  'For late practice, 3000K is a warm bulb and 1000K is candlelight.',
  'Change the page colour and the background: General → Colour, then Background.',
  'Chrono is the timer that counts up: no deadline, and nothing submits for you.',
  'These tips can be switched off: Settings → General → Show hints.'
];

/** Must match the `hint-fade` animation duration in index.css. */
export const HINT_INTERVAL_MS = 7000;
