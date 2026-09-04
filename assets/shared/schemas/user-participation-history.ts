/**
 * What a person took part in, one collection per kind, most recent first.
 *
 * This is the chronological half of the contact record. Its sibling,
 * `./user-participation`, answers "how involved is this person" with standing
 * and rates; this answers "what did they actually do, and when". The two are
 * separate resources because they are read at different moments and cost
 * different amounts: the summary is one bounded aggregate, a history is a
 * page of rows the reader scrolls.
 *
 * They are four collections rather than one feed with a `kind` discriminator
 * because the rows genuinely differ — an event carries the roles held at it, a
 * meeting the group that called it, a document its version and the kind of
 * contribution, a ballot its round — and because a reader looking at one tab
 * should not pay to page the other three.
 *
 * Every collection composes the shared list contract (search, sort,
 * pagination) and the shared page envelope from `./pagination`, so these read
 * as the same dialect as every other listing endpoint rather than a private
 * one invented for a record page.
 *
 * Instants are transported exactly as persisted (`z.string()`), the
 * convention every read model over these columns already follows (see
 * `./organization-activity`): `events.starts_at`,
 * `event_participants.created_at`, `presentation_versions.uploaded_at`, and
 * `vote_ballots.submitted_at` predate the millisecond-precision UTC codec and
 * carry rows written before it. Localization stays at the rendering boundary.
 */
import { z } from "zod";

import { eventIdSchema, trimmedString, userIdParamsSchema } from "./api-common";
import { eventOccurrenceStatusSchema } from "./event-series";
import { groupSummarySchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchemaWithDefault } from "./pagination";
import { eventParticipantRoleSchema } from "./participant-roles";
import { presentationReviewStatusSchema } from "./presentation-versions";
import { authErrors, ok, requiresPermissions } from "./route-contract";
import { voteTypeSchema } from "./votes";

/**
 * The instant a row is placed at, and the only thing the four collections
 * sort by. Carrying one named field rather than sorting each tab by whichever
 * column happens to fit is what makes the record read as a single history:
 * the reader sees one date column and one ordering everywhere.
 *
 * What the instant *means* differs per collection and is documented on each,
 * because "when did this happen" has a different answer for something that
 * was scheduled than for something a person did.
 */
export const participationHistoryEntrySchema = z.object({
  occurredAt: z.string(),
});

export const PARTICIPATION_HISTORY_SORT_COLUMNS = ["occurredAt"] as const;

/**
 * One query contract for all four collections. The default is newest first,
 * which is how a history is read; ascending remains available for someone
 * tracing how an involvement began.
 */
export const participationHistoryListQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(PARTICIPATION_HISTORY_SORT_COLUMNS, "-occurredAt"),
);
export type ParticipationHistoryListQuery = z.infer<typeof participationHistoryListQuerySchema>;

/** Every collection is addressed by the person whose record it belongs to. */
export const userParticipationHistoryParamsSchema = userIdParamsSchema;

/* ── Events the person took part in ────────────────────────────────────── */

export const userEventParticipationSchema = participationHistoryEntrySchema.extend({
  eventId: eventIdSchema,
  eventSlug: z.string(),
  eventName: trimmedString(1, 180),
  /**
   * The active roles held at this event, in vocabulary order. One row per
   * event, not per role: somebody who spoke and also organized took part in
   * one event twice over, and reads better as one line carrying both badges
   * than as two lines a day apart.
   */
  roles: z.array(eventParticipantRoleSchema).min(1),
  /** Null for an event that never had a schedule; the row is still real. */
  startsAt: z.string().nullable(),
  /**
   * The event's start where it has one, and otherwise when the role was first
   * recorded. An unscheduled event still has to sit somewhere in a history,
   * and the moment somebody was put on it is the only honest stand-in.
   */
  occurredAt: z.string(),
});
export type UserEventParticipation = z.infer<typeof userEventParticipationSchema>;

export const userEventParticipationListResponseSchema = paginatedResponseSchema("events", userEventParticipationSchema);
export type UserEventParticipationListResponse = z.infer<typeof userEventParticipationListResponseSchema>;

/* ── Meetings the person joined ────────────────────────────────────────── */

