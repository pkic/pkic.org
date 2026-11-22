import { liveLocationChatSnapshotFields } from "./live-location-chat";
import {
  liveQuestionSchema,
  liveQuestionAskSchema,
  liveQuestionRewriteSchema,
  liveQuestionEditSchema,
  liveQuestionWithdrawSchema,
  liveQuestionModerateSchema,
} from "./live-session-question";
import {
  liveModerationClientMessageSchemas,
  liveModerationServerMessageSchemas,
  liveParticipationRestrictionSchema,
} from "./live-session-moderation";
export {
  liveQuestionSchema,
  liveQuestionStatusSchema,
  liveQuestionAskSchema,
  liveQuestionRewriteSchema,
  liveQuestionEditSchema,
  liveQuestionWithdrawSchema,
  type LiveQuestion,
} from "./live-session-question";
import {
  liveQuestionAnswerClientMessageSchemas,
  liveQuestionAnswersSchema,
  liveQuestionAnswerResultSchema,
} from "./live-session-answer";
import { liveScheduleConfigSchema, liveScheduleCommandSchema } from "./live-session-schedule";
import { liveTickerConfigSchema, liveTickerContextSchema, DEFAULT_LIVE_TICKER_CONTEXT } from "./live-session-ticker";
import { livePollPresentationSchema } from "./live-session-poll";
import {
  liveAddedCreditInputSchema,
  liveAddedCreditsSchema,
  liveCreditFieldsSchema,
  liveCreditSchema,
  liveTypedCreditInputSchema,
} from "./live-session-credit";
import { liveOverlayLayoutGeometriesSchema, liveOverlayLayoutSlugSchema } from "./live-overlay-layout";
import { z } from "zod";
import { liveAuthorClientMessageSchemas, liveAuthorServerMessageSchemas } from "./live-session-author";
import { liveChatClientMessageSchemas, liveChatServerMessageSchemas } from "./live-session-chat";
import { databaseIdSchema } from "./identifiers";
import { liveRoomOutputKeySchema, liveRoomOutputsSchema } from "./live-room-output-setup";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { LIVE_ROOM_POLICY, LIVE_STAGE_VIEWS } from "../live-session-policy";
import { liveChangeSchema, livePersonNameSchema } from "./live-session-change";
import { liveReactionBurstSchema, liveReactionCountsSchema, liveReactionSendSchema } from "./live-session-reaction";
import { liveChatFeedConfigSchema, liveTopQuestionsConfigSchema } from "./live-session-on-screen";
import { LIVE_SPEAKER_MESSAGE_MAX_LENGTH, LIVE_SPEAKER_MESSAGE_TONES } from "../live-room-outputs";
import { livePollClientMessageSchemas, livePollSchema, livePollServerMessageSchemas } from "./live-session-poll";
import {
  livePreparedQuestionClientMessageSchemas,
  livePreparedQuestionServerMessageSchemas,
  livePreparedQuestionWindowSchema,
  livePreparedQuestionsSchema,
} from "./live-session-prepared-question";
import {
  liveTimerCommandSchemas,
  liveTimerGraphicsSchema,
  liveTimersChangedSchema,
  liveTimersSchema,
} from "./live-session-timer";
import { attendancePointSelectionSchema } from "../attendance-points";
import * as stageDisplaySettings from "./live-stage-display-settings";
import * as screenSync from "./live-screen-sync";
import * as roomOpening from "./live-room-opening";
import * as roomSources from "./live-room-sources";
import { LIVE_GRAPHIC_THEME_DEFAULTS, liveGraphicThemeSchema } from "../live-graphic-theme";
import { DEFAULT_LIVE_LOWER_THIRD_MOTION } from "../live-lower-third";
import {
  liveLowerThirdMotionSchema,
  liveCheckInTextSchema,
  liveReactionsGraphicSchema,
  DEFAULT_LIVE_CHECK_IN_TEXT,
  DEFAULT_LIVE_REACTIONS_GRAPHIC,
} from "./live-session-graphic-settings";
export {
  liveCheckInChoiceSchema,
  liveCheckInOnAirSchema,
  liveLowerThirdMotionSchema,
  type LiveCheckInChoice,
  type LiveCheckInOnAir,
} from "./live-session-graphic-settings";

