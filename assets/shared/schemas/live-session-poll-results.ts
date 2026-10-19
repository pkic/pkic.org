import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { formSubmissionStatSchema } from "./form-management";
import { livePollFieldSchema, livePollStatusSchema } from "./live-session-poll";
import { liveRoomParamsSchema } from "./live-session-room";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresPermissions } from "./route-contract";

/**
 * A session's polls as reporting reads them from the durable copy: each
 * question as the form field it was asked as and its counts as the forms
 * results views draw them. Who answered what was never copied.
 */
export const livePollResultSchema = z
  .object({
    id: databaseIdSchema,
    field: livePollFieldSchema,
    status: livePollStatusSchema,
    showResults: z.boolean(),
    results: formSubmissionStatSchema,
    createdAt: utcInstantSchema,
    openedAt: utcInstantSchema.nullable(),
    closedAt: utcInstantSchema.nullable(),
  })
  .strict();
export type LivePollResult = z.infer<typeof livePollResultSchema>;

export const LIVE_POLL_RESULT_SORTS = ["createdAt", "openedAt", "respondents"] as const;
export const livePollResultsQuerySchema = listQuerySchema(LIVE_POLL_RESULT_SORTS);
export type LivePollResultsQuery = z.infer<typeof livePollResultsQuerySchema>;
export const livePollResultsResponseSchema = paginatedResponseSchema("polls", livePollResultSchema);

export const livePollResultsRouteSchema = {
  ...requiresPermissions("agenda:live_moderate"),
  tags: ["Events"],
  summary: "List a session's poll results from its durable copy",
  request: { params: liveRoomParamsSchema, query: livePollResultsQuerySchema },
  responses: {
    ...ok("The session's opened and closed polls with their counts", livePollResultsResponseSchema),
    ...authErrors({ badRequest: "The query is not valid." }),
  },
};
