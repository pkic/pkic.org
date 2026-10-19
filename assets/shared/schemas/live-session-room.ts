import {
  liveQuestionAnswerSendSchema,
  liveQuestionAnswerAcceptSchema,
  liveQuestionAnswersWatchSchema,
  liveQuestionAnswersSchema,
  liveQuestionAnswerResultSchema,
} from "./live-session-answer";
import {
  liveScheduleProjectionSchema,
  liveScheduleConfigSchema,
  liveScheduleCommandSchema,
} from "./live-session-schedule";
import {
  liveTickerConfigSchema,
  liveTickerSchema,
  liveTickerContextSchema,
  DEFAULT_LIVE_TICKER_CONTEXT,
} from "./live-session-ticker";
import { livePollPresentationSchema, DEFAULT_LIVE_POLL_PRESENTATION } from "./live-session-poll";
import {
  liveAddedCreditInputSchema,
  liveAddedCreditsSchema,
  liveCreditFieldsSchema,
  liveCreditSchema,
} from "./live-session-credit";
import { liveOverlayLayoutGeometriesSchema } from "./live-overlay-layout";
import { z } from "zod";
import { liveProgramParamsSchema } from "./live-room-program";
import { publicSessionPortraitUrlSchema } from "./event-session-history";
import {
  liveAuthorAffiliationSchema,
  liveAuthorClientMessageSchemas,
  liveAuthorFields,
  liveAuthorServerMessageSchemas,
} from "./live-session-author";
import {
  liveChatClientMessageSchemas,
  liveChatRestrictionSchema,
  liveChatServerMessageSchemas,
  liveChatSnapshotFields,
} from "./live-session-chat";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { authErrors, created, requiresPermissions } from "./route-contract";
import { LIVE_QUESTION_STATUSES, LIVE_REACTION_IDS, LIVE_ROOM_POLICY, LIVE_STAGE_VIEWS } from "../live-session-policy";
import { liveChangeSchema, livePersonNameSchema } from "./live-session-change";
import { LIVE_AUX_OUTPUTS, LIVE_SPEAKER_MESSAGE_MAX_LENGTH, LIVE_SPEAKER_MESSAGE_TONES } from "../live-room-outputs";
import { livePollClientMessageSchemas, livePollSchema, livePollServerMessageSchemas } from "./live-session-poll";
import {
  liveTimerCommandSchemas,
  liveTimerGraphicsSchema,
  liveTimersChangedSchema,
  liveTimersSchema,
} from "./live-session-timer";
import { attendancePointSelectionSchema } from "../attendance-points";
import { LIVE_GRAPHIC_THEME_DEFAULTS, liveGraphicThemeSchema } from "../live-graphic-theme";
import { DEFAULT_LIVE_LOWER_THIRD_MOTION } from "../live-lower-third";
import {
  liveCheckInOnAirSchema,
  liveLowerThirdMotionSchema,
  liveCheckInTextSchema,
  DEFAULT_LIVE_CHECK_IN_TEXT,
} from "./live-session-graphic-settings";
export {
  liveCheckInOnAirSchema,
  liveLowerThirdMotionSchema,
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
 * not retry. A server fault stays an HTTP failure, which the page retries.
 */
const LIVE_ROOM_REFUSAL_CLOSE_BASE = 4000;

export function liveRoomRefusalCloseCode(status: number): number {
  return LIVE_ROOM_REFUSAL_CLOSE_BASE + status;
}

/** The error code of a refused admission, or null for any other close. */
export function liveRoomRefusalFromClose(code: number, reason: string): string | null {
  if (!(code >= LIVE_ROOM_REFUSAL_CLOSE_BASE + 400 && code <= LIVE_ROOM_REFUSAL_CLOSE_BASE + 499)) return null;
  return reason || "LIVE_ROOM_REFUSED";
}

export const liveRoomParamsSchema = eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema });

export const liveRoomRoleSchema = z.enum(["attendee", "speaker", "operator", "overlay"]);
export const liveQuestionStatusSchema = z.enum(LIVE_QUESTION_STATUSES);
export const liveReactionSchema = z.enum(LIVE_REACTION_IDS);
/** The outputs a browser source can show; which of an output's elements it draws, and where, is its layout's. */
export const liveOverlayViewSchema = z.enum(["program", ...LIVE_AUX_OUTPUTS]);
export type LiveOverlayView = z.infer<typeof liveOverlayViewSchema>;
/**
 * The live room socket's query. A broadcast source names the output it draws,
 * so the room sends the speaker-facing stage display what only it may show.
 */
export const liveRoomSocketQuerySchema = z.object({ output: liveOverlayViewSchema.optional() }).strict();
/** The parts of the broadcast an operator lines up and puts on air. */
export const liveStageViewSchema = z.enum(LIVE_STAGE_VIEWS);

const questionTextSchema = z.string().min(1).max(LIVE_ROOM_POLICY.questionMaxLength);

