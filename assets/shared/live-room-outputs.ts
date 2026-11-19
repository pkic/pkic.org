import { LIVE_OVERLAY_DEFAULT_LAYOUT } from "./schemas/live-overlay-layout";
import {
  DEFAULT_LIVE_ROOM_OUTPUTS,
  LIVE_SPEAKER_OUTPUT_KEY,
  type LiveRoomOutput,
  type LiveRoomOutputRole,
} from "./schemas/live-room-output-setup";

/**
 * The outputs a live room composes. Program (PGM) is the broadcast the room
 * puts on air; each auxiliary (AUX) output is a separate composition for a
 * screen in the physical room. The room, the overlay pages and the control
 * room read the outputs, their names and their purpose from here.
 */

/**
 * The outputs every room holds a composition for, whether or not it lists
 * them: the projector and the speaker's screen it always had, and the stage
 * preview, the speaker screen's lineup. A screen can always show one.
 */
export const LIVE_AUX_OUTPUTS = ["projector", "stage-preview", LIVE_SPEAKER_OUTPUT_KEY] as const;
/** One of the room's outputs besides Program, by its key: one it sets up, or one it always holds. */
export type LiveAuxOutput = string;
export const LIVE_STAGE_PREVIEW_OUTPUT = "stage-preview";

export const LIVE_AUX_OUTPUT_DETAILS: Record<(typeof LIVE_AUX_OUTPUTS)[number], LiveOutputDetails> = {
  projector: { label: "Projector", short: "PRJ", purpose: "Room screen" },
  "stage-preview": { label: "Stage preview", short: "SPV", purpose: "Speaker-facing" },
  "stage-display": { label: "Stage display", short: "DSP", purpose: "Speaker-facing" },
};

export type LiveOutputDetails = { label: string; short: string; purpose: string };

/** The room's outputs as it set them up, or the ones it always had. */
export function liveRoomOutputs(session: { roomOutputs?: readonly LiveRoomOutput[] } | null | undefined) {
  return session?.roomOutputs ?? DEFAULT_LIVE_ROOM_OUTPUTS;
}

/** Each role as the room's settings and the studio say it: its name, and what a screen in it shows. */
export const LIVE_ROOM_OUTPUT_ROLE_COPY: Record<LiveRoomOutputRole, { label: string; shows: string; hint: string }> = {
  exact: {
    label: "Exact",
    shows: "Shows what you take to it",
    hint: "Nothing from Program appears on it.",
  },
  follow: {
    label: "Follow Program",
    shows: "Shows what is on Program, in its own scene",
    hint: "Its scene decides which graphics show, lower third and ticker included. A take changes its scene only.",
  },
  speaker: {
    label: "Speaker",
    shows: "Time, next question, messages",
    hint: "For the speaker on stage. One per room.",
  },
};

/** Where Program's scene comes from: whatever is taken to it from Preview. */
export const LIVE_ROOM_OUTPUT_SCENE_TAKEN = "From Preview";
/** The speaker's screen draws its own layout, not a scene. */
export const LIVE_SPEAKER_SCENE = "Fixed";

/** A screen's scene as its room set it up: "Always Break" for a locked one, "Starts in Default" otherwise. */
export function liveOutputSceneLabel(
  output: Pick<LiveRoomOutput, "role" | "scene" | "sceneLocked">,
  scenes: ReadonlyArray<{ slug: string; name: string }>,
): string {
  if (output.role === "speaker") return LIVE_SPEAKER_SCENE;
  const slug = output.scene ?? LIVE_OVERLAY_DEFAULT_LAYOUT;
  const name = scenes.find((scene) => scene.slug === slug)?.name ?? slug;
  return output.sceneLocked ? `Always ${name}` : `Starts in ${name}`;
}

/** The scene a locked screen always draws; null for a screen that draws the scene last taken to it. */
export function liveOutputFixedScene(outputs: readonly LiveRoomOutput[], key: LiveAuxOutput): string | null {
  const output = outputs.find((entry) => entry.key === key);
  return output?.sceneLocked ? (output.scene ?? LIVE_OVERLAY_DEFAULT_LAYOUT) : null;
}

