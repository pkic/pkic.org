import { z } from "zod";
import { LIVE_ADDED_CREDITS_MAX } from "../live-room-credits";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { publicSessionPortraitUrlSchema } from "./event-session-history";
import { databaseIdSchema } from "./identifiers";
import { livePersonNameSchema } from "./live-session-change";

/**
 * The capacity a person appears in on a lower third: the job title and the
 * organization of the identity they act as, read from that identity. The
 * identity is the only source; nothing about it is typed in or copied.
 */
export const liveCreditIdentitySchema = z
  .object({
    title: z.string().trim().min(1).max(200).nullable(),
    organization: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();
export type LiveCreditIdentity = z.infer<typeof liveCreditIdentitySchema>;

/** The fields of a person offered as a lower third. */
export const liveCreditFieldsSchema = z
  .object({
    key: z.string().min(1).max(80),
    name: livePersonNameSchema,
    moderator: z.boolean().default(false),
    photoUrl: publicSessionPortraitUrlSchema.nullable().default(null),
    /** The identity the person acts as; null for someone who appears as themselves. */
    identity: liveCreditIdentitySchema.nullable().default(null),
    /** The role the lower third names above the person, "Moderator" or a host's duty; null for a speaker. */
    roleLabel: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .strict();

/** Fields a room stored before credits read their identity; they are dropped as the room reads them. */
const RETIRED_CREDIT_FIELDS = ["title", "affiliations", "directoryAffiliations"] as const;

/** A speaker credit from the approved agenda, a host, or a person operators added, offered as a lower third. */
export const liveCreditSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  const fields = { ...(value as Record<string, unknown>) };
  for (const retired of RETIRED_CREDIT_FIELDS) delete fields[retired];
  return fields;
}, liveCreditFieldsSchema);
export type LiveCredit = z.infer<typeof liveCreditFieldsSchema>;

/**
 * A person an operator adds to this session's lower thirds: one identity of
 * someone at the event, or someone without an account by name alone. A
 * person found by search brings their identity's title and organization;
 * nobody types a title.
 */
export const liveAddedCreditInputSchema = z
  .object({
    /** The person picked from the event's people; null for a typed name. */
    userId: databaseIdSchema.nullable(),
    /** The identity they appear as; null for a typed name or someone who appears as themselves. */
    identityId: databaseIdSchema.nullable(),
    name: z.string().trim().min(1, "Enter a name.").max(200, "Keep the name under 200 characters."),
  })
  .strict()
  .refine((value) => value.identityId === null || value.userId !== null, {
    path: ["identityId"],
    message: "Choose the person this identity belongs to.",
  });
export type LiveAddedCreditInput = z.infer<typeof liveAddedCreditInputSchema>;

/** The people operators added for this session, oldest first; operators only. */
export const liveAddedCreditsSchema = z.array(liveCreditSchema).max(LIVE_ADDED_CREDITS_MAX);

/** One way a person at the event can appear: each active identity of theirs is its own result. */
export const liveSpeakerCandidateSchema = z
  .object({
    userId: databaseIdSchema,
    identityId: databaseIdSchema.nullable(),
    name: livePersonNameSchema,
    photoUrl: publicSessionPortraitUrlSchema.nullable(),
    title: z.string().nullable(),
    organization: z.string().nullable(),
  })
  .strict();
export type LiveSpeakerCandidate = z.infer<typeof liveSpeakerCandidateSchema>;
export const liveSpeakerCandidatesQuerySchema = listQuerySchema(["name"] as const);
export const liveSpeakerCandidatesResponseSchema = paginatedResponseSchema("identities", liveSpeakerCandidateSchema);