export const userMeetingParticipationSchema = participationHistoryEntrySchema.extend({
  occurrenceId: databaseIdSchema,
  /** The meeting series' event: what the owning group calls its meetings. */
  eventName: trimmedString(1, 180),
  eventSlug: z.string(),
  /** Null when the series' event is not owned by a group, which the schema permits. */
  group: groupSummarySchema.nullable(),
  /**
   * `cancelled` never appears: a meeting that did not take place is not
   * something anybody took part in, so it is excluded rather than listed as
   * an absence.
   */
  status: eventOccurrenceStatusSchema,
  /** When the person confirmed they were joining, which is not when the meeting began. */
  confirmedAt: z.string(),
  /** The meeting's own start. A history of meetings is read by meeting date. */
  occurredAt: z.string(),
});
export type UserMeetingParticipation = z.infer<typeof userMeetingParticipationSchema>;

export const userMeetingParticipationListResponseSchema = paginatedResponseSchema(
  "meetings",
  userMeetingParticipationSchema,
);
export type UserMeetingParticipationListResponse = z.infer<typeof userMeetingParticipationListResponseSchema>;

/* ── Presentation documents the person contributed to ──────────────────── */

/**
 * The two ways this schema records a person against a presentation document:
 * they uploaded a version of it (`presentation_versions.uploaded_by_user_id`)
 * or they reviewed one (`presentation_version_reviews.reviewed_by_user_id`).
 * Both are attributable by design — a review is an official act recorded
 * against the reviewer — so both belong in a history of contributions.
 *
 * Deliberately not included: authorship of the underlying proposal, or being
 * listed as one of its speakers. Those are proposal facts, not document ones,
 * and inferring "contributed to the document" from them would credit people
 * who never touched a file.
 */
export const PARTICIPATION_DOCUMENT_CONTRIBUTIONS = ["upload", "review"] as const;
export const participationDocumentContributionSchema = z.enum(PARTICIPATION_DOCUMENT_CONTRIBUTIONS);
export type ParticipationDocumentContribution = z.infer<typeof participationDocumentContributionSchema>;

export const userDocumentContributionSchema = participationHistoryEntrySchema.extend({
  /**
   * The id of the row this contribution *is* — the version for an upload, the
   * review for a review. One person can contribute to one version twice (they
   * uploaded it, then somebody else's revision came back to them), so the
   * version id alone would not identify a line.
   */
  contributionId: databaseIdSchema,
  contribution: participationDocumentContributionSchema,
  versionId: databaseIdSchema,
  versionNumber: z.number().int().positive(),
  /** Null on versions migrated from the pre-versioning columns, which stored no name. */
  fileName: z.string().nullable(),
  proposalId: databaseIdSchema,
  proposalTitle: z.string(),
  eventSlug: z.string(),
  eventName: trimmedString(1, 180),
  /** The decision recorded by a review; null for an upload, which decides nothing. */
  reviewStatus: presentationReviewStatusSchema.nullable(),
  /** When the version was uploaded, or when the review was recorded. */
  occurredAt: z.string(),
});
export type UserDocumentContribution = z.infer<typeof userDocumentContributionSchema>;

export const userDocumentContributionListResponseSchema = paginatedResponseSchema(
  "documents",
  userDocumentContributionSchema,
);
export type UserDocumentContributionListResponse = z.infer<typeof userDocumentContributionListResponseSchema>;

/* ── Votes the person cast a ballot in ─────────────────────────────────── */

/**
 * That somebody voted — never how.
 *
 * `vote_ballots.choice` is identifiable, and the schema treats it that way:
 * the only surface that returns it is the management ballot audit
 * (`GET /api/v1/groups/:groupId/votes/:voteId/ballots`), reached through the
 * owning group and guarded by `requireVoteManagementAccess` for that specific
 * vote. A contact record is a different question asked by a different reader,
 * and `users:read` is not vote-management authority. Turning a staff person's
 * ability to open a profile into the ability to read everyone's votes would
 * quietly retire that boundary, so this contract has no `choice` field to put
 * one in, and the query that feeds it never projects the column.
 *
 * Participation itself is the fact the record shows: a member's voting record
 * as a record of turnout, which is what a roster of a governance body is
 * entitled to know about the people sitting on it.
 */
