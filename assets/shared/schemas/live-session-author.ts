import { z } from "zod";
import { agendaSpeakerAffiliationContentSchema } from "./agenda-speaker-presentation";
import { publicSessionPortraitUrlSchema } from "./event-session-history";
import { livePersonNameSchema } from "./live-session-change";
import { LIVE_AUTHOR_ROLE_IDS } from "../live-author-roles";

/**
 * Who wrote a chat message or asked a question, as the live room shows it.
 *
 * A browser never receives a user id. Each author has an opaque handle that
 * only means something in one room: the room derives it from the person and
 * the room under a server secret, and resolves it back only for people who
 * wrote something the asking viewer can see there. A handle from another
 * room, or for someone who never wrote here, resolves to nothing.
 */
export const liveAuthorHandleSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/u);

/** The capacity an author wrote in: their acting identity's title and organization when they wrote it. */
export const liveAuthorAffiliationSchema = agendaSpeakerAffiliationContentSchema;
export type LiveAuthorAffiliation = z.infer<typeof liveAuthorAffiliationSchema>;

/** The roles the room recognizes for an author, highest first. */
export const liveAuthorRolesSchema = z.array(z.enum(LIVE_AUTHOR_ROLE_IDS)).max(LIVE_AUTHOR_ROLE_IDS.length);

/** Who someone was when they wrote: their capacity and their roles, frozen with what they wrote. */
export const liveAuthorStampSchema = z
  .object({ affiliation: liveAuthorAffiliationSchema.nullable(), roles: liveAuthorRolesSchema })
  .strict();
export type LiveAuthorStamp = z.infer<typeof liveAuthorStampSchema>;

/** An author's card: what the room may show about someone who wrote in it. */
export const liveAuthorDetailsSchema = z
  .object({
    handle: liveAuthorHandleSchema,
    name: livePersonNameSchema,
    photoUrl: publicSessionPortraitUrlSchema.nullable(),
    affiliation: liveAuthorAffiliationSchema.nullable(),
    roles: liveAuthorRolesSchema,
    /** Their public profile page, when they have one. */
    profilePath: z
      .string()
      .regex(/^\/people\/[a-z0-9%-]+\/$/u)
      .nullable(),
  })
  .strict();
export type LiveAuthorDetails = z.infer<typeof liveAuthorDetailsSchema>;

/** The author fields a chat message or question carries; absent for an anonymous author. */
export const liveAuthorFields = {
  authorHandle: liveAuthorHandleSchema.nullable().optional(),
  authorAffiliation: liveAuthorAffiliationSchema.nullable().optional(),
  authorRoles: liveAuthorRolesSchema.optional(),
};

export const liveAuthorClientMessageSchemas = [
  /** Asks for one author's card; the room answers this socket only. */
  z.object({ type: z.literal("author.lookup"), handle: liveAuthorHandleSchema }).strict(),
] as const;

export const liveAuthorServerMessageSchemas = [
  /** An author's card, or null when the handle does not resolve for this viewer. */
  z
    .object({
      type: z.literal("author.details"),
      handle: liveAuthorHandleSchema,
      author: liveAuthorDetailsSchema.nullable(),
    })
    .strict(),
] as const;
