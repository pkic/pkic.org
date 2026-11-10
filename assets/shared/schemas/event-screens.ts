import { z } from "zod";
import { LIVE_SCREEN_OUTPUTS, screenOutputUsesOverlay } from "../live-room-outputs";
import { eventSlugParamsSchema, slugPattern, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { liveOverlayLayoutSlugSchema } from "./live-overlay-layout";
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
  })
  .strict();
export type EventScreenPairingCreate = z.infer<typeof eventScreenPairingCreateSchema>;

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
    /** The screen's newest sign-in that is not revoked. */
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

export const SCREEN_LIST_SORTS = ["name", "lastSeenAt"] as const;
export const eventScreensQuerySchema = listQuerySchema(SCREEN_LIST_SORTS).extend({
  roomId: databaseIdSchema.optional(),
});
export type EventScreensQuery = z.infer<typeof eventScreensQuerySchema>;
export const eventScreensListSchema = paginatedResponseSchema("screens", screenRecordSchema);
export const eventScreensParamsSchema = eventSlugParamsSchema;

// ── A screen reading itself ──

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