export const userVoteParticipationSchema = participationHistoryEntrySchema.extend({
  voteId: databaseIdSchema,
  voteSlug: z.string(),
  voteTitle: trimmedString(1, 300),
  voteType: voteTypeSchema,
  /** The group that called the vote; `votes.owner_group_id` is required, so never null. */
  group: groupSummarySchema,
  /**
   * Which round this ballot was cast in. An eliminating election runs several,
   * and a person taking part in each of them took part several times.
   */
  round: z.number().int().positive(),
  /** When the ballot was submitted. */
  occurredAt: z.string(),
  /**
   * How they voted — present ONLY when the vote itself was configured to
   * publish that: `visibility = 'public'` with `publicDetailLevel =
   * 'full_breakdown'`. Every other vote returns null, and the column is not
   * selected at all, so a ballot's confidentiality is decided by the vote that
   * collected it rather than by who is reading the record.
   */
  choice: z.string().nullable(),
});
export type UserVoteParticipation = z.infer<typeof userVoteParticipationSchema>;

export const userVoteParticipationListResponseSchema = paginatedResponseSchema("votes", userVoteParticipationSchema);
export type UserVoteParticipationListResponse = z.infer<typeof userVoteParticipationListResponseSchema>;

/* ── Route contracts ───────────────────────────────────────────────────── */

/**
 * A person who does not exist has no history, so every collection answers
 * with an empty page rather than a 404 — the record's own detail GET is what
 * tells a reader the person is gone, and four tabs repeating it would not.
 */
const HISTORY_FORBIDDEN = "The users:read permission is required.";
const HISTORY_QUERY_NOTE =
  "Search, sorting, counting, and pagination are executed in bounded D1 queries; the response is one page.";

export const userEventParticipationListRouteSchema = {
  ...requiresPermissions("users:read"),
  tags: ["Users", "Events"],
  summary: "List the events a person took part in",
  description: `Events carrying an active participant role for this person, newest first. ${HISTORY_QUERY_NOTE}`,
  request: { params: userParticipationHistoryParamsSchema, query: participationHistoryListQuerySchema },
  responses: {
    ...ok("A bounded page of event participation.", userEventParticipationListResponseSchema),
    ...authErrors({ forbidden: HISTORY_FORBIDDEN }),
  },
};

export const userMeetingParticipationListRouteSchema = {
  ...requiresPermissions("users:read"),
  tags: ["Users", "Meetings"],
  summary: "List the meetings a person joined",
  description: `Meeting occurrences this person confirmed joining, excluding cancelled ones, newest first. ${HISTORY_QUERY_NOTE}`,
  request: { params: userParticipationHistoryParamsSchema, query: participationHistoryListQuerySchema },
  responses: {
    ...ok("A bounded page of meeting attendance.", userMeetingParticipationListResponseSchema),
    ...authErrors({ forbidden: HISTORY_FORBIDDEN }),
  },
};

export const userDocumentContributionListRouteSchema = {
  ...requiresPermissions("users:read"),
  tags: ["Users", "Presentations"],
  summary: "List the presentation documents a person contributed to",
  description: `Presentation versions this person uploaded or reviewed, newest first. ${HISTORY_QUERY_NOTE}`,
  request: { params: userParticipationHistoryParamsSchema, query: participationHistoryListQuerySchema },
  responses: {
    ...ok("A bounded page of document contributions.", userDocumentContributionListResponseSchema),
    ...authErrors({ forbidden: HISTORY_FORBIDDEN }),
  },
};

export const userVoteParticipationListRouteSchema = {
  ...requiresPermissions("users:read"),
  tags: ["Users", "Votes"],
  summary: "List the votes a person cast a ballot in",
  description:
    "Ballots this person submitted, newest first. Participation only: the choice recorded on a ballot is never " +
    `returned here, and remains limited to the owning group's management ballot audit. ${HISTORY_QUERY_NOTE}`,
  request: { params: userParticipationHistoryParamsSchema, query: participationHistoryListQuerySchema },
  responses: {
    ...ok("A bounded page of ballot participation.", userVoteParticipationListResponseSchema),
    ...authErrors({ forbidden: HISTORY_FORBIDDEN }),
  },
};
