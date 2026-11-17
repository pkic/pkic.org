import { z } from "zod";
import { LIVE_REACTION_IDS } from "../live-session-policy";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { liveReactionSchema } from "./live-session-reaction";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresPermissions } from "./route-contract";

const countSchema = z.number().int().nonnegative();

/**
 * How each session's audience took part, from the live sessions' durable
 * copies: reactions, questions and poll answers. A reaction total counts one
 * per person per reaction in each counting window, so it reflects people
 * rather than clicks.
 */
export const sessionPopularityReportRowSchema = z
  .object({
    occurrenceId: databaseIdSchema,
    title: z.string(),
    startAt: utcInstantSchema.nullable(),
    /** Every reaction in display order, zero when nobody used it. */
    reactions: z
      .array(z.object({ reaction: liveReactionSchema, total: countSchema }).strict())
      .length(LIVE_REACTION_IDS.length),
    reactionTotal: countSchema,
    questions: countSchema,
    questionVotes: countSchema,
    pollAnswers: countSchema,
  })
  .strict();
export type SessionPopularityReportRow = z.infer<typeof sessionPopularityReportRowSchema>;

export const SESSION_POPULARITY_REPORT_SORTS = [
  "title",
  "startAt",
  "reactionTotal",
  ...LIVE_REACTION_IDS,
  "questions",
  "questionVotes",
  "pollAnswers",
] as const;
export const sessionPopularityReportQuerySchema = listQuerySchema(SESSION_POPULARITY_REPORT_SORTS).strict();
export type SessionPopularityReportQuery = z.infer<typeof sessionPopularityReportQuerySchema>;

export const sessionPopularityReportResponseSchema = paginatedResponseSchema(
  "sessions",
  sessionPopularityReportRowSchema,
)
  .extend({ timeZone: z.string() })
  .strict();
export type SessionPopularityReportResponse = z.infer<typeof sessionPopularityReportResponseSchema>;

export const sessionPopularityReportRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
  summary: "Compare how each session's audience reacted, asked questions and answered polls",
  request: { params: eventSlugParamsSchema, query: sessionPopularityReportQuerySchema },
  responses: {
    ...ok("Sessions with any audience interaction and their counts", sessionPopularityReportResponseSchema),
    ...authErrors({ badRequest: "The query is not valid.", notFound: "Event unavailable" }),
  },
};
