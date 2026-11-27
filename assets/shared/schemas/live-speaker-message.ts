import { z } from "zod";
import { LIVE_SPEAKER_MESSAGE_MAX_LENGTH, LIVE_SPEAKER_MESSAGE_TONES } from "../live-room-outputs";
import { liveChangeSchema } from "./live-session-change";

/** A short message an operator shows the speaker on the stage display. */
export const liveSpeakerMessageTextSchema = z
  .string()
  .trim()
  .min(1, "Write a message for the speaker.")
  .max(LIVE_SPEAKER_MESSAGE_MAX_LENGTH, `Keep the message under ${LIVE_SPEAKER_MESSAGE_MAX_LENGTH} characters.`);
export const liveSpeakerMessageToneSchema = z.enum(LIVE_SPEAKER_MESSAGE_TONES);
export const liveSpeakerMessageSchema = z
  .object({
    text: liveSpeakerMessageTextSchema,
    tone: liveSpeakerMessageToneSchema.default("neutral"),
    /** The stage display pulses the message until an operator stops it, to catch the speaker's eye. */
    flash: z.boolean().default(false),
    change: liveChangeSchema.nullable(),
  })
  .strict();
export type LiveSpeakerMessage = z.infer<typeof liveSpeakerMessageSchema>;
/** The message editor's contract. */
export const liveSpeakerMessageInputSchema = z
  .object({ text: liveSpeakerMessageTextSchema, tone: liveSpeakerMessageToneSchema, flash: z.boolean() })
  .strict();