/** An output's name, code and purpose; an output the room no longer lists keeps its built-in name. */
export function liveOutputDetails(outputs: readonly LiveRoomOutput[], key: LiveAuxOutput): LiveOutputDetails {
  const output = outputs.find((entry) => entry.key === key);
  if (output) return { label: output.name, short: output.code, purpose: LIVE_ROOM_OUTPUT_ROLE_COPY[output.role].shows };
  return (
    (LIVE_AUX_OUTPUT_DETAILS as Record<string, LiveOutputDetails>)[key] ?? {
      label: key,
      short: key.slice(0, 5).toUpperCase(),
      purpose: "",
    }
  );
}

/** What an output shows; the stage preview, the speaker screen's own lineup, has no role of its own. */
export function liveOutputRole(outputs: readonly LiveRoomOutput[], key: LiveAuxOutput): LiveRoomOutputRole | null {
  if (key === LIVE_STAGE_PREVIEW_OUTPUT) return null;
  const output = outputs.find((entry) => entry.key === key);
  if (output) return output.role;
  return key === LIVE_SPEAKER_OUTPUT_KEY ? "speaker" : "follow";
}

/**
 * Where the studio's Transition puts Preview: Program, then each of the
 * room's screens in order. A screen that follows Program takes only
 * Preview's scene, and keeps showing Program's graphics in it.
 */
export type LiveTakeTarget = "program" | LiveAuxOutput;
export function liveTakeTargets(outputs: readonly LiveRoomOutput[]): LiveTakeTarget[] {
  return ["program", ...outputs.map((output) => output.key)];
}

/** The outputs the studio sends graphics to: every one the room lists. */
export function liveStudioOutputs(outputs: readonly LiveRoomOutput[]): LiveAuxOutput[] {
  return outputs.map((output) => output.key);
}

/** How many tally tones the outputs take in turn, after Program and Preview. */
/** The speaker's screen keeps the stage display's amber in every room. */
const SPEAKER_TONE = 2;
/** The tones the room's other outputs take in their order; the first is the projector's blue. */
const OUTPUT_TONES = [1, 3, 4, 5, 6] as const;
/**
 * The tally tone an output takes, so each output in a room reads by color
 * alone: the speaker's screen always amber, every other one by its place
 * among the rest. The stage preview shares the speaker screen's.
 */
export function liveOutputTone(outputs: readonly LiveRoomOutput[], key: LiveAuxOutput): number | null {
  const lookup = key === LIVE_STAGE_PREVIEW_OUTPUT ? LIVE_SPEAKER_OUTPUT_KEY : key;
  const output = outputs.find((entry) => entry.key === lookup);
  if (!output) return null;
  if (output.role === "speaker") return SPEAKER_TONE;
  const index = outputs.filter((entry) => entry.role !== "speaker").indexOf(output);
  return OUTPUT_TONES[index % OUTPUT_TONES.length]!;
}

/** The broadcast the room puts on air, as the studio and the room's screens name it. */
export const LIVE_PROGRAM_OUTPUT_DETAILS = { label: "Program", short: "PGM", purpose: "What is on air" } as const;
/** The operators' shared Preview: the next composition, which a Transition puts on Program. */
export const LIVE_PREVIEW_OUTPUT_DETAILS = { label: "Preview", short: "PVW", purpose: "The next composition" } as const;
/** The room's live stream, as online viewers see it. It is a stream, not an overlay composition. */
export const LIVE_LIVESTREAM_OUTPUT_DETAILS = {
  label: "Livestream",
  short: "LIVE",
  purpose: "What online viewers see",
} as const;

/**
 * What a screen can show: one of its room's overlay outputs, or the room's
 * livestream full screen. Overlay outputs come first, in the order an
 * operator meets them.
 */
export const LIVE_SCREEN_OUTPUTS = ["program", ...LIVE_AUX_OUTPUTS, "livestream"] as const;
export type LiveScreenOutput = (typeof LIVE_SCREEN_OUTPUTS)[number];
export const LIVE_SCREEN_OUTPUT_DETAILS: Record<LiveScreenOutput, { label: string; short: string; purpose: string }> = {
  program: LIVE_PROGRAM_OUTPUT_DETAILS,
  ...LIVE_AUX_OUTPUT_DETAILS,
  livestream: LIVE_LIVESTREAM_OUTPUT_DETAILS,
};
/** A screen output drawn by the overlay page, so it takes a layout; the livestream does not. */
export function screenOutputUsesOverlay(output: LiveScreenOutput): boolean {
  return output !== "livestream";
}

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
