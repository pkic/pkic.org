/**
 * What an output shows: one composition, the same for Program and every
 * auxiliary output such as the projector or the stage display.
 */
import { z } from "zod";
import { liveQuestionAddresseeSchema } from "./live-session-question";
import { liveScheduleProjectionSchema } from "./live-session-schedule";
import { liveTickerSchema } from "./live-session-ticker";
import { livePollPresentationSchema, DEFAULT_LIVE_POLL_PRESENTATION } from "./live-session-poll";
import { liveCreditSchema } from "./live-session-credit";
import { publicSessionPortraitUrlSchema } from "./event-session-history";
import { liveAuthorAffiliationSchema } from "./live-session-author";
import { databaseIdSchema } from "./identifiers";
import { liveRoomOutputKeySchema } from "./live-room-output-setup";
import { liveChangeSchema, livePersonNameSchema } from "./live-session-change";
import { liveChatFeedOnAirSchema, liveTopQuestionsOnAirSchema } from "./live-session-on-screen";
import { liveTimerGraphicsSchema } from "./live-session-timer";
import { DEFAULT_LIVE_LOWER_THIRD_MOTION } from "../live-lower-third";
import {
  liveCheckInOnAirSchema,
  liveLowerThirdMotionSchema,
  liveReactionsGraphicSchema,
  DEFAULT_LIVE_REACTIONS_GRAPHIC,
} from "./live-session-graphic-settings";
import { liveOverlayLayoutSlugSchema } from "./live-overlay-layout";

export const livePanelistsSchema = z.object({ layout: z.enum(["panel", "list", "columns"]) }).strict();
export type LivePanelists = z.infer<typeof livePanelistsSchema>;
export const livePanelistsCommandSchema = z
  .object({ type: z.literal("stage.panelists"), panelists: livePanelistsSchema.nullable() })
  .strict();

/** A question as an output shows it; an anonymous author stays anonymous, photo and organization included. */
export const liveStageQuestionSchema = z
  .object({
    id: databaseIdSchema,
    text: z.string().min(1),
    authorName: livePersonNameSchema.nullable(),
    /** Shown beside the question only when the author asked by name and has a profile photo. */
    authorPhotoUrl: publicSessionPortraitUrlSchema.nullable().default(null),
    /** The capacity the author asked in, frozen with the question; null when anonymous or unaffiliated. */
    authorAffiliation: liveAuthorAffiliationSchema.nullable().default(null),
    /** The credited person the question is for, so an output can name them from the session's credits. */
    addressedTo: liveQuestionAddresseeSchema.default(null),
  })
  .strict();
export type LiveStageQuestion = z.infer<typeof liveStageQuestionSchema>;

export const liveStageSchema = z
  .object({
    question: liveStageQuestionSchema.nullable(),
    questionChange: liveChangeSchema.nullable(),
    ticker: liveTickerSchema.nullable().default(null),
    panelists: livePanelistsSchema.nullable().default(null),
    schedule: liveScheduleProjectionSchema.nullable().default(null),
    /** The attendee check-in code the output shows, resolved and signed by the room. */
    checkIn: liveCheckInOnAirSchema.nullable().default(null),
    lowerThird: liveCreditSchema.nullable(),
    lowerThirdChange: liveChangeSchema.nullable(),
    lowerThirdMotion: liveLowerThirdMotionSchema.default(DEFAULT_LIVE_LOWER_THIRD_MOTION),
    /** The poll whose results the broadcast shows; the poll itself travels in the room's poll list. */
    poll: z
      .object({
        id: databaseIdSchema,
        presentation: livePollPresentationSchema.default(DEFAULT_LIVE_POLL_PRESENTATION),
      })
      .strict()
      .nullable(),
    pollChange: liveChangeSchema.nullable(),
    /** The timer graphic: which of the room's timers, and how it looks. */
    timerGraphics: liveTimerGraphicsSchema.default([]),
    /** The open questions with the most votes, as the room last filled them. */
    topQuestions: liveTopQuestionsOnAirSchema.nullable().default(null),
    /** The latest attendee chat the broadcast may show, as the room last filled it. */
    chatFeed: liveChatFeedOnAirSchema.nullable().default(null),
    /** Viewers' reactions float up over the output while this is on. */
    reactions: z.boolean().default(false),
    reactionsGraphic: liveReactionsGraphicSchema.default(DEFAULT_LIVE_REACTIONS_GRAPHIC),
    /**
     * The scene the output draws its graphics in; null for the event's default.
     * A Take carries it, so Program shows exactly what Preview did.
     */
    scene: liveOverlayLayoutSlugSchema.nullable().default(null),
  })
  .strict();
export type LiveStage = z.infer<typeof liveStageSchema>;

/** A composition with nothing on it: how Program and every auxiliary output start. */
export const EMPTY_LIVE_STAGE: LiveStage = {
  schedule: null,
  panelists: null,
  checkIn: null,
  ticker: null,
  question: null,
  questionChange: null,
  lowerThird: null,
  lowerThirdChange: null,
  lowerThirdMotion: DEFAULT_LIVE_LOWER_THIRD_MOTION,
  poll: null,
  pollChange: null,
  timerGraphics: [],
  topQuestions: null,
  chatFeed: null,
  reactions: false,
  reactionsGraphic: DEFAULT_LIVE_REACTIONS_GRAPHIC,
  scene: null,
};

/** One of the room's outputs besides Program, by its key. */
export const liveAuxOutputSchema = z.union([liveRoomOutputKeySchema, z.literal("stage-preview")]);
/** An auxiliary output, like the shared Preview, holds the same kind of composition as Program. */
export const liveAuxCompositionSchema = liveStageSchema;
export type LiveAuxComposition = LiveStage;
export const EMPTY_LIVE_AUX_COMPOSITION: LiveAuxComposition = EMPTY_LIVE_STAGE;
/** At most every output a room sets up, the ones it always holds, and a few it removed since. */
export const LIVE_HELD_OUTPUTS_MAX = 16;
/** Each output's composition by key; an output nobody composed yet is missing and shows nothing. */
export const liveOutputsSchema = z
  .record(liveAuxOutputSchema, liveAuxCompositionSchema)
  .refine((outputs) => Object.keys(outputs).length <= LIVE_HELD_OUTPUTS_MAX, "Too many outputs.");
export type LiveOutputs = z.infer<typeof liveOutputsSchema>;
export const EMPTY_LIVE_OUTPUTS: LiveOutputs = {};
/** The composition an output holds now; one nobody composed yet shows nothing. */
export function liveOutputComposition(outputs: LiveOutputs, output: string): LiveAuxComposition {
  return outputs[output] ?? EMPTY_LIVE_AUX_COMPOSITION;
}
