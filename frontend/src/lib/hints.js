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
  'The Formatting tab previews every change before you close it.',
  'On a phone the card width slider is the side margins: right is wider, left is narrower.',
  'Answering on a phone? The keyboard shrinks the card, never the answer box.',
  'The Formatting tab is the one to open first if anything looks off.',
  'Falling papers distracting? Settings → General → Falling papers.',
  'Want a harder rep? Hide the topic tag: General → Show topic tag.',
  'Hide committee and delegation details too: General → Show comm/delegation.',
  'Low intensity dims the decoration without touching your text.',
  'Night light warms every colour: General → Night light, then drag the temperature.',
  'Night light starts faint at 5000K; 3000K is a warm bulb, 1000K candlelight.',
  'Change the page colour and the background: General → Colour, then Background.',
  'Chrono is the timer that counts up: no deadline, and nothing submits for you.',
  'These tips can be switched off: Settings → General → Show hints.'
];

/** Must match the `hint-fade` animation duration in index.css. */
export const HINT_INTERVAL_MS = 7000;