export { liveChangeSchema } from "./live-session-change";

/**
 * The live session room protocol. Every message on the socket, in either
 * direction, is one of the discriminated unions below; the room and both
 * browser surfaces parse with these schemas and nothing else.
 */

/** The subprotocol a client offers and the room accepts. */
export const LIVE_ROOM_PROTOCOL = "pkic-live.v1";
/** An overlay offers its access token as a second subprotocol, so it never appears in a URL or log. */
export const LIVE_OVERLAY_PROTOCOL_PREFIX = "pkic-overlay.";

/**
 * A browser never sees the status of a refused WebSocket handshake, only a
 * bare close. So a room that cannot admit a socket (no such session, no
 * access) accepts it and closes it at once with `4000 + the 4xx status` and
 * the error code as the close reason; the page then says what failed and does
 * not retry. A fault on our side closes the same way with 4500 and a
 * reference the server logged the fault under, so the page tells it apart
 * from a lost connection, says so with the reference, and still retries.
 */
const LIVE_ROOM_REFUSAL_CLOSE_BASE = 4000;
/** The close code of a socket the room could not serve because of a fault on our side. */
export const LIVE_ROOM_FAULT_CLOSE_CODE = 4500;

export function liveRoomRefusalCloseCode(status: number): number {
  return LIVE_ROOM_REFUSAL_CLOSE_BASE + status;
}

/** The error code of a refused admission, or null for any other close. */
export function liveRoomRefusalFromClose(code: number, reason: string): string | null {
  if (!(code >= LIVE_ROOM_REFUSAL_CLOSE_BASE + 400 && code <= LIVE_ROOM_REFUSAL_CLOSE_BASE + 499)) return null;
  return reason || "LIVE_ROOM_REFUSED";
}

/** The reference of a fault on our side, or null for any other close. */
export function liveRoomFaultFromClose(code: number, reason: string): string | null {
  return code === LIVE_ROOM_FAULT_CLOSE_CODE ? reason || "unknown" : null;
}

export const liveRoomParamsSchema = eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema });

export const liveRoomRoleSchema = z.enum(["attendee", "speaker", "operator", "overlay"]);
/** The outputs a browser source can show; which of an output's elements it draws, and where, is its layout's. */
export const liveOverlayViewSchema = z.union([
  z.literal("program"),
  liveRoomOutputKeySchema,
  z.literal("stage-preview"),
]);
export type LiveOverlayView = z.infer<typeof liveOverlayViewSchema>;
/**
 * The live room socket's query. A broadcast source names the output it draws,
 * so the room sends the speaker-facing stage display what only it may show.
 */
export const liveRoomSocketQuerySchema = z.object({ output: liveOverlayViewSchema.optional() }).strict();
/** The parts of the broadcast an operator lines up and puts on air. */
export const liveStageViewSchema = z.enum(LIVE_STAGE_VIEWS);

/** Whether the room's graphics go straight to the stream, or through the production switcher's own scenes. */
export const liveOverlayModeSchema = z.enum(["direct", "switcher"]);
export type LiveOverlayMode = z.infer<typeof liveOverlayModeSchema>;
export {
  liveChatChannelSchema,
  liveChatMessageSchema,
  liveChatSendSchema,
  liveChatEditSchema,
  liveChatReportSchema,
  liveChatReactionSchema,
  type LiveChatMessage,
  type LiveChatChannel,
  type LiveChatModeration,
  type LiveChatReplyQuote,
} from "./live-session-chat";