export const liveQuestionSchema = z
  .object({
    id: databaseIdSchema,
    /** The text the room shows: an operator's rewrite when there is one, else the author's own words. */
    text: questionTextSchema,
    status: liveQuestionStatusSchema,
    votes: z.number().int().nonnegative(),
    /** The author chose to stay anonymous to other attendees; moderators always see the name. */
    anonymous: z.boolean(),
    /** Null when the question is anonymous to this viewer. */
    authorName: livePersonNameSchema.nullable(),
    /** The author's profile photo; null when they asked anonymously or have none. */
    authorPhotoUrl: publicSessionPortraitUrlSchema.nullable().default(null),
    /** The author's room handle, capacity and roles, under the same anonymity as the name. */
    ...liveAuthorFields,
    mine: z.boolean(),
    revision: z.number().int().nonnegative().default(0),
    withdrawn: z.boolean().default(false),
    canEdit: z.boolean().default(false),
    votedByMe: z.boolean(),
    askedAt: utcInstantSchema,
    answeredAt: utcInstantSchema.nullable(),
    moderated: liveChangeSchema.nullable(),
    /** Moderators only: the author's own words once an operator rewrote the question. */
    originalText: questionTextSchema.nullable(),
    /** Moderators only: who last rewrote the question. */
    rewritten: liveChangeSchema.nullable(),
  })
  .strict();
export type LiveQuestion = z.infer<typeof liveQuestionSchema>;

/** Whether the room's graphics go straight to the stream, or through the production switcher's own scenes. */
export const liveOverlayModeSchema = z.enum(["direct", "switcher"]);
export type LiveOverlayMode = z.infer<typeof liveOverlayModeSchema>;
export {
  liveChatChannelSchema,
  liveChatMessageSchema,
  liveChatSendSchema,
  liveChatReportSchema,
  liveChatReactionSchema,
  liveChatReportReasonSchema,
  liveChatRestrictionSchema,
  type LiveChatMessage,
  type LiveChatChannel,
  type LiveChatModeration,
} from "./live-session-chat";

export {
  liveAddedCreditInputSchema,
  liveAddedCreditsSchema,
  liveCreditFieldsSchema,
  liveCreditIdentitySchema,
  liveCreditSchema,
  type LiveAddedCreditInput,
  type LiveCredit,
  type LiveCreditIdentity,
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
    /** The organization the author spoke for as they asked; null when anonymous or unaffiliated. */
    /** The capacity the author asked in, frozen with the question; null when anonymous or unaffiliated. */
    authorAffiliation: liveAuthorAffiliationSchema.nullable().default(null),
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
};

export const liveAuxOutputSchema = z.enum(LIVE_AUX_OUTPUTS);
/** An auxiliary output, like the shared Preview, holds the same kind of composition as Program. */
export const liveAuxCompositionSchema = liveStageSchema;
export type LiveAuxComposition = LiveStage;
export const EMPTY_LIVE_AUX_COMPOSITION: LiveAuxComposition = EMPTY_LIVE_STAGE;
export const liveOutputsSchema = z
  .object({
    projector: liveAuxCompositionSchema,
    "stage-preview": liveAuxCompositionSchema,
    "stage-display": liveAuxCompositionSchema,
  })
  .strict();
export type LiveOutputs = z.infer<typeof liveOutputsSchema>;
export const EMPTY_LIVE_OUTPUTS: LiveOutputs = {
  projector: EMPTY_LIVE_AUX_COMPOSITION,
  "stage-preview": EMPTY_LIVE_AUX_COMPOSITION,
  "stage-display": EMPTY_LIVE_AUX_COMPOSITION,
};

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
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    timeZone: z.string().min(1),
    credits: z.array(liveCreditSchema).max(50),
  })
  .strict();
export type LiveRoomSession = z.infer<typeof liveRoomSessionSchema>;

export const liveRoomViewerSchema = z
  .object({
    role: liveRoomRoleSchema,
    name: livePersonNameSchema.nullable(),
    /** An operator who also organizes the event; the chat policy lets them restrict people. */
    organizer: z.boolean().optional(),
    /** This viewer's own chat restriction for the session. */
    chatRestriction: liveChatRestrictionSchema.nullable().optional(),
  })
  .strict();

const reactionCountsSchema = z.partialRecord(liveReactionSchema, z.number().int().positive());

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
    overlayMode: liveOverlayModeSchema.default("direct"),
    /** The event's saved overlay layouts; a browser source draws the one it names, else a built-in one. */
    overlayLayouts: liveOverlayLayoutGeometriesSchema.default([]),
    tickerContext: liveTickerContextSchema.default(DEFAULT_LIVE_TICKER_CONTEXT),
    ...liveChatSnapshotFields,
    stage: liveStageSchema,
    /** Operators, speakers and overlays only; empty for attendees. */
    outputs: liveOutputsSchema.default(EMPTY_LIVE_OUTPUTS),
    /** Operators, speakers and overlays only; null for attendees. */
    speakerMessage: liveSpeakerMessageSchema.nullable().default(null),
    /** The operators' one shared Preview (PVW); operators only, empty for everyone else. */
    preview: liveAuxCompositionSchema.default(EMPTY_LIVE_AUX_COMPOSITION),
    /** The room's timers, the session's first. */
    timers: liveTimersSchema,
    reactionTotals: reactionCountsSchema,
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
  })
  .strict();
