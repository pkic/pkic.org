import { palette } from "./palette.ts";

/*
 * The stage display: a speaker-facing confidence monitor read from two to
 * five meters, dark in both themes. Its type sits on the 1920 x 1080 frame,
 * never below 64 px. Its colors carry one meaning each: red is live or on
 * air, green is next, amber is a warning, orange is the operators' banner.
 */
export const stageTokens = {
  "stage-type": "64px",
  "stage-type-lead": "84px",
  "stage-type-clock": "120px",
  "stage-type-timer-small": "180px",
  "stage-type-timer": "400px",
  "stage-ground": "#020202",
  "stage-ink": "#f5f6f7",
  "stage-ink-soft": "#d6d9dd",
  "stage-ink-muted": "#a9adb3",
  "stage-ink-faint": "#7d8186",
  "stage-rule": "#2a2c2f",
  "stage-track": "#111214",
  "stage-bar": "#2c4a6b",
  "stage-live": "#e5484d",
  "stage-live-ink": "#ffffff",
  "stage-next": "#3fb06f",
  "stage-next-ink": "#04210f",
  "stage-warn": "#f5a524",
  "stage-warn-ink": "#2b1a00",
  "stage-banner": palette.orange,
  "stage-banner-ink": "#111111",
} as const;
