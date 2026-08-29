import { z } from "zod";
import { groupLabelSchema, groupReferenceParamsSchema } from "./groups";
import { jsonErrorResponse, utcInstantSchema } from "./api-common";
import { requiresSession } from "./route-contract";

/** The population represented by the membership counts. */
export const GROUP_STATS_SCOPES = ["current", "historical"] as const;
export const groupStatsScopeSchema = z.enum(GROUP_STATS_SCOPES);

/**
 * Statistics use UTC deliberately. D1 stores application timestamps as ISO
 * UTC text, so accepting arbitrary local time zones here would make a window
 * ambiguous and would prevent the query from using the timestamp indexes.
 */
export const groupStatsQuerySchema = z
  .object({
    scope: groupStatsScopeSchema.default("current"),
    timezone: z.literal("UTC").default("UTC"),
    from: utcInstantSchema.optional(),
    to: utcInstantSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && value.from >= value.to) {
      context.addIssue({ code: "custom", path: ["to"], message: "to must be later than from" });
    }
  });
export type GroupStatsQuery = z.infer<typeof groupStatsQuerySchema>;

const countSchema = z.number().int().min(0);
const participationCountSchema = z.object({ count: countSchema });

export const groupStatsResponseSchema = z.object({
  group: groupLabelSchema,
  generatedAt: utcInstantSchema,
  scope: groupStatsScopeSchema,
  window: z.object({ from: utcInstantSchema.nullable(), to: utcInstantSchema }),
  participation: z.object({
    /** Distinct people, independent of how many Members they represent. */
    people: participationCountSchema,
    /** Membership-capacity rows; one person may contribute several rows. */
    capacities: participationCountSchema,
  }),
  activity: z.object({
    /** Group-scoped auditable actions by attributable people. */
    people: z.object({ actorCount: countSchema, actionCount: countSchema }),
    /** Membership-capacity joins and leaves in the requested window. */
    capacities: z.object({ joinedCount: countSchema, leftCount: countSchema }),
  }),
});
export type GroupStatsResponse = z.infer<typeof groupStatsResponseSchema>;

export const groupStatsRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Statistics"],
  summary: "Read statistics for one managed group",
  description:
    "Returns D1-computed person and membership-capacity counts. Current scope counts active capacities now; historical scope counts capacities overlapping the requested UTC window. No engagement score is inferred.",
  request: { params: groupReferenceParamsSchema, query: groupStatsQuerySchema },
  responses: {
    "200": {
      description: "Group participation and auditable activity statistics.",
      content: { "application/json": { schema: groupStatsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated management identity is required."),
    "403": jsonErrorResponse("Effective group management permission is required."),
    "404": jsonErrorResponse("Group not found."),
  },
};