export {
  liveAddedCreditInputSchema,
  liveAddedCreditsSchema,
  liveCreditFieldsSchema,
  liveCreditIdentitySchema,
  liveCreditSchema,
  liveTypedCreditInputSchema,
  type LiveAddedCreditInput,
  type LiveCredit,
  type LiveCreditIdentity,
  type LiveTypedCreditInput,
} from "./live-session-credit";

export {
  liveTickerConfigSchema,
  liveTickerSchema,
  type LiveTickerConfig,
  type LiveTicker,
  liveTickerContextSchema,
  DEFAULT_LIVE_TICKER_CONTEXT,
  type LiveTickerContext,
} from "./live-session-ticker";
export const liveTickerCommandSchema = z
  .object({ type: z.literal("stage.ticker"), ticker: liveTickerConfigSchema.nullable() })
  .strict();
export {
  livePanelistsSchema,
  livePanelistsCommandSchema,
  liveStageQuestionSchema,
  liveStageSchema,
  EMPTY_LIVE_STAGE,
  liveAuxOutputSchema,
  liveAuxCompositionSchema,
  EMPTY_LIVE_AUX_COMPOSITION,
  liveOutputsSchema,
  EMPTY_LIVE_OUTPUTS,
  liveOutputComposition,
  type LivePanelists,
  type LiveStageQuestion,
  type LiveStage,
  type LiveAuxComposition,
  type LiveOutputs,
} from "./live-session-stage";
import {
  livePanelistsCommandSchema,
  livePanelistsSchema,
  liveStageQuestionSchema,
  liveStageSchema,
  EMPTY_LIVE_AUX_COMPOSITION,
  liveAuxOutputSchema,
  liveAuxCompositionSchema,
  liveOutputsSchema,
  EMPTY_LIVE_OUTPUTS,
} from "./live-session-stage";

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

/** A cleared Program the room keeps for an Undo, named so any operator can restore exactly that one. */
export const liveProgramSnapshotIdSchema = z.uuid();

/** What the operators lined up next for each part of the broadcast, first item first. */
export const liveQueueSchema = z
  .object({
    question: z.array(databaseIdSchema).max(LIVE_ROOM_POLICY.queueMaxLength),
    "lower-third": z.array(liveCreditFieldsSchema.shape.key).max(LIVE_ROOM_POLICY.queueMaxLength),
    poll: z.array(databaseIdSchema).max(LIVE_ROOM_POLICY.queueMaxLength),
    change: liveChangeSchema.nullable(),
  })
  .strict();
export type LiveQueue = z.infer<typeof liveQueueSchema>;

/** An operator connected to the control desk right now, with how many desks they have open. */
export const liveOperatorPresenceSchema = z
  .object({ name: livePersonNameSchema, connections: z.number().int().positive() })
  .strict();

export {
  liveTimerSchema,
  liveTimerGraphicsSchema,
  liveTimerDraftSchema,
  liveTimerAddSchema,
  type LiveTimer,
  type LiveTimerGraphic,
  type LiveTimerDraft,
} from "./live-session-timer";

export const liveRoomSessionSchema = z
  .object({
    occurrenceId: databaseIdSchema,
    title: z.string().min(1),
    /** The event the session belongs to; a room admitted before this field reads without it. */
    eventName: z.string().min(1).optional(),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    timeZone: z.string().min(1),
    /** The location the session takes place in, whose chat it shows on air; a room admitted before this field has none. */
    roomId: databaseIdSchema.nullable().optional(),
    credits: z.array(liveCreditSchema).max(50),
    /** The session's abstract as plain text, cut to fit a board; null when it has none, absent for a room admitted before it. */
    abstract: z.string().min(1).max(LIVE_ROOM_POLICY.sessionAbstractMaxLength).nullable().optional(),
    /** The outputs its physical room sets up beside Program; a room admitted before this field reads the built-in ones. */
    roomOutputs: liveRoomOutputsSchema.optional(),
  })
  .strict();
export type LiveRoomSession = z.infer<typeof liveRoomSessionSchema>;

