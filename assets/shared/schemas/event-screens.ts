import { z } from "zod";
import { LIVE_SCREEN_OUTPUTS, screenOutputUsesOverlay } from "../live-room-outputs";
import { eventSlugParamsSchema, slugPattern, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { timeZoneSchema } from "./event-series";
import { SCREEN_POLICY } from "../event-screen-policy";
import { liveOverlayLayoutSlugSchema } from "./live-overlay-layout";
import { liveStreamSchema } from "./event-live-stream";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Event screens: physical displays that pair once, stay signed in, and show
 * one output of one room. A screen ID is the device's own stable identifier,
 * not a secret; the pairing code is what proves staff saw the screen.
 */

/** Six base32 characters (A-Z, 2-7), as the device prints them. */
export const SCREEN_ID_PATTERN = /^[A-Z2-7]{6}$/;
export const screenIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SCREEN_ID_PATTERN, "Enter the 6-character screen ID shown on the screen.");
export type ScreenId = z.infer<typeof screenIdSchema>;
export const screenParamsSchema = z.object({ screenId: screenIdSchema });

/** Letters and digits that cannot be mistaken for one another when read off a screen (no I, O, 0 or 1). */
export const SCREEN_PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SCREEN_PAIRING_CODE_LENGTH = 8;
const pairingCodePattern = new RegExp(`^[${SCREEN_PAIRING_CODE_ALPHABET}]{${SCREEN_PAIRING_CODE_LENGTH}}$`);
/** Typed as shown, in any case, with or without the spaces and hyphens a screen groups it with. */
export const screenPairingCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(pairingCodePattern, "Enter the 8-character pairing code shown on the screen."));

/** Where the screen stands, such as "Foyer, by registration". */
export const screenNameSchema = trimmedString(1, 80, "Enter where the screen stands.");

export const screenOutputSchema = z.enum(LIVE_SCREEN_OUTPUTS);

/** One room of the screen's event and the output it shows there; only overlay outputs take a layout. */
export const screenAssignmentInputSchema = z
  .object({
    roomId: databaseIdSchema,
    output: screenOutputSchema,
    layout: liveOverlayLayoutSlugSchema.nullable().default(null),
  })
  .strict()
  .refine((assignment) => screenOutputUsesOverlay(assignment.output) || assignment.layout === null, {
    message: "The livestream has no layout.",
    path: ["layout"],
  });
export type ScreenAssignmentInput = z.infer<typeof screenAssignmentInputSchema>;

/** The 401 codes a screen receives when it must pair again; any other refusal is not about its sign-in. */
export const SCREEN_SESSION_ERROR_CODES = {
  missing: "SCREEN_SESSION_MISSING",
  revoked: "SCREEN_SESSION_REVOKED",
  expired: "SCREEN_SESSION_EXPIRED",
} as const;

/** The 409 a rename or reassignment receives when the screen changed since the editor read it. */
export const SCREEN_REVISION_CONFLICT_CODE = "SCREEN_REVISION_CONFLICT";

// ── Pairing ──

/** An unpaired screen's code, valid until the challenge it proves expires. */
export const screenPairingResponseSchema = z
  .object({ code: z.string().regex(pairingCodePattern), expiresAt: utcInstantSchema })
  .strict();
export type ScreenPairingResponse = z.infer<typeof screenPairingResponseSchema>;

/** The pairing page's poll: still waiting for staff, or signed in until `expiresAt`. */
export const screenSessionPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), expiresAt: utcInstantSchema }).strict(),
  z.object({ status: z.literal("active"), expiresAt: utcInstantSchema }).strict(),
]);
export type ScreenSessionPollResponse = z.infer<typeof screenSessionPollResponseSchema>;

/**
 * Staff approve the code a screen shows, name it and optionally assign it.
 * Without `assignment`, a screen keeps its assignment in the same event and
 * loses it when it moves to this event; `null` clears it.
 */
export const eventScreenPairingCreateSchema = z
  .object({
    screenId: screenIdSchema,
    pairingCode: screenPairingCodeSchema,
    name: screenNameSchema,
    assignment: screenAssignmentInputSchema.nullable().optional(),
    /**
     * Pair even though a screen with this ID is signed in now, which signs it
     * out. Without it, such a pairing is refused: the ID was mistyped, or two
     * screens share it.
     */
    replace: z.literal(true).optional(),
  })
  .strict();
export type EventScreenPairingCreate = z.infer<typeof eventScreenPairingCreateSchema>;
export const SCREEN_ID_IN_USE_CODE = "SCREEN_ID_IN_USE";

// ── Staff records ──

export const SCREEN_SESSION_STATES = ["none", "pending", "active"] as const;
export const screenSessionStateSchema = z.enum(SCREEN_SESSION_STATES);