export type LiveRoomSnapshot = z.infer<typeof liveRoomSnapshotSchema>;

export const liveRoomServerMessageSchema = z.discriminatedUnion("type", [
  liveRoomSnapshotSchema,
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
  /** Stage display sources only: the question in Preview changed. Operators read it from Preview itself. */
  z.object({ type: z.literal("stage.display.next.changed"), question: liveStageQuestionSchema.nullable() }).strict(),
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
  ...liveAuthorServerMessageSchemas,
  z.object({ type: z.literal("reaction.burst"), counts: reactionCountsSchema, at: utcInstantSchema }).strict(),
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

const questionBodySchema = z
  .string()
  .trim()
  .min(LIVE_ROOM_POLICY.questionMinLength, "Write a question of at least a few characters.")
  .max(
    LIVE_ROOM_POLICY.questionMaxLength,
    `Keep your question under ${LIVE_ROOM_POLICY.questionMaxLength} characters.`,
  );

/** The ask form's contract: the socket message carries exactly these fields. */
export const liveQuestionAskSchema = z.object({ text: questionBodySchema, anonymous: z.boolean() }).strict();

/**
 * The rewrite editor's contract. The operator submits the text the room will
 * show; the author's own words stay on the question for the record. A later
 * writing assistant only proposes this text: the operator still sends it.
 */
export const liveQuestionRewriteSchema = z.object({ text: questionBodySchema }).strict();

const questionAuthorRequestFields = {
  questionId: databaseIdSchema,
  operationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const liveQuestionEditSchema = liveQuestionRewriteSchema.extend({
  type: z.literal("question.edit"),
  ...questionAuthorRequestFields,
});
export const liveQuestionWithdrawSchema = z
  .object({
    type: z.literal("question.withdraw"),
    ...questionAuthorRequestFields,
  })
  .strict();

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
  })
  .strict();
export type LiveCompositionInput = z.infer<typeof liveCompositionInputSchema>;
/** The check-in code's settings in the Graphics panel: which code, and its colors. */
export const liveCheckInChoiceSchema = z
  .object({
    checkIn: attendancePointSelectionSchema,
    checkInTheme: liveGraphicThemeSchema,
    checkInText: liveCheckInTextSchema,
  })
  .strict();
export type LiveCheckInChoice = z.infer<typeof liveCheckInChoiceSchema>;
export const liveAuxSetSchema = z
  .object({ type: z.literal("aux.set"), output: liveAuxOutputSchema, composition: liveCompositionInputSchema })
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
      })
      .partial()
      .strict(),
  })
  .strict();
export type LivePreviewPatch = z.infer<typeof livePreviewSetSchema>["composition"];
export const liveRoomClientMessageSchema = z.discriminatedUnion("type", [
  liveQuestionEditSchema,
  liveQuestionWithdrawSchema,
  liveQuestionAnswersWatchSchema,
  liveQuestionAnswerSendSchema,
  liveQuestionAnswerAcceptSchema,
  liveQuestionAskSchema.extend({ type: z.literal("question.ask"), operationId: z.uuid() }),
  z.object({ type: z.literal("question.vote"), questionId: databaseIdSchema, voted: z.boolean() }).strict(),
  z.object({ type: z.literal("reaction.send"), reaction: liveReactionSchema }).strict(),
  z
    .object({
      type: z.literal("question.moderate"),
      questionId: databaseIdSchema,
      status: liveQuestionStatusSchema,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  liveQuestionRewriteSchema.extend({ type: z.literal("question.rewrite"), questionId: databaseIdSchema }),
  ...livePollClientMessageSchemas,
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
  ...liveChatClientMessageSchemas,
  ...liveAuthorClientMessageSchemas,
]);
export type LiveRoomClientMessage = z.infer<typeof liveRoomClientMessageSchema>;

// ── Overlay access ──────────────────────────────────────────────────────────

export const liveOverlayAccessResponseSchema = z
  .object({ token: z.string().min(1).max(2000), expiresAt: utcInstantSchema })
  .strict();

export const liveOverlayAccessRouteSchema = {
  ...requiresPermissions("agenda:live_moderate"),
  tags: ["Events"],
  summary: "Issue read-only, expiring sources for a physical room's complete broadcast program",
  request: { params: liveProgramParamsSchema },
  responses: {
    ...created("Overlay access for broadcast browser sources", liveOverlayAccessResponseSchema),
    ...authErrors({ notFound: "The physical room is not on the approved agenda." }),
  },
};
