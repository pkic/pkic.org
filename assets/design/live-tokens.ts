/*
 * Broadcast graphics: the livestream overlay, the projector and the studio's
 * samples of them. They draw on a fixed 1920 x 1080 canvas, independent of
 * the page's root font size, straight on a camera picture or on the
 * conference board.
 */
export const liveTokens = {
  "live-question-type": "64px",
  "live-question-type-long": "52px",
  "live-question-type-longer": "44px",
  "live-question-type-longest": "36px",
  "live-question-byline-type": "32px",
  // The conference board under the panelists, question and poll: its eyebrow, headline, and body text.
  "live-board-eyebrow-type": "28px",
  "live-board-headline-type": "64px",
  "live-board-headline-type-compact": "52px",
  "live-board-body-type": "34px",
  "live-control-scrim": "rgba(0, 0, 0, 0.6)",
  // The timer on air: its label and digits on a plate, larger where it has no plate or sits on a board.
  "live-timer-label-type": "20px",
  "live-timer-type": "60px",
  "live-timer-label-type-large": "24px",
  "live-timer-type-large": "72px",
  "live-timer-mark-label-type": "22px",
  // White graphics straight on the camera picture: a tight edge, and a soft halo for digits.
  "live-on-picture-edge": "0 2px 4px rgba(0, 0, 0, 0.55)",
  "live-on-picture-text-shadow": "0 2px 4px rgba(0, 0, 0, 0.55), 0 0 24px rgba(0, 0, 0, 0.45)",
  "live-on-picture-label-shadow": "0 2px 12px rgba(0, 0, 0, 0.6)",
  "live-plate-shadow": "0 8px 30px rgba(0, 0, 0, 0.35)",
  // The pitch mark's seats still to fill, and the glare on the fill's leading edge.
  "live-mark-track": "rgba(255, 255, 255, 0.28)",
  "live-mark-glare": "rgba(255, 255, 255, 0.85)",
  // A camera-like shot behind a timer look's sample, so a look without a plate is judged as it reads on air.
  "live-sample-shot":
    "radial-gradient(ellipse 60% 120% at 30% 110%, rgb(107 97 87) 0%, rgb(61 58 55) 45%, transparent 75%), linear-gradient(180deg, rgb(141 154 164) 0%, rgb(88 99 107) 45%, rgb(44 50 56) 100%)",
  // The pitch mark keeps time: its fill eases over each second, it beats and ripples once a second, and blinks once over.
  "dur-live-mark-second": "1s",
  "dur-live-mark-beat": "700ms",
  "dur-live-mark-ripple": "900ms",
} as const;