export const screenRecordSchema = z
  .object({
    id: screenIdSchema,
    name: z.string(),
    /** Null once the event it was paired for is deleted. */
    eventId: databaseIdSchema.nullable(),
    assignment: z
      .object({
        roomId: databaseIdSchema,
        roomName: z.string(),
        output: screenOutputSchema,
        layout: liveOverlayLayoutSlugSchema.nullable(),
        assignedAt: utcInstantSchema,
      })
      .strict()
      .nullable(),
    /** Compare-and-set token for renaming or reassigning. */
    revision: z.number().int().nonnegative(),
    /**
     * The screen's current sign-in, else its newest approval that is not
     * revoked. An approval past `expiresAt` was never collected: the screen
     * showed another code, or none.
     */
    session: z
      .object({
        state: screenSessionStateSchema,
        activatedAt: utcInstantSchema.nullable(),
        lastSeenAt: utcInstantSchema.nullable(),
        expiresAt: utcInstantSchema.nullable(),
      })
      .strict(),
    createdAt: utcInstantSchema,
  })
  .strict();
export type ScreenRecord = z.infer<typeof screenRecordSchema>;

/** Rename or reassign a screen from the revision the editor started from; `assignment: null` clears it. */
export const screenUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    name: screenNameSchema.optional(),
    assignment: screenAssignmentInputSchema.nullable().optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.assignment !== undefined, {
    message: "Change the name or the assignment.",
  });
export type ScreenUpdate = z.infer<typeof screenUpdateSchema>;

/**
 * Moves a screen to a new device, as when its device was reinstalled and
 * shows a new screen ID: staff enter what the new device shows, and the
 * screen keeps its name and assignment under the new ID. The old device is
 * signed out.
 */
export const screenDeviceReplacementSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    newScreenId: screenIdSchema,
    pairingCode: screenPairingCodeSchema,
  })
  .strict();
export type ScreenDeviceReplacement = z.infer<typeof screenDeviceReplacementSchema>;
/** The 409 a replacement receives when the new device's screen ID already belongs to a screen. */
export const SCREEN_ID_TAKEN_CODE = "SCREEN_ID_TAKEN";
/** The 409 a removal receives while the screen is signed in. */
export const SCREEN_SIGNED_IN_CODE = "SCREEN_SIGNED_IN";

export const SCREEN_LIST_SORTS = ["name", "lastSeenAt"] as const;
export const eventScreensQuerySchema = listQuerySchema(SCREEN_LIST_SORTS).extend({
  roomId: databaseIdSchema.optional(),
  /** Only these screens, comma-separated: the ones the screen monitor says need attention. */
  screenIds: z
    .string()
    .max(800)
    .optional()
    .transform((value) => value?.split(","))
    .pipe(z.array(screenIdSchema).min(1).max(100).optional()),
});
export type EventScreensQuery = z.infer<typeof eventScreensQuerySchema>;
export const eventScreensListSchema = paginatedResponseSchema("screens", screenRecordSchema);
export const eventScreensParamsSchema = eventSlugParamsSchema;

// ── A screen reading itself ──

/** The cached agenda's revision, so the read leaves the sessions out when they have not changed. */
export const screenReadQuerySchema = z
  .object({ agendaRevision: z.coerce.number().int().nonnegative().optional() })
  .strict();
export type ScreenReadQuery = z.infer<typeof screenReadQuerySchema>;

/** One published session of the screen's room, as the screen runs it while offline. */
export const screenAgendaSessionSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().max(500),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
  })
  .strict()
  .refine((session) => session.startAt < session.endAt, { message: "A session ends after it starts." });
export type ScreenAgendaSession = z.infer<typeof screenAgendaSessionSchema>;

/**
 * The screen's room in the published agenda around now, in the event's zone.
 * `sessions` is null when the screen already holds this revision; the window
 * moves with every read, so a screen asks for the sessions again before its
 * copy runs out.
 */
export const screenAgendaSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    timeZone: timeZoneSchema,
    from: utcInstantSchema,
    to: utcInstantSchema,
    sessions: z.array(screenAgendaSessionSchema).max(SCREEN_POLICY.agendaMaxSessions).nullable(),
  })
  .strict();
export type ScreenAgenda = z.infer<typeof screenAgendaSchema>;

/** What a paired screen shows, its server's clock for countdowns, and short-lived access to its room's overlay. */
export const screenOwnViewSchema = z
  .object({
    viewer: z.literal("screen"),
    screen: z
      .object({
        id: screenIdSchema,
        name: z.string(),
        assignment: z
          .object({
            eventSlug: z.string().regex(slugPattern),
            roomId: databaseIdSchema,
            roomName: z.string(),
            output: screenOutputSchema,
            layout: liveOverlayLayoutSlugSchema.nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    serverNow: utcInstantSchema,
    /** Its room's published agenda; null while unassigned or before the event's agenda is published. */
    agenda: screenAgendaSchema.nullable(),
    /**
     * For a livestream assignment, its room's stream on today's event day in
     * the event's zone (that day's replacement, else the usual stream); null
     * for any other output or when the room streams nothing today.
     */
    livestream: liveStreamSchema.nullable(),
    /** Present only while the screen is assigned. */
    overlay: z
      .object({ token: z.string().min(1), expiresAt: utcInstantSchema })
      .strict()
      .nullable(),
  })
  .strict();
export type ScreenOwnView = z.infer<typeof screenOwnViewSchema>;

export const screenStaffViewSchema = z.object({ viewer: z.literal("staff"), screen: screenRecordSchema }).strict();

export const screenReadResponseSchema = z.discriminatedUnion("viewer", [screenOwnViewSchema, screenStaffViewSchema]);
export type ScreenReadResponse = z.infer<typeof screenReadResponseSchema>;
