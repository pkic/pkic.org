import { palette } from "./palette.ts";
import { conferenceFieldColors } from "./conference-field.ts";

/** Scanner feedback and the relative size of each brand-color region. */
export const scannerTokens = {
  "grad-state-ok": `linear-gradient(135deg, #0b2a1c, color-mix(in oklab, ${palette.green} 85%, #000))`,
  "scanner-status-stroke": "4px",
  "scanner-field-dark-green": conferenceFieldColors.darkGreen,
  "scanner-field-green": conferenceFieldColors.green,
  "scanner-field-blue": conferenceFieldColors.blue,
  "scanner-field-orange": conferenceFieldColors.orange,
  "scanner-field-entry-green-end": "60%",
  "scanner-field-entry-blue-start": "80%",
  "scanner-field-entry-blue-end": "90%",
  "scanner-field-entry-orange-start": "100%",
  "scanner-field-exit-green-end": "8%",
  "scanner-field-exit-blue-start": "18%",
  "scanner-field-exit-blue-end": "80%",
  "scanner-field-exit-orange-start": "100%",
  "scanner-field-session-green-end": "30%",
  "scanner-field-session-blue-start": "50%",
  "scanner-field-session-blue-end": "85%",
  "scanner-field-session-orange-start": "100%",
  "scanner-field-lead-green-end": "8%",
  "scanner-field-lead-blue-start": "25%",
  "scanner-field-lead-blue-end": "45%",
  "scanner-field-lead-orange-start": "75%",
  "scanner-field-print-green-end": "5%",
  "scanner-field-print-blue-start": "15%",
  "scanner-field-print-blue-end": "20%",
  "scanner-field-print-orange-start": "40%",
  "grad-state-warning": `linear-gradient(135deg, color-mix(in oklab, ${palette.yellow} 28%, #000), color-mix(in oklab, ${palette.yellow} 48%, #000))`,
  "grad-state-error": `linear-gradient(135deg, color-mix(in oklab, ${palette.red} 38%, #000), color-mix(in oklab, ${palette.red} 80%, #000))`,
} as const;