export const liveRoomViewerSchema = z
  .object({
    role: liveRoomRoleSchema,
    name: livePersonNameSchema.nullable(),
    /** An operator who also organizes the event; the moderation policy lets them block for the event. */
    organizer: z.boolean().optional(),
    /** This viewer's own block from posting, voting and reacting; null while they may take part. */
    participation: liveParticipationRestrictionSchema.nullable().optional(),
  })
  .strict();

export {
  livePresenceFocusSchema,
  livePresencePointerSchema,
  livePresenceSchema,
  livePresenceUpdateSchema,
  type LivePresence,
  type LivePresenceFocus,
  type LivePresencePointer,
  type LivePresenceUpdate,
} from "./live-session-presence";
import { livePresenceSchema, livePresenceUpdateSchema } from "./live-session-presence";

const operatorsSchema = z.array(liveOperatorPresenceSchema).max(100);

// ── Room → client ───────────────────────────────────────────────────────────

export const liveRoomSnapshotSchema = z
  .object({
    type: z.literal("room.snapshot"),
    session: liveRoomSessionSchema,
    viewer: liveRoomViewerSchema,
    /** Ordered by votes, newest first on a tie; omitted for overlays. */
    questions: z.array(liveQuestionSchema).max(LIVE_ROOM_POLICY.maxQuestionsPerRoom),
    /** In the order they were prepared; drafts for operators only, the poll on air only for overlays. */
    polls: z.array(livePollSchema),
    /** Questions waiting for their release moment, soonest first; operators only, empty for everyone else. */
    preparedQuestions: livePreparedQuestionsSchema.default([]),
    /** The span prepared questions are released in; operators only, null for everyone else. */
    preparedQuestionWindow: livePreparedQuestionWindowSchema.nullable().default(null),
    overlayMode: liveOverlayModeSchema.default("direct"),
    /** The event's saved overlay layouts; a browser source draws the one it names, else a built-in one. */
    overlayLayouts: liveOverlayLayoutGeometriesSchema.default([]),
    tickerContext: liveTickerContextSchema.default(DEFAULT_LIVE_TICKER_CONTEXT),
    stage: liveStageSchema,
    /** Operators, speakers and overlays only; empty for attendees. */
    outputs: liveOutputsSchema.default(EMPTY_LIVE_OUTPUTS),
    /** Operators, speakers and overlays only; null for attendees. */
    speakerMessage: liveSpeakerMessageSchema.nullable().default(null),
    /** The operators' one shared Preview (PVW); operators only, empty for everyone else. */
    preview: liveAuxCompositionSchema.default(EMPTY_LIVE_AUX_COMPOSITION),
    /** The room's timers, the session's first. */
    timers: liveTimersSchema,
    reactionTotals: liveReactionCountsSchema,
    /** Operators only; empty for everyone else. */
    queue: liveQueueSchema,
    /** Operators only; empty for everyone else. */
    operators: operatorsSchema,
    /** People operators added to this session's lower thirds; operators only, empty for everyone else. */
    addedCredits: liveAddedCreditsSchema.default([]),
    /**
     * The question lined up in Preview, which the stage display shows the
     * speaker as the next one. Operators and stage display sources only; null
     * for everyone else, so Preview never reaches an audience output.
     */
    stageDisplayNext: liveStageQuestionSchema.nullable().default(null),
    /** The votes of the question lined up next, so a stage display source shows them without the question list. */
    stageDisplayNextVotes: stageDisplaySettings.liveStageDisplayVotesSchema.default(null),
    stageDisplaySettings: stageDisplaySettings.liveStageDisplaySettingsSnapshotSchema,
    /** Whether the projector and the stage display follow Program. */
    screenSync: screenSync.liveScreenSyncSnapshotSchema,
    /** Whether attendees take part on schedule, or because an operator opened or closed the room. */
    opening: roomOpening.liveRoomOpeningSnapshotSchema,
    movedOn: roomOpening.liveRoomMovedOnSnapshotSchema,
    /** How many sources draw each output now; operators only, zeros for everyone else. */
    sources: roomSources.liveRoomSourcesSnapshotSchema,
  })
  .strict();
