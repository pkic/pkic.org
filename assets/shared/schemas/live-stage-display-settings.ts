import { z } from "zod";

/**
 * How the stage display behaves for one session, set from the studio: whether
 * it shows the audience's reactions as they arrive, and when it tells the
 * speaker the session is near its end, with questions or a wrap-up. The room
 * keeps one copy and sends it to every output that draws the stage display.
 */

/** The choices the studio offers for the near-end cue, in seconds before the session ends; zero turns it off. */
export const LIVE_STAGE_NEAR_END_CHOICES = [0, 120, 300, 600] as const;

export const liveStageDisplaySettingsSchema = z
  .object({
    /** Reactions show in the top row while they arrive. */
    reactions: z.boolean(),
    /** How long before the session ends the stage display cues its end and names what is next; zero is never. */
    nearEndSeconds: z.number().int().min(0).max(3600),
    /** The cue says "Questions now" when the session ends with questions, else "Wrap up". */
    endsWithQuestions: z.boolean(),
  })
  .strict();
export type LiveStageDisplaySettings = z.infer<typeof liveStageDisplaySettingsSchema>;

export const DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS: LiveStageDisplaySettings = {
  reactions: true,
  nearEndSeconds: 300,
  endsWithQuestions: true,
};

/** The room snapshot's copy: what the stage display does for this session, the defaults until an operator changes them. */
export const liveStageDisplaySettingsSnapshotSchema = liveStageDisplaySettingsSchema.default(
  DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS,
);

export const liveStageDisplaySettingsCommandSchema = z
  .object({ type: z.literal("stage.display.settings"), settings: liveStageDisplaySettingsSchema })
  .strict();

export const liveStageDisplaySettingsChangedSchema = z
  .object({ type: z.literal("stage.display.settings.changed"), settings: liveStageDisplaySettingsSchema })
  .strict();
