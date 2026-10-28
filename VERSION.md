# Versions

## Version 1.1 - Locked Mobile Shell, Unlimited POI, Persisted Zoom

Tag: `v1.1`. Builds on the componentized architecture and the responsive tier work.

- **Mobile layout is a fixed shell.** On phones the app is pinned to the visible viewport (`100dvh`, page scrolling disabled) and the speech card is the only thing that scrolls. The POI textarea and Submit button stay anchored to the bottom edge, so you can always type and submit without hunting for the button.
- **Landscape fallback.** Screens too short to fit shell + card + input (e.g. 640x360) let the shell itself scroll, with the speech card held at a 120px minimum so nothing overlaps.
- **No more 40-word cap or helper text.** The helper sentence is gone and the counter shows the live word count. A Point of Information of any length can be submitted.
- **Zoom control in Settings.** 80%-160% in 10% steps via a slider and +/- steppers; tapping the percentage resets to 100%. Zoom is applied through the `--ui-scale` CSS variable and every viewport calculation divides by it, so the layout stays intact at any zoom level.
- **Settings persist.** All preferences (animations, topic/committee tags, low intensity, zoom, colour, background) are stored in `localStorage` under `writeitout:settings` and restored on load, with per-field validation.
- **Safe areas.** `viewport-fit=cover` is set so iOS notch and home-bar insets resolve correctly.

If the mobile layout ever regresses, the pre-refactor state is still available at tag `v1.0-stable-pre-refactor`.

## Version 1.0 - Stable Pre-Refactor

This is the fully functional version before the componentization. If the new architecture breaks, revert to the git tag v1.0-stable-pre-refactor.