export type LiveRoomSnapshot = z.infer<typeof liveRoomSnapshotSchema>;

/** What a viewer receives on joining a location's chat, which speaks this protocol's chat and moderation. */
export const liveLocationChatSnapshotSchema = z
  .object({
    type: z.literal("location.chat.snapshot"),
    viewer: liveRoomViewerSchema,
    ...liveLocationChatSnapshotFields,
  })
  .strict();
export type LiveLocationChatSnapshot = z.infer<typeof liveLocationChatSnapshotSchema>;

export const liveRoomServerMessageSchema = z.discriminatedUnion("type", [
  liveRoomSnapshotSchema,
  liveLocationChatSnapshotSchema,
  liveQuestionAnswersSchema,
  liveQuestionAnswerResultSchema,
  z.object({ type: z.literal("question.changed"), question: liveQuestionSchema }).strict(),
  z
    .object({
      type: z.literal("question.updated"),
      operationId: z.uuid(),
      questionId: databaseIdSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal("question.accepted"), operationId: z.uuid(), questionId: databaseIdSchema }).strict(),
  z.object({ type: z.literal("question.removed"), questionId: databaseIdSchema }).strict(),
  ...livePollServerMessageSchemas,
  ...livePreparedQuestionServerMessageSchemas,
  z.object({ type: z.literal("stage.changed"), stage: liveStageSchema }).strict(),
  z
    .object({ type: z.literal("aux.changed"), output: liveAuxOutputSchema, composition: liveAuxCompositionSchema })
    .strict(),
  z
    .object({ type: z.literal("speaker.message.changed"), speakerMessage: liveSpeakerMessageSchema.nullable() })
    .strict(),
  z.object({ type: z.literal("queue.changed"), queue: liveQueueSchema }).strict(),
  z.object({ type: z.literal("operators.changed"), operators: operatorsSchema }).strict(),
  /** Operators only: someone was added to or removed from this session's lower thirds. */
  z.object({ type: z.literal("credits.added.changed"), addedCredits: liveAddedCreditsSchema }).strict(),
  /** Operators only: the shared Preview changed. */
  z.object({ type: z.literal("preview.changed"), composition: liveAuxCompositionSchema }).strict(),
  /** Operators only, never stored: another operator moved. */
  z.object({ type: z.literal("presence.changed"), presence: livePresenceSchema }).strict(),
  z.object({ type: z.literal("presence.left"), id: livePresenceSchema.shape.id }).strict(),
  liveTimersChangedSchema,
  z.object({ type: z.literal("overlay.mode.changed"), mode: liveOverlayModeSchema }).strict(),
  stageDisplaySettings.liveStageDisplayNextChangedSchema(liveStageQuestionSchema),
  stageDisplaySettings.liveStageDisplaySettingsChangedSchema,
  screenSync.liveScreenSyncChangedSchema,
  roomOpening.liveRoomOpeningChangedSchema,
  roomOpening.liveRoomMovedOnChangedSchema,
  /** Operators only: a source of one of the room's outputs connected or dropped. */
  roomSources.liveRoomSourcesChangedSchema,
  /** Operators only: Program was cleared, and this snapshot restores it. */
  z
    .object({
      type: z.literal("program.cleared"),
      snapshotId: liveProgramSnapshotIdSchema,
      change: liveChangeSchema,
    })
    .strict(),
  z.object({ type: z.literal("overlay.layouts.changed"), layouts: liveOverlayLayoutGeometriesSchema }).strict(),
  z.object({ type: z.literal("ticker.context.changed"), context: liveTickerContextSchema }).strict(),
  ...liveChatServerMessageSchemas,
  ...liveModerationServerMessageSchemas,
  ...liveAuthorServerMessageSchemas,
  liveReactionBurstSchema,
  /** A refused action; the socket stays open. */
  z
    .object({
      type: z.literal("room.refused"),
      code: z.string().min(1).max(80),
      message: z.string().min(1),
      operationId: z.uuid().optional(),
    })
    .strict(),
]);
export type LiveRoomServerMessage = z.infer<typeof liveRoomServerMessageSchema>;

