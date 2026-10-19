/**
 * The outputs a live room composes. Program (PGM) is the broadcast the room
 * puts on air; each auxiliary (AUX) output is a separate composition for a
 * screen in the physical room. The room, the overlay pages and the control
 * room read the outputs, their names and their purpose from here.
 */

/** Auxiliary outputs, in the order an operator meets them. */
export const LIVE_AUX_OUTPUTS = ["projector", "stage-preview", "stage-display"] as const;
export type LiveAuxOutput = (typeof LIVE_AUX_OUTPUTS)[number];

export const LIVE_AUX_OUTPUT_DETAILS: Record<LiveAuxOutput, { label: string; short: string; purpose: string }> = {
  projector: { label: "Projector", short: "PRJ", purpose: "Room screen" },
  "stage-preview": { label: "Stage preview", short: "SPV", purpose: "Speaker-facing" },
  "stage-display": { label: "Stage display", short: "DSP", purpose: "Speaker-facing" },
};

/**
 * How a message to the speaker stands out on the stage display, calmest first.
 * Each tone maps to a fixed pair of event-kit colors with readable contrast.
 */
export const LIVE_SPEAKER_MESSAGE_TONES = ["neutral", "info", "warning", "urgent"] as const;
export type LiveSpeakerMessageTone = (typeof LIVE_SPEAKER_MESSAGE_TONES)[number];
export const LIVE_SPEAKER_MESSAGE_TONE_LABELS: Record<LiveSpeakerMessageTone, string> = {
  neutral: "Neutral",
  info: "Info",
  warning: "Warning",
  urgent: "Urgent",
};

/** Ready-made messages to the speaker, shown on the stage display, each in the tone it usually needs. */
export const LIVE_SPEAKER_MESSAGE_PRESETS: ReadonlyArray<{ text: string; tone: LiveSpeakerMessageTone }> = [
  { text: "5 minutes left", tone: "info" },
  { text: "Please wrap up", tone: "warning" },
  { text: "Time for questions", tone: "info" },
  { text: "Please use the microphone", tone: "urgent" },
];

export const LIVE_SPEAKER_MESSAGE_MAX_LENGTH = 120;

/**
 * How large the stage display sets a message: full size while it fits on one
 * line, one step smaller when longer, and the smallest readable size beyond
 * that, where it wraps to at most three lines. Character counts stand in for
 * measuring, so the room, the monitors and the browser source agree.
 */
export type LiveSpeakerMessageFit = "regular" | "long" | "longer";
export function liveSpeakerMessageFit(text: string): LiveSpeakerMessageFit {
  const length = [...text.trim()].length;
  return length <= 32 ? "regular" : length <= 64 ? "long" : "longer";
}

/** Time left below which the control room warns that the session is ending. */
export const LIVE_TIME_WARNING_MS = 2 * 60_000;