// ── Client → room ───────────────────────────────────────────────────────────

/** A question id, a poll id or a credit key, depending on the lineup it belongs to. */
const queueItemSchema = z.string().min(1).max(80);

/** One complete composition of graphics, for Program or an auxiliary output. */
export const liveCompositionInputSchema = z
  .object({
    questionId: databaseIdSchema.nullable(),
    creditKey: liveCreditFieldsSchema.shape.key.nullable(),
    pollId: databaseIdSchema.nullable(),
    pollPresentation: livePollPresentationSchema,
    ticker: liveTickerConfigSchema.nullable(),
    panelists: livePanelistsSchema.nullable(),
    schedule: liveScheduleConfigSchema.nullable().default(null),
    timerGraphics: liveTimerGraphicsSchema.default([]),
    /** Which check-in code to show; the room signs it. */
    checkIn: attendancePointSelectionSchema.nullable().default(null),
    lowerThirdMotion: liveLowerThirdMotionSchema.default(DEFAULT_LIVE_LOWER_THIRD_MOTION),
    /** How the check-in code is colored on this composition. */
    checkInTheme: liveGraphicThemeSchema.default(LIVE_GRAPHIC_THEME_DEFAULTS.checkIn),
    checkInText: liveCheckInTextSchema.default(DEFAULT_LIVE_CHECK_IN_TEXT),
    topQuestions: liveTopQuestionsConfigSchema.nullable().default(null),
    chatFeed: liveChatFeedConfigSchema.nullable().default(null),
    reactions: z.boolean().default(false),
    reactionsGraphic: liveReactionsGraphicSchema.default(DEFAULT_LIVE_REACTIONS_GRAPHIC),
    /** The scene to draw the composition in; null for the event's default. */
    scene: liveOverlayLayoutSlugSchema.nullable().default(null),
  })
  .strict();
export type LiveCompositionInput = z.infer<typeof liveCompositionInputSchema>;
export const liveAuxSetSchema = z
  .object({ type: z.literal("aux.set"), output: liveAuxOutputSchema, composition: liveCompositionInputSchema })
  .strict();
/**
 * Changes the scene a room screen draws. The screen keeps everything it
 * holds, and the graphics that come on with the scene go on, as when a scene
 * loads on Preview.
 */
export const liveAuxSceneSchema = z
  .object({ type: z.literal("aux.scene"), output: liveAuxOutputSchema, scene: liveOverlayLayoutSlugSchema.nullable() })
  .strict();
/**
 * Changes the shared Preview. Only the layers named change, so operators
 * working on different graphics at once merge instead of overwriting.
 */
export const livePreviewSetSchema = z
  .object({
    type: z.literal("preview.set"),
    // No defaults: a layer the patch leaves out keeps what Preview shows.
    composition: liveCompositionInputSchema
      .extend({
        schedule: liveScheduleConfigSchema.nullable(),
        checkIn: attendancePointSelectionSchema.nullable(),
        checkInTheme: liveGraphicThemeSchema,
        checkInText: liveCheckInTextSchema,
        lowerThirdMotion: liveLowerThirdMotionSchema,
        timerGraphics: liveTimerGraphicsSchema,
        topQuestions: liveTopQuestionsConfigSchema.nullable(),
        chatFeed: liveChatFeedConfigSchema.nullable(),
        reactions: z.boolean(),
        reactionsGraphic: liveReactionsGraphicSchema,
        scene: liveOverlayLayoutSlugSchema.nullable(),
      })
      .partial()
      .strict(),
  })
  .strict();
export type LivePreviewPatch = z.infer<typeof livePreviewSetSchema>["composition"];
export const liveRoomClientMessageSchema = z.discriminatedUnion("type", [
  liveQuestionEditSchema,
  liveQuestionWithdrawSchema,
  ...liveQuestionAnswerClientMessageSchemas,
  liveQuestionAskSchema.extend({ type: z.literal("question.ask"), operationId: z.uuid() }),
  z.object({ type: z.literal("question.vote"), questionId: databaseIdSchema, voted: z.boolean() }).strict(),
  liveReactionSendSchema,
  liveQuestionModerateSchema,
  liveQuestionRewriteSchema.extend({ type: z.literal("question.rewrite"), questionId: databaseIdSchema }),
  ...livePollClientMessageSchemas,
  ...livePreparedQuestionClientMessageSchemas,
  z.object({ type: z.literal("stage.question"), questionId: databaseIdSchema.nullable() }).strict(),
  z
    .object({
      type: z.literal("stage.lowerThird"),
      creditKey: liveCreditFieldsSchema.shape.key.nullable(),
      /** How it goes on or off Program; Program keeps its own when left out. */
      motion: liveLowerThirdMotionSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("stage.poll"), pollId: databaseIdSchema.nullable() }).strict(),
  liveTickerCommandSchema,
  livePanelistsCommandSchema,
  liveScheduleCommandSchema,
  liveCompositionInputSchema.extend({ type: z.literal("stage.set") }).strict(),
  liveAuxSetSchema,
  liveAuxSceneSchema,
  livePreviewSetSchema,
  /** Puts the shared Preview on Program; Preview keeps its contents. */
  z.object({ type: z.literal("preview.take") }).strict(),
  /** Takes every graphic off Program at once; the room keeps what was there for an Undo. */
  z.object({ type: z.literal("program.clear") }).strict(),
  /** Puts back the Program a clear took off, while it is the latest one cleared. */
  z.object({ type: z.literal("program.restore"), snapshotId: liveProgramSnapshotIdSchema }).strict(),
  livePresenceUpdateSchema,
  z
    .object({
      type: z.literal("speaker.message"),
      text: liveSpeakerMessageTextSchema.nullable(),
      tone: liveSpeakerMessageToneSchema.default("neutral"),
      flash: z.boolean().default(false),
    })
    .strict(),
  z.object({ type: z.literal("credit.add"), person: liveAddedCreditInputSchema }).strict(),
  /** Changes what an operator typed for someone without an account; a person from an identity is not edited here. */
  z
    .object({
      type: z.literal("credit.update"),
      creditKey: liveCreditFieldsSchema.shape.key,
      person: liveTypedCreditInputSchema,
    })
    .strict(),
  z.object({ type: z.literal("credit.remove"), creditKey: liveCreditFieldsSchema.shape.key }).strict(),
  /** Puts the first lined-up item of a view on air. */
  z.object({ type: z.literal("stage.next"), view: liveStageViewSchema }).strict(),
  z.object({ type: z.literal("queue.add"), view: liveStageViewSchema, itemId: queueItemSchema }).strict(),
  z.object({ type: z.literal("queue.remove"), view: liveStageViewSchema, itemId: queueItemSchema }).strict(),
  z
    .object({
      type: z.literal("queue.move"),
      view: liveStageViewSchema,
      itemId: queueItemSchema,
      direction: z.enum(["up", "down"]),
    })
    .strict(),
  ...liveTimerCommandSchemas,
  z.object({ type: z.literal("overlay.mode"), mode: liveOverlayModeSchema }).strict(),
  stageDisplaySettings.liveStageDisplaySettingsCommandSchema,
  screenSync.liveScreenSyncCommandSchema,
  roomOpening.liveRoomOpeningCommandSchema,
  ...liveChatClientMessageSchemas,
  ...liveModerationClientMessageSchemas,
  ...liveAuthorClientMessageSchemas,
]);
export type LiveRoomClientMessage = z.infer<typeof liveRoomClientMessageSchema>;
